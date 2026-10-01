import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelerCore, primitiveMesh } from '../src/modeler-core.js';

test('primitive meshes are real 3D triangle meshes', () => {
  for (const type of ['box','sphere','cylinder']) {
    const mesh=primitiveMesh(type);
    assert.ok(mesh.vertices.length >= 8);
    assert.ok(mesh.faces.length >= 12);
    assert.ok(mesh.vertices.every(v=>v.length===3));
    assert.ok(mesh.faces.every(f=>f.length===3));
  }
});

test('objects can be added, transformed, duplicated and removed', () => {
  const core=new ModelerCore();
  const box=core.addObject('box',{name:'Hull'});
  core.updateObject(box.id,{position:[1,2,3],rotation:[10,20,30],scale:[2,3,4],color:'#112233'});
  const state=core.getState();
  assert.deepEqual(state.objects[0].position,[1,2,3]);
  assert.deepEqual(state.objects[0].scale,[2,3,4]);
  const copy=core.duplicateObject(box.id);
  assert.equal(core.getState().objects.length,2);
  core.removeObject(copy.id);
  assert.equal(core.getState().objects.length,1);
});

test('project roundtrip preserves geometry state and camera', () => {
  const core=new ModelerCore();
  core.addObject('cylinder',{position:[2,0,-1],scale:[1,3,1]});
  core.setCamera({yaw:70,pitch:15,distance:12,target:[1,1,0]});
  const restored=ModelerCore.fromProject(JSON.parse(JSON.stringify(core.exportProject())));
  assert.deepEqual(restored.getState().objects,core.getState().objects);
  assert.deepEqual(restored.getState().camera,core.getState().camera);
});

test('OBJ export emits transformed vertices and faces', () => {
  const core=new ModelerCore();
  core.addObject('box',{name:'Test Box',position:[1,0,0]});
  const obj=core.exportOBJ();
  assert.match(obj,/o Test_Box/);
  assert.match(obj,/^v /m);
  assert.match(obj,/^f /m);
  assert.ok(obj.trim().split('\n').filter(line=>line.startsWith('v ')).length===8);
});

test('invalid scale and primitive are rejected', () => {
  const core=new ModelerCore();
  assert.throws(()=>core.addObject('torus'),/Unknown primitive/);
  const box=core.addObject('box');
  assert.throws(()=>core.updateObject(box.id,{scale:[0,1,1]}),/scale/);
});
