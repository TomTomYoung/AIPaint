import { PaintCore, PaintError, VERSION, LIMITS, COMMANDS, check, object, integer, identifier } from './core.js';
export const newId = prefix => `${prefix}-${crypto.randomUUID()}`;
const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
export function rasterCanvas(raster) {
  const canvas = document.createElement('canvas'); canvas.width = raster.width; canvas.height = raster.height;
  canvas.getContext('2d').putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
  return canvas;
}
async function png(canvas, state) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new PaintError('EXPORT_FAILED', 'PNG export failed')), 'image/png'));
  return { blob, mimeType: 'image/png', byteLength: blob.size, width: canvas.width, height: canvas.height,
    documentId: state.documentId, revision: state.revision, sha256: await hash(await blob.arrayBuffer()) };
}
/** Validate and render a job on an isolated core. Failure cannot damage the active document. */
export function executeJob(job) {
  object(job, ['schemaVersion', 'jobId', 'idempotencyKey', 'rendererProfile', 'source', 'batches', 'output', 'checks']);
  check(job.schemaVersion === 'paint-job/1' && job.rendererProfile === 'pixel-v0.1', 'UNSUPPORTED_PROFILE', 'Use paint-job/1 and pixel-v0.1');
  identifier(job.jobId); identifier(job.idempotencyKey);
  object(job.source, ['kind', 'documentId', 'width', 'height', 'mode', 'background', 'colorSpace']);
  check(job.source.kind === 'blank', 'UNSUPPORTED_SOURCE', 'Only blank job sources are implemented');
  object(job.output, ['assetId', 'revisionId', 'publishMode', 'reviewStatus']);
  identifier(job.output.assetId); identifier(job.output.revisionId);
  check(job.output.publishMode === 'pull_request' && job.output.reviewStatus === 'candidate', 'INVALID_INPUT', 'Use pull_request / candidate');
  object(job.checks, ['width', 'height'], ['requireTransparency', 'maxOpaqueColors']);
  integer(job.checks.width, 1, LIMITS.dimension); integer(job.checks.height, 1, LIMITS.dimension);
  if ('requireTransparency' in job.checks) check(typeof job.checks.requireTransparency === 'boolean', 'INVALID_INPUT', 'Boolean required');
  if ('maxOpaqueColors' in job.checks) integer(job.checks.maxOpaqueColors, 1, 16777216);
  check(Array.isArray(job.batches) && job.batches.length > 0 && job.batches.length <= 100, 'RESOURCE_LIMIT', 'Invalid batch count');
  check(job.batches.reduce((n, b) => n + (Array.isArray(b.commands) ? b.commands.length : 10001), 0) <= 10000, 'RESOURCE_LIMIT', 'Job command limit');
  const core = new PaintCore(job.source);
  for (const batch of job.batches) {
    object(batch, ['batchId', 'expectedRevision', 'commands']);
    core.applyBatch({ ...batch, documentId: job.source.documentId });
  }
  const raster = core.composite(), colors = new Set(); let transparent = false, visible = false;
  for (let i = 0; i < raster.data.length; i += 4) {
    if (raster.data[i + 3] < 255) transparent = true;
    if (raster.data[i + 3] > 0) { visible = true; colors.add(raster.data[i] * 65536 + raster.data[i + 1] * 256 + raster.data[i + 2]); }
  }
  check(raster.width === job.checks.width && raster.height === job.checks.height, 'CHECK_FAILED', 'Dimension mismatch');
  check(visible, 'CHECK_FAILED', 'Entirely transparent image');
  check(!job.checks.requireTransparency || transparent, 'CHECK_FAILED', 'Transparency required');
  check(!job.checks.maxOpaqueColors || colors.size <= job.checks.maxOpaqueColors, 'CHECK_FAILED', 'Color count exceeded');
  return { core, checks: { passed: true, width: raster.width, height: raster.height, hasTransparency: transparent, visibleRGBColors: colors.size } };
}
export function createAgent(onChange = () => {}) {
  let core = new PaintCore({ documentId: newId('doc') });
  const seen = new Set([core.getState().documentId]);
  const notify = result => { onChange(core.getState()); return result; };
  const current = input => {
    object(input, ['documentId', 'revision']);
    core.assertContext({ documentId: input.documentId, expectedRevision: input.revision });
    return core.getState();
  };
  const replacement = input => {
    check(input.replace === true, 'REPLACE_REQUIRED', 'Explicit replacement required');
    core.assertContext({ documentId: input.expectedDocumentId, expectedRevision: input.expectedRevision });
  };
  const install = next => {
    const id = next.getState().documentId;
    check(!seen.has(id), 'DOCUMENT_ID_REUSE', 'Choose a new documentId for a new session');
    seen.add(id); core = next; return notify(core.getState());
  };
  return Object.freeze({
    getCapabilities: () => ({ version: VERSION, apiVersion: 'paint-agent/0.1', projectVersion: 'paint-project/0.1',
      rendererProfile: 'pixel-v0.1', modes: ['pixel'], commands: COMMANDS, limits: LIMITS,
      webMCPRegistered: false, githubPublishing: false, transfer: 'browser-blob', buildId: VERSION }),
    getState: () => core.getState(),
    getHistory: ({ limit = 50 } = {}) => core.getHistory(limit),
    createDocument(input) {
      object(input, ['documentId', 'width', 'height', 'replace', 'expectedDocumentId', 'expectedRevision'], ['mode', 'background', 'colorSpace']);
      replacement(input); return install(new PaintCore(input));
    },
    openProject(input) {
      object(input, ['bundle', 'replace', 'expectedDocumentId', 'expectedRevision']); replacement(input);
      return install(PaintCore.fromProject(input.bundle, newId('doc')));
    },
    applyBatch: input => notify(core.applyBatch(input)),
    undo: input => notify(core.undo(input)),
    redo: input => notify(core.redo(input)),
    composite: () => core.composite(),
    exportProject(input) { current(input); return core.exportProject(); },
    async exportImage(input) { const state = current(input); return png(rasterCanvas(core.composite()), state); },
    async renderPreview(input) {
      object(input, ['documentId', 'revision'], ['maxDimension']);
      const state = current({ documentId: input.documentId, revision: input.revision });
      const max = input.maxDimension ?? 1024; integer(max, 1, 1024);
      const original = rasterCanvas(core.composite()), scale = Math.min(1, max / Math.max(original.width, original.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(original.width * scale)); canvas.height = Math.max(1, Math.round(original.height * scale));
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(original, 0, 0, canvas.width, canvas.height);
      const result = await png(canvas, state);
      return { ...result, dataURL: canvas.toDataURL('image/png') };
    },
    runJob(input) {
      object(input, ['job', 'replace', 'expectedDocumentId', 'expectedRevision']); replacement(input);
      const result = executeJob(input.job), state = install(result.core);
      return { ...state, checks: result.checks, status: 'rendered', githubStored: false };
    },
    preparePublish() { throw new PaintError('PUBLISH_UNAVAILABLE', 'GitHub publisher is not configured in v0.1'); }
  });
}
