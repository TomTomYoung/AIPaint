export const MODELER_VERSION = 'blockout-modeler/0.2';
export const LEGACY_MODELER_VERSION = 'blockout-modeler/0.1';
export const PRIMITIVE_TYPES = Object.freeze(['box','sphere','cylinder','cone','capsule','wedge','plane']);
export const MODEL_TYPES = Object.freeze([...PRIMITIVE_TYPES,'group']);

export class ModelerError extends Error {
  constructor(code, message) { super(message); this.name='ModelerError'; this.code=code; }
}
const check=(ok,code,message)=>{ if(!ok) throw new ModelerError(code,message); };
const finite=(v,min,max,label)=>{
  check(Number.isFinite(v)&&v>=min&&v<=max,'INVALID_INPUT',`${label} must be ${min}..${max}`);
  return v;
};
const vec3=(v,label,min=-1000,max=1000)=>{
  check(Array.isArray(v)&&v.length===3,'INVALID_INPUT',`${label} must be vec3`);
  return v.map((x,i)=>finite(x,min,max,`${label}[${i}]`));
};
const bool=(v,label)=>{ check(typeof v==='boolean','INVALID_INPUT',`${label} must be boolean`); return v; };
const color=value=>{
  check(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value),'INVALID_INPUT','Color must be #RRGGBB');
  return value.toUpperCase();
};
const clone=value=>structuredClone(value);
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mulComponents=(a,b)=>[a[0]*b[0],a[1]*b[1],a[2]*b[2]];

export function rotateXYZ([x,y,z],[rx,ry,rz]){
  rx*=Math.PI/180; ry*=Math.PI/180; rz*=Math.PI/180;
  let c=Math.cos(rx),s=Math.sin(rx); [y,z]=[y*c-z*s,y*s+z*c];
  c=Math.cos(ry);s=Math.sin(ry); [x,z]=[x*c+z*s,-x*s+z*c];
  c=Math.cos(rz);s=Math.sin(rz); [x,y]=[x*c-y*s,x*s+y*c];
  return [x,y,z];
}
export function inverseRotateXYZ(v,[rx,ry,rz]){
  let [x,y,z]=v;
  let c=Math.cos(-rz*Math.PI/180),s=Math.sin(-rz*Math.PI/180); [x,y]=[x*c-y*s,x*s+y*c];
  c=Math.cos(-ry*Math.PI/180);s=Math.sin(-ry*Math.PI/180); [x,z]=[x*c+z*s,-x*s+z*c];
  c=Math.cos(-rx*Math.PI/180);s=Math.sin(-rx*Math.PI/180); [y,z]=[y*c-z*s,y*s+z*c];
  return [x,y,z];
}

function ringMesh(rings,segments=16){
  const vertices=[],faces=[];
  for(const ring of rings){
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2;
      vertices.push([Math.cos(a)*ring.radius,ring.y,Math.sin(a)*ring.radius]);
    }
  }
  for(let r=0;r<rings.length-1;r++){
    for(let i=0;i<segments;i++){
      const n=(i+1)%segments;
      const a=r*segments+i,b=r*segments+n,c=(r+1)*segments+n,d=(r+1)*segments+i;
      faces.push([a,d,b],[b,d,c]);
    }
  }
  return {vertices,faces};
}

const BASE_MESHES={
  box(){
    return {vertices:[
      [-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
      [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]
    ],faces:[
      [0,2,1],[0,3,2],[4,5,6],[4,6,7],
      [0,1,5],[0,5,4],[3,7,6],[3,6,2],
      [1,2,6],[1,6,5],[0,4,7],[0,7,3]
    ]};
  },
  cylinder(segments=16){
    const vertices=[],faces=[];
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2;
      vertices.push([Math.cos(a)*.5,-.5,Math.sin(a)*.5],[Math.cos(a)*.5,.5,Math.sin(a)*.5]);
    }
    const bottom=vertices.length,top=bottom+1;
    vertices.push([0,-.5,0],[0,.5,0]);
    for(let i=0;i<segments;i++){
      const n=(i+1)%segments,b0=i*2,t0=b0+1,b1=n*2,t1=b1+1;
      faces.push([b0,b1,t1],[b0,t1,t0],[bottom,b1,b0],[top,t0,t1]);
    }
    return {vertices,faces};
  },
  cone(segments=16){
    const vertices=[[0,.5,0],[0,-.5,0]],faces=[];
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2;
      vertices.push([Math.cos(a)*.5,-.5,Math.sin(a)*.5]);
    }
    for(let i=0;i<segments;i++){
      const n=(i+1)%segments,a=2+i,b=2+n;
      faces.push([0,a,b],[1,b,a]);
    }
    return {vertices,faces};
  },
  sphere(lat=8,lon=12){
    const rings=[];
    for(let y=0;y<=lat;y++){
      const theta=y/lat*Math.PI;
      rings.push({y:Math.cos(theta)*.5,radius:Math.sin(theta)*.5});
    }
    return ringMesh(rings,lon);
  },
  capsule(segments=12,hemiSteps=4){
    const rings=[];
    for(let i=0;i<=hemiSteps;i++){
      const a=-Math.PI/2+i/hemiSteps*Math.PI/2;
      rings.push({y:-.5+Math.sin(a)*.5,radius:Math.cos(a)*.5});
    }
    rings.push({y:.5,radius:.5});
    for(let i=1;i<=hemiSteps;i++){
      const a=i/hemiSteps*Math.PI/2;
      rings.push({y:.5+Math.sin(a)*.5,radius:Math.cos(a)*.5});
    }
    return ringMesh(rings,segments);
  },
  wedge(){
    return {vertices:[
      [-.5,-.5,-.5],[.5,-.5,-.5],[-.5,.5,-.5],
      [-.5,-.5,.5],[.5,-.5,.5],[-.5,.5,.5]
    ],faces:[
      [0,1,2],[3,5,4],[0,3,4],[0,4,1],
      [0,2,5],[0,5,3],[1,4,5],[1,5,2],[2,1,5]
    ]};
  },
  plane(){
    return {vertices:[[-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5]],faces:[[0,2,1],[0,3,2]]};
  },
  group(){ return {vertices:[],faces:[]}; }
};

export function primitiveMesh(type){
  check(MODEL_TYPES.includes(type),'UNKNOWN_PRIMITIVE',`Unknown primitive: ${type}`);
  return clone(BASE_MESHES[type]());
}

export function transformVertex(vertex,object){
  const centered=sub(vertex,object.pivot);
  const scaled=mulComponents(centered,object.scale);
  return add(rotateXYZ(scaled,object.rotation),object.position);
}

function validateObject(input){
  check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_INPUT','Object required');
  check(typeof input.id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.id),'INVALID_INPUT','Invalid object id');
  check(typeof input.name==='string'&&input.name.length>0&&input.name.length<=80,'INVALID_INPUT','Invalid object name');
  check(MODEL_TYPES.includes(input.type),'UNKNOWN_PRIMITIVE','Unsupported primitive');
  const parentId=input.parentId??null;
  check(parentId===null||(typeof parentId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(parentId)),'INVALID_INPUT','Invalid parentId');
  return {
    id:input.id,
    name:input.name,
    type:input.type,
    position:vec3(input.position,'position'),
    rotation:vec3(input.rotation,'rotation',-36000,36000),
    scale:vec3(input.scale,'scale',.01,1000),
    pivot:vec3(input.pivot??[0,0,0],'pivot',-1000,1000),
    color:color(input.color??'#8AA3A0'),
    parentId,
    visible:bool(input.visible??true,'visible'),
    locked:bool(input.locked??false,'locked')
  };
}

function snapshotObjects(objects){ return clone(objects); }

export class ModelerCore{
  #objects=[];
  #camera={yaw:35,pitch:22,distance:8,target:[0,0,0],projection:'perspective',orthoScale:8};
  #revision=0;
  #counter=1;
  #undo=[];
  #redo=[];
  #historyLimit=80;
  #grouping=false;
  #groupSnapshot=null;

  getState(){
    return {
      version:MODELER_VERSION,
      revision:this.#revision,
      objects:clone(this.#objects),
      camera:clone(this.#camera),
      canUndo:this.#undo.length>0,
      canRedo:this.#redo.length>0
    };
  }

  #nextId(prefix='object'){
    while(this.#objects.some(o=>o.id===`${prefix}-${this.#counter}`))this.#counter++;
    return `${prefix}-${this.#counter++}`;
  }
  #pushUndo(snapshot){
    this.#undo.push(snapshot);
    if(this.#undo.length>this.#historyLimit)this.#undo.shift();
    this.#redo=[];
  }
  #beforeMutation(){
    if(this.#grouping){
      if(!this.#groupSnapshot)this.#groupSnapshot=snapshotObjects(this.#objects);
    }else{
      this.#pushUndo(snapshotObjects(this.#objects));
    }
  }
  #afterMutation(){ this.#revision++; }
  #recount(){
    let max=0;
    for(const o of this.#objects){
      const m=o.id.match(/-(\d+)$/);
      if(m)max=Math.max(max,Number(m[1]));
    }
    this.#counter=max+1;
  }

  beginHistoryGroup(){
    check(!this.#grouping,'HISTORY_GROUP','History group already open');
    this.#grouping=true; this.#groupSnapshot=null;
  }
  endHistoryGroup(){
    check(this.#grouping,'HISTORY_GROUP','No history group open');
    if(this.#groupSnapshot)this.#pushUndo(this.#groupSnapshot);
    this.#grouping=false; this.#groupSnapshot=null;
    return this.getState();
  }
  cancelHistoryGroup(){
    check(this.#grouping,'HISTORY_GROUP','No history group open');
    if(this.#groupSnapshot){
      this.#objects=this.#groupSnapshot;
      this.#revision++;
      this.#recount();
    }
    this.#grouping=false; this.#groupSnapshot=null;
    return this.getState();
  }
  undo(){
    check(!this.#grouping,'HISTORY_GROUP','Finish active transform first');
    check(this.#undo.length,'EMPTY_HISTORY','Nothing to undo');
    this.#redo.push(snapshotObjects(this.#objects));
    this.#objects=this.#undo.pop();
    this.#revision++; this.#recount();
    return this.getState();
  }
  redo(){
    check(!this.#grouping,'HISTORY_GROUP','Finish active transform first');
    check(this.#redo.length,'EMPTY_HISTORY','Nothing to redo');
    this.#undo.push(snapshotObjects(this.#objects));
    this.#objects=this.#redo.pop();
    this.#revision++; this.#recount();
    return this.getState();
  }

  addObject(type,options={}){
    check(MODEL_TYPES.includes(type),'UNKNOWN_PRIMITIVE',`Unknown primitive: ${type}`);
    const id=options.id||this.#nextId(type==='group'?'group':'object');
    check(!this.#objects.some(o=>o.id===id),'DUPLICATE_ID','Object id already exists');
    if(options.parentId!=null)check(this.#objects.some(o=>o.id===options.parentId),'OBJECT_NOT_FOUND','Parent not found');
    const object=validateObject({
      id,
      name:options.name||`${type} ${this.#objects.length+1}`,
      type,
      position:options.position||[0,0,0],
      rotation:options.rotation||[0,0,0],
      scale:options.scale||[1,1,1],
      pivot:options.pivot||[0,0,0],
      color:options.color||'#8AA3A0',
      parentId:options.parentId??null,
      visible:options.visible??true,
      locked:options.locked??false
    });
    this.#beforeMutation();
    this.#objects.push(object);
    this.#afterMutation();
    return clone(object);
  }

  childrenOf(id){ return this.#objects.filter(o=>o.parentId===id).map(o=>clone(o)); }
  descendantsOf(id){
    const result=[],queue=[id];
    while(queue.length){
      const parent=queue.shift();
      for(const child of this.#objects.filter(o=>o.parentId===parent)){
        result.push(clone(child)); queue.push(child.id);
      }
    }
    return result;
  }
  #descendantRefs(id){
    const result=[],queue=[id];
    while(queue.length){
      const parent=queue.shift();
      for(const child of this.#objects.filter(o=>o.parentId===parent)){
        result.push(child); queue.push(child.id);
      }
    }
    return result;
  }
  depthOf(id){
    let depth=0,current=this.#objects.find(o=>o.id===id),seen=new Set();
    while(current?.parentId){
      check(!seen.has(current.id),'INVALID_HIERARCHY','Hierarchy cycle');
      seen.add(current.id); depth++;
      current=this.#objects.find(o=>o.id===current.parentId);
    }
    return depth;
  }
  isEffectivelyVisible(id){
    let current=this.#objects.find(o=>o.id===id),seen=new Set();
    while(current){
      if(!current.visible)return false;
      if(!current.parentId)return true;
      check(!seen.has(current.id),'INVALID_HIERARCHY','Hierarchy cycle');
      seen.add(current.id); current=this.#objects.find(o=>o.id===current.parentId);
    }
    return false;
  }
  isEffectivelyLocked(id){
    let current=this.#objects.find(o=>o.id===id),seen=new Set();
    while(current){
      if(current.locked)return true;
      if(!current.parentId)return false;
      check(!seen.has(current.id),'INVALID_HIERARCHY','Hierarchy cycle');
      seen.add(current.id); current=this.#objects.find(o=>o.id===current.parentId);
    }
    return false;
  }

  setParent(id,parentId){
    const object=this.#objects.find(o=>o.id===id);
    check(object,'OBJECT_NOT_FOUND','Object not found');
    check(parentId===null||this.#objects.some(o=>o.id===parentId),'OBJECT_NOT_FOUND','Parent not found');
    check(parentId!==id,'INVALID_HIERARCHY','Object cannot parent itself');
    if(parentId){
      check(!this.descendantsOf(id).some(o=>o.id===parentId),'INVALID_HIERARCHY','Hierarchy cycle');
    }
    if(object.parentId===parentId)return clone(object);
    this.#beforeMutation(); object.parentId=parentId; this.#afterMutation();
    return clone(object);
  }

  groupObjects(ids,name='Group'){
    const unique=[...new Set(ids)].filter(id=>this.#objects.some(o=>o.id===id));
    check(unique.length>0,'INVALID_INPUT','Select objects to group');
    const roots=unique.filter(id=>!unique.includes(this.#objects.find(o=>o.id===id)?.parentId));
    const center=[0,0,0];
    for(const id of roots){
      const o=this.#objects.find(x=>x.id===id);
      for(let i=0;i<3;i++)center[i]+=o.position[i]/roots.length;
    }
    this.beginHistoryGroup();
    try{
      const group=this.addObject('group',{name,position:center,color:'#94A29B'});
      for(const id of roots)this.setParent(id,group.id);
      this.endHistoryGroup();
      return group;
    }catch(error){ this.cancelHistoryGroup(); throw error; }
  }

  ungroup(id){
    const group=this.#objects.find(o=>o.id===id);
    check(group&&group.type==='group','INVALID_INPUT','Select a group');
    this.beginHistoryGroup();
    try{
      for(const child of this.#objects.filter(o=>o.parentId===id))this.setParent(child.id,group.parentId);
      this.removeObject(id);
      this.endHistoryGroup();
    }catch(error){ this.cancelHistoryGroup(); throw error; }
    return this.getState();
  }

  updateObject(id,patch){
    const index=this.#objects.findIndex(o=>o.id===id),current=this.#objects[index];
    check(current,'OBJECT_NOT_FOUND','Object not found');
    const unlockingSelf=current.locked&&patch?.locked===false&&Object.keys(patch).every(k=>k==='locked');
    check(!this.isEffectivelyLocked(id)||unlockingSelf,'OBJECT_LOCKED','Object is locked');
    const allowed=new Set(['name','position','rotation','scale','pivot','color','visible','locked']);
    check(patch&&typeof patch==='object'&&!Array.isArray(patch),'INVALID_INPUT','Patch required');
    check(Object.keys(patch).every(k=>allowed.has(k)),'INVALID_INPUT','Unknown object field');
    const next=validateObject({...current,...patch,id:current.id,type:current.type,parentId:current.parentId});
    const descendants=this.#descendantRefs(id);
    this.#beforeMutation();

    const translation=sub(next.position,current.position);
    const rotationDelta=next.rotation.map((v,i)=>v-current.rotation[i]);
    const scaleFactor=next.scale.map((v,i)=>v/current.scale[i]);

    if(translation.some(v=>Math.abs(v)>1e-12)){
      for(const child of descendants)child.position=add(child.position,translation);
    }
    if(rotationDelta.some(v=>Math.abs(v)>1e-12)){
      for(const child of descendants){
        const rel=sub(child.position,next.position);
        child.position=add(next.position,rotateXYZ(rel,rotationDelta));
        child.rotation=child.rotation.map((v,i)=>v+rotationDelta[i]);
      }
    }
    if(scaleFactor.some(v=>Math.abs(v-1)>1e-12)){
      for(const child of descendants){
        const rel=sub(child.position,next.position);
        const local=inverseRotateXYZ(rel,next.rotation);
        child.position=add(next.position,rotateXYZ(mulComponents(local,scaleFactor),next.rotation));
        child.scale=mulComponents(child.scale,scaleFactor);
      }
    }

    this.#objects[index]=next;
    this.#afterMutation();
    return clone(next);
  }

  setPivot(id,pivot){
    const object=this.#objects.find(o=>o.id===id);
    check(object,'OBJECT_NOT_FOUND','Object not found');
    check(!this.isEffectivelyLocked(id),'OBJECT_LOCKED','Object is locked');
    const nextPivot=vec3(pivot,'pivot',-1000,1000);
    const deltaLocal=mulComponents(sub(nextPivot,object.pivot),object.scale);
    const deltaWorld=rotateXYZ(deltaLocal,object.rotation);
    this.#beforeMutation();
    object.position=add(object.position,deltaWorld);
    object.pivot=nextPivot;
    this.#afterMutation();
    return clone(object);
  }

  removeObject(id){
    const index=this.#objects.findIndex(o=>o.id===id),object=this.#objects[index];
    check(object,'OBJECT_NOT_FOUND','Object not found');
    check(!this.isEffectivelyLocked(id),'OBJECT_LOCKED','Object is locked');
    this.#beforeMutation();
    for(const child of this.#objects)if(child.parentId===id)child.parentId=object.parentId;
    const [removed]=this.#objects.splice(index,1);
    this.#afterMutation();
    return clone(removed);
  }

  duplicateObject(id){
    const source=this.#objects.find(o=>o.id===id);
    check(source,'OBJECT_NOT_FOUND','Object not found');
    return this.addObject(source.type,{
      name:`${source.name} copy`,
      position:[source.position[0]+.5,source.position[1],source.position[2]+.5],
      rotation:source.rotation,scale:source.scale,pivot:source.pivot,color:source.color,
      parentId:source.parentId,visible:source.visible,locked:false
    });
  }

  mirrorSubtree(id,axis='x'){
    const axisIndex={x:0,y:1,z:2}[axis];
    check(axisIndex!==undefined,'INVALID_INPUT','Mirror axis must be x, y or z');
    const root=this.#objects.find(o=>o.id===id);
    check(root,'OBJECT_NOT_FOUND','Object not found');
    const originals=[root,...this.#descendantRefs(id)];
    const map=new Map(),created=[];
    const mirrorRotation=rotation=>{
      const r=[...rotation];
      if(axis==='x'){ r[1]*=-1; r[2]*=-1; }
      if(axis==='y'){ r[0]*=-1; r[2]*=-1; }
      if(axis==='z'){ r[0]*=-1; r[1]*=-1; }
      return r;
    };
    this.beginHistoryGroup();
    try{
      for(const original of originals){
        const position=[...original.position]; position[axisIndex]*=-1;
        const pivot=[...original.pivot]; pivot[axisIndex]*=-1;
        const parentId=map.get(original.parentId)||original.parentId;
        const copy=this.addObject(original.type,{
          name:`${original.name} mirror`,position,rotation:mirrorRotation(original.rotation),
          scale:original.scale,pivot,color:original.color,parentId,visible:original.visible,locked:false
        });
        map.set(original.id,copy.id); created.push(copy);
      }
      this.endHistoryGroup();
      return created;
    }catch(error){ this.cancelHistoryGroup(); throw error; }
  }

  setCamera(patch){
    check(patch&&typeof patch==='object'&&!Array.isArray(patch),'INVALID_INPUT','Camera patch required');
    const allowed=new Set(['yaw','pitch','distance','target','projection','orthoScale']);
    check(Object.keys(patch).every(k=>allowed.has(k)),'INVALID_INPUT','Unknown camera field');
    if('yaw'in patch)this.#camera.yaw=finite(patch.yaw,-36000,36000,'yaw');
    if('pitch'in patch)this.#camera.pitch=finite(patch.pitch,-89,89,'pitch');
    if('distance'in patch)this.#camera.distance=finite(patch.distance,.5,200,'distance');
    if('target'in patch)this.#camera.target=vec3(patch.target,'target');
    if('projection'in patch){
      check(['perspective','orthographic'].includes(patch.projection),'INVALID_INPUT','Invalid projection');
      this.#camera.projection=patch.projection;
    }
    if('orthoScale'in patch)this.#camera.orthoScale=finite(patch.orthoScale,.1,500,'orthoScale');
    this.#revision++;
    return clone(this.#camera);
  }

  meshFor(id){
    const object=this.#objects.find(o=>o.id===id);
    check(object,'OBJECT_NOT_FOUND','Object not found');
    const mesh=primitiveMesh(object.type);
    return {vertices:mesh.vertices.map(v=>transformVertex(v,object)),faces:mesh.faces.map(f=>[...f])};
  }

  exportProject(){
    return {schemaVersion:MODELER_VERSION,revision:this.#revision,camera:clone(this.#camera),objects:clone(this.#objects)};
  }

  static fromProject(project){
    check(project&&[MODELER_VERSION,LEGACY_MODELER_VERSION].includes(project.schemaVersion),'INVALID_PROJECT','Unsupported modeler project');
    check(Array.isArray(project.objects),'INVALID_PROJECT','Objects required');
    const core=new ModelerCore(),ids=new Set();
    core.#objects=project.objects.map(object=>{
      const migrated={
        ...object,
        pivot:object.pivot??[0,0,0],
        parentId:object.parentId??null,
        visible:object.visible??true,
        locked:object.locked??false
      };
      const validated=validateObject(migrated);
      check(!ids.has(validated.id),'INVALID_PROJECT','Duplicate object id'); ids.add(validated.id);
      return validated;
    });
    for(const object of core.#objects){
      check(object.parentId===null||ids.has(object.parentId),'INVALID_PROJECT','Missing parent');
      check(object.parentId!==object.id,'INVALID_PROJECT','Self parent');
    }
    for(const object of core.#objects)core.depthOf(object.id);
    core.#camera={
      yaw:finite(project.camera?.yaw??35,-36000,36000,'yaw'),
      pitch:finite(project.camera?.pitch??22,-89,89,'pitch'),
      distance:finite(project.camera?.distance??8,.5,200,'distance'),
      target:vec3(project.camera?.target??[0,0,0],'target'),
      projection:['perspective','orthographic'].includes(project.camera?.projection)?project.camera.projection:'perspective',
      orthoScale:finite(project.camera?.orthoScale??8,.1,500,'orthoScale')
    };
    core.#revision=Number.isSafeInteger(project.revision)&&project.revision>=0?project.revision:0;
    core.#recount();
    return core;
  }

  exportOBJ(){
    const lines=['# AIPaint Object Modeler OBJ'];
    let offset=1;
    for(const object of this.#objects){
      if(object.type==='group'||!this.isEffectivelyVisible(object.id))continue;
      const mesh=this.meshFor(object.id);
      lines.push(`o ${object.name.replace(/\s+/g,'_')}`);
      for(const v of mesh.vertices)lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`);
      for(const face of mesh.faces)lines.push(`f ${face.map(i=>i+offset).join(' ')}`);
      offset+=mesh.vertices.length;
    }
    return lines.join('\n')+'\n';
  }
}
