import type { RoomConfig } from '../sim/config';

export type Vec3 = [number, number, number];
export type Camera = { yaw: number; pitch: number; zoom: number };
export type ViewTransform = ReturnType<typeof viewTransform>;
export const defaultCamera = (): Camera => ({ yaw: 0.95, pitch: 0.48, zoom: 1 });
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Shared orthographic camera for GPU rays, overlays, and dragging on a horizontal plane. */
export function viewTransform(room: RoomConfig, camera: Camera, width: number, height: number) {
  const { yaw, pitch } = camera;
  const normal: Vec3 = [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch)];
  const right: Vec3 = [Math.sin(yaw), -Math.cos(yaw), 0];
  const up: Vec3 = [-Math.cos(yaw) * Math.sin(pitch), -Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch)];
  const center: Vec3 = [room.widthM / 2, room.heightM / 2, room.ceilingM / 2];
  const radius = Math.hypot(room.widthM, room.heightM, room.ceilingM) / 2;
  const scale = Math.max(1, Math.min(width, height)) * 0.78 * camera.zoom / (2 * radius);
  const origin = center.map((n, i) => n + normal[i] * radius * 3) as Vec3;
  return { normal, right, up, center, origin, scale, width, height };
}

export function project(v: ViewTransform, point: Vec3) {
  const p = point.map((n, i) => n - v.center[i]) as Vec3;
  return { x: v.width / 2 + dot(p, v.right) * v.scale, y: v.height / 2 - dot(p, v.up) * v.scale };
}

export function pointOnPlane(v: ViewTransform, px: number, py: number, axis: 0 | 1 | 2, value: number): Vec3 | null {
  const sx = (px - v.width / 2) / v.scale, sy = (v.height / 2 - py) / v.scale;
  const origin = v.origin.map((n, i) => n + v.right[i] * sx + v.up[i] * sy) as Vec3;
  if (Math.abs(v.normal[axis]) < 1e-5) return null;
  const t = (origin[axis] - value) / v.normal[axis];
  return origin.map((n, i) => n - v.normal[i] * t) as Vec3;
}

export function screenRay(v: ViewTransform, px: number, py: number): { origin: Vec3; direction: Vec3 } {
  const sx = (px - v.width / 2) / v.scale, sy = (v.height / 2 - py) / v.scale;
  return {
    origin: v.origin.map((n, i) => n + v.right[i] * sx + v.up[i] * sy) as Vec3,
    direction: v.normal.map((n) => -n) as Vec3,
  };
}
