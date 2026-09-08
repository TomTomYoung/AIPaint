import { PaintCore, PaintError, LIMITS, check } from './core.js';
import { createAgent, newId, rasterCanvas } from './agent.js';
const $ = id => document.getElementById(id), canvas = $('canvas'), ctx = canvas.getContext('2d');
const STORAGE = 'aipaint-project-v0.1';
let activeLayer = null, tool = 'brush', gesture = null, saveTimer, frame, dirty = false;
function message(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function failure(e) { message(`${e.code || 'ERROR'}: ${e.message}`, true); }
function guard(fn) { return async (...args) => { try { await fn(...args); } catch (e) { failure(e); } }; }
const agent = createAgent(() => { dirty = true; render(); scheduleSave(); });
window.paintAgent = agent;
const context = () => { const s = agent.getState(); return { documentId: s.documentId, expectedRevision: s.revision }; };
const exportContext = () => { const s = agent.getState(); return { documentId: s.documentId, revision: s.revision }; };
const replaceContext = () => { const s = agent.getState(); return { replace: true, expectedDocumentId: s.documentId, expectedRevision: s.revision }; };
function batch(commands, input = context()) { return agent.applyBatch({ ...input, batchId: newId('ui'), commands }); }
function drawRaster(raster) {
  if (canvas.width !== raster.width || canvas.height !== raster.height) { canvas.width = raster.width; canvas.height = raster.height; }
  ctx.putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
  canvas.style.width = `${raster.width * Number($('zoom').value)}px`; canvas.style.height = `${raster.height * Number($('zoom').value)}px`;
}
function render() {
  const s = agent.getState();
  if (!s.layers.some(l => l.id === activeLayer)) activeLayer = s.layers.at(-1)?.id || null;
  drawRaster(agent.composite());
  $('dimensions').textContent = `${s.width} × ${s.height} px`;
  $('document-state').textContent = `revision ${s.revision} / GitHub未保存`;
  $('undo').disabled = !s.canUndo; $('redo').disabled = !s.canRedo;
  const selected = s.layers.find(l => l.id === activeLayer);
  $('layer-opacity').disabled = !selected; $('layer-opacity').value = (selected?.opacity ?? 1) * 100;
  $('layers').replaceChildren(...[...s.layers].reverse().map(l => {
    const row = document.createElement('div'); row.className = `layer${l.id === activeLayer ? ' active' : ''}`;
    const b = document.createElement('button'); b.className = 'select-layer'; b.textContent = l.name; b.title = l.id;
    b.onclick = () => { activeLayer = l.id; render(); }; row.append(b);
    for (const [key, label] of [['visible', '表示'], ['locked', '固定']]) {
      const holder = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = l[key]; cb.setAttribute('aria-label', `${l.name} ${label}`);
      cb.onchange = guard(() => batch([{ type: 'layer.setProperties', layerId: l.id, properties: { [key]: cb.checked } }]));
      holder.append(cb, document.createTextNode(label)); row.append(holder);
    } return row;
  }));
  $('agent-state').textContent = JSON.stringify({ state: s, capabilities: agent.getCapabilities() }, null, 2);
}
function scheduleSave() {
  clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    try {
      const data = JSON.stringify(agent.exportProject(exportContext()));
      check(data.length <= 3000000, 'AUTOSAVE_LIMIT', 'この原稿は自動保存の上限を超えました。原稿JSONを保存してください。');
      localStorage.setItem(STORAGE, data); $('autosave').textContent = `自動保存：revision ${agent.getState().revision}（ブラウザ内のみ）`;
    } catch (e) { $('autosave').textContent = `自動保存失敗：${e.message} 原稿JSONを保存してください。`; }
  }, 400);
}
const color = () => `${$('color').value}${Math.round(Number($('alpha').value) * 2.55).toString(16).padStart(2, '0')}`;
function commandsFor(g) {
  const a = g.points[0], b = g.points.at(-1), base = { layerId: g.layerId };
  if (g.tool === 'brush' || g.tool === 'eraser') return [{ ...base, type: g.tool === 'brush' ? 'brush.stroke' : 'eraser.stroke', points: g.points, size: g.size, ...(g.tool === 'brush' ? { color: g.color } : {}) }];
  if (g.tool === 'line') return [{ ...base, type: 'shape.line', x: a.x, y: a.y, x2: b.x, y2: b.y, size: g.size, color: g.color }];
  return [{ ...base, type: `shape.${g.tool}`, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x) + 1, height: Math.abs(b.y - a.y) + 1, fill: g.color }];
}
function position(e) {
  const r = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(canvas.width - 1, Math.floor((e.clientX - r.left) * canvas.width / r.width))), y: Math.max(0, Math.min(canvas.height - 1, Math.floor((e.clientY - r.top) * canvas.height / r.height))) };
}
function preview() {
  frame = null; if (!gesture) return;
  try {
    const c = PaintCore.fromProject(gesture.project);
    c.applyBatch({ documentId: c.getState().documentId, batchId: 'preview', expectedRevision: 0, commands: commandsFor(gesture) });
    drawRaster(c.composite());
  } catch (e) { failure(e); }
}
canvas.addEventListener('pointerdown', guard(e => {
  if (e.button !== 0 || gesture) return;
  check(activeLayer, 'LAYER_NOT_FOUND', 'レイヤーを追加してください。');
  const p = position(e); canvas.focus();
  if (tool === 'fill') { batch([{ type: 'fill.bucket', layerId: activeLayer, ...p, color: color() }]); message('塗りつぶしました。'); return; }
  check(!agent.getState().layers.find(l => l.id === activeLayer)?.locked, 'LAYER_LOCKED', '選択レイヤーは固定されています。');
  gesture = { pointerId: e.pointerId, context: context(), project: agent.exportProject(exportContext()), layerId: activeLayer, tool, size: Number($('size').value), color: color(), points: [p] };
  canvas.setPointerCapture(e.pointerId); preview();
}));
canvas.addEventListener('pointermove', e => {
  const p = position(e); $('coordinates').textContent = `x ${p.x} / y ${p.y}`;
  if (!gesture || e.pointerId !== gesture.pointerId) return;
  const last = gesture.points.at(-1); if (p.x === last.x && p.y === last.y) return;
  if (gesture.tool === 'brush' || gesture.tool === 'eraser') {
    if (gesture.points.length >= LIMITS.points) return;
    gesture.points.push(p);
  } else gesture.points[1] = p;
  if (!frame) frame = requestAnimationFrame(preview);
});
function cancelGesture() { gesture = null; if (frame) cancelAnimationFrame(frame); frame = null; render(); }
canvas.addEventListener('pointerup', guard(e => {
  if (!gesture || e.pointerId !== gesture.pointerId) return;
  const g = gesture; cancelGesture();
  try { batch(commandsFor(g), g.context); message('描画を確定しました。'); } finally { render(); }
}));
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', () => { if (gesture) cancelGesture(); });
const help = { brush: 'ドラッグして描き、離すと確定します。一筆がUndo一回分です。', eraser: 'ドラッグした部分を透明に戻します。', line: '始点から終点へドラッグし、直線を描きます。', rect: '対角の2点をドラッグし、矩形を塗ります。', ellipse: '外接矩形の対角2点をドラッグし、楕円を塗ります。', fill: '選択レイヤーの同色で上下左右につながる範囲を塗ります。' };
function selectTool(value) { tool = value; for (const b of $('tools').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tool === value)); $('tool-help').textContent = help[value]; }
for (const b of $('tools').querySelectorAll('button')) b.onclick = () => selectTool(b.dataset.tool);
for (const c of ['#245749', '#183F38', '#4DBB83', '#88E0A0', '#D9F7C7', '#E2B45C', '#D87657', '#F8F9F5', '#20262A']) {
  const b = document.createElement('button'); b.style.backgroundColor = c; b.title = c; b.setAttribute('aria-label', `色 ${c}`); b.onclick = () => { $('color').value = c; }; $('palette').append(b);
}
$('size').oninput = () => { $('size-label').textContent = `${$('size').value} px`; };
$('alpha').oninput = () => { $('alpha-label').textContent = `${$('alpha').value}%`; };
$('zoom').onchange = render;
$('undo').onclick = guard(() => { agent.undo(context()); message('元に戻しました。'); });
$('redo').onclick = guard(() => { agent.redo(context()); message('やり直しました。'); });
$('add-layer').onclick = guard(() => { const id = newId('layer'); batch([{ type: 'layer.add', id, name: `レイヤー ${agent.getState().layers.length + 1}` }]); activeLayer = id; render(); });
$('remove-layer').onclick = guard(() => { if (!activeLayer || !confirm('選択レイヤーを削除しますか？ Undoで戻せます。')) return; batch([{ type: 'layer.remove', layerId: activeLayer }]); });
for (const [id, delta] of [['layer-up', 1], ['layer-down', -1]]) $(id).onclick = guard(() => {
  const s = agent.getState(), index = s.layers.findIndex(l => l.id === activeLayer) + delta;
  check(activeLayer && index >= 0 && index < s.layers.length, 'INVALID_INPUT', 'これ以上移動できません。');
  batch([{ type: 'layer.reorder', layerId: activeLayer, index }]);
});
$('layer-opacity').onchange = guard(() => batch([{ type: 'layer.setProperties', layerId: activeLayer, properties: { opacity: Number($('layer-opacity').value) / 100 } }]));
const confirmReplace = () => confirm('現在の原稿を置き換えます。必要な原稿は先にJSONで保存してください。続けますか？');
$('new-document').onclick = guard(() => {
  if (!confirmReplace()) return; cancelGesture();
  agent.createDocument({ documentId: newId('doc'), width: Number($('width').value), height: Number($('height').value), ...replaceContext() });
  batch([{ type: 'layer.add', id: 'ink', name: 'レイヤー 1' }]); message('新規原稿を作成しました。'); sampleCommands();
});
function download(blob, name) { const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
$('save-png').onclick = guard(async () => {
  const image = await agent.exportImage(exportContext()); download(image.blob, `aipaint-r${image.revision}.png`);
  message(`PNGをダウンロードに渡しました。${image.width} × ${image.height} px。GitHubには未保存です。`);
});
$('save-project').onclick = guard(() => {
  const project = agent.exportProject(exportContext()); download(new Blob([JSON.stringify(project)], { type: 'application/json' }), 'project.paint.json');
  dirty = false; message('レイヤー付き原稿をダウンロードに渡しました。GitHubには未保存です。');
});
$('open-project').onchange = guard(async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  check(file.size <= 24000000, 'RESOURCE_LIMIT', '原稿JSONは24 MB以下にしてください。');
  const expected = replaceContext(), p = JSON.parse(await file.text());
  if (!confirmReplace()) return; cancelGesture(); agent.openProject({ bundle: p, ...expected }); sampleCommands(); message('原稿を開きました。編集番号は新しいセッションで0から始まります。');
});
$('restore').onclick = guard(() => {
  const data = localStorage.getItem(STORAGE); check(data, 'NO_AUTOSAVE', '自動保存がありません。');
  if (!confirmReplace()) return; cancelGesture(); agent.openProject({ bundle: JSON.parse(data), ...replaceContext() }); sampleCommands(); message('ブラウザ内の原稿を復元しました。GitHubには未保存です。');
});
function sampleCommands() { $('commands').value = JSON.stringify([{ type: 'shape.ellipse', layerId: activeLayer || 'ink', x: 16, y: 16, width: 40, height: 40, fill: '#4DBB83FF' }], null, 2); }
$('sample-commands').onclick = sampleCommands;
$('apply-json').onclick = guard(() => {
  check($('commands').value.length <= 2000000, 'RESOURCE_LIMIT', 'JSONが大きすぎます。');
  batch(JSON.parse($('commands').value)); message('JSON操作を一括適用しました。Undo一回で戻せます。');
});
$('demo').onclick = guard(async () => {
  const expected = replaceContext(), response = await fetch('./examples/slime.json');
  check(response.ok, 'LOAD_FAILED', 'サンプルを取得できません。'); const job = await response.json();
  job.source.documentId = newId('demo'); if (!confirmReplace()) return; cancelGesture();
  agent.runJob({ job, ...expected }); sampleCommands(); message('サンプルジョブを実行し、画像の寸法・透過・色数を検証しました。');
});
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select') || e.target.isContentEditable) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('redo') : $('undo')).click(); return; }
  if (e.key === 'Escape' && gesture) { cancelGesture(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const names = { b: 'brush', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', f: 'fill' }; if (names[e.key]) selectTool(names[e.key]);
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
// Do not overwrite a previously saved project merely by opening this page.
let previous = null; try { previous = localStorage.getItem(STORAGE); } catch { /* Browsing policies may disable storage. */ }
batch([{ type: 'layer.add', id: 'ink', name: 'レイヤー 1' }]); clearTimeout(saveTimer); dirty = false;
if (previous) $('autosave').textContent = '以前の自動保存があります。「復元」で再開できます。';
sampleCommands(); render(); message('準備できました。描画するか、サンプルジョブを実行してください。');
