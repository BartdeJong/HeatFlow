import { expect, it } from 'vitest';
import { DEFAULT_ROOM } from '../sim/config';
import { defaultCamera, pointOnPlane, project, viewTransform, type Vec3 } from './camera';

it('maps projected markers back to their 3D plane after rotating and zooming', () => {
  for (const yaw of [-2, 0.4, 2]) for (const pitch of [0.15, 0.7, 1.4]) {
    const v = viewTransform(DEFAULT_ROOM, { ...defaultCamera(), yaw, pitch, zoom: 1.3 }, 1200, 800);
    const point: Vec3 = [1.3, 2.6, 0.7];
    const p = project(v, point);
    const result = pointOnPlane(v, p.x, p.y, 2, point[2])!;
    result.forEach((n, i) => expect(n).toBeCloseTo(point[i], 8));
  }
});
