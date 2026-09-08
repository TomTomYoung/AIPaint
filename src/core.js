/** A deterministic RGBA pixel engine. No DOM, network, filesystem or eval. */
export const VERSION = '0.1.0';
export const LIMITS = Object.freeze({ dimension: 1024, layers: 16, pixels: 4194304,
  commands: 1000, points: 2048, historyBytes: 33554432, historyEntries: 50,
  receipts: 2000, receiptChars: 4000000, work: 20000000 });
export class PaintError extends Error {
  constructor(code, message) { super(message); this.name = 'PaintError'; this.code = code; }
}
export function check(ok, code, message) { if (!ok) throw new PaintError(code, message); }
export function object(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Object required');
  const allowed = new Set([...required, ...optional]);
  check(required.every(k => Object.hasOwn(value, k)), 'INVALID_INPUT', `Required: ${required.join(', ')}`);
  check(Object.keys(value).every(k => allowed.has(k)), 'INVALID_INPUT', 'Unknown field');
}
export function integer(value, min, max, label = 'number') {
  check(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INPUT', `${label}: ${min}..${max}`);
  return value;
}
export function identifier(value) {
  check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value), 'INVALID_INPUT', 'Invalid identifier');
  return value;
}
function text(value) { check(typeof value === 'string' && value.length > 0 && value.length <= 100, 'INVALID_INPUT', 'Invalid text'); }
function boolean(value) { check(typeof value === 'boolean', 'INVALID_INPUT', 'Boolean required'); }
function opacity(value) { check(Number.isFinite(value) && value >= 0 && value <= 1, 'INVALID_INPUT', 'Opacity must be 0..1'); }
export function rgba(value) {
  check(typeof value === 'string' && /^#[\da-f]{8}$/i.test(value), 'INVALID_COLOR', 'Use #RRGGBBAA');
  return [1, 3, 5, 7].map(i => parseInt(value.slice(i, i + 2), 16));
}
const point = p => { object(p, ['x', 'y']); integer(p.x, -4096, 4096, 'x'); integer(p.y, -4096, 4096, 'y'); };
const rules = {
  'layer.add': [['id', 'name'], []],
  'layer.remove': [['layerId'], []],
  'layer.reorder': [['layerId', 'index'], []],
  'layer.setProperties': [['layerId', 'properties'], []],
  'pixel.set': [['layerId', 'x', 'y', 'color'], []],
  'pixel.setMany': [['layerId', 'pixels'], []],
  'brush.stroke': [['layerId', 'points', 'size', 'color'], []],
  'eraser.stroke': [['layerId', 'points', 'size'], []],
  'shape.line': [['layerId', 'x', 'y', 'x2', 'y2', 'color'], ['size']],
  'shape.rect': [['layerId', 'x', 'y', 'width', 'height', 'fill'], []],
  'shape.ellipse': [['layerId', 'x', 'y', 'width', 'height', 'fill'], []],
  'fill.bucket': [['layerId', 'x', 'y', 'color'], ['tolerance']],
  'color.replace': [['layerId', 'from', 'to'], ['tolerance']],
};
export const COMMANDS = Object.freeze(Object.keys(rules));
export function validateCommand(c) {
  check(c && Object.hasOwn(rules, c.type), 'UNKNOWN_COMMAND', 'Unsupported command');
  object(c, ['type', ...rules[c.type][0]], rules[c.type][1]);
  if ('layerId' in c) identifier(c.layerId);
  if ('id' in c) identifier(c.id);
  if ('name' in c) text(c.name);
  for (const k of ['x', 'y', 'x2', 'y2']) if (k in c) integer(c[k], -4096, 4096, k);
  for (const k of ['color', 'fill', 'from', 'to']) if (k in c) rgba(c[k]);
  for (const k of ['width', 'height']) if (k in c) integer(c[k], 1, LIMITS.dimension, k);
  if ('index' in c) integer(c.index, 0, LIMITS.layers - 1, 'index');
  if ('size' in c) integer(c.size, 1, 64, 'size');
  if ('tolerance' in c) integer(c.tolerance, 0, 255, 'tolerance');
  if ('points' in c) {
    check(Array.isArray(c.points) && c.points.length > 0 && c.points.length <= LIMITS.points, 'INVALID_INPUT', 'Invalid point count');
    c.points.forEach(point);
  }
  if ('pixels' in c) {
    check(Array.isArray(c.pixels) && c.pixels.length > 0 && c.pixels.length <= LIMITS.points, 'INVALID_INPUT', 'Invalid pixel count');
    c.pixels.forEach(p => { object(p, ['x', 'y', 'color']); point({ x: p.x, y: p.y }); rgba(p.color); });
  }
  if ('properties' in c) {
    object(c.properties, [], ['name', 'visible', 'locked', 'opacity']);
    check(Object.keys(c.properties).length > 0, 'INVALID_INPUT', 'Empty properties');
    if ('name' in c.properties) text(c.properties.name);
    for (const k of ['visible', 'locked']) if (k in c.properties) boolean(c.properties[k]);
    if ('opacity' in c.properties) opacity(c.properties.opacity);
  }
}
const cloneDoc = d => ({ ...d, layers: d.layers.map(l => ({ ...l, data: l.data.slice() })) });
const bytes = d => d.layers.reduce((n, l) => n + l.data.byteLength, 0);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
function encode(data) {
  let s = ''; for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(s);
}
function decode(value, length) {
  check(typeof value === 'string' && value.length === Math.ceil(length / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), 'INVALID_PROJECT', 'Invalid RGBA encoding');
  let s; try { s = atob(value); } catch { throw new PaintError('INVALID_PROJECT', 'Invalid Base64'); }
  check(s.length === length, 'INVALID_PROJECT', 'RGBA length mismatch');
  const data = Uint8ClampedArray.from(s, c => c.charCodeAt(0));
  check(encode(data) === value, 'INVALID_PROJECT', 'Non-canonical Base64');
  return data;
}
function dimensions(w, h, count) {
  integer(w, 1, LIMITS.dimension, 'width'); integer(h, 1, LIMITS.dimension, 'height');
  check(count <= LIMITS.layers && w * h * count <= LIMITS.pixels, 'RESOURCE_LIMIT', 'Layer/pixel limit exceeded');
}
function blend(dst, i, color, factor = 1) {
  const sa = color[3] / 255 * factor, da = dst[i + 3] / 255, a = sa + da * (1 - sa);
  if (!sa) return;
  for (let j = 0; j < 3; j++) dst[i + j] = Math.round((color[j] * sa + dst[i + j] * da * (1 - sa)) / a);
  dst[i + 3] = Math.round(a * 255);
}
function put(d, layer, x, y, color, erase = false, touched = null) {
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  const p = y * d.width + x, i = p * 4;
  if (touched?.[p]) return;
  if (touched) touched[p] = 1;
  if (erase) layer.data.fill(0, i, i + 4); else blend(layer.data, i, color);
}
function line(a, b, visit) {
  let { x, y } = a;
  const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x, y); if (x === b.x && y === b.y) break;
    const e = 2 * err;
    if (e >= dy) { err += dy; x += sx; }
    if (e <= dx) { err += dx; y += sy; }
  }
}
function stroke(d, l, points, size, color, erase) {
  const touched = new Uint8Array(d.width * d.height), offset = Math.floor((size - 1) / 2);
  const stamp = (x, y) => {
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) put(d, l, x + i - offset, y + j - offset, color, erase, touched);
  };
  stamp(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) line(points[i - 1], points[i], stamp);
}
function workCost(c, d) {
  if (c.points || c.type === 'shape.line') {
    const p = c.points || [{ x: c.x, y: c.y }, { x: c.x2, y: c.y2 }];
    let n = 1;
    for (let i = 1; i < p.length; i++) n += 1 + Math.max(Math.abs(p[i].x - p[i - 1].x), Math.abs(p[i].y - p[i - 1].y));
    return n * (c.size || 1) ** 2;
  }
  if (c.type === 'fill.bucket' || c.type === 'color.replace') return d.width * d.height * 4;
  return c.width ? c.width * c.height : c.pixels?.length || 1;
}
function apply(d, c) {
  if (c.type === 'layer.add') {
    check(!d.layers.some(l => l.id === c.id), 'DUPLICATE_LAYER', 'Layer already exists');
    dimensions(d.width, d.height, d.layers.length + 1);
    d.layers.push({ id: c.id, name: c.name, visible: true, locked: false, opacity: 1, data: new Uint8ClampedArray(d.width * d.height * 4) });
    return;
  }
  const index = d.layers.findIndex(l => l.id === c.layerId), l = d.layers[index];
  check(l, 'LAYER_NOT_FOUND', 'Layer not found');
  if (c.type === 'layer.setProperties') { Object.assign(l, c.properties); return; }
  check(!l.locked, 'LAYER_LOCKED', 'Layer is locked');
  if (c.type === 'layer.remove') { d.layers.splice(index, 1); return; }
  if (c.type === 'layer.reorder') {
    check(c.index < d.layers.length, 'INVALID_INPUT', 'Layer index out of range');
    d.layers.splice(index, 1); d.layers.splice(c.index, 0, l); return;
  }
  if (c.type === 'pixel.set' || c.type === 'pixel.setMany') {
    for (const p of c.pixels || [c]) {
      check(p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height, 'OUT_OF_BOUNDS', 'Pixel outside canvas');
      l.data.set(rgba(p.color), (p.y * d.width + p.x) * 4);
    } return;
  }
  if (c.type === 'brush.stroke' || c.type === 'eraser.stroke' || c.type === 'shape.line') {
    stroke(d, l, c.points || [{ x: c.x, y: c.y }, { x: c.x2, y: c.y2 }], c.size || 1,
      c.color ? rgba(c.color) : [0, 0, 0, 0], c.type === 'eraser.stroke'); return;
  }
  if (c.type === 'shape.rect' || c.type === 'shape.ellipse') {
    const color = rgba(c.fill);
    for (let y = Math.max(0, c.y); y < Math.min(d.height, c.y + c.height); y++) {
      for (let x = Math.max(0, c.x); x < Math.min(d.width, c.x + c.width); x++) {
        if (c.type === 'shape.rect' || ((x + .5 - c.x - c.width / 2) / (c.width / 2)) ** 2 + ((y + .5 - c.y - c.height / 2) / (c.height / 2)) ** 2 <= 1) put(d, l, x, y, color);
      }
    } return;
  }
  const target = c.type === 'color.replace' ? rgba(c.from) : (() => {
    check(c.x >= 0 && c.y >= 0 && c.x < d.width && c.y < d.height, 'OUT_OF_BOUNDS', 'Fill start outside canvas');
    return Array.from(l.data.slice((c.y * d.width + c.x) * 4, (c.y * d.width + c.x) * 4 + 4));
  })();
  const color = rgba(c.to || c.color), tolerance = c.tolerance || 0;
  const match = p => target.every((v, j) => Math.abs(l.data[p * 4 + j] - v) <= tolerance);
  if (c.type === 'color.replace') {
    for (let p = 0; p < d.width * d.height; p++) if (match(p)) l.data.set(color, p * 4);
    return;
  }
  // Four-connected fill. Mark on enqueue: at most width*height queue entries.
  const count = d.width * d.height, seen = new Uint8Array(count), queue = new Uint32Array(count);
  let head = 0, tail = 0;
  const enqueue = p => { if (!seen[p] && match(p)) { seen[p] = 1; queue[tail++] = p; } };
  enqueue(c.y * d.width + c.x);
  while (head < tail) {
    const p = queue[head++], x = p % d.width, y = Math.floor(p / d.width);
    l.data.set(color, p * 4);
    if (x) enqueue(p - 1); if (x + 1 < d.width) enqueue(p + 1);
    if (y) enqueue(p - d.width); if (y + 1 < d.height) enqueue(p + d.width);
  }
}
export class PaintCore {
  #doc; #undo = []; #redo = []; #receipts = new Map(); #receiptChars = 0; #events = [];
  constructor({ documentId = 'untitled', width = 128, height = 128, mode = 'pixel', background = 'transparent', colorSpace = 'srgb' } = {}) {
    identifier(documentId); dimensions(width, height, 0);
    check(mode === 'pixel', 'UNSUPPORTED_MODE', 'v0.1 implements pixel mode only');
    check(background === 'transparent' && colorSpace === 'srgb', 'INVALID_INPUT', 'Use transparent / srgb');
    this.#doc = { documentId, revision: 0, width, height, mode, background, colorSpace, layers: [] };
  }
  getState() {
    return { ...this.#doc, layers: this.#doc.layers.map(({ data, ...l }) => ({ ...l })),
      canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0, githubStored: false };
  }
  assertContext({ documentId, expectedRevision }) {
    check(documentId === this.#doc.documentId, 'DOCUMENT_CONFLICT', 'Active document changed');
    check(expectedRevision === this.#doc.revision, 'REVISION_CONFLICT', 'Read the current revision first');
  }
  #record(kind, detail = {}) {
    this.#events.push({ revision: this.#doc.revision, kind, ...detail });
    if (this.#events.length > 200) this.#events.shift();
  }
  #trim() {
    while (this.#undo.length + this.#redo.length > LIMITS.historyEntries ||
      [...this.#undo, ...this.#redo].reduce((n, d) => n + bytes(d), 0) > LIMITS.historyBytes) {
      if (this.#undo.length) this.#undo.shift(); else this.#redo.shift();
    }
  }
  applyBatch(input) {
    object(input, ['documentId', 'batchId', 'expectedRevision', 'commands']);
    identifier(input.documentId); identifier(input.batchId); integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
    check(input.documentId === this.#doc.documentId, 'DOCUMENT_CONFLICT', 'Active document changed');
    check(Array.isArray(input.commands) && input.commands.length > 0 && input.commands.length <= LIMITS.commands, 'RESOURCE_LIMIT', 'Invalid command count');
    input.commands.forEach(validateCommand);
    const payload = canonical(input), receipt = this.#receipts.get(input.batchId);
    if (receipt) {
      check(receipt.payload === payload, 'IDEMPOTENCY_CONFLICT', 'Batch ID already has different content');
      return { ...this.getState(), replayed: true, appliedRevision: receipt.revision };
    }
    this.assertContext(input);
    check(this.#receipts.size < LIMITS.receipts && this.#receiptChars + payload.length <= LIMITS.receiptChars, 'RESOURCE_LIMIT', 'Session batch limit reached');
    check(input.commands.reduce((n, c) => n + workCost(c, this.#doc), 0) <= LIMITS.work, 'RESOURCE_LIMIT', 'Batch work budget exceeded');
    const next = cloneDoc(this.#doc);
    input.commands.forEach(c => apply(next, c));
    next.revision = this.#doc.revision + 1;
    this.#undo.push(this.#doc); this.#redo = []; this.#doc = next; this.#trim();
    this.#receipts.set(input.batchId, { payload, revision: next.revision }); this.#receiptChars += payload.length;
    this.#record('batch', { batchId: input.batchId, commandCount: input.commands.length });
    return { ...this.getState(), replayed: false, appliedRevision: next.revision };
  }
  undo(input) { return this.#travel(input, this.#undo, this.#redo, 'undo'); }
  redo(input) { return this.#travel(input, this.#redo, this.#undo, 'redo'); }
  #travel(input, from, to, kind) {
    object(input, ['documentId', 'expectedRevision']); this.assertContext(input);
    check(from.length > 0, 'EMPTY_HISTORY', `Nothing to ${kind}`);
    const old = this.#doc, next = from.pop();
    to.push(old); this.#doc = { ...next, revision: old.revision + 1 }; this.#trim(); this.#record(kind);
    return this.getState();
  }
  getHistory(limit = 50) { integer(limit, 1, 200); return structuredClone(this.#events.slice(-limit)); }
  composite() {
    const d = this.#doc, data = new Uint8ClampedArray(d.width * d.height * 4);
    for (const l of d.layers) if (l.visible && l.opacity > 0) {
      for (let i = 0; i < data.length; i += 4) blend(data, i, l.data.subarray(i, i + 4), l.opacity);
    }
    return { width: d.width, height: d.height, data };
  }
  exportProject() {
    return { schemaVersion: 'paint-project/0.1', encoding: 'rgba8-base64', renderer: VERSION,
      ...this.#doc, layers: this.#doc.layers.map(({ data, ...l }) => ({ ...l, pixels: encode(data) })) };
  }
  static fromProject(p, documentId) {
    object(p, ['schemaVersion', 'encoding', 'renderer', 'documentId', 'revision', 'width', 'height', 'mode', 'background', 'colorSpace', 'layers']);
    check(p.schemaVersion === 'paint-project/0.1' && p.encoding === 'rgba8-base64' && p.renderer === VERSION, 'INVALID_PROJECT', 'Unsupported project/renderer version');
    identifier(p.documentId); integer(p.revision, 0, Number.MAX_SAFE_INTEGER);
    check(Array.isArray(p.layers), 'INVALID_PROJECT', 'Layers required'); dimensions(p.width, p.height, p.layers.length);
    const core = new PaintCore({ ...p, documentId: documentId || p.documentId }), ids = new Set();
    core.#doc.layers = p.layers.map(l => {
      object(l, ['id', 'name', 'visible', 'locked', 'opacity', 'pixels']);
      identifier(l.id); text(l.name); boolean(l.visible); boolean(l.locked); opacity(l.opacity);
      check(!ids.has(l.id), 'INVALID_PROJECT', 'Duplicate layer ID'); ids.add(l.id);
      const { pixels, ...meta } = l;
      return { ...meta, data: decode(pixels, p.width * p.height * 4) };
    });
    // Opening creates a new editing session, not an old revision/receipt history.
    return core;
  }
}
