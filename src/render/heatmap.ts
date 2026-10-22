import { paletteBytes, paletteColor, type PaletteId } from './palette';
import { dot, project, type Vec3, type ViewTransform } from './camera';
import { furnitureBoxes, type FurnitureBox } from '../sim/furniture';
import type { Furniture } from '../sim/config';
import type { SimulationField } from '../sim/field';

export interface RenderView {
  transform: ViewTransform;
  size: Vec3;
  mode: 'volume' | 'slice';
  axis: 'x' | 'y' | 'z';
  fraction: number;
  temperatures?: { min: number; max: number; mean: number };
  temperatureField?: { T: Float32Array; sample(x: number, y: number, z: number): number };
  furniture?: Furniture[];
  selectedFurnitureId?: number;
}
export interface HeatmapRenderer {
  render(sim: SimulationField, tMin: number, tMax: number, view: RenderView): void;
  setPalette(id: PaletteId): void;
  resize(): void;
  dispose(): void;
}

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uTemp;
uniform sampler3D uSolid;
uniform sampler2D uPalette;
uniform vec3 uSize, uOrigin, uNormal, uRight, uUp;
uniform vec2 uResolution;
uniform float uScale, uFraction;
uniform vec3 uThermal;
uniform int uMode, uAxis;
uniform int uBoxCount;
uniform vec4 uBoxMin[72], uBoxMax[72];
uniform vec3 uFurnitureColor[8];
uniform vec2 uFurnitureStyle[8];
out vec4 outColor;
vec3 color(float t) { return texture(uPalette, vec2(clamp(t, 0.002, 0.998), 0.5)).rgb; }
void main() {
  vec2 pixel = (gl_FragCoord.xy - uResolution * 0.5) / uScale;
  vec3 ro = uOrigin + uRight * pixel.x + uUp * pixel.y;
  vec3 rd = -uNormal;
  vec3 safeDir = vec3(rd.x == 0.0 ? 0.000001 : rd.x, rd.y == 0.0 ? 0.000001 : rd.y, rd.z == 0.0 ? 0.000001 : rd.z);
  vec3 a = -ro / safeDir, b = (uSize - ro) / safeDir;
  vec3 lo = min(a,b), hi = max(a,b);
  float entry = max(max(lo.x,lo.y),lo.z), exit = min(min(hi.x,hi.y),hi.z);
  if (exit < max(0.0,entry)) { outColor = vec4(0); return; }
  float roomExit = exit;
  float objectT = exit + 1.0;
  vec3 objectColor = vec3(0);
  for (int i = 0; i < 72; i++) {
    if (i >= uBoxCount) break;
    vec3 ba = (uBoxMin[i].xyz - ro) / safeDir, bb = (uBoxMax[i].xyz - ro) / safeDir;
    vec3 near = min(ba, bb), far = max(ba, bb);
    float t = max(max(near.x, near.y), near.z), end = min(min(far.x, far.y), far.z);
    if (t < 0.0 || t > end || t > objectT) continue;
    objectT = t;
    vec3 normal = vec3(0);
    if (near.x >= near.y && near.x >= near.z) normal.x = -sign(rd.x);
    else if (near.y >= near.z) normal.y = -sign(rd.y);
    else normal.z = -sign(rd.z);
    int owner = int(uBoxMax[i].w + 0.5);
    vec3 pos = ro + rd * t;
    float light = 0.52 + 0.48 * max(0.0, dot(normal, normalize(vec3(-0.4, 0.6, 1.0))));
    float grain = uFurnitureStyle[owner].y == 0.0 ? 0.025 * sin(pos.x * 48.0 + sin(pos.y * 13.0) * 3.0) : 0.008 * sin(pos.x * 150.0) * sin(pos.y * 150.0);
    vec3 faceDistance = min(pos - uBoxMin[i].xyz, uBoxMax[i].xyz - pos);
    float edgeDistance = min(min(max(faceDistance.x, faceDistance.y), max(faceDistance.x, faceDistance.z)), max(faceDistance.y, faceDistance.z));
    float edge = 1.0 - smoothstep(0.008, 0.024, edgeDistance);
    objectColor = uFurnitureColor[owner] * uBoxMin[i].w * (light + grain) * (1.0 - 0.15 * edge);
    objectColor = mix(objectColor, vec3(1.0, 0.73, 0.43), edge * uFurnitureStyle[owner].x * 0.9);
  }
  if (uMode == 1) {
    float dir = rd[uAxis];
    if (abs(dir) < 0.00001) { outColor = objectT <= roomExit ? vec4(objectColor, 1) : vec4(0); return; }
    float t = (uSize[uAxis] * uFraction - ro[uAxis]) / dir;
    if (objectT <= roomExit && (t < entry || objectT <= t)) { outColor = vec4(objectColor, 1); return; }
    if (t < entry - 0.0001 || t > exit + 0.0001) { outColor = vec4(0); return; }
    vec3 pos = ro + rd * t;
    if (texture(uSolid, pos / uSize).r > 0.0) { outColor = vec4(0); return; }
    outColor = vec4(color(texture(uTemp, pos / uSize).r), 0.94);
    return;
  }
  // Show interior temperature anomalies as clouds. The reference is the volume mean,
  // so a plume passing through the centre cannot disappear into its own reference.
  vec3 sum = vec3(0); float opacity = 0.0;
  exit = min(exit, objectT);
  float stepSize = (exit - entry) / 80.0;
  float roomScale = min(min(uSize.x, uSize.y), uSize.z);
  for (int i = 0; i < 80; i++) {
    vec3 pos = ro + rd * (entry + (float(i) + 0.5) * stepSize);
    if (texture(uSolid, pos / uSize).r > 0.0) continue;
    float t = texture(uTemp, pos / uSize).r;
    float delta = t - uThermal.x;
    float contrast = abs(delta) / (delta >= 0.0 ? uThermal.y : uThermal.z);
    vec3 faceDistance = min(pos, uSize - pos);
    float edge = smoothstep(0.0, roomScale * 0.05, min(min(faceDistance.x, faceDistance.y), faceDistance.z));
    float density = 12.0 / roomScale * pow(smoothstep(0.04, 0.9, contrast), 1.5) * edge;
    float alpha = 1.0 - exp(-density * stepSize);
    sum += (1.0 - opacity) * color(t) * alpha;
    opacity += (1.0 - opacity) * alpha;
  }
  float rear = texture(uTemp, (ro + rd * (exit - 0.001)) / uSize).r;
  bool hitFurniture = objectT <= roomExit;
  float rearAlpha = hitFurniture ? 1.0 : 0.06;
  sum += (1.0 - opacity) * (hitFurniture ? objectColor : color(rear)) * rearAlpha;
  opacity += (1.0 - opacity) * rearAlpha;
  outColor = vec4(sum / max(opacity, 0.001), opacity);
}`;

export function fitCanvas(canvas: HTMLCanvasElement, maxDpr = 1.5): number {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

function furnitureColor(f: Furniture): Vec3 {
  if (f.material === 'wood') return [0.67, 0.47, 0.29];
  if (f.material === 'metal') return [0.55, 0.64, 0.7];
  return f.kind === 'bed' ? [0.68, 0.58, 0.55] : [0.42, 0.56, 0.65];
}
const partTone = (part: FurnitureBox['part']) => part === 'leg' ? 0.52 : part === 'seat' ? 1.12 : part === 'back' ? 0.88 : 1;

function createWebGLRenderer(canvas: HTMLCanvasElement, palette: PaletteId): HeatmapRenderer {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 not available');
  const shaders: WebGLShader[] = [];
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    shaders.push(shader);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
  gl.useProgram(program);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const temp = gl.createTexture()!, pal = gl.createTexture()!, solid = gl.createTexture()!;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, temp);
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pal);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, solid);
  for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const setPalette = (id: PaletteId) => {
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, pal);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes(id));
  };
  setPalette(palette);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(uniform('uTemp'), 0); gl.uniform1i(uniform('uPalette'), 1);
  gl.uniform1i(uniform('uSolid'), 2);
  let bytes = new Uint8Array(0), grid = '';
  let solidData: Uint8Array | undefined;
  let lastFurniture: Furniture[] | undefined, lastSelection: number | undefined;
  const mins = new Float32Array(72 * 4), maxs = new Float32Array(72 * 4);
  const colors = new Float32Array(8 * 3), styles = new Float32Array(8 * 2);
  return {
    render(sim, tMin, tMax, view) {
      const dpr = fitCanvas(canvas);
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (bytes.length !== sim.T.length) bytes = new Uint8Array(sim.T.length);
      const span = tMax - tMin || 1;
      const field = view.temperatureField ?? sim;
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(255 * (field.T[i] - tMin) / span)));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, temp);
      const key = `${sim.nx}|${sim.ny}|${sim.nz}`;
      if (grid !== key) {
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, sim.nx, sim.ny, sim.nz, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, solid);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, sim.nx, sim.ny, sim.nz, 0, gl.RED, gl.UNSIGNED_BYTE, sim.solid);
        solidData = sim.solid;
        grid = key;
      } else gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, sim.nx, sim.ny, sim.nz, gl.RED, gl.UNSIGNED_BYTE, bytes);
      if (solidData !== sim.solid) {
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, solid);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, sim.nx, sim.ny, sim.nz, gl.RED, gl.UNSIGNED_BYTE, sim.solid);
        solidData = sim.solid;
      }
      if (lastFurniture !== view.furniture || lastSelection !== view.selectedFurnitureId) {
        lastFurniture = view.furniture; lastSelection = view.selectedFurnitureId;
        let count = 0;
        for (let i = 0; i < (view.furniture?.length ?? 0); i++) {
          const f = view.furniture![i];
          colors.set(furnitureColor(f), i * 3);
          styles.set([Number(f.id === view.selectedFurnitureId), f.material === 'wood' ? 0 : f.material === 'fabric' ? 1 : 2], i * 2);
          for (const b of furnitureBoxes(f)) {
            mins.set([...b.min, partTone(b.part)], count * 4); maxs.set([...b.max, i], count * 4); count++;
          }
        }
        gl.uniform1i(uniform('uBoxCount'), count);
        gl.uniform4fv(uniform('uBoxMin[0]'), mins); gl.uniform4fv(uniform('uBoxMax[0]'), maxs);
        gl.uniform3fv(uniform('uFurnitureColor[0]'), colors); gl.uniform2fv(uniform('uFurnitureStyle[0]'), styles);
      }
      const { transform: v } = view;
      gl.uniform3fv(uniform('uSize'), view.size);
      gl.uniform3fv(uniform('uOrigin'), v.origin); gl.uniform3fv(uniform('uNormal'), v.normal);
      gl.uniform3fv(uniform('uRight'), v.right); gl.uniform3fv(uniform('uUp'), v.up);
      gl.uniform2f(uniform('uResolution'), canvas.width, canvas.height);
      gl.uniform1f(uniform('uScale'), v.scale * dpr);
      gl.uniform1f(uniform('uFraction'), view.fraction);
      const { min, max, mean } = view.temperatures ?? sim.stats();
      gl.uniform3f(uniform('uThermal'), (mean - tMin) / span, Math.max(0.5, max - mean) / span, Math.max(0.5, mean - min) / span);
      gl.uniform1i(uniform('uMode'), view.mode === 'slice' ? 1 : 0);
      gl.uniform1i(uniform('uAxis'), ['x', 'y', 'z'].indexOf(view.axis));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    setPalette,
    resize() { fitCanvas(canvas); },
    dispose() {
      gl.deleteTexture(temp); gl.deleteTexture(pal); gl.deleteTexture(solid); gl.deleteBuffer(buffer); gl.deleteVertexArray(vao);
      gl.deleteProgram(program); for (const shader of shaders) gl.deleteShader(shader);
    },
  };
}

/** CPU fallback draws temperature planes in the same rotatable 3D coordinate system. */
function createCanvasRenderer(canvas: HTMLCanvasElement, palette: PaletteId): HeatmapRenderer {
  const ctx = canvas.getContext('2d')!;
  return {
    render(sim, tMin, tMax, view) {
      const dpr = fitCanvas(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      const axis = view.mode === 'slice' ? ['x', 'y', 'z'].indexOf(view.axis) : 2;
      const other = [0, 1, 2].filter((n) => n !== axis);
      const levels = view.mode === 'slice' ? [view.fraction] : Array.from({ length: 14 }, (_, i) => (i + 0.5) / 14);
      levels.sort((a, b) => (a - b) * view.transform.normal[axis]);
      const n = 22;
      const { min, max, mean } = view.temperatures ?? sim.stats();
      const surfaces: { points: Vec3[]; color: string; depth: number; edge?: string }[] = [];
      for (const level of levels) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const point = (a: number, b: number): Vec3 => {
          const p: Vec3 = [0, 0, 0]; p[axis] = level * view.size[axis];
          p[other[0]] = a / n * view.size[other[0]]; p[other[1]] = b / n * view.size[other[1]]; return p;
        };
        const p = point(i + 0.5, j + 0.5);
        if (sim.isSolid(...p)) continue;
        const temp = (view.temperatureField ?? sim).sample(...p);
        const rgb = paletteColor(palette, (temp - tMin) / (tMax - tMin || 1));
        const contrast = Math.abs(temp - mean) / Math.max(0.5, temp >= mean ? max - mean : mean - min);
        const alpha = view.mode === 'slice' ? 0.96 : Math.min(0.65, Math.max(0, contrast - 0.04) ** 1.5 * 0.8);
        if (alpha < 0.005) continue;
        surfaces.push({ color: `rgba(${rgb.join(',')},${alpha})`, depth: dot(p, view.transform.normal),
          points: [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => point(a, b)) });
      }
      for (const f of view.furniture ?? []) for (const box of furnitureBoxes(f)) for (let axis = 0; axis < 3; axis++) {
        const other = [0, 1, 2].filter((n) => n !== axis);
        const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => {
          const p = [...box.min] as Vec3;
          p[axis] = view.transform.normal[axis] >= 0 ? box.max[axis] : box.min[axis];
          p[other[0]] = a ? box.max[other[0]] : box.min[other[0]];
          p[other[1]] = b ? box.max[other[1]] : box.min[other[1]]; return p;
        });
        const center = points[0].map((value, i) => (value + points[2][i]) / 2) as Vec3;
        const rgb = furnitureColor(f).map((c) => c * 255 * partTone(box.part) * (axis === 2 ? 1 : axis === 0 ? 0.65 : 0.8));
        surfaces.push({ points, color: `rgb(${rgb.join(',')})`, depth: dot(center, view.transform.normal),
          edge: f.id === view.selectedFurnitureId ? '#efbe83' : '#18202d55' });
      }
      surfaces.sort((a, b) => a.depth - b.depth);
      for (const surface of surfaces) {
        ctx.beginPath();
        for (const point of surface.points) { const q = project(view.transform, point); ctx.lineTo(q.x, q.y); }
        ctx.closePath(); ctx.fillStyle = surface.color; ctx.fill();
        if (surface.edge) { ctx.strokeStyle = surface.edge; ctx.lineWidth = 1; ctx.stroke(); }
      }
    },
    setPalette(id) { palette = id; },
    resize() { fitCanvas(canvas); },
    dispose() {},
  };
}

export function createRenderer(canvas: HTMLCanvasElement, palette: PaletteId): HeatmapRenderer {
  // Probe separately so a failed GPU initialization cannot lock the visible canvas context.
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  if (gl) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    try { return createWebGLRenderer(canvas, palette); }
    catch (error) { console.warn('3D renderer initialization failed', error); throw error; }
  }
  return createCanvasRenderer(canvas, palette);
}
