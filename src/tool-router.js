export class ToolRoutingError extends Error {
  constructor(code, message) { super(message); this.name = 'ToolRoutingError'; this.code = code; }
}

const freezeList = items => Object.freeze(items.map(item => Object.freeze({ ...item, purposes: Object.freeze([...item.purposes]) })));

export const TOOL_CATALOG = freezeList([
  {
    id: 'pixel',
    label: 'AIPaint Pixel Core',
    family: 'pixel',
    execution: 'local',
    integration: 'built-in',
    purposes: ['pixel-sprite', 'pixel-tileset', 'pixel-ui'],
    description: '決定論的なピクセル編集、タイル、スプライト、低色数UI素材向け。'
  },
  {
    id: 'raster-editor',
    label: 'Raster editor',
    family: 'raster',
    execution: 'external',
    integration: 'adapter',
    purposes: ['raster-paint', 'concept-art', 'illustration', '3d-render-to-2d', 'texture-paint'],
    description: '通常解像度のペイント、レタッチ、合成、仕上げ向け。'
  },
  {
    id: 'vector-editor',
    label: 'Vector editor',
    family: 'vector',
    execution: 'external',
    integration: 'adapter',
    purposes: ['vector-asset'],
    description: 'ロゴ、UI、図形、拡大縮小を前提とするベクター素材向け。'
  },
  {
    id: 'image-generation',
    label: 'Image generation',
    family: 'generation',
    execution: 'external',
    integration: 'adapter',
    purposes: ['concept-art', 'illustration'],
    description: '構図、デザイン、複雑な絵作りの初稿生成向け。'
  },
  {
    id: 'blockout-3d',
    label: 'AIPaint Blockout Modeler',
    family: '3d',
    execution: 'local',
    integration: 'built-in',
    purposes: ['3d-blockout'],
    description: 'プリミティブを組み合わせるゲーム素材の3Dブロックアウト向け。'
  },
  {
    id: 'blender-3d',
    label: '3D modeler / Blender',
    family: '3d',
    execution: 'external',
    integration: 'mcp-adapter',
    purposes: ['3d-model', '3d-pose-reference', '3d-render-to-2d', 'texture-paint'],
    description: '3Dモデリング、リグ、ポーズ、カメラ、レンダリング向け。'
  }
]);

export const PURPOSE_CATALOG = Object.freeze([
  Object.freeze({ id: 'pixel-sprite', label: 'ドット絵スプライト', pipeline: Object.freeze(['pixel']) }),
  Object.freeze({ id: 'pixel-tileset', label: 'ドット絵タイル', pipeline: Object.freeze(['pixel']) }),
  Object.freeze({ id: 'pixel-ui', label: 'ドット絵UI素材', pipeline: Object.freeze(['pixel']) }),
  Object.freeze({ id: 'raster-paint', label: '通常ペイント', pipeline: Object.freeze(['raster-editor']) }),
  Object.freeze({ id: 'vector-asset', label: 'ベクター素材', pipeline: Object.freeze(['vector-editor']) }),
  Object.freeze({ id: 'concept-art', label: 'コンセプトアート', pipeline: Object.freeze(['image-generation', 'raster-editor']) }),
  Object.freeze({ id: 'illustration', label: 'イラスト素材', pipeline: Object.freeze(['image-generation', 'raster-editor']) }),
  Object.freeze({ id: '3d-blockout', label: '3Dブロックアウト', pipeline: Object.freeze(['blockout-3d']) }),
  Object.freeze({ id: '3d-model', label: '3Dモデル', pipeline: Object.freeze(['blender-3d']) }),
  Object.freeze({ id: '3d-pose-reference', label: '3Dポーズ・デッサン参照', pipeline: Object.freeze(['blender-3d']) }),
  Object.freeze({ id: '3d-render-to-2d', label: '3D下絵から2D仕上げ', pipeline: Object.freeze(['blender-3d', 'raster-editor']) }),
  Object.freeze({ id: 'texture-paint', label: '3Dテクスチャ制作', pipeline: Object.freeze(['blender-3d', 'raster-editor']) })
]);

const toolById = id => TOOL_CATALOG.find(tool => tool.id === id);
const purposeById = id => PURPOSE_CATALOG.find(purpose => purpose.id === id);

function requireTool(id) {
  const tool = toolById(id);
  if (!tool) throw new ToolRoutingError('UNKNOWN_TOOL', `Unknown tool: ${id}`);
  return tool;
}

function requirePurpose(id) {
  const purpose = purposeById(id);
  if (!purpose) throw new ToolRoutingError('UNKNOWN_PURPOSE', `Unknown purpose: ${id}`);
  return purpose;
}

export function createToolRouter({ adapters = [] } = {}) {
  const registered = new Map();
  let activePurpose = 'pixel-sprite';
  let activeTool = 'auto';

  function registerAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new ToolRoutingError('INVALID_ADAPTER', 'Adapter object required');
    const tool = requireTool(adapter.id);
    if (typeof adapter.execute !== 'function') throw new ToolRoutingError('INVALID_ADAPTER', 'Adapter execute function required');
    if (registered.has(tool.id)) throw new ToolRoutingError('ADAPTER_EXISTS', `Adapter already registered: ${tool.id}`);
    registered.set(tool.id, Object.freeze({ id: tool.id, execute: adapter.execute }));
    return tool.id;
  }

  for (const adapter of adapters) registerAdapter(adapter);

  function plan(purposeId = activePurpose) {
    const purpose = requirePurpose(purposeId);
    return {
      purposeId: purpose.id,
      label: purpose.label,
      steps: purpose.pipeline.map((id, index) => {
        const tool = requireTool(id);
        return { index, toolId: id, label: tool.label, available: registered.has(id), integration: tool.integration, execution: tool.execution };
      })
    };
  }

  function route({ purpose = activePurpose, toolId = activeTool } = {}) {
    const selectedPurpose = requirePurpose(purpose);
    const selectedToolId = toolId === 'auto' ? selectedPurpose.pipeline[0] : toolId;
    const selectedTool = requireTool(selectedToolId);
    if (!selectedPurpose.pipeline.includes(selectedToolId)) {
      throw new ToolRoutingError('TOOL_MISMATCH', `${selectedTool.label} is not a route for ${selectedPurpose.label}`);
    }
    return {
      purposeId: selectedPurpose.id,
      purposeLabel: selectedPurpose.label,
      toolId: selectedTool.id,
      toolLabel: selectedTool.label,
      available: registered.has(selectedTool.id),
      requiresHandoff: !registered.has(selectedTool.id),
      execution: selectedTool.execution,
      integration: selectedTool.integration,
      pipeline: [...selectedPurpose.pipeline]
    };
  }

  function selectPurpose(purposeId) {
    const purpose = requirePurpose(purposeId);
    activePurpose = purpose.id;
    if (activeTool !== 'auto' && !purpose.pipeline.includes(activeTool)) activeTool = 'auto';
    return getState();
  }

  function selectTool(toolId) {
    if (toolId !== 'auto') {
      requireTool(toolId);
      const purpose = requirePurpose(activePurpose);
      if (!purpose.pipeline.includes(toolId)) {
        throw new ToolRoutingError('TOOL_MISMATCH', `${toolId} is not a route for ${purpose.label}`);
      }
    }
    activeTool = toolId;
    return getState();
  }

  async function execute(input = {}) {
    const selected = route({ purpose: input.purpose ?? activePurpose, toolId: input.toolId ?? activeTool });
    const adapter = registered.get(selected.toolId);
    if (!adapter) {
      throw new ToolRoutingError('TOOL_UNAVAILABLE', `${selected.toolLabel} requires ${selected.integration}; do not fall back to another renderer`);
    }
    return adapter.execute(input.payload, selected);
  }

  function listTools() {
    return TOOL_CATALOG.map(tool => ({ ...tool, purposes: [...tool.purposes], available: registered.has(tool.id) }));
  }

  function listPurposes() {
    return PURPOSE_CATALOG.map(purpose => ({ ...purpose, pipeline: [...purpose.pipeline] }));
  }

  function getState() {
    return { activePurpose, activeTool, route: route(), plan: plan() };
  }

  return Object.freeze({ registerAdapter, listTools, listPurposes, plan, route, selectPurpose, selectTool, execute, getState });
}
