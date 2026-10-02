import { ModelerCore, rotateXYZ } from './modeler-core.js';

const $=id=>document.getElementById(id);
const canvas=$('model-canvas');
const ctx=canvas.getContext('2d');
let core=new ModelerCore();
let selectedIds=new Set();
let activeId=null;
let drag=null;
let redrawPending=false;
let gizmoMode='translate';
let axisSpace='world';
let snap={enabled:false,translate:.25,rotate:15,scale:.1};

const AXES=Object.freeze([
  Object.freeze({axis:'x',index:0,vector:[1,0,0],color:'#e45f5f'}),
  Object.freeze({axis:'y',index:1,vector:[0,1,0],color:'#79c96f'}),
  Object.freeze({axis:'z',index:2,vector:[0,0,1],color:'#6d8ee8'})
]);

const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,n)=>[a[0]*n,a[1]*n,a[2]*n];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2])||1;
const norm=a=>{const l=len(a);return[a[0]/l,a[1]/l,a[2]/l];};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const quantize=(value,step)=>Math.round(value/step)*step;

function message(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function fail(error){message(`${error.code||'ERROR'}: ${error.message}`,true);}
function guard(fn){return(...args)=>{try{const result=fn(...args);if(result?.catch)result.catch(fail);return result;}catch(error){fail(error);}};}

function cameraBasis(camera){
  const yaw=camera.yaw*Math.PI/180,pitch=camera.pitch*Math.PI/180,cp=Math.cos(pitch);
  const eye=[
    camera.target[0]+Math.sin(yaw)*cp*camera.distance,
    camera.target[1]+Math.sin(pitch)*camera.distance,
    camera.target[2]+Math.cos(yaw)*cp*camera.distance
  ];
  const forward=norm(sub(camera.target,eye));
  let right=norm(cross(forward,[0,1,0]));
  if(Math.abs(dot(right,right))<.0001)right=[1,0,0];
  const up=norm(cross(right,forward));
  return{eye,forward,right,up};
}
function worldToCamera(point,basis){
  const d=sub(point,basis.eye);
  return[dot(d,basis.right),dot(d,basis.up),dot(d,basis.forward)];
}
function projectCamera([x,y,z],camera){
  if(z<=.05)return null;
  if(camera.projection==='orthographic'){
    const scale=canvas.height/camera.orthoScale;
    return[canvas.width/2+x*scale,canvas.height/2-y*scale,z];
  }
  const fov=48*Math.PI/180,focal=canvas.height/(2*Math.tan(fov/2));
  return[canvas.width/2+x*focal/z,canvas.height/2-y*focal/z,z];
}
function projectWorld(point,basis,camera){return projectCamera(worldToCamera(point,basis),camera);}
function resizeCanvas(){
  const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
}
function canvasPoint(event){
  const rect=canvas.getBoundingClientRect();
  return[(event.clientX-rect.left)*canvas.width/rect.width,(event.clientY-rect.top)*canvas.height/rect.height];
}
function hexToRgb(hex){return[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function shadeColor(hex,factor){
  const[r,g,b]=hexToRgb(hex);
  return`rgb(${Math.round(clamp(r*factor,0,255))},${Math.round(clamp(g*factor,0,255))},${Math.round(clamp(b*factor,0,255))})`;
}
function rotateAroundAxis(v,axis,degrees){
  const a=norm(axis),r=degrees*Math.PI/180,c=Math.cos(r),s=Math.sin(r),k=dot(a,v),cr=cross(a,v);
  return[
    v[0]*c+cr[0]*s+a[0]*k*(1-c),
    v[1]*c+cr[1]*s+a[1]*k*(1-c),
    v[2]*c+cr[2]*s+a[2]*k*(1-c)
  ];
}

function drawLine3D(a,b,basis,camera,color,width=1){
  const pa=projectWorld(a,basis,camera),pb=projectWorld(b,basis,camera);
  if(!pa||!pb)return;
  ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
}
function renderGrid(basis,camera){
  const range=12;
  for(let i=-range;i<=range;i++){
    const major=i===0;
    drawLine3D([-range,0,i],[range,0,i],basis,camera,major?'#566b61':'#34433c',major?1.5:1);
    drawLine3D([i,0,-range],[i,0,range],basis,camera,major?'#566b61':'#34433c',major?1.5:1);
  }
  drawLine3D([0,0,0],[2,0,0],basis,camera,'#c95d5d',2);
  drawLine3D([0,0,0],[0,2,0],basis,camera,'#73ba70',2);
  drawLine3D([0,0,0],[0,0,2],basis,camera,'#5d7fc9',2);
}
function objectFaces(state,basis){
  const faces=[],light=norm([.35,.8,.45]);
  for(const object of state.objects){
    if(object.type==='group'||!core.isEffectivelyVisible(object.id))continue;
    const mesh=core.meshFor(object.id),camVerts=mesh.vertices.map(v=>worldToCamera(v,basis));
    for(const face of mesh.faces){
      const world=face.map(i=>mesh.vertices[i]),cam=face.map(i=>camVerts[i]);
      if(cam.some(v=>v[2]<=.05))continue;
      const points=cam.map(v=>projectCamera(v,state.camera));
      const normal=norm(cross(sub(world[1],world[0]),sub(world[2],world[0])));
      const brightness=.48+.52*Math.abs(dot(normal,light));
      faces.push({objectId:object.id,points,depth:cam.reduce((n,v)=>n+v[2],0)/cam.length,fill:shadeColor(object.color,brightness)});
    }
  }
  return faces.sort((a,b)=>b.depth-a.depth);
}
function pointInTriangle(p,a,b,c){
  const sign=(p1,p2,p3)=>(p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1]);
  const d1=sign(p,a,b),d2=sign(p,b,c),d3=sign(p,c,a),neg=d1<0||d2<0||d3<0,pos=d1>0||d2>0||d3>0;
  return!(neg&&pos);
}
function pickObject(point,state,basis){
  const faces=objectFaces(state,basis);
  for(let i=faces.length-1;i>=0;i--){
    const f=faces[i];
    if(pointInTriangle(point,f.points[0],f.points[1],f.points[2]))return f.objectId;
  }
  return null;
}
function pointSegmentDistance(point,a,b){
  const ab=[b[0]-a[0],b[1]-a[1]],ap=[point[0]-a[0],point[1]-a[1]],d=ab[0]*ab[0]+ab[1]*ab[1];
  const t=d?clamp((ap[0]*ab[0]+ap[1]*ab[1])/d,0,1):0,p=[a[0]+ab[0]*t,a[1]+ab[1]*t];
  return Math.hypot(point[0]-p[0],point[1]-p[1]);
}

function stateMap(state=core.getState()){return new Map(state.objects.map(o=>[o.id,o]));}
function activeObject(){return core.getState().objects.find(o=>o.id===activeId)||null;}
function selectionRoots(state=core.getState()){
  const map=stateMap(state),selected=selectedIds;
  return[...selected].filter(id=>{
    let parent=map.get(id)?.parentId;
    while(parent){if(selected.has(parent))return false;parent=map.get(parent)?.parentId;}
    return map.has(id);
  });
}
function selectionPivot(state=core.getState()){
  const ids=selectionRoots(state);
  if(!ids.length)return[0,0,0];
  const map=stateMap(state),p=[0,0,0];
  for(const id of ids){const o=map.get(id);for(let i=0;i<3;i++)p[i]+=o.position[i]/ids.length;}
  return p;
}
function axisDirection(item,state){
  const active=state.objects.find(o=>o.id===activeId);
  if(axisSpace==='local'&&active)return norm(rotateXYZ(item.vector,active.rotation));
  return item.vector;
}

function computeGizmoHandles(state,basis){
  const active=state.objects.find(o=>o.id===activeId);
  if(!active||!selectedIds.size||core.isEffectivelyLocked(active.id))return[];
  const pivot=selectionPivot(state),origin=projectWorld(pivot,basis,state.camera);
  if(!origin)return[];
  const pixelScale=canvas.width/Math.max(1,canvas.getBoundingClientRect().width);
  if(gizmoMode==='rotate'){
    return AXES.map((item,i)=>({kind:'rotate',...item,axisDir:axisDirection(item,state),center:origin,radius:(46+i*13)*pixelScale,pivot}));
  }
  const worldLength=clamp(state.camera.projection==='orthographic'?state.camera.orthoScale*.13:state.camera.distance*.15,.55,2.8);
  return AXES.flatMap(item=>{
    const axisDir=axisDirection(item,state),endpoint=projectWorld(add(pivot,mul(axisDir,worldLength)),basis,state.camera);
    if(!endpoint)return[];
    return[{kind:gizmoMode,...item,axisDir,p0:origin,p1:endpoint,worldLength,pivot}];
  });
}
function hitGizmo(point){
  const state=core.getState(),basis=cameraBasis(state.camera),handles=computeGizmoHandles(state,basis);
  const pixelScale=canvas.width/Math.max(1,canvas.getBoundingClientRect().width);
  if(gizmoMode==='rotate'){
    let best=null,bestDistance=Infinity;
    for(const h of handles){
      const d=Math.abs(Math.hypot(point[0]-h.center[0],point[1]-h.center[1])-h.radius);
      if(d<9*pixelScale&&d<bestDistance){best=h;bestDistance=d;}
    }
    return best;
  }
  let best=null,bestDistance=Infinity;
  for(const h of handles){
    const d=pointSegmentDistance(point,h.p0,h.p1),e=Math.hypot(point[0]-h.p1[0],point[1]-h.p1[1]),score=Math.min(d,e*.7);
    if(score<10*pixelScale&&score<bestDistance){best=h;bestDistance=score;}
  }
  return best;
}

function drawSelections(state,basis){
  for(const id of selectedIds){
    const object=state.objects.find(o=>o.id===id);
    if(!object||!core.isEffectivelyVisible(id))continue;
    if(object.type==='group'){
      const p=projectWorld(object.position,basis,state.camera);
      if(!p)continue;
      ctx.beginPath();ctx.arc(p[0],p[1],id===activeId?9:6,0,Math.PI*2);ctx.strokeStyle=id===activeId?'#e4f7b7':'#9fba8c';ctx.lineWidth=2;ctx.stroke();
      continue;
    }
    const mesh=core.meshFor(id),pts=mesh.vertices.map(v=>projectWorld(v,basis,state.camera)).filter(Boolean);
    if(!pts.length)continue;
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    ctx.setLineDash(id===activeId?[7,5]:[3,4]);ctx.strokeStyle=id===activeId?'#d8f39f':'#8eaa80';ctx.lineWidth=id===activeId?2:1.4;
    ctx.strokeRect(minX-5,minY-5,maxX-minX+10,maxY-minY+10);ctx.setLineDash([]);
  }
}
function drawGizmo(state,basis){
  const handles=computeGizmoHandles(state,basis),pixelScale=canvas.width/Math.max(1,canvas.getBoundingClientRect().width);
  ctx.save();ctx.font=`${Math.round(11*pixelScale)}px ui-monospace,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
  if(gizmoMode==='rotate'){
    for(const h of handles){
      ctx.beginPath();ctx.arc(h.center[0],h.center[1],h.radius,0,Math.PI*2);ctx.strokeStyle=h.color;ctx.lineWidth=2.5*pixelScale;ctx.stroke();
      ctx.fillStyle=h.color;ctx.fillText(h.axis.toUpperCase(),h.center[0]+h.radius+10*pixelScale,h.center[1]);
    }
  }else{
    for(const h of handles){
      ctx.beginPath();ctx.moveTo(h.p0[0],h.p0[1]);ctx.lineTo(h.p1[0],h.p1[1]);ctx.strokeStyle=h.color;ctx.lineWidth=3*pixelScale;ctx.stroke();
      ctx.fillStyle=h.color;
      if(gizmoMode==='scale'){const size=7*pixelScale;ctx.fillRect(h.p1[0]-size,h.p1[1]-size,size*2,size*2);}
      else{ctx.beginPath();ctx.arc(h.p1[0],h.p1[1],7*pixelScale,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle='#f4f8f2';ctx.fillText(h.axis.toUpperCase(),h.p1[0],h.p1[1]-13*pixelScale);
    }
  }
  ctx.restore();
}
function render3D(){
  redrawPending=false;resizeCanvas();
  const state=core.getState(),basis=cameraBasis(state.camera);
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#1e2723';ctx.fillRect(0,0,canvas.width,canvas.height);
  renderGrid(basis,state.camera);
  for(const face of objectFaces(state,basis)){
    ctx.beginPath();ctx.moveTo(face.points[0][0],face.points[0][1]);for(let i=1;i<face.points.length;i++)ctx.lineTo(face.points[i][0],face.points[i][1]);ctx.closePath();
    ctx.fillStyle=face.fill;ctx.fill();ctx.strokeStyle=selectedIds.has(face.objectId)?'#d5ec9f':'#17201c';ctx.lineWidth=face.objectId===activeId?1.8:1;ctx.stroke();
  }
  drawSelections(state,basis);drawGizmo(state,basis);
}
function requestRender(){if(!redrawPending){redrawPending=true;requestAnimationFrame(render3D);}}

function setSelection(ids,active=undefined){
  const state=core.getState(),valid=new Set(state.objects.map(o=>o.id));
  selectedIds=new Set([...ids].filter(id=>valid.has(id)));
  if(active!==undefined&&selectedIds.has(active))activeId=active;
  else if(!selectedIds.has(activeId))activeId=[...selectedIds].at(-1)||null;
  syncUI();
}
function clickSelect(id,additive=false){
  if(additive){
    const next=new Set(selectedIds);
    if(next.has(id))next.delete(id);else next.add(id);
    setSelection(next,next.has(id)?id:undefined);
  }else setSelection([id],id);
}

function objectTree(state){
  const children=new Map();
  for(const o of state.objects){const key=o.parentId||'';if(!children.has(key))children.set(key,[]);children.get(key).push(o);}
  const result=[];
  const walk=(parent,depth)=>{for(const o of children.get(parent)||[]){result.push({object:o,depth});walk(o.id,depth+1);}};
  walk('',0);return result;
}
function renderOutliner(){
  const state=core.getState();
  for(const id of [...selectedIds])if(!state.objects.some(o=>o.id===id))selectedIds.delete(id);
  if(activeId&&!state.objects.some(o=>o.id===activeId))activeId=null;
  if(!activeId&&selectedIds.size)activeId=[...selectedIds].at(-1);

  $('object-list').replaceChildren(...objectTree(state).map(({object,depth})=>{
    const row=document.createElement('div');row.className='object-row';
    const select=document.createElement('button');select.className='select-object';
    select.classList.toggle('selected',selectedIds.has(object.id));select.classList.toggle('active',activeId===object.id);
    const indent=document.createElement('span');indent.className='indent';indent.style.width=`${depth*12}px`;
    const name=document.createElement('span');name.className='object-name';name.textContent=object.name;
    const type=document.createElement('span');type.className='object-type';type.textContent=object.type;
    select.append(indent,name,document.createElement('br'),document.createTextNode(' '.repeat(depth)),type);
    select.onclick=e=>clickSelect(object.id,e.shiftKey);

    const visible=document.createElement('button');visible.className='icon-button';visible.textContent=object.visible?'V':'—';visible.title='表示';
    visible.onclick=guard(e=>{e.stopPropagation();core.updateObject(object.id,{visible:!object.visible});syncUI();});
    const locked=document.createElement('button');locked.className='icon-button';locked.textContent=object.locked?'L':'—';locked.title='ロック';
    locked.onclick=guard(e=>{e.stopPropagation();core.updateObject(object.id,{locked:!object.locked});syncUI();});
    row.append(select,visible,locked);return row;
  }));
}

function setInspectorDisabled(disabled){
  for(const id of ['object-name','object-color','object-visible','object-locked','pos-x','pos-y','pos-z','rot-x','rot-y','rot-z','scale-x','scale-y','scale-z','pivot-x','pivot-y','pivot-z','pivot-center','pivot-bottom','parent-select'])$(id).disabled=disabled;
}
function updateInspector(){
  const state=core.getState(),object=state.objects.find(o=>o.id===activeId);
  setInspectorDisabled(!object);
  $('selection-summary').textContent=`${selectedIds.size} selected`;
  if(!object){$('object-name').value='';return;}
  $('object-name').value=object.name;$('object-color').value=object.color.toLowerCase();$('object-visible').checked=object.visible;$('object-locked').checked=object.locked;
  for(const[prefix,values]of[['pos',object.position],['rot',object.rotation],['scale',object.scale],['pivot',object.pivot]]){
    ['x','y','z'].forEach((axis,i)=>{$(`${prefix}-${axis}`).value=String(Number(values[i].toFixed(4)));});
  }
  const descendants=new Set(core.descendantsOf(object.id).map(o=>o.id));
  $('parent-select').replaceChildren(new Option('None',''),...state.objects.filter(o=>o.id!==object.id&&!descendants.has(o.id)).map(o=>new Option(o.name,o.id)));
  $('parent-select').value=object.parentId||'';
}
function refreshMeta(){
  const state=core.getState();
  $('revision').textContent=`r${state.revision}`;$('scene-summary').textContent=`${state.objects.length} objects / ${selectedIds.size} selected`;
  $('undo').disabled=!state.canUndo;$('redo').disabled=!state.canRedo;
  $('projection-label').textContent=state.camera.projection==='orthographic'?'Orthographic':'Perspective';
  $('toggle-projection').textContent=state.camera.projection==='orthographic'?'Perspective':'Ortho';
  $('axis-space').childNodes[0].nodeValue=axisSpace==='world'?'World ':'Local ';
}
function syncUI(){renderOutliner();updateInspector();refreshMeta();requestRender();}
function refreshTransformUI(){updateInspector();refreshMeta();requestRender();}

function setGizmoMode(mode){
  if(!['translate','rotate','scale'].includes(mode))throw new Error('Unknown gizmo mode');
  gizmoMode=mode;
  for(const button of document.querySelectorAll('[data-gizmo]'))button.setAttribute('aria-pressed',String(button.dataset.gizmo===mode));
  $('gizmo-mode-label').textContent=mode==='translate'?'移動':mode==='rotate'?'回転':'拡縮';requestRender();return mode;
}
function setAxisSpace(space){
  if(!['world','local'].includes(space))throw new Error('Unknown axis space');
  axisSpace=space;refreshMeta();requestRender();return space;
}
function updateSnapFromUI(){
  snap={enabled:$('snap-enabled').checked,translate:Number($('snap-translate').value),rotate:Number($('snap-rotate').value),scale:Number($('snap-scale').value)};
}

for(const button of document.querySelectorAll('[data-add]')){
  button.onclick=guard(()=>{
    const type=button.dataset.add,o=core.addObject(type,{name:`${type[0].toUpperCase()+type.slice(1)}`});
    setSelection([o.id],o.id);message(`${type} を追加しました。`);
  });
}
for(const button of document.querySelectorAll('[data-gizmo]'))button.onclick=()=>{setGizmoMode(button.dataset.gizmo);message(`ギズモ：${button.textContent.trim()}`);};
$('axis-space').onclick=()=>{setAxisSpace(axisSpace==='world'?'local':'world');message(`Axis: ${axisSpace}`);};
for(const id of ['snap-enabled','snap-translate','snap-rotate','snap-scale'])$(id).onchange=updateSnapFromUI;

$('undo').onclick=guard(()=>{core.undo();syncUI();message('Undo');});
$('redo').onclick=guard(()=>{core.redo();syncUI();message('Redo');});
$('duplicate').onclick=guard(()=>{
  if(!activeId)return;const o=core.duplicateObject(activeId);setSelection([o.id],o.id);message('複製しました。');
});
$('remove').onclick=guard(()=>{
  const ids=selectionRoots();
  if(!ids.length)return;
  core.beginHistoryGroup();
  try{for(const id of ids)core.removeObject(id);core.endHistoryGroup();}catch(error){core.cancelHistoryGroup();throw error;}
  setSelection([]);message('選択オブジェクトを削除しました。');
});
$('group').onclick=guard(()=>{
  if(!selectedIds.size)return;const group=core.groupObjects([...selectedIds]);setSelection([group.id],group.id);message('グループ化しました。');
});
$('ungroup').onclick=guard(()=>{const o=activeObject();if(!o||o.type!=='group')return;core.ungroup(o.id);setSelection([]);message('グループ解除しました。');});
$('parent-select').onchange=guard(()=>{if(!activeId)return;core.setParent(activeId,$('parent-select').value||null);syncUI();message('Parentを変更しました。');});
for(const button of document.querySelectorAll('[data-mirror]')){
  button.onclick=guard(()=>{if(!activeId)return;const created=core.mirrorSubtree(activeId,button.dataset.mirror);const root=created[0];setSelection([root.id],root.id);message(`${button.dataset.mirror.toUpperCase()} Mirrorを作成しました。`);});
}

function inputVec(prefix){return['x','y','z'].map(axis=>Number($(`${prefix}-${axis}`).value));}
for(const kind of ['pos','rot','scale','pivot']){
  for(const axis of ['x','y','z']){
    $(`${kind}-${axis}`).onchange=guard(()=>{
      if(!activeId)return;
      if(kind==='pivot')core.setPivot(activeId,inputVec(kind));
      else{
        const key=kind==='pos'?'position':kind==='rot'?'rotation':'scale';
        core.updateObject(activeId,{[key]:inputVec(kind)});
      }
      syncUI();message('Transformを更新しました。');
    });
  }
}
$('object-name').onchange=guard(()=>{if(activeId){core.updateObject(activeId,{name:$('object-name').value});syncUI();}});
$('object-color').onchange=guard(()=>{if(activeId){core.updateObject(activeId,{color:$('object-color').value});syncUI();}});
$('object-visible').onchange=guard(()=>{if(activeId){core.updateObject(activeId,{visible:$('object-visible').checked});syncUI();}});
$('object-locked').onchange=guard(()=>{if(activeId){core.updateObject(activeId,{locked:$('object-locked').checked});syncUI();}});
$('pivot-center').onclick=guard(()=>{if(activeId){core.setPivot(activeId,[0,0,0]);syncUI();}});
$('pivot-bottom').onclick=guard(()=>{if(activeId){core.setPivot(activeId,[0,-.5,0]);syncUI();}});

function setView(name){
  const views={front:[0,0],back:[180,0],right:[90,0],left:[-90,0],top:[0,89],bottom:[0,-89],iso:[35,22]};
  const[yaw,pitch]=views[name];core.setCamera({yaw,pitch});syncUI();
}
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>setView(button.dataset.view);
$('toggle-projection').onclick=()=>{const c=core.getState().camera;core.setCamera({projection:c.projection==='perspective'?'orthographic':'perspective'});syncUI();};
$('reset-camera').onclick=()=>{core.setCamera({yaw:35,pitch:22,distance:8,target:[0,0,0],projection:'perspective',orthoScale:8});syncUI();};
$('frame-selection').onclick=()=>{if(!selectedIds.size)return;const p=selectionPivot();core.setCamera({target:p});syncUI();};
$('new-scene').onclick=guard(()=>{if(!confirm('現在の3Dシーンを破棄して新規作成しますか？'))return;core=new ModelerCore();selectedIds.clear();activeId=null;syncUI();message('新規シーンを作成しました。');});

function downloadText(text,name,type='text/plain'){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('save-project').onclick=()=>{downloadText(JSON.stringify(core.exportProject(),null,2),'aipaint-object-model.model.json','application/json');message('シーンJSONを保存しました。');};
$('export-obj').onclick=()=>{downloadText(core.exportOBJ(),'aipaint-object-model.obj');message('OBJを書き出しました。');};
$('open-project').onchange=guard(async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  core=ModelerCore.fromProject(JSON.parse(await file.text()));selectedIds.clear();activeId=null;syncUI();message('シーンを開きました。');
});

canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  const point=canvasPoint(event),handle=hitGizmo(point);
  if(handle&&activeId){
    const state=core.getState(),roots=selectionRoots(state).filter(id=>!core.isEffectivelyLocked(id)),map=stateMap(state);
    if(!roots.length)return;
    core.beginHistoryGroup();
    drag={
      kind:'gizmo',id:event.pointerId,handle,startPoint:point,pivot:handle.pivot,
      roots,startObjects:new Map(roots.map(id=>[id,structuredClone(map.get(id))])),
      startAngle:handle.kind==='rotate'?Math.atan2(point[1]-handle.center[1],point[0]-handle.center[0]):0
    };
    canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';return;
  }
  const state=core.getState(),basis=cameraBasis(state.camera),picked=pickObject(point,state,basis);
  if(picked){clickSelect(picked,event.shiftKey);message(`${activeObject()?.name||'Object'} を選択しました。`);return;}
  drag={kind:'orbit',id:event.pointerId,x:event.clientX,y:event.clientY,yaw:state.camera.yaw,pitch:state.camera.pitch};
  canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
});
canvas.addEventListener('pointermove',event=>{
  const point=canvasPoint(event);
  if(!drag||drag.id!==event.pointerId){canvas.style.cursor=hitGizmo(point)?'pointer':'grab';return;}
  if(drag.kind==='orbit'){
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    core.setCamera({yaw:drag.yaw-dx*.45,pitch:clamp(drag.pitch+dy*.35,-89,89)});refreshMeta();requestRender();return;
  }
  const h=drag.handle,fine=event.shiftKey ? .2 : 1;
  if(h.kind==='rotate'){
    const angle=Math.atan2(point[1]-h.center[1],point[0]-h.center[0]);let degrees=(angle-drag.startAngle)*180/Math.PI*fine;
    while(degrees>180)degrees-=360;while(degrees<-180)degrees+=360;
    if(snap.enabled)degrees=quantize(degrees,snap.rotate);
    for(const id of drag.roots){
      const start=drag.startObjects.get(id),rel=sub(start.position,drag.pivot),position=add(drag.pivot,rotateAroundAxis(rel,h.axisDir,degrees)),rotation=[...start.rotation];
      rotation[h.index]+=degrees;core.updateObject(id,{position,rotation});
    }
  }else{
    const screen=[h.p1[0]-h.p0[0],h.p1[1]-h.p0[1]],mouse=[point[0]-drag.startPoint[0],point[1]-drag.startPoint[1]],denom=screen[0]**2+screen[1]**2;
    if(denom<1)return;
    let delta=(mouse[0]*screen[0]+mouse[1]*screen[1])/denom*h.worldLength*fine;
    if(h.kind==='translate'&&snap.enabled)delta=quantize(delta,snap.translate);
    if(h.kind==='translate'){
      for(const id of drag.roots){const start=drag.startObjects.get(id);core.updateObject(id,{position:add(start.position,mul(h.axisDir,delta))});}
    }else{
      const rawFactor=Math.max(.01,1+delta);
      for(const id of drag.roots){
        const start=drag.startObjects.get(id),scale=[...start.scale];
        let factor=rawFactor,target=start.scale[h.index]*factor;
        if(snap.enabled)target=Math.max(.01,quantize(target,snap.scale));
        factor=target/start.scale[h.index];scale[h.index]=target;
        const rel=sub(start.position,drag.pivot),along=dot(rel,h.axisDir),position=add(start.position,mul(h.axisDir,along*(factor-1)));
        core.updateObject(id,{position,scale});
      }
    }
  }
  refreshTransformUI();
});
function endDrag(event){
  if(!drag||(event&&drag.id!==event.pointerId))return;
  const was=drag;drag=null;canvas.style.cursor='grab';
  if(was.kind==='gizmo'){
    core.endHistoryGroup();syncUI();
    const verb=was.handle.kind==='translate'?'移動':was.handle.kind==='rotate'?'回転':'拡縮';
    message(`${was.handle.axis.toUpperCase()}軸で${verb}しました。`);
  }
}
canvas.addEventListener('pointerup',guard(endDrag));
canvas.addEventListener('pointercancel',guard(event=>{if(drag?.kind==='gizmo')core.cancelHistoryGroup();drag=null;syncUI();}));
canvas.addEventListener('lostpointercapture',()=>{
  if(drag?.kind==='gizmo'){
    try{core.endHistoryGroup();}catch{/* transform may already be committed */}
    syncUI();
  }
  drag=null;
});
canvas.addEventListener('wheel',event=>{
  event.preventDefault();const c=core.getState().camera;
  if(c.projection==='orthographic')core.setCamera({orthoScale:clamp(c.orthoScale*Math.exp(event.deltaY*.0012),.1,500)});
  else core.setCamera({distance:clamp(c.distance*Math.exp(event.deltaY*.0012),.5,200)});
  refreshMeta();requestRender();
},{passive:false});

document.addEventListener('keydown',event=>{
  if(event.target.closest('input,textarea,select')||event.target.isContentEditable)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();(event.shiftKey?$('redo'):$('undo')).click();return;}
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const key=event.key.toLowerCase();
  if(key==='g')setGizmoMode('translate');
  if(key==='r')setGizmoMode('rotate');
  if(key==='s')setGizmoMode('scale');
  if(key==='w')setAxisSpace(axisSpace==='world'?'local':'world');
});
window.addEventListener('resize',requestRender);

function gizmoState(){
  resizeCanvas();const state=core.getState(),basis=cameraBasis(state.camera),handles=computeGizmoHandles(state,basis),rect=canvas.getBoundingClientRect(),sx=rect.width/canvas.width,sy=rect.height/canvas.height;
  return{mode:gizmoMode,axisSpace,activeId,selectedIds:[...selectedIds],handles:handles.map(h=>h.kind==='rotate'
    ?{kind:h.kind,axis:h.axis,index:h.index,center:{x:h.center[0]*sx,y:h.center[1]*sy},radius:h.radius*sx}
    :{kind:h.kind,axis:h.axis,index:h.index,from:{x:h.p0[0]*sx,y:h.p0[1]*sy},to:{x:h.p1[0]*sx,y:h.p1[1]*sy}})};
}

const initial=core.addObject('box',{name:'Blockout Cube',color:'#8AA3A0'});
selectedIds=new Set([initial.id]);activeId=initial.id;setGizmoMode('translate');updateSnapFromUI();syncUI();
message('Object Mode v0.2。Shift複数選択、Group、Mirror、Snap、World/Local、Ortho、Undo/Redoが使えます。');

window.blockoutModeler=Object.freeze({
  getState:()=>core.getState(),
  getSelection:()=>({activeId,selectedIds:[...selectedIds]}),
  select:(ids,active)=>{setSelection(Array.isArray(ids)?ids:[ids],active??(Array.isArray(ids)?ids.at(-1):ids));return activeObject();},
  addObject:(type,options)=>{const o=core.addObject(type,options);setSelection([o.id],o.id);return o;},
  updateObject:(id,patch)=>{const o=core.updateObject(id,patch);syncUI();return o;},
  removeObject:id=>{const o=core.removeObject(id);selectedIds.delete(id);if(activeId===id)activeId=null;syncUI();return o;},
  duplicateObject:id=>{const o=core.duplicateObject(id);setSelection([o.id],o.id);return o;},
  setParent:(id,parentId)=>{const o=core.setParent(id,parentId);syncUI();return o;},
  setPivot:(id,pivot)=>{const o=core.setPivot(id,pivot);syncUI();return o;},
  groupObjects:(ids,name)=>{const o=core.groupObjects(ids,name);setSelection([o.id],o.id);return o;},
  mirrorSubtree:(id,axis)=>{const a=core.mirrorSubtree(id,axis);setSelection([a[0].id],a[0].id);return a;},
  undo:()=>{const s=core.undo();syncUI();return s;},
  redo:()=>{const s=core.redo();syncUI();return s;},
  setCamera:patch=>{const c=core.setCamera(patch);syncUI();return c;},
  setGizmoMode,
  setAxisSpace,
  setSnap:patch=>{snap={...snap,...patch};return structuredClone(snap);},
  getGizmoState:gizmoState,
  exportProject:()=>core.exportProject(),
  exportOBJ:()=>core.exportOBJ(),
  openProject:project=>{core=ModelerCore.fromProject(project);selectedIds.clear();activeId=null;syncUI();return core.getState();}
});
