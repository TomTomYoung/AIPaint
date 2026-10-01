import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRouter, ToolRoutingError } from '../src/tool-router.js';

test('pixel work is routed to the local pixel adapter', () => {
  const router = createToolRouter({ adapters: [{ id: 'pixel', execute: payload => payload }] });
  const route = router.route({ purpose: 'pixel-sprite' });
  assert.equal(route.toolId, 'pixel');
  assert.equal(route.available, true);
  assert.equal(route.requiresHandoff, false);
});

test('3D work never falls back to the pixel renderer', () => {
  const router = createToolRouter({ adapters: [{ id: 'pixel', execute: payload => payload }] });
  const route = router.route({ purpose: '3d-model' });
  assert.equal(route.toolId, 'blender-3d');
  assert.equal(route.available, false);
  assert.equal(route.requiresHandoff, true);
  assert.deepEqual(route.pipeline, ['blender-3d']);
});

test('3D blockout uses the local modeler without changing full 3D routing', () => {
  const router = createToolRouter({ adapters: [
    { id: 'pixel', execute: payload => payload },
    { id: 'blockout-3d', execute: payload => ({ workspace: 'modeler', payload }) }
  ] });
  const blockout = router.route({ purpose: '3d-blockout' });
  assert.equal(blockout.toolId, 'blockout-3d');
  assert.equal(blockout.available, true);
  assert.equal(blockout.requiresHandoff, false);
  assert.equal(router.route({ purpose: '3d-model' }).toolId, 'blender-3d');
});

test('multi-tool production plans preserve their intended order', () => {
  const router = createToolRouter();
  const plan = router.plan('3d-render-to-2d');
  assert.deepEqual(plan.steps.map(step => step.toolId), ['blender-3d', 'raster-editor']);
});

test('manual selection is limited to tools valid for the purpose', () => {
  const router = createToolRouter();
  router.selectPurpose('vector-asset');
  assert.throws(() => router.selectTool('pixel'), error => error instanceof ToolRoutingError && error.code === 'TOOL_MISMATCH');
});

test('execution switches to a registered purpose-specific adapter', async () => {
  const calls = [];
  const router = createToolRouter({
    adapters: [
      { id: 'pixel', execute: payload => ({ kind: 'pixel', payload }) },
      { id: 'blender-3d', execute: (payload, route) => { calls.push(route.toolId); return { kind: '3d', payload }; } }
    ]
  });
  router.selectPurpose('3d-pose-reference');
  const result = await router.execute({ payload: { pose: 'deep-squat' } });
  assert.deepEqual(result, { kind: '3d', payload: { pose: 'deep-squat' } });
  assert.deepEqual(calls, ['blender-3d']);
});

test('a tool becomes available when an adapter is registered later', () => {
  const router = createToolRouter();
  assert.equal(router.route({ purpose: '3d-model' }).available, false);
  router.registerAdapter({ id: 'blender-3d', execute: payload => payload });
  assert.equal(router.route({ purpose: '3d-model' }).available, true);
});

test('unavailable tools fail explicitly instead of silently degrading', async () => {
  const router = createToolRouter();
  await assert.rejects(router.execute({ purpose: 'illustration', payload: {} }), error => error instanceof ToolRoutingError && error.code === 'TOOL_UNAVAILABLE');
});
