export const MODELER_VERSION = 'blockout-modeler/0.1';
export const MODEL_TYPES = Object.freeze(['box', 'sphere', 'cylinder']);

export class ModelerError extends Error {
  constructor(code, message) { super(message); this.name = 'ModelerError'; this.code = code; }
}
const check = (ok, code, message) => { if (!ok) throw new ModelerError(code, message); };
const number = (v, min, max, label) => {
  check(Number.isFinite(v) && v >= min && v <= max, 'INVALID_INPUT', `${label} must be ${min}..${max}`);
  return v;
};
const vec3 = (v, label, min = -1000, max = 1000) => {
  check(Array.isArray(v) && v.length === 3, 'INVALID_INPUT', `${label} must be vec3`);
  return v.map((x, i) => number(x, min, max, `${label}[${i}]`));
};
const color = value => {
  check(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value), 'INVALID_INPUT', 'Color must be #RRGGBB');
  return value.toUpperCase();
};
const clone = value => structuredClone(value);

const BASE_MESHES = {
  box() {
    return {
      vertices: [
        [-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
        [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]
      ],
      faces: [
        [0,2,1],[0,3,2],[4,5,6],[4,6,7],
        [0,1,5],[0,5,4],[3,7,6],[3,6,2],
        [1,2,6],[1,6,5],[0,4,7],[0,7,3]
      ]
    };
  },
  cylinder(segments = 16) {
    const vertices = [], faces = [];
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      vertices.push([Math.cos(a) * .5, -.5, Math.sin(a) * .5]);
      vertices.push([Math.cos(a) * .5, .5, Math.sin(a) * .5]);
    }
    const bottom = vertices.length, top = bottom + 1;
    vertices.push([0,-.5,0],[0,.5,0]);
    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments;
      const b0 = i * 2, t0 = b0 + 1, b1 = n * 2, t1 = b1 + 1;
      faces.push([b0,b1,t1],[b0,t1,t0],[bottom,b1,b0],[top,t0,t1]);
    }
    return { vertices, faces };
  },
  sphere(lat = 8, lon = 12) {
    const vertices = [], faces = [];
    for (let y = 0; y <= lat; y++) {
      const theta = y / lat * Math.PI;
      const sy = Math.cos(theta) * .5, r = Math.sin(theta) * .5;
      for (let x = 0; x < lon; x++) {
        const phi = x / lon * Math.PI * 2;
        vertices.push([Math.cos(phi) * r, sy, Math.sin(phi) * r]);
      }
    }
    for (let y = 0; y < lat; y++) {
      for (let x = 0; x < lon; x++) {
        const n = (x + 1) % lon;
        const a = y * lon + x, b = y * lon + n, c = (y + 1) * lon + n, d = (y + 1) * lon + x;
        if (y !== 0) faces.push([a,d,b]);
        if (y !== lat - 1) faces.push([b,d,c]);
      }
    }
    return { vertices, faces };
  }
};

export function primitiveMesh(type) {
  check(MODEL_TYPES.includes(type), 'UNKNOWN_PRIMITIVE', `Unknown primitive: ${type}`);
  return clone(BASE_MESHES[type]());
}

function rotateXYZ([x,y,z], [rx,ry,rz]) {
  rx *= Math.PI / 180; ry *= Math.PI / 180; rz *= Math.PI / 180;
  let cy = Math.cos(rx), sy = Math.sin(rx);
  [y,z] = [y * cy - z * sy, y * sy + z * cy];
  cy = Math.cos(ry); sy = Math.sin(ry);
  [x,z] = [x * cy + z * sy, -x * sy + z * cy];
  cy = Math.cos(rz); sy = Math.sin(rz);
  [x,y] = [x * cy - y * sy, x * sy + y * cy];
  return [x,y,z];
}

export function transformVertex(vertex, object) {
  const scaled = vertex.map((v, i) => v * object.scale[i]);
  const rotated = rotateXYZ(scaled, object.rotation);
  return rotated.map((v, i) => v + object.position[i]);
}

function validateObject(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT', 'Object required');
  check(typeof input.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(input.id), 'INVALID_INPUT', 'Invalid object id');
  check(typeof input.name === 'string' && input.name.length > 0 && input.name.length <= 80, 'INVALID_INPUT', 'Invalid object name');
  check(MODEL_TYPES.includes(input.type), 'UNKNOWN_PRIMITIVE', 'Unsupported primitive');
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    position: vec3(input.position, 'position'),
    rotation: vec3(input.rotation, 'rotation', -36000, 36000),
    scale: vec3(input.scale, 'scale', .01, 1000),
    color: color(input.color)
  };
}

export class ModelerCore {
  #objects = [];
  #camera = { yaw: 35, pitch: 22, distance: 8, target: [0,0,0] };
  #revision = 0;
  #counter = 1;

  getState() {
    return {
      version: MODELER_VERSION,
      revision: this.#revision,
      objects: clone(this.#objects),
      camera: clone(this.#camera)
    };
  }

  #nextId() {
    while (this.#objects.some(o => o.id === `object-${this.#counter}`)) this.#counter++;
    return `object-${this.#counter++}`;
  }

  addObject(type, options = {}) {
    check(MODEL_TYPES.includes(type), 'UNKNOWN_PRIMITIVE', `Unknown primitive: ${type}`);
    const id = options.id || this.#nextId();
    check(!this.#objects.some(o => o.id === id), 'DUPLICATE_ID', 'Object id already exists');
    const object = validateObject({
      id,
      name: options.name || `${type} ${this.#objects.length + 1}`,
      type,
      position: options.position || [0,0,0],
      rotation: options.rotation || [0,0,0],
      scale: options.scale || [1,1,1],
      color: options.color || '#8AA3A0'
    });
    this.#objects.push(object);
    this.#revision++;
    return clone(object);
  }

  updateObject(id, patch) {
    const index = this.#objects.findIndex(o => o.id === id);
    check(index >= 0, 'OBJECT_NOT_FOUND', 'Object not found');
    const current = this.#objects[index];
    const allowed = new Set(['name','position','rotation','scale','color']);
    check(patch && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_INPUT', 'Patch required');
    check(Object.keys(patch).every(k => allowed.has(k)), 'INVALID_INPUT', 'Unknown object field');
    const next = validateObject({ ...current, ...patch, id: current.id, type: current.type });
    this.#objects[index] = next;
    this.#revision++;
    return clone(next);
  }

  removeObject(id) {
    const index = this.#objects.findIndex(o => o.id === id);
    check(index >= 0, 'OBJECT_NOT_FOUND', 'Object not found');
    const [removed] = this.#objects.splice(index, 1);
    this.#revision++;
    return clone(removed);
  }

  duplicateObject(id) {
    const source = this.#objects.find(o => o.id === id);
    check(source, 'OBJECT_NOT_FOUND', 'Object not found');
    return this.addObject(source.type, {
      name: `${source.name} copy`,
      position: [source.position[0] + .5, source.position[1], source.position[2] + .5],
      rotation: source.rotation,
      scale: source.scale,
      color: source.color
    });
  }

  setCamera(patch) {
    check(patch && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_INPUT', 'Camera patch required');
    const allowed = new Set(['yaw','pitch','distance','target']);
    check(Object.keys(patch).every(k => allowed.has(k)), 'INVALID_INPUT', 'Unknown camera field');
    if ('yaw' in patch) this.#camera.yaw = number(patch.yaw, -36000, 36000, 'yaw');
    if ('pitch' in patch) this.#camera.pitch = number(patch.pitch, -89, 89, 'pitch');
    if ('distance' in patch) this.#camera.distance = number(patch.distance, .5, 200, 'distance');
    if ('target' in patch) this.#camera.target = vec3(patch.target, 'target');
    this.#revision++;
    return clone(this.#camera);
  }

  meshFor(id) {
    const object = this.#objects.find(o => o.id === id);
    check(object, 'OBJECT_NOT_FOUND', 'Object not found');
    const mesh = primitiveMesh(object.type);
    return { vertices: mesh.vertices.map(v => transformVertex(v, object)), faces: mesh.faces.map(f => [...f]) };
  }

  exportProject() {
    return { schemaVersion: MODELER_VERSION, revision: this.#revision, camera: clone(this.#camera), objects: clone(this.#objects) };
  }

  static fromProject(project) {
    check(project && project.schemaVersion === MODELER_VERSION, 'INVALID_PROJECT', 'Unsupported modeler project');
    check(Array.isArray(project.objects), 'INVALID_PROJECT', 'Objects required');
    const core = new ModelerCore(), ids = new Set();
    core.#objects = project.objects.map(object => {
      const validated = validateObject(object);
      check(!ids.has(validated.id), 'INVALID_PROJECT', 'Duplicate object id');
      ids.add(validated.id);
      return validated;
    });
    core.#camera = {
      yaw: number(project.camera?.yaw ?? 35, -36000, 36000, 'yaw'),
      pitch: number(project.camera?.pitch ?? 22, -89, 89, 'pitch'),
      distance: number(project.camera?.distance ?? 8, .5, 200, 'distance'),
      target: vec3(project.camera?.target ?? [0,0,0], 'target')
    };
    core.#revision = Number.isSafeInteger(project.revision) && project.revision >= 0 ? project.revision : 0;
    core.#counter = 1;
    return core;
  }

  exportOBJ() {
    const lines = ['# AIPaint Blockout Modeler OBJ'], vertices = [];
    let offset = 1;
    for (const object of this.#objects) {
      const mesh = this.meshFor(object.id);
      lines.push(`o ${object.name.replace(/\s+/g, '_')}`);
      for (const v of mesh.vertices) {
        lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`);
        vertices.push(v);
      }
      for (const face of mesh.faces) lines.push(`f ${face.map(i => i + offset).join(' ')}`);
      offset += mesh.vertices.length;
    }
    return lines.join('\n') + '\n';
  }
}
