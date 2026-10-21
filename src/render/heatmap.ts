import { PALETTE, paletteColor } from './palette';
import type { Simulation } from '../sim/simulation';

export interface HeatmapRenderer {
  render(sim: Simulation, tMin: number, tMax: number): void;
  resize(): void;
  dispose(): void;
}

function fragmentSource(): string {
  const n = PALETTE.length;
  const f = (v: number) => v.toFixed(4);
  let body = '';
  for (let i = 1; i < n; i++) {
    const [p0, r0, g0, b0] = PALETTE[i - 1];
    const [p1, r1, g1, b1] = PALETTE[i];
    const c0 = `vec3(${f(r0 / 255)},${f(g0 / 255)},${f(b0 / 255)})`;
    const c1 = `vec3(${f(r1 / 255)},${f(g1 / 255)},${f(b1 / 255)})`;
    body += `${i === 1 ? '' : 'else '}if (t <= ${f(p1)}) return mix(${c0}, ${c1}, (t - ${f(p0)}) / ${f(p1 - p0)});\n`;
  }
  const [, rl, gl, bl] = PALETTE[n - 1];
  return `#version 300 es
precision highp float;
uniform sampler2D uTemp;
uniform vec2 uRange;
in vec2 vUv;
out vec4 outColor;
vec3 palette(float t) {
  ${body}
  return vec3(${f(rl / 255)},${f(gl / 255)},${f(bl / 255)});
}
void main() {
  float temp = texture(uTemp, vec2(vUv.x, 1.0 - vUv.y)).r;
  float t = clamp((temp - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  outColor = vec4(palette(t), 1.0);
}`;
}

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed');
  }
  return s;
}

function fitCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function createWebGLRenderer(canvas: HTMLCanvasElement): HeatmapRenderer {
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 not available');

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragmentSource()));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
  }
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const uRange = gl.getUniformLocation(prog, 'uRange');
  gl.uniform1i(gl.getUniformLocation(prog, 'uTemp'), 0);

  let texW = 0;
  let texH = 0;

  return {
    render(sim, tMin, tMax) {
      fitCanvas(canvas);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (texW !== sim.nx || texH !== sim.ny) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, sim.nx, sim.ny, 0, gl.RED, gl.FLOAT, sim.T);
        texW = sim.nx;
        texH = sim.ny;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.nx, sim.ny, gl.RED, gl.FLOAT, sim.T);
      }
      gl.uniform2f(uRange, tMin, tMax);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    resize() {
      fitCanvas(canvas);
    },
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
  };
}

function createCanvas2DRenderer(canvas: HTMLCanvasElement): HeatmapRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d')!;
  const lut: Uint8ClampedArray[] = [];
  for (let i = 0; i < 256; i++) lut.push(Uint8ClampedArray.from(paletteColor(i / 255)));

  return {
    render(sim, tMin, tMax) {
      fitCanvas(canvas);
      if (off.width !== sim.nx || off.height !== sim.ny) {
        off.width = sim.nx;
        off.height = sim.ny;
      }
      const img = offCtx.createImageData(sim.nx, sim.ny);
      const span = tMax - tMin || 1;
      for (let i = 0; i < sim.T.length; i++) {
        const k = Math.min(255, Math.max(0, Math.round(((sim.T[i] - tMin) / span) * 255)));
        const c = lut[k];
        img.data[i * 4] = c[0];
        img.data[i * 4 + 1] = c[1];
        img.data[i * 4 + 2] = c[2];
        img.data[i * 4 + 3] = 255;
      }
      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    },
    resize() {
      fitCanvas(canvas);
    },
    dispose() {},
  };
}

/** WebGL2 renderer with Canvas2D fallback. */
export function createRenderer(canvas: HTMLCanvasElement): HeatmapRenderer {
  try {
    const probe = document.createElement('canvas');
    if (probe.getContext('webgl2')) return createWebGLRenderer(canvas);
  } catch (e) {
    console.warn('WebGL unavailable, falling back to Canvas2D', e);
  }
  return createCanvas2DRenderer(canvas);
}
