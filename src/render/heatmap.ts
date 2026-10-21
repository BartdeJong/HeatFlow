import { paletteBytes, type PaletteId } from './palette';
import type { Simulation } from '../sim/simulation';

export interface HeatmapRenderer {
  render(sim: Simulation, tMin: number, tMax: number): void;
  setPalette(id: PaletteId): void;
  resize(): void;
  dispose(): void;
}

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTemp;
uniform sampler2D uPalette;
uniform vec2 uRange;
in vec2 vUv;
out vec4 outColor;
void main() {
  float temp = texture(uTemp, vec2(vUv.x, 1.0 - vUv.y)).r;
  float t = clamp((temp - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  outColor = vec4(texture(uPalette, vec2(0.001 + t * 0.998, 0.5)).rgb, 1.0);
}`;

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

function createWebGLRenderer(canvas: HTMLCanvasElement, palette: PaletteId): HeatmapRenderer {
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) throw new Error('WebGL2 not available');

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
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

  const setupTexture = (unit: number): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const tex = setupTexture(0);
  const palTex = setupTexture(1);

  const setPalette = (id: PaletteId) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, palTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes(id));
    gl.activeTexture(gl.TEXTURE0);
  };
  setPalette(palette);

  const uRange = gl.getUniformLocation(prog, 'uRange');
  gl.uniform1i(gl.getUniformLocation(prog, 'uTemp'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uPalette'), 1);

  let texW = 0;
  let texH = 0;

  return {
    render(sim, tMin, tMax) {
      fitCanvas(canvas);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0);
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
    setPalette,
    resize() {
      fitCanvas(canvas);
    },
    dispose() {
      gl.deleteTexture(tex);
      gl.deleteTexture(palTex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
  };
}

function createCanvas2DRenderer(canvas: HTMLCanvasElement, palette: PaletteId): HeatmapRenderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d')!;
  let lut = paletteBytes(palette);

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
        const k = Math.min(255, Math.max(0, Math.round(((sim.T[i] - tMin) / span) * 255))) * 4;
        img.data[i * 4] = lut[k];
        img.data[i * 4 + 1] = lut[k + 1];
        img.data[i * 4 + 2] = lut[k + 2];
        img.data[i * 4 + 3] = 255;
      }
      offCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    },
    setPalette(id) {
      lut = paletteBytes(id);
    },
    resize() {
      fitCanvas(canvas);
    },
    dispose() {},
  };
}

/** WebGL2 renderer with Canvas2D fallback. */
export function createRenderer(canvas: HTMLCanvasElement, palette: PaletteId): HeatmapRenderer {
  try {
    const probe = document.createElement('canvas');
    if (probe.getContext('webgl2')) return createWebGLRenderer(canvas, palette);
  } catch (e) {
    console.warn('WebGL unavailable, falling back to Canvas2D', e);
  }
  return createCanvas2DRenderer(canvas, palette);
}
