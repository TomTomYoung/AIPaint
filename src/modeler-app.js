import { ModelerCore } from './modeler-core.js';

const $ = id => document.getElementById(id);
const canvas = $('model-canvas');
const ctx = canvas.getContext('2d');
let core = new ModelerCore();
let selectedId = null;
let drag = null;
let redrawPending = false;
let gizmoMode = 'translate';

const AXES = Object.freeze([
  Object.freeze({ axis: 'x', index: 0, vector: [1,0,0], color: '#e45f5f' }),
  Object.freeze({ axis: 'y', index: 1, vector: [0,1,0], color: '#79c96f' }),
  Object.freeze({ axis: 'z', index: 2, vector: [0,0,1], color: '#6d8ee8' })
]);

function message(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function fail(error) {
  message(`${error.code || 'ERROR'}: ${error.message}`, true);
}
function guard(fn) {
  return (...args) => {
    try {
      const result = fn(...args);
      if (result?.catch) result.catch(fail);
      return result;
    } catch (error) {
      fail(error);
    }
  };
}

const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul = (a,n) => [a[0]*n,a[1]*n,a[2]*n];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len = a => Math.hypot(a[0],a[1],a[2]) || 1;
const norm = a => { const l=len(a); return [a[0]/l,a[1]/l,a[2]/l]; };
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const dist2 = (a,b) => (a[0]-b[0])**2 + (a[1]-b[1])**2;

function cameraBasis(camera) {
  const yaw = camera.yaw * Math.PI / 180;
  const pitch = camera.pitch * Math.PI / 180;
  const cp = Math.cos(pitch);
  const eye = [
    camera.target[0] + Math.sin(yaw) * cp * camera.distance,
    camera.target[1] + Math.sin(pitch) * camera.distance,
    camera.target[2] + Math.cos(yaw) * cp * camera.distance
  ];
  const forward = norm(sub(camera.target, eye));
  let right = norm(cross(forward, [0,1,0]));
  if (Math.abs(dot(right,right)) < .0001) right = [1,0,0];
  const up = norm(cross(right, forward));
  return { eye, forward, right, up };
}

function worldToCamera(point, basis) {
  const d = sub(point, basis.eye);
  return [dot(d,basis.right), dot(d,basis.up), dot(d,basis.forward)];
}

function projectCamera([x,y,z]) {
  if (z <= .05) return null;
  const fov = 48 * Math.PI / 180;
  const focal = canvas.height / (2 * Math.tan(fov / 2));
  return [canvas.width / 2 + x * focal / z, canvas.height / 2 - y * focal / z, z];
}

function projectWorld(point, basis) {
  return projectCamera(worldToCamera(point, basis));
}

function hexToRgb(hex) {
  return [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
}
function shadeColor(hex, factor) {
  const [r,g,b] = hexToRgb(hex);
  return `rgb(${Math.round(clamp(r*factor,0,255))},${Math.round(clamp(g*factor,0,255))},${Math.round(clamp(b*factor,0,255))})`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return [
    (event.clientX - rect.left) * canvas.width / rect.width,
    (event.clientY - rect.top) * canvas.height / rect.height
  ];
}

function drawLine3D(a,b,basis,color,width=1) {
  const pa = projectWorld(a,basis);
  const pb = projectWorld(b,basis);
  if (!pa || !pb) return;
  ctx.beginPath();
  ctx.moveTo(pa[0],pa[1]); ctx.lineTo(pb[0],pb[1]);
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.stroke();
}

function renderGrid(basis) {
  const range = 10;
  for (let i=-range;i<=range;i++) {
    const major = i === 0;
    drawLine3D([-range,0,i],[range,0,i],basis,major?'#566b61':'#34433c',major?1.5:1);
    drawLine3D([i,0,-range],[i,0,range],basis,major?'#566b61':'#34433c',major?1.5:1);
  }
  drawLine3D([0,0,0],[2,0,0],basis,'#c95d5d',2);
  drawLine3D([0,0,0],[0,2,0],basis,'#73ba70',2);
  drawLine3D([0,0,0],[0,0,2],basis,'#5d7fc9',2);
}

function objectFaces(state,basis) {
  const faces = [];
  const light = norm([.35,.8,.45]);
  for (const object of state.objects) {
    const mesh = core.meshFor(object.id);
    const camVerts = mesh.vertices.map(v => worldToCamera(v,basis));
    for (const face of mesh.faces) {
      const world = face.map(i => mesh.vertices[i]);
      const cam = face.map(i => camVerts[i]);
      if (cam.some(v => v[2] <= .05)) continue;
      const points = cam.map(projectCamera);
      const normal = norm(cross(sub(world[1],world[0]),sub(world[2],world[0])));
      const brightness = .48 + .52 * Math.abs(dot(normal,light));
      faces.push({
        objectId: object.id,
        points,
        depth: cam.reduce((n,v)=>n+v[2],0)/cam.length,
        fill: shadeColor(object.color, brightness)
      });
    }
  }
  return faces.sort((a,b)=>b.depth-a.depth);
}

function drawSelection(state,basis) {
  const object = state.objects.find(o=>o.id===selectedId);
  if (!object) return;
  const mesh = core.meshFor(object.id);
  const pts = mesh.vertices.map(v => projectWorld(v,basis)).filter(Boolean);
  if (!pts.length) return;
  const xs = pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  ctx.setLineDash([7,5]);
  ctx.strokeStyle='#d8f39f'; ctx.lineWidth=2;
  ctx.strokeRect(minX-5,minY-5,maxX-minX+10,maxY-minY+10);
  ctx.setLineDash([]);
}

function pointSegmentDistance(point,a,b) {
  const ab=[b[0]-a[0],b[1]-a[1]], ap=[point[0]-a[0],point[1]-a[1]];
  const d=ab[0]*ab[0]+ab[1]*ab[1];
  const t=d ? clamp((ap[0]*ab[0]+ap[1]*ab[1])/d,0,1) : 0;
  const p=[a[0]+ab[0]*t,a[1]+ab[1]*t];
  return Math.hypot(point[0]-p[0],point[1]-p[1]);
}

function pointInTriangle(p,a,b,c) {
  const sign=(p1,p2,p3)=>(p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1]);
  const d1=sign(p,a,b),d2=sign(p,b,c),d3=sign(p,c,a);
  const neg=d1<0||d2<0||d3<0, pos=d1>0||d2>0||d3>0;
  return !(neg&&pos);
}

function pickObject(point,state,basis) {
  const faces=objectFaces(state,basis);
  for (let i=faces.length-1;i>=0;i--) {
    const f=faces[i];
    if (pointInTriangle(point,f.points[0],f.points[1],f.points[2])) return f.objectId;
  }
  return null;
}

function selectedObject() {
  return core.getState().objects.find(o => o.id === selectedId) || null;
}

function computeGizmoHandles(state,basis) {
  const object=state.objects.find(o=>o.id===selectedId);
  if (!object) return [];
  const origin=projectWorld(object.position,basis);
  if (!origin) return [];
  const pixelScale=canvas.width / Math.max(1,canvas.getBoundingClientRect().width);

  if (gizmoMode === 'rotate') {
    return AXES.map((item,i)=>({
      kind:'rotate',
      ...item,
      center:origin,
      radius:(46+i*13)*pixelScale
    }));
  }

  const worldLength=clamp(state.camera.distance*.15,.55,2.4);
  return AXES.flatMap(item=>{
    const endpoint=projectWorld(add(object.position,mul(item.vector,worldLength)),basis);
    if (!endpoint || dist2(origin,endpoint)<36) return [];
    return [{
      kind:gizmoMode,
      ...item,
      p0:origin,
      p1:endpoint,
      worldLength
    }];
  });
}

function drawGizmo(state,basis) {
  const handles=computeGizmoHandles(state,basis);
  const pixelScale=canvas.width / Math.max(1,canvas.getBoundingClientRect().width);
  ctx.save();
  ctx.font=`${Math.round(11*pixelScale)}px ui-monospace, monospace`;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  if (gizmoMode==='rotate') {
    for (const h of handles) {
      ctx.beginPath();
      ctx.arc(h.center[0],h.center[1],h.radius,0,Math.PI*2);
      ctx.strokeStyle=h.color;
      ctx.lineWidth=2.5*pixelScale;
      ctx.stroke();
      ctx.fillStyle=h.color;
      ctx.fillText(h.axis.toUpperCase(),h.center[0]+h.radius+10*pixelScale,h.center[1]);
    }
  } else {
    for (const h of handles) {
      ctx.beginPath();
      ctx.moveTo(h.p0[0],h.p0[1]);
      ctx.lineTo(h.p1[0],h.p1[1]);
      ctx.strokeStyle=h.color;
      ctx.lineWidth=3*pixelScale;
      ctx.stroke();
      ctx.fillStyle=h.color;
      if (gizmoMode==='scale') {
        const size=7*pixelScale;
        ctx.fillRect(h.p1[0]-size,h.p1[1]-size,size*2,size*2);
      } else {
        ctx.beginPath();
        ctx.arc(h.p1[0],h.p1[1],7*pixelScale,0,Math.PI*2);
        ctx.fill();
      }
      ctx.fillStyle='#f4f8f2';
      ctx.fillText(h.axis.toUpperCase(),h.p1[0],h.p1[1]-13*pixelScale);
    }
  }
  ctx.restore();
}

function hitGizmo(point) {
  const state=core.getState(), basis=cameraBasis(state.camera);
  const handles=computeGizmoHandles(state,basis);
  const pixelScale=canvas.width / Math.max(1,canvas.getBoundingClientRect().width);
  if (gizmoMode==='rotate') {
    let best=null,bestDistance=Infinity;
    for (const h of handles) {
      const distance=Math.abs(Math.hypot(point[0]-h.center[0],point[1]-h.center[1])-h.radius);
      if (distance<9*pixelScale && distance<bestDistance) { best=h; bestDistance=distance; }
    }
    return best;
  }
  let best=null,bestDistance=Infinity;
  for (const h of handles) {
    const distance=pointSegmentDistance(point,h.p0,h.p1);
    const endDistance=Math.hypot(point[0]-h.p1[0],point[1]-h.p1[1]);
    const score=Math.min(distance,endDistance*.7);
    if (score<10*pixelScale && score<bestDistance) { best=h; bestDistance=score; }
  }
  return best;
}

function render3D() {
  redrawPending = false;
  resizeCanvas();
  const state = core.getState();
  const basis = cameraBasis(state.camera);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#1e2723'; ctx.fillRect(0,0,canvas.width,canvas.height);
  renderGrid(basis);
  for (const face of objectFaces(state,basis)) {
    ctx.beginPath();
    ctx.moveTo(face.points[0][0],face.points[0][1]);
    for (let i=1;i<face.points.length;i++) ctx.lineTo(face.points[i][0],face.points[i][1]);
    ctx.closePath();
    ctx.fillStyle=face.fill; ctx.fill();
    ctx.strokeStyle=face.objectId===selectedId?'#d5ec9f':'#17201c';
    ctx.lineWidth=face.objectId===selectedId?1.8:1;
    ctx.stroke();
  }
  drawSelection(state,basis);
  drawGizmo(state,basis);
}

function requestRender() {
  if (!redrawPending) {
    redrawPending = true;
    requestAnimationFrame(render3D);
  }
}

function setInputsDisabled(disabled) {
  for (const id of ['object-name','object-color','pos-x','pos-y','pos-z','rot-x','rot-y','rot-z','scale-x','scale-y','scale-z','duplicate','remove']) {
    $(id).disabled = disabled;
  }
}

function updateInspector() {
  const object = selectedObject();
  setInputsDisabled(!object);
  if (!object) {
    $('object-name').value='';
    return;
  }
  $('object-name').value=object.name;
  $('object-color').value=object.color.toLowerCase();
  const groups = [
    ['pos',object.position],
    ['rot',object.rotation],
    ['scale',object.scale]
  ];
  for (const [prefix,values] of groups) {
    ['x','y','z'].forEach((axis,i)=>{ $(`${prefix}-${axis}`).value=String(Number(values[i].toFixed(4))); });
  }
}

function renderObjectList() {
  const state=core.getState();
  if (selectedId && !state.objects.some(o=>o.id===selectedId)) selectedId=state.objects.at(-1)?.id || null;
  if (!selectedId && state.objects.length) selectedId=state.objects[0].id;
  $('object-list').replaceChildren(...state.objects.map(object=>{
    const row=document.createElement('div'); row.className='object-row';
    const button=document.createElement('button'); button.classList.toggle('active',object.id===selectedId);
    const title=document.createElement('span'); title.textContent=object.name;
    const type=document.createElement('span'); type.className='object-type'; type.textContent=object.type;
    button.append(title,document.createElement('br'),type);
    button.onclick=()=>{ selectedId=object.id; syncUI(); };
    row.append(button);
    return row;
  }));
  $('revision').textContent=`r${state.revision}`;
  $('scene-summary').textContent=`${state.objects.length} objects / ${state.camera.distance.toFixed(1)} units`;
  updateInspector();
}

function refreshTransformUI() {
  const state=core.getState();
  $('revision').textContent=`r${state.revision}`;
  $('scene-summary').textContent=`${state.objects.length} objects / ${state.camera.distance.toFixed(1)} units`;
  updateInspector();
  requestRender();
}

function syncUI() {
  renderObjectList();
  requestRender();
}

function mutate(fn, status) {
  fn();
  syncUI();
  if (status) message(status);
}

function setGizmoMode(mode) {
  if (!['translate','rotate','scale'].includes(mode)) throw new Error('Unknown gizmo mode');
  gizmoMode=mode;
  for (const button of document.querySelectorAll('[data-gizmo]')) {
    button.setAttribute('aria-pressed',String(button.dataset.gizmo===mode));
  }
  $('gizmo-mode-label').textContent=mode==='translate'?'移動':mode==='rotate'?'回転':'拡縮';
  requestRender();
  return gizmoMode;
}

for (const button of document.querySelectorAll('[data-add]')) {
  button.onclick = guard(() => mutate(() => {
    const object=core.addObject(button.dataset.add);
    selectedId=object.id;
  }, `${button.textContent}を追加しました。`));
}
for (const button of document.querySelectorAll('[data-gizmo]')) {
  button.onclick=guard(()=>{ setGizmoMode(button.dataset.gizmo); message(`ギズモ：${button.textContent}`); });
}

$('duplicate').onclick=guard(()=> {
  if (!selectedId) return;
  mutate(()=>{ selectedId=core.duplicateObject(selectedId).id; },'複製しました。');
});
$('remove').onclick=guard(()=> {
  if (!selectedId) return;
  mutate(()=>{ core.removeObject(selectedId); selectedId=null; },'削除しました。');
});

function transformPatch(kind) {
  return ['x','y','z'].map(axis=>Number($(`${kind}-${axis}`).value));
}
for (const kind of ['pos','rot','scale']) {
  for (const axis of ['x','y','z']) {
    $(`${kind}-${axis}`).onchange=guard(()=> {
      if (!selectedId) return;
      const key=kind==='pos'?'position':kind==='rot'?'rotation':'scale';
      mutate(()=>core.updateObject(selectedId,{[key]:transformPatch(kind)}),'変形を更新しました。');
    });
  }
}
$('object-name').onchange=guard(()=> {
  if (!selectedId) return;
  mutate(()=>core.updateObject(selectedId,{name:$('object-name').value}),'名前を更新しました。');
});
$('object-color').oninput=guard(()=> {
  if (!selectedId) return;
  core.updateObject(selectedId,{color:$('object-color').value});
  renderObjectList(); requestRender();
});

function downloadText(text,name,type='text/plain') {
  const blob=new Blob([text],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
$('save-project').onclick=guard(()=> {
  downloadText(JSON.stringify(core.exportProject(),null,2),'aipaint-blockout.model.json','application/json');
  message('編集可能な3DシーンJSONを保存しました。');
});
$('export-obj').onclick=guard(()=> {
  downloadText(core.exportOBJ(),'aipaint-blockout.obj','text/plain');
  message('OBJを書き出しました。');
});
$('open-project').onchange=guard(async event=> {
  const file=event.target.files[0]; event.target.value='';
  if (!file) return;
  const parsed=JSON.parse(await file.text());
  core=ModelerCore.fromProject(parsed); selectedId=core.getState().objects[0]?.id || null;
  syncUI(); message('3Dシーンを開きました。');
});
$('new-scene').onclick=guard(()=> {
  if (!confirm('現在の3Dシーンを破棄して新規作成しますか？')) return;
  core=new ModelerCore(); selectedId=null; syncUI(); message('新規シーンを作成しました。');
});
$('reset-camera').onclick=guard(()=> {
  core.setCamera({yaw:35,pitch:22,distance:8,target:[0,0,0]});
  syncUI(); message('カメラを初期位置へ戻しました。');
});

canvas.addEventListener('pointerdown',event=>{
  if (event.button!==0) return;
  const point=canvasPoint(event);
  const handle=hitGizmo(point);
  if (handle && selectedId) {
    const object=selectedObject();
    drag={
      kind:'gizmo',
      id:event.pointerId,
      handle,
      startPoint:point,
      startPosition:[...object.position],
      startRotation:[...object.rotation],
      startScale:[...object.scale],
      startAngle:handle.kind==='rotate'?Math.atan2(point[1]-handle.center[1],point[0]-handle.center[0]):0
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor='grabbing';
    return;
  }

  const state=core.getState(),basis=cameraBasis(state.camera);
  const picked=pickObject(point,state,basis);
  if (picked) {
    selectedId=picked;
    syncUI();
    message(`${selectedObject().name} を選択しました。`);
    return;
  }

  const camera=state.camera;
  drag={kind:'orbit',id:event.pointerId,x:event.clientX,y:event.clientY,yaw:camera.yaw,pitch:camera.pitch};
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor='grabbing';
});

canvas.addEventListener('pointermove',event=>{
  const point=canvasPoint(event);
  if (!drag || drag.id!==event.pointerId) {
    canvas.style.cursor=hitGizmo(point)?'pointer':'grab';
    return;
  }

  if (drag.kind==='orbit') {
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    core.setCamera({yaw:drag.yaw-dx*.45,pitch:clamp(drag.pitch+dy*.35,-89,89)});
    refreshTransformUI();
    return;
  }

  const h=drag.handle;
  const fine=event.shiftKey?.2:1;
  if (h.kind==='rotate') {
    const angle=Math.atan2(point[1]-h.center[1],point[0]-h.center[0]);
    let delta=angle-drag.startAngle;
    while(delta>Math.PI)delta-=Math.PI*2;
    while(delta<-Math.PI)delta+=Math.PI*2;
    const rotation=[...drag.startRotation];
    rotation[h.index]+=delta*180/Math.PI*fine;
    core.updateObject(selectedId,{rotation});
  } else {
    const screen=[h.p1[0]-h.p0[0],h.p1[1]-h.p0[1]];
    const mouse=[point[0]-drag.startPoint[0],point[1]-drag.startPoint[1]];
    const denom=screen[0]*screen[0]+screen[1]*screen[1];
    if (denom<1) return;
    const delta=(mouse[0]*screen[0]+mouse[1]*screen[1])/denom*h.worldLength*fine;
    if (h.kind==='translate') {
      const position=[...drag.startPosition];
      position[h.index]+=delta;
      core.updateObject(selectedId,{position});
    } else {
      const scale=[...drag.startScale];
      scale[h.index]=Math.max(.01,scale[h.index]+delta);
      core.updateObject(selectedId,{scale});
    }
  }
  refreshTransformUI();
});

function endDrag(event) {
  if (!drag || (event && drag.id!==event.pointerId)) return;
  const was=drag;
  drag=null;
  canvas.style.cursor='grab';
  if (was.kind==='gizmo') {
    const verb=was.handle.kind==='translate'?'移動':was.handle.kind==='rotate'?'回転':'拡縮';
    message(`${was.handle.axis.toUpperCase()}軸で${verb}しました。`);
  }
}
canvas.addEventListener('pointerup',endDrag);
canvas.addEventListener('pointercancel',endDrag);
canvas.addEventListener('lostpointercapture',()=>endDrag());

canvas.addEventListener('wheel',event=>{
  event.preventDefault();
  const c=core.getState().camera;
  core.setCamera({distance:clamp(c.distance*Math.exp(event.deltaY*.0012),.5,200)});
  refreshTransformUI();
},{passive:false});

document.addEventListener('keydown',event=>{
  if (event.target.closest('input,textarea,select') || event.target.isContentEditable) return;
  if (event.ctrlKey||event.metaKey||event.altKey) return;
  const key=event.key.toLowerCase();
  if (key==='g') setGizmoMode('translate');
  if (key==='r') setGizmoMode('rotate');
  if (key==='s') setGizmoMode('scale');
});

window.addEventListener('resize',requestRender);

function gizmoState() {
  resizeCanvas();
  const state=core.getState(),basis=cameraBasis(state.camera),handles=computeGizmoHandles(state,basis);
  const rect=canvas.getBoundingClientRect();
  const sx=rect.width/canvas.width,sy=rect.height/canvas.height;
  return {
    mode:gizmoMode,
    selectedId,
    handles:handles.map(h=>h.kind==='rotate'
      ? {kind:h.kind,axis:h.axis,index:h.index,center:{x:h.center[0]*sx,y:h.center[1]*sy},radius:h.radius*sx}
      : {kind:h.kind,axis:h.axis,index:h.index,from:{x:h.p0[0]*sx,y:h.p0[1]*sy},to:{x:h.p1[0]*sx,y:h.p1[1]*sy}})
  };
}

core.addObject('box',{name:'Blockout Cube',color:'#8AA3A0'});
selectedId=core.getState().objects[0].id;
setGizmoMode('translate');
syncUI();
message('準備できました。G=移動、R=回転、S=拡縮。ギズモをドラッグして直接変形できます。');

window.blockoutModeler=Object.freeze({
  getState:()=>core.getState(),
  addObject:(type,options)=>{const o=core.addObject(type,options);selectedId=o.id;syncUI();return o;},
  updateObject:(id,patch)=>{const o=core.updateObject(id,patch);syncUI();return o;},
  removeObject:id=>{const o=core.removeObject(id);if(selectedId===id)selectedId=null;syncUI();return o;},
  duplicateObject:id=>{const o=core.duplicateObject(id);selectedId=o.id;syncUI();return o;},
  select:id=>{selectedId=id;syncUI();return selectedObject();},
  setCamera:patch=>{const c=core.setCamera(patch);syncUI();return c;},
  setGizmoMode,
  getGizmoState:gizmoState,
  exportProject:()=>core.exportProject(),
  exportOBJ:()=>core.exportOBJ(),
  openProject:project=>{core=ModelerCore.fromProject(project);selectedId=core.getState().objects[0]?.id||null;syncUI();return core.getState();}
});
