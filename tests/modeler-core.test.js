import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelerCore, primitiveMesh, MODEL_TYPES, MODELER_VERSION, LEGACY_MODELER_VERSION } from '../src/modeler-core.js';

test('all supported scene types expose valid triangle meshes or empty groups', () => {
  for (const type of MODEL_TYPES) {
    const mesh=primitiveMesh(type);
    assert.ok(Array.isArray(mesh.vertices));
    assert.ok(Array.isArray(mesh.faces));
    assert.ok(mesh.vertices.every(v=>v.length===3));
    assert.ok(mesh.faces.every(f=>f.length===3));
    if(type==='group') assert.deepEqual(mesh,{vertices:[],faces:[]});
    else {
      assert.ok(mesh.vertices.length>=4,type);
      assert.ok(mesh.faces.length>=2,type);
    }
  }
});

test('objects support pivot visibility lock and transforms', () => {
  const core=new ModelerCore();
  const box=core.addObject('box',{name:'Hull',pivot:[0,-.5,0]});
  core.updateObject(box.id,{position:[1,2,3],rotation:[10,20,30],scale:[2,3,4],color:'#112233',visible:false});
  const object=core.getState().objects[0];
  assert.deepEqual(object.position,[1,2,3]);
  assert.deepEqual(object.pivot,[0,-.5,0]);
  assert.equal(object.color,'#112233');
  assert.equal(object.visible,false);
  core.updateObject(box.id,{visible:true,locked:true});
  assert.throws(()=>core.updateObject(box.id,{position:[2,2,3]}),error=>error.code==='OBJECT_LOCKED');
});

test('parent translation rotation and scale propagate through hierarchy', () => {
  const core=new ModelerCore();
  const parent=core.addObject('group',{name:'Arm',position:[0,0,0]});
  const child=core.addObject('box',{name:'Hand',position:[2,0,0],parentId:parent.id});
  core.updateObject(parent.id,{position:[1,0,0]});
  assert.deepEqual(core.getState().objects.find(o=>o.id===child.id).position,[3,0,0]);
  core.updateObject(parent.id,{rotation:[0,0,90]});
  const rotated=core.getState().objects.find(o=>o.id===child.id);
  assert.ok(Math.abs(rotated.position[0]-1)<1e-9);
  assert.ok(Math.abs(rotated.position[1]-2)<1e-9);
  assert.ok(Math.abs(rotated.rotation[2]-90)<1e-9);
  core.updateObject(parent.id,{scale:[2,1,1]});
  const scaled=core.getState().objects.find(o=>o.id===child.id);
  assert.ok(Math.abs(scaled.scale[0]-2)<1e-9);
});

test('reparent preserves current world transform and rejects cycles', () => {
  const core=new ModelerCore();
  const a=core.addObject('group',{position:[5,0,0]});
  const b=core.addObject('box',{position:[2,3,4]});
  const before=core.getState().objects.find(o=>o.id===b.id);
  core.setParent(b.id,a.id);
  const after=core.getState().objects.find(o=>o.id===b.id);
  assert.deepEqual(after.position,before.position);
  assert.throws(()=>core.setParent(a.id,b.id),error=>error.code==='INVALID_HIERARCHY');
});

test('grouping selected objects is one undo step', () => {
  let core=new ModelerCore();
  const a=core.addObject('box',{position:[-1,0,0]});
  const b=core.addObject('box',{position:[1,0,0]});
  core=ModelerCore.fromProject(core.exportProject());
  const group=core.groupObjects([a.id,b.id],'Pair');
  assert.equal(core.getState().objects.find(o=>o.id===a.id).parentId,group.id);
  core.undo();
  const state=core.getState();
  assert.equal(state.objects.length,2);
  assert.ok(state.objects.every(o=>o.parentId===null));
  core.redo();
  assert.equal(core.getState().objects.length,3);
});

test('history grouping collapses drag-like updates into one undo', () => {
  let core=new ModelerCore();
  const box=core.addObject('box');
  core=ModelerCore.fromProject(core.exportProject());
  core.beginHistoryGroup();
  core.updateObject(box.id,{position:[1,0,0]});
  core.updateObject(box.id,{position:[2,0,0]});
  core.updateObject(box.id,{position:[3,0,0]});
  core.endHistoryGroup();
  assert.deepEqual(core.getState().objects[0].position,[3,0,0]);
  core.undo();
  assert.deepEqual(core.getState().objects[0].position,[0,0,0]);
});

test('mirror subtree duplicates hierarchy across selected axis', () => {
  const core=new ModelerCore();
  const root=core.addObject('group',{name:'Right Arm',position:[2,1,0],rotation:[10,20,30]});
  const child=core.addObject('capsule',{name:'Forearm',position:[3,0,1],parentId:root.id});
  const mirrored=core.mirrorSubtree(root.id,'x');
  const mroot=mirrored.find(o=>o.parentId===null);
  const mchild=mirrored.find(o=>o.name.startsWith('Forearm'));
  assert.equal(mroot.position[0],-2);
  assert.equal(mroot.rotation[1],-20);
  assert.equal(mroot.rotation[2],-30);
  assert.equal(mchild.position[0],-3);
  assert.equal(mchild.parentId,mroot.id);
  assert.equal(core.getState().objects.length,4);
  assert.ok(core.getState().objects.some(o=>o.id===child.id));
});

test('hidden or locked parents affect descendants', () => {
  const core=new ModelerCore();
  const parent=core.addObject('group');
  const child=core.addObject('box',{parentId:parent.id});
  core.updateObject(parent.id,{visible:false});
  assert.equal(core.isEffectivelyVisible(child.id),false);
  core.updateObject(parent.id,{visible:true,locked:true});
  assert.equal(core.isEffectivelyLocked(child.id),true);
  assert.throws(()=>core.updateObject(child.id,{position:[1,0,0]}),error=>error.code==='OBJECT_LOCKED');
});

test('project roundtrip preserves v0.2 state and camera projection', () => {
  const core=new ModelerCore();
  const group=core.addObject('group',{name:'Rig'});
  core.addObject('wedge',{parentId:group.id,pivot:[0,-.5,0]});
  core.setCamera({yaw:70,pitch:15,distance:12,target:[1,1,0],projection:'orthographic',orthoScale:6});
  const project=JSON.parse(JSON.stringify(core.exportProject()));
  assert.equal(project.schemaVersion,MODELER_VERSION);
  const restored=ModelerCore.fromProject(project);
  assert.deepEqual(restored.getState().objects,core.getState().objects);
  assert.deepEqual(restored.getState().camera,core.getState().camera);
});

test('legacy v0.1 projects migrate with safe defaults', () => {
  const legacy={
    schemaVersion:LEGACY_MODELER_VERSION,revision:4,
    camera:{yaw:35,pitch:22,distance:8,target:[0,0,0]},
    objects:[{id:'object-1',name:'Old Box',type:'box',position:[1,2,3],rotation:[0,0,0],scale:[1,1,1],color:'#AABBCC'}]
  };
  const restored=ModelerCore.fromProject(legacy);
  const object=restored.getState().objects[0];
  assert.deepEqual(object.pivot,[0,0,0]);
  assert.equal(object.parentId,null);
  assert.equal(object.visible,true);
  assert.equal(object.locked,false);
  assert.equal(restored.getState().camera.projection,'perspective');
});

test('OBJ skips groups and hidden objects', () => {
  const core=new ModelerCore();
  const group=core.addObject('group',{name:'Group'});
  core.addObject('box',{name:'Visible Box',parentId:group.id});
  core.addObject('sphere',{name:'Hidden Sphere',visible:false});
  const obj=core.exportOBJ();
  assert.match(obj,/o Visible_Box/);
  assert.doesNotMatch(obj,/o Group/);
  assert.doesNotMatch(obj,/Hidden_Sphere/);
  assert.match(obj,/^v /m);
  assert.match(obj,/^f /m);
});

test('invalid scale primitive projection and hierarchy are rejected', () => {
  const core=new ModelerCore();
  assert.throws(()=>core.addObject('torus'),/Unknown primitive/);
  const box=core.addObject('box');
  assert.throws(()=>core.updateObject(box.id,{scale:[0,1,1]}),/scale/);
  assert.throws(()=>core.setCamera({projection:'fisheye'}),/projection/i);
  assert.throws(()=>core.setParent(box.id,'missing'),error=>error.code==='OBJECT_NOT_FOUND');
});
