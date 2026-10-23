<script lang="ts">
  import { paletteCssGradient } from '../render/palette';
  import { onMount, untrack } from 'svelte';
  import { createRenderer, fitCanvas, type HeatmapRenderer } from '../render/heatmap';
  import { defaultCamera, dot, pointOnPlane, project, screenRay, viewTransform, walkTransform, type Camera, type Vec3, type ViewTransform } from '../render/camera';
  import { AirflowTrails, airflowHighlight } from '../render/airflow';
  import { TemperatureDisplay } from '../render/temperature';
  import { paletteColor } from '../render/palette';
  import { TEMPERATURE_MIN_C, ROOM_TEMPERATURE_C, TEMPERATURE_MAX_C, temperaturePosition } from '../render/temperature-scale';
  import { SimulationClient } from '../sim/runtime';
  import type { SimulationField } from '../sim/field';
  import { getEmitter } from '../sim/model';
  import type { Opening } from '../sim/config';
  import { DEFAULT_CEILING_FAN, FURNITURE_PRESETS, ROOF_MATERIALS, roofGeometry } from '../sim/config';
  import { furnitureBoxes, intersectBox } from '../sim/furniture';
  import { app, moveItem, recorder, select, updateFurniture, updateOpening } from '../state/app.svelte';

  let canvas: HTMLCanvasElement;
  let overlay: HTMLCanvasElement;
  let roomEl: HTMLDivElement;
  let renderer: HeatmapRenderer | undefined;
  const client = new SimulationClient();
  const sim = client.field;
  let camera = defaultCamera();
  let walkCamera: Camera = { yaw: -Math.PI / 2, pitch: 0, zoom: 1 };
  let walkPosition: Vec3 = [0, 0, 1.6];
  let cameraMode = $state<'orbit' | 'walk'>('orbit');
  const walkKeys = new Set<string>();
  const handleWalkBlur = () => walkKeys.clear();
  let transform: ViewTransform | undefined;
  let drag: { kind: 'source' | 'probe' | 'furniture'; id: number; x: number; y: number; z: number; px: number; py: number } | null = null;
  let orbit: { px: number; py: number } | null = null;
  let hoverRaw: { px: number; py: number } | null = null;
  let hover = $state<{ px: number; py: number; temp: number; z: number } | null>(null);
  let markers = $state<{ kind: 'source' | 'probe'; id: number; px: number; py: number; x: number; y: number; z: number; cold: boolean; fan: boolean }[]>([]);
  let openingMarkers = $state<{ id: number; px: number; py: number; kind: string; open: boolean }[]>([]);
  let furnitureMarkers = $state<{ id: number; label: string; px: number; py: number }[]>([]);
  const boxes = $derived(app.room.furniture.flatMap(furnitureBoxes));
  const hasActiveCeilingFan = $derived(app.room.sources.some((source) => source.kind === 'fan' && source.fanEnabled !== false));
  const airflow = new AirflowTrails();
  const temperatureDisplay = new TemperatureDisplay();
  let airflowSim: SimulationField | undefined;
  let airflowSeedsKey = "";

  $effect(() => {
    const room = $state.snapshot(app.room);
    untrack(() => client.configure(room));
  });
  $effect(() => {
    const running = app.running, speed = app.speed;
    untrack(() => client.setControl(running, speed));
  });
  $effect(() => {
    app.resetToken;
    untrack(() => { client.reset(); airflow.reset(); temperatureDisplay.reset(); recorder.clear(); app.graphTick++; });
  });
  $effect(() => { renderer?.setPalette(app.palette); });
  $effect(() => { app.cameraToken; untrack(() => {
    camera = defaultCamera(); walkCamera = { yaw: -Math.PI / 2, pitch: 0, zoom: 1 };
    walkPosition = findWalkerSpawn();
  }); });
  $effect(() => {
    const keep = new Set(['avg', ...app.room.probes.map((p) => `p${p.id}`)]);
    untrack(() => recorder.removeSeriesExcept(keep));
  });

  function localPoint(e: PointerEvent) {
    const rect = roomEl.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }
  const walkerRadius = 0.18, walkerHeight = 1.7;
  function canWalkerOccupy(x: number, y: number) {
    if (x < walkerRadius || y < walkerRadius || x > app.room.widthM - walkerRadius || y > app.room.heightM - walkerRadius) return false;
    return !boxes.some((box) => box.min[2] < walkerHeight && box.max[2] > 0.12
      && x + walkerRadius > box.min[0] && x - walkerRadius < box.max[0]
      && y + walkerRadius > box.min[1] && y - walkerRadius < box.max[1]);
  }
  function findWalkerSpawn(): Vec3 {
    const candidates: { x: number; y: number; distance: number }[] = [];
    for (let y = walkerRadius + 0.1; y <= app.room.heightM - walkerRadius; y += 0.25) {
      for (let x = walkerRadius + 0.1; x <= app.room.widthM - walkerRadius; x += 0.25) {
        const distance = (x - app.room.widthM / 2) ** 2 + (y - app.room.heightM / 2) ** 2;
        if (canWalkerOccupy(x, y)) candidates.push({ x, y, distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const spawn = candidates[0];
    return [spawn?.x ?? app.room.widthM / 2, spawn?.y ?? app.room.heightM / 2, Math.min(walkerHeight - 0.05, app.room.ceilingM - 0.15)];
  }
  function setCameraMode(mode: 'orbit' | 'walk') {
    cameraMode = mode;
    walkKeys.clear();
    if (mode === 'walk') {
      walkPosition = findWalkerSpawn();
      walkCamera = { yaw: -Math.PI / 2, pitch: 0, zoom: 1 };
      requestAnimationFrame(() => roomEl?.focus());
    }
  }
  function handleWalkKeyDown(e: KeyboardEvent) {
    if (cameraMode !== 'walk' || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, button, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { setCameraMode('orbit'); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
      e.preventDefault(); walkKeys.add(key);
    }
  }
  function handleWalkKeyUp(e: KeyboardEvent) { walkKeys.delete(e.key.toLowerCase()); }
  function updateWalker(dt: number) {
    walkPosition[2] = Math.min(walkerHeight - 0.05, app.room.ceilingM - 0.15);
    if (!canWalkerOccupy(walkPosition[0], walkPosition[1])) walkPosition = findWalkerSpawn();
    const forward = [-Math.cos(walkCamera.yaw), -Math.sin(walkCamera.yaw)];
    const right = [Math.sin(walkCamera.yaw), -Math.cos(walkCamera.yaw)];
    let dx = 0, dy = 0;
    if (walkKeys.has('w') || walkKeys.has('arrowup')) { dx += forward[0]; dy += forward[1]; }
    if (walkKeys.has('s') || walkKeys.has('arrowdown')) { dx -= forward[0]; dy -= forward[1]; }
    if (walkKeys.has('d') || walkKeys.has('arrowright')) { dx += right[0]; dy += right[1]; }
    if (walkKeys.has('a') || walkKeys.has('arrowleft')) { dx -= right[0]; dy -= right[1]; }
    const length = Math.hypot(dx, dy);
    if (!length) return;
    const speed = walkKeys.has('shift') ? 3.8 : 2.2;
    dx = dx / length * speed * dt; dy = dy / length * speed * dt;
    // Resolve each axis independently so the player slides along walls and furniture.
    if (canWalkerOccupy(walkPosition[0] + dx, walkPosition[1])) walkPosition[0] += dx;
    if (canWalkerOccupy(walkPosition[0], walkPosition[1] + dy)) walkPosition[1] += dy;
  }
  function startDrag(e: PointerEvent, kind: 'source' | 'probe' | 'furniture', id: number) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const item = (kind === 'source' ? app.room.sources : kind === 'probe' ? app.room.probes : app.room.furniture).find((s) => s.id === id);
    if (!item) return;
    roomEl.setPointerCapture(e.pointerId);
    select({ kind, id });
    drag = { kind, id, x: item.x, y: item.y, z: 'z' in item ? item.z : item.heightM, ...localPoint(e) };
    hoverRaw = null; hover = null;
  }
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 2) return;
    if (cameraMode === 'orbit' && e.button === 0 && transform) {
      const { px, py } = localPoint(e), ray = screenRay(transform, px, py);
      let closest = Infinity, id: number | undefined;
      for (const box of boxes) {
        const t = intersectBox(ray.origin, ray.direction, box);
        if (t !== null && t <= closest) { closest = t; id = box.id; }
      }
      if (id !== undefined) { startDrag(e, 'furniture', id); return; }
    }
    roomEl.setPointerCapture(e.pointerId); orbit = localPoint(e);
    hover = null;
  }
  function onPointerMove(e: PointerEvent) {
    const p = localPoint(e);
    if (orbit) {
      if (cameraMode === 'walk') {
        walkCamera.yaw += (p.px - orbit.px) * 0.008;
        walkCamera.pitch = Math.max(-1.2, Math.min(1.2, walkCamera.pitch + (p.py - orbit.py) * 0.008));
      } else {
        camera.yaw += (p.px - orbit.px) * 0.008;
        camera.pitch = Math.max(0.12, Math.min(1.45, camera.pitch + (p.py - orbit.py) * 0.008));
      }
      orbit = p; return;
    }
    if (drag && transform) {
      const isFan = drag.kind === 'source' && app.room.sources.find((source) => source.id === drag!.id)?.kind === 'fan';
      if (e.shiftKey && drag.kind !== 'furniture' && !isFan) moveItem(drag.kind, drag.id, drag.x, drag.y, drag.z - (p.py - drag.py) / transform.scale);
      else {
        const from = pointOnPlane(transform, drag.px, drag.py, 2, drag.z);
        const to = pointOnPlane(transform, p.px, p.py, 2, drag.z);
        if (from && to) moveItem(drag.kind, drag.id, drag.x + to[0] - from[0], drag.y + to[1] - from[1], drag.z);
      }
      return;
    }
    hoverRaw = p;
  }
  function onPointerUp(e: PointerEvent) {
    drag = null; orbit = null;
    if (roomEl.hasPointerCapture(e.pointerId)) roomEl.releasePointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') { hoverRaw = null; hover = null; }
  }
  function zoom(factor: number) {
    if (cameraMode === 'walk') walkCamera.zoom = Math.max(0.65, Math.min(1.8, walkCamera.zoom * factor));
    else camera.zoom = Math.max(0.55, Math.min(2.4, camera.zoom * factor));
  }
  function onKey(e: KeyboardEvent, m: typeof markers[number]) {
    const step = e.shiftKey ? 0.5 : 0.1;
    const directions: Record<string, Vec3> = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], PageUp: [0, 0, step], PageDown: [0, 0, -step] };
    const d = directions[e.key];
    if (!d) return;
    if (m.fan && d[2] !== 0) { e.preventDefault(); return; }
    e.preventDefault(); moveItem(m.kind, m.id, m.x + d[0], m.y + d[1], m.z + d[2]);
  }
  function onFurnitureKey(e: KeyboardEvent, id: number) {
    const f = app.room.furniture.find((item) => item.id === id);
    if (!f) return;
    const step = e.shiftKey ? 0.5 : 0.1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (d[e.key]) { e.preventDefault(); moveItem('furniture', id, f.x + d[e.key][0], f.y + d[e.key][1]); }
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); updateFurniture(id, { rotation: f.rotation === 0 ? 90 : 0 }); }
  }
  function openingPoints(o: Opening): Vec3[] {
    const a = o.pos - o.length / 2, b = o.pos + o.length / 2;
    const lo = o.sillM, hi = lo + o.heightM;
    if (o.side === 'top' || o.side === 'bottom') {
      const y = o.side === 'top' ? 0 : app.room.heightM;
      return [[a, y, lo], [b, y, lo], [b, y, hi], [a, y, hi]];
    }
    const x = o.side === 'left' ? 0 : app.room.widthM;
    return [[x, a, lo], [x, b, lo], [x, b, hi], [x, a, hi]];
  }

  function drawOverlay(v: ViewTransform, wallDt: number) {
    const dpr = fitCanvas(overlay, 2);
    const ctx = overlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, v.width, v.height);
    const { widthM: w, heightM: l, ceilingM: h } = app.room;
    const line = (a: Vec3, b: Vec3, color: string, width = 1) => {
      let start = a, end = b;
      if (cameraMode === 'walk') {
        const depth = (p: Vec3) => -dot(p.map((n, i) => n - v.origin[i]) as Vec3, v.normal);
        const da = depth(start), db = depth(end);
        if (da <= 0.05 && db <= 0.05) return;
        if (da <= 0.05 || db <= 0.05) {
          const t = (0.05 - da) / (db - da);
          const clipped = start.map((n, i) => n + (end[i] - n) * t) as Vec3;
          if (da <= 0.05) start = clipped; else end = clipped;
        }
      }
      const p = project(v, start), q = project(v, end);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    };
    const polygon = (points: Vec3[], fill: string, stroke: string) => {
      let visible = points;
      if (cameraMode === 'walk') {
        const depth = (p: Vec3) => -dot(p.map((n, i) => n - v.origin[i]) as Vec3, v.normal);
        visible = [];
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length], da = depth(a), db = depth(b);
          if (da >= 0.05) visible.push(a);
          if ((da < 0.05 && db >= 0.05) || (da >= 0.05 && db < 0.05)) {
            const t = (0.05 - da) / (db - da);
            visible.push(a.map((n, axis) => n + (b[axis] - n) * t) as Vec3);
          }
        }
        if (visible.length < 3) return;
      }
      ctx.beginPath(); visible.map((p) => project(v, p)).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke();
    };
    if (app.exterior && cameraMode !== 'walk') {
      const { rise, overhangM: o } = roofGeometry(app.room);
      const t = app.room.wall.thicknessM + app.room.wall.insulationM;
      const color = ROOF_MATERIALS.find((m) => m.id === app.room.roof.material)!.color;
      const left = -t - o, right = w + t + o, low = h - o * Math.tan(app.room.roof.pitchDeg * Math.PI / 180);
      // Translucent exterior keeps the simulation and its controls visible through the shell.
      polygon([[-t, -t, 0], [w + t, -t, 0], [w + t, -t, h], [-t, -t, h]], '#bfa18418', '#ccb39570');
      polygon([[w + t, -t, 0], [w + t, l + t, 0], [w + t, l + t, h], [w + t, -t, h]], '#bfa18418', '#ccb39570');
      polygon([[-t, l + t, 0], [w + t, l + t, 0], [w + t, l + t, h], [-t, l + t, h]], '#bfa18418', '#ccb39570');
      polygon([[-t, -t, 0], [-t, l + t, 0], [-t, l + t, h], [-t, -t, h]], '#bfa18418', '#ccb39570');
      for (const y of [-t, l + t]) polygon([[-t, y, h], [w / 2, y, h + rise], [w + t, y, h]], '#bfa18422', '#ccb39570');
      polygon([[left, -t-o, low], [w/2, -t-o, h+rise], [w/2, l+t+o, h+rise], [left, l+t+o, low]], color + '55', color);
      polygon([[right, -t-o, low], [w/2, -t-o, h+rise], [w/2, l+t+o, h+rise], [right, l+t+o, low]], color + '55', color);
    }
    if(app.room.heatingMode !== 'underfloor') for(const source of app.room.sources) {
      const emitter=getEmitter(source); if(emitter.kind==='ideal' || source.kind==='cold' || source.kind==='fan') continue;
      const size=[emitter.widthM,emitter.depthM,emitter.heightM], center=[source.x,source.y,source.z];
      const min=center.map((n,a)=>Math.max(0,n-size[a]/2)), max=center.map((n,a)=>Math.min([w,l,h][a],n+size[a]/2));
      for(let axis=0;axis<3;axis++) for(const sign of [0,1]) {
        const other=[0,1,2].filter(a=>a!==axis);
        const points=[[0,0],[1,0],[1,1],[0,1]].map(([a,b])=>{ const p=[...min] as Vec3; p[axis]=sign?max[axis]:min[axis];p[other[0]]=a?max[other[0]]:min[other[0]];p[other[1]]=b?max[other[1]]:min[other[1]];return p; });
        polygon(points, '#d7e1eb30', '#d7e1eb99');
      }
    }
    if (app.room.heatingMode === 'underfloor' && app.room.sources.some((s) => s.kind === 'heat' && s.powerKW > 0)) {
      polygon([[0,0,0], [w,0,0], [w,l,0], [0,l,0]], app.stats.thermostatHeating ? '#ff914233' : '#ff914210', '#ff914288');
    }
    const fan = app.room.sources.find((source) => source.kind === 'fan');
    if (fan) {
      const cx = fan.x, cy = fan.y, z = fan.z;
      const radius = (fan.fanDiameterM ?? DEFAULT_CEILING_FAN.diameterM) / 2, bladeWidth = Math.min(0.13, radius * 0.22);
      const spin = fan.fanEnabled === false ? 0 : sim.elapsed * (fan.fanSpeedMps ?? DEFAULT_CEILING_FAN.speedMps) * 2.2;
      line([cx, cy, h], [cx, cy, z], '#d5e0ecbb', 2);
      for (let blade = 0; blade < 4; blade++) {
        const angle = spin + blade * Math.PI / 2, ux = Math.cos(angle), uy = Math.sin(angle);
        const px = -uy * bladeWidth / 2, py = ux * bladeWidth / 2;
        polygon([
          [cx + ux * 0.09 + px, cy + uy * 0.09 + py, z],
          [cx + ux * radius + px, cy + uy * radius + py, z],
          [cx + ux * radius - px, cy + uy * radius - py, z],
          [cx + ux * 0.09 - px, cy + uy * 0.09 - py, z],
        ], '#d5e0ec88', '#edf4ffcc');
      }
      const motor = 0.09;
      polygon([[cx-motor,cy-motor,z-0.04],[cx+motor,cy-motor,z-0.04],[cx+motor,cy+motor,z-0.04],[cx-motor,cy+motor,z-0.04]], '#d5e0ec', '#ffffff');
    }
    if (app.showVectors) for (const vector of sim.vectorField()) {
      const length = Math.min(w, l, h) * 0.16 / vector.magnitude;
      const a = project(v, [vector.x, vector.y, vector.z]);
      const b = project(v, [vector.x + vector.dx * length, vector.y + vector.dy * length, vector.z + vector.dz * length]);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.strokeStyle = '#ffe8aacc'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      for (const turn of [-0.5, 0.5]) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - 5 * Math.cos(angle + turn), b.y - 5 * Math.sin(angle + turn)); }
      ctx.stroke();
    }
    if (cameraMode !== 'walk') {
      for (let x = 0; x <= w; x++) line([x, 0, 0], [x, l, 0], '#ffffff14');
      for (let y = 0; y <= l; y++) line([0, y, 0], [w, y, 0], '#ffffff14');
    }
    for (const z of [0, h]) {
      const corners: Vec3[] = [[0, 0, z], [w, 0, z], [w, l, z], [0, l, z]];
      for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4], z === 0 ? '#c7d6e5a0' : '#bfd4e766', z === 0 ? 2 : 1);
    }
    for (const [x, y] of [[0, 0], [w, 0], [w, l], [0, l]]) line([x, y, 0], [x, y, h], '#bfd4e780', 1.5);
    for (const o of app.room.openings) {
      const points = openingPoints(o).map((p) => project(v, p));
      ctx.beginPath(); points.forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath();
      ctx.fillStyle = o.open ? '#ff9f4320' : o.kind === 'window' ? '#8fd3ff35' : '#b9824f60'; ctx.fill();
      ctx.strokeStyle = o.open ? '#ffae5c' : o.kind === 'window' ? '#a2dcff' : '#d7a679'; ctx.lineWidth = 2;
      ctx.setLineDash(o.open ? [5, 4] : []); ctx.stroke(); ctx.setLineDash([]);
    }
    if (app.view === 'slice') {
      const axis = ['x', 'y', 'z'].indexOf(app.sliceAxis);
      const other = [0, 1, 2].filter((n) => n !== axis), size = [w, l, h];
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => {
        const p: Vec3 = [0, 0, 0]; p[axis] = size[axis] * app.sliceFraction;
        p[other[0]] = a * size[other[0]]; p[other[1]] = b * size[other[1]]; return p;
      });
      for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4], '#ffc98c', 1.5);
    }
    for (const item of [...app.room.sources, ...app.room.probes]) {
      if ('kind' in item && item.kind === 'fan') continue;
      ctx.setLineDash([3, 4]); line([item.x, item.y, 0], [item.x, item.y, item.z], '#f1f5f960'); ctx.setLineDash([]);
      const p = project(v, [item.x, item.y, 0]); ctx.strokeStyle = '#d8e2f080'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 5, 2.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (app.view === 'volume' && (app.room.convection || (fan !== undefined && fan.fanEnabled !== false)) && app.showAirflow) {
      const seeds: Vec3[] = [];
      for (let z = 0; z < 3; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
        seeds.push([w * (0.1 + x * 0.2), l * (0.1 + y * 0.8 / 3), h * (0.15 + z * 0.35)]);
      }
      // Extra seeds around each source reveal its plume and the returning circulation.
      for (const source of app.room.sources) for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        seeds.push([source.x + Math.cos(angle) * 0.18, source.y + Math.sin(angle) * 0.18,
          Math.max(0.05, Math.min(h - 0.05, source.z + (source.kind === 'heat' ? 0.18 : -0.18)))]);
      }
      const seedsKey = JSON.stringify([seeds, fan]);
      if (airflowSim !== sim || airflowSeedsKey !== seedsKey) {
        airflow.reset(); airflowSim = sim; airflowSeedsKey = seedsKey;
      }
      airflow.update(sim, [w, l, h], seeds, sim.elapsed, app.running ? wallDt : 0);
      ctx.lineCap = 'round';
      for (const layer of airflow.layers) {
        if (layer.opacity === 0) continue;
        for (let i = 0; i < layer.trails.length; i++) {
          const { points: path, temperatures } = layer.trails[i];
          for (let j = 1; j < path.length; j++) {
            const middle = path[j].map((n, axis) => (n + path[j - 1][axis]) / 2) as Vec3;
            if (boxes.some((box) => intersectBox(middle, v.normal, box) !== null)) continue;
            const highlight = airflowHighlight(airflow.phase, i, j);
            const taper = Math.min(1, j / 3, (path.length - j) / 3);
            const a = project(v, path[j - 1]), b = project(v, path[j]);
            const rgb = paletteColor(app.palette, temperaturePosition(temperatures[j]));
            ctx.strokeStyle = `rgba(${rgb.join(',')},${layer.opacity * taper * (0.14 + 0.8 * highlight)})`;
            ctx.lineWidth = 1 + highlight * 1.6;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      ctx.lineCap = 'butt';
    }
    ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#a9b7cc';
    const text = (p: Vec3, label: string, dy: number) => { const q = project(v, p); ctx.fillText(label, q.x, q.y + dy); };
    if (cameraMode !== 'walk') {
      text([w / 2, l, 0], `X · ${w.toFixed(1)} m`, 25);
      text([w, l / 2, 0], `Y · ${l.toFixed(1)} m`, 25);
      text([0, 0, h], `Z · ${h.toFixed(1)} m`, -16);
    }
    // Orientation widget remains readable as the room rotates.
    if (cameraMode !== 'walk') {
      const origin = { x: 48, y: v.height - 65 };
      for (const [axis, label, color] of [[0, 'X', '#f68f72'], [1, 'Y', '#8ed3a3'], [2, 'Z', '#80baff']] as const) {
        const x = origin.x + v.right[axis] * 28, y = origin.y - v.up[axis] * 28;
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = color; ctx.fillText(label, x + v.right[axis] * 9, y - v.up[axis] * 9 + 4);
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleWalkKeyDown);
    window.addEventListener('keyup', handleWalkKeyUp);
    window.addEventListener('blur', handleWalkBlur);
    renderer = createRenderer(canvas, app.palette);
    let generation = -1;
    client.onError = message => { app.running = false; app.stats.diagnostics.failure = message; };
    client.onUpdate = snapshot => {
      if (snapshot.generation !== generation) {
        generation = snapshot.generation; airflow.reset(); temperatureDisplay.reset();
      }
      Object.assign(app.stats, snapshot.stats, { elapsed: snapshot.elapsed, heatingKWh: snapshot.energy.heating,
        coolingKWh: snapshot.energy.cooling, thermostatHeating: snapshot.thermostatHeating,
        heatLoss: snapshot.heatLoss, achievedSpeed: snapshot.achievedSpeed, diagnostics: snapshot.diagnostics });
      app.furnitureTemperatures = snapshot.furnitureTemps;
      recorder.times = snapshot.history.times; recorder.series = new Map(snapshot.history.series); app.graphTick++;
      if (snapshot.diagnostics.failure) app.running = false;
    };
    let raf = 0, last = performance.now(), lastStats = 0, fpsSince = performance.now(), fpsFrames = 0;
    const frame = (now: number) => {
      fpsFrames++;
      if(now-fpsSince>=1000) { app.stats.renderFPS=fpsFrames*1000/(now-fpsSince); fpsSince=now; fpsFrames=0; }
      const wallDt = Math.min(0.1, (now - last) / 1000); last = now;
      if (cameraMode === 'walk') updateWalker(wallDt);
      temperatureDisplay.update(sim, app.running ? wallDt : 0);
      transform = cameraMode === 'walk'
        ? walkTransform(app.room, walkCamera, walkPosition, canvas.clientWidth, canvas.clientHeight)
        : viewTransform(app.exterior ? { ...app.room, ceilingM: app.room.ceilingM + roofGeometry(app.room).rise + 0.5 } : app.room, camera, canvas.clientWidth, canvas.clientHeight);
      renderer!.render(sim, { transform, size: [app.room.widthM, app.room.heightM, app.room.ceilingM], mode: app.view, axis: app.sliceAxis, fraction: app.sliceFraction, walkMode: cameraMode === 'walk', temperatureField: temperatureDisplay,
        furniture: app.room.furniture, selectedFurnitureId: app.selection?.kind === 'furniture' ? app.selection.id : undefined });
      drawOverlay(transform, wallDt);
      markers = cameraMode === 'walk' ? [] : [
        ...app.room.sources.map((p) => ({ ...p, kind: 'source' as const, cold: p.kind === 'cold', fan: p.kind === 'fan' })),
        ...app.room.probes.map((p) => ({ ...p, kind: 'probe' as const, cold: false, fan: false })),
      ].map((p) => { const q = project(transform!, [p.x, p.y, p.z]); return { ...p, px: q.x, py: q.y }; });
      openingMarkers = cameraMode === 'walk' ? [] : app.room.openings.map((o) => {
        const corners = openingPoints(o); const mid = corners[0].map((n, i) => (n + corners[2][i]) / 2) as Vec3;
        const p = project(transform!, mid); return { id: o.id, kind: o.kind, open: o.open, px: p.x, py: p.y };
      });
      furnitureMarkers = cameraMode === 'walk' ? [] : app.room.furniture.map((f) => {
        const p = project(transform!, [f.x, f.y, f.heightM + 0.05]);
        return { id: f.id, label: FURNITURE_PRESETS.find((item) => item.id === f.kind)!.label, px: p.x, py: p.y };
      });
      if (now - lastStats > 200) {
        lastStats = now;
        hover = null;
        if (cameraMode !== 'walk' && hoverRaw && !drag && !orbit) {
          const axis = app.view === 'slice' ? ['x', 'y', 'z'].indexOf(app.sliceAxis) as 0 | 1 | 2 : 2;
          const size = [app.room.widthM, app.room.heightM, app.room.ceilingM];
          const p = pointOnPlane(transform, hoverRaw.px, hoverRaw.py, axis, size[axis] * app.sliceFraction);
          if (p && p.every((n, i) => n >= 0 && n <= size[i])) hover = { ...hoverRaw, temp: sim.sample(...p), z: p[2] };
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); client.dispose(); renderer?.dispose();
      window.removeEventListener('keydown', handleWalkKeyDown);
      window.removeEventListener('keyup', handleWalkKeyUp);
      window.removeEventListener('blur', handleWalkBlur);
    };
  });
</script>

<div class="stage">
  <div class="metric-cards" aria-label="Live simulation readings">
    <div><span>ROOM AVERAGE</span><strong>{app.stats.mean.toFixed(1)}<small> °C</small></strong></div>
    <div><span>HOTTEST AIR</span><strong>{app.stats.max.toFixed(1)}<small> °C</small></strong></div>
    <div><span>HEAT LOSS</span><strong>{Math.abs(app.stats.heatLoss.totalW) >= 1000 ? (app.stats.heatLoss.totalW / 1000).toFixed(2) : app.stats.heatLoss.totalW.toFixed(0)}<small> {Math.abs(app.stats.heatLoss.totalW) >= 1000 ? 'kW' : 'W'}</small></strong></div>
  </div>
  <div class="heading">
    <span class="eyebrow">HEATFLOW / SPATIAL SIMULATION</span>
    <h2>{cameraMode === 'walk' ? 'Walk through the room' : 'Room overview'}</h2>
    <p>{app.room.widthM.toFixed(1)} × {app.room.heightM.toFixed(1)} × {app.room.ceilingM.toFixed(1)} m <span>·</span>{app.room.convection ? hasActiveCeilingFan ? 'Buoyant airflow + ceiling fan' : 'Buoyant airflow' : hasActiveCeilingFan ? 'Ceiling fan circulation' : 'Thermal diffusion'}</p>
  </div>
  <div class="view-tools" aria-label="3D view controls">
    <button aria-pressed={cameraMode === 'orbit'} class:active={cameraMode === 'orbit'} onclick={() => setCameraMode('orbit')}>Orbit</button>
    <button aria-pressed={cameraMode === 'walk'} class:active={cameraMode === 'walk'} onclick={() => setCameraMode('walk')}>Walk</button>
    <button aria-pressed={app.view === 'volume'} class:active={app.view === 'volume'} onclick={() => (app.view = 'volume')}>Volume</button>
    <button aria-pressed={app.view === 'slice'} class:active={app.view === 'slice'} onclick={() => (app.view = 'slice')}>Slice</button>
    <button onclick={() => zoom(1.15)} aria-label="Zoom in">＋</button>
    <button onclick={() => zoom(1 / 1.15)} aria-label="Zoom out">−</button>
    <button onclick={() => app.cameraToken++} aria-label="Reset camera">↺</button>
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="room" bind:this={roomEl} role="application" tabindex="0" aria-label={cameraMode === 'walk'
    ? 'First-person room view. Use W A S D or arrow keys to walk, hold Shift to move faster, and drag to look around. Press Escape to return to orbit view.'
    : '3D room. Drag empty space to rotate; scroll to zoom. Drag furniture or sources to move; Shift-drag heat and cold sources to change height. The ceiling fan moves horizontally. Arrow keys move selected markers; R rotates furniture.'}
    onpointerdown={onPointerDown} onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerUp}
    onpointerleave={() => { hoverRaw = null; hover = null; }} oncontextmenu={(e) => e.preventDefault()}
    onwheel={(e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.001)); }}>
    <canvas class="map" bind:this={canvas} aria-hidden="true"></canvas>
    <canvas class="overlay" bind:this={overlay} aria-hidden="true"></canvas>
    {#each furnitureMarkers as f (f.id)}
      <button class="furniture-marker" class:sel={app.selection?.kind === 'furniture' && app.selection.id === f.id}
        style:left="{f.px}px" style:top="{f.py}px" aria-label="Furniture {f.label} {f.id}. Drag to move. Arrow keys move; R rotates."
        onpointerdown={(e) => startDrag(e, 'furniture', f.id)} onfocus={() => select({ kind: 'furniture', id: f.id })}
        onclick={() => select({ kind: 'furniture', id: f.id })} onkeydown={(e) => onFurnitureKey(e, f.id)}>↔</button>
    {/each}
    {#each openingMarkers as o (o.id)}
      <button class="opening-marker" class:open={o.open} style:left="{o.px}px" style:top="{o.py}px"
        aria-label="{o.kind} {o.id}: {o.open ? 'open' : 'closed'}. Toggle opening." aria-pressed={o.open}
        onpointerdown={(e) => e.stopPropagation()} onclick={() => { select({ kind: 'opening', id: o.id }); updateOpening(o.id, { open: !o.open }); }}>
        {o.open ? '↗' : '▤'}
      </button>
    {/each}
    {#each markers as m (`${m.kind}${m.id}`)}
      <button class="marker" class:probe={m.kind === 'probe'} class:cold={m.cold} class:fan={m.fan}
        class:sel={app.selection?.kind === m.kind && app.selection.id === m.id}
        style:left="{m.px}px" style:top="{m.py}px"
        aria-label="{m.kind === 'probe' ? 'Probe' : m.fan ? 'Ceiling fan' : m.cold ? 'Cold source' : 'Heat source'} {m.id}. X {m.x.toFixed(1)}, Y {m.y.toFixed(1)}, height {m.z.toFixed(1)} metres."
        onpointerdown={(e) => startDrag(e, m.kind, m.id)} onkeydown={(e) => onKey(e, m)} onfocus={() => select({ kind: m.kind, id: m.id })} onclick={() => select({ kind: m.kind, id: m.id })}>
        {m.kind === 'probe' ? m.id : m.fan ? 'F' : m.cold ? '−' : '+'}
      </button>
    {/each}
    {#if hover}
      <div class="tip" style:left="{hover.px}px" style:top="{hover.py}px">{hover.temp.toFixed(1)} °C <span>at {hover.z.toFixed(1)} m</span></div>
    {/if}
  </div>
  <div class="temperature-scale" aria-label="Temperature scale"><div class="scale-label"><span>Temperature</span><span>°C</span></div><div class="scale-gradient" style:background={paletteCssGradient(app.palette, 'to right')}></div><div class="scale-values"><span>{TEMPERATURE_MIN_C}</span><span>{ROOM_TEMPERATURE_C}</span><span>{TEMPERATURE_MAX_C}</span></div></div>
  <div class="view-caption"><span class="live" class:paused={!app.running}></span>{cameraMode === 'walk' ? 'First-person room view' : app.view === 'volume' ? '3D temperature volume' : `${app.sliceAxis.toUpperCase()} temperature slice`}<span>·</span>{app.stats.mean.toFixed(1)} °C average</div>
  <p class="instructions">{cameraMode === 'walk' ? 'W A S D to walk · Drag to look · Shift to move faster · Esc to exit' : 'Drag to orbit · Scroll to zoom · Shift-drag heat or cold sources to lift · Move fan horizontally'}</p>
</div>

<style>
  .stage { flex:1; position: relative; min-height: 0; min-width: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 50%, #222b3b 0, #151b26 52%, #11151d 100%); }
  .heading { position: absolute; top: 118px; left: 28px; z-index: 2; pointer-events: none; }
  .eyebrow { color: #8e9eb4; font-size: 10px; letter-spacing: 0.17em; }
  h2 { margin: 8px 0; font-size: 25px; font-weight: 500; letter-spacing: -0.03em; }
  .heading p { margin: 0; color: #91a0b6; font-size: 12px; }
  .heading p span, .view-caption > span:not(.live) { margin: 0 8px; color: #536179; }
  .room { position: absolute; inset: 175px 0 90px; touch-action: none; cursor: grab; user-select: none; }
  .room:active { cursor: grabbing; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
  .view-tools { position: absolute; bottom: 76px; right: 24px; z-index: 3; display: flex; gap: 3px; padding: 4px; background: #1b2431d9; border: 1px solid #334055; border-radius: 9px; }
  .view-tools button { border: none; background: transparent; color: #9aabc0; padding: 7px 10px; border-radius: 5px; cursor: pointer; font: inherit; font-size: 12px; min-height: 32px; }
  .view-tools button.active { background: #384457; color: #fff; }
  .view-tools button:hover { background: #303d51; color: #fff; }
  .marker { position: absolute; transform: translate(-50%, -50%); width: 30px; height: 30px; border-radius: 50%; border: 2px solid #fff0d7; background: #ff7432; color: white; box-shadow: 0 0 25px #ff6e3260, 0 2px 7px #0008; cursor: grab; touch-action: none; font: 600 18px system-ui; display: grid; place-items: center; padding: 0; }
  .marker.cold { background: #3c95f4; border-color: #e4f2ff; box-shadow: 0 0 25px #449bff70; }
  .marker.fan { background: #526b83; border-color: #e4f2ff; box-shadow: 0 0 25px #a8d4ff70; }
  .marker.probe { width: 24px; height: 24px; border-radius: 6px; background: #151c2cee; border-color: #e4e9ff; font-size: 12px; box-shadow: 0 2px 8px #0008; }
  .marker.sel { outline: 2px solid #fff9; outline-offset: 4px; }
  .furniture-marker { position: absolute; transform: translate(-50%, -50%); width: 26px; height: 22px; border-radius: 5px; border: 1px solid #e5c4a099; background: #251f1bdd; color: #f5d3ad; cursor: grab; padding: 0; touch-action: none; }
  .furniture-marker.sel { outline: 2px solid #efbe83; outline-offset: 3px; }
  button:focus-visible { outline: 2px solid #89c8ff; outline-offset: 4px; }
  .opening-marker { position: absolute; transform: translate(-50%, -50%); width: 30px; height: 30px; border-radius: 5px; background: #162a3bbb; border: 1px solid #a2dcff99; color: #c4e9ff; cursor: pointer; }
  .opening-marker.open { color: #ffbc76; border-color: #ffbc76; }
  .tip { position: absolute; transform: translate(14px, -140%); padding: 6px 10px; border: 1px solid #3e4b60; border-radius: 6px; background: #101723ed; color: #fff; font-size: 13px; pointer-events: none; white-space: nowrap; }
  .tip span { color: #9cacc2; font-size: 11px; margin-left: 6px; }
  .view-caption { position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; font-size: 12px; color: #b5c2d3; white-space: nowrap; pointer-events: none; }
  .live { width: 6px; height: 6px; border-radius: 50%; background: #78cfaa; margin-right: 8px; box-shadow: 0 0 8px #78cfaa55; }
  .live.paused { background: #e1b46f; }
  .instructions { position: absolute; left: 20px; right: 20px; bottom: 13px; margin: 0; font-size: 11px; color: #74849d; text-align: center; pointer-events: none; }

.metric-cards { position:absolute; top:22px; left:28px; right:28px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; z-index:2; pointer-events:none; }
.metric-cards > div { background:#1c2431bb; border:1px solid #354052; border-radius:10px; padding:14px 18px; }
.metric-cards span { color:var(--muted); font-size:9px; letter-spacing:1px; display:block; margin-bottom:8px; }
.metric-cards strong { font-size:26px; font-weight:500; letter-spacing:-1px; font-variant-numeric:tabular-nums; }
.metric-cards small { color:var(--muted); font-size:14px; letter-spacing:0; }
.metric-cards > div:first-child strong { color:var(--accent); }
.temperature-scale { position:absolute; bottom:70px; left:28px; width:150px; font-size:10px; color:var(--muted); pointer-events:none; }
.scale-label,.scale-values { display:flex; justify-content:space-between; } .scale-gradient { height:6px; border-radius:4px; margin:7px 0; }
.view-caption { bottom:30px; } .instructions { bottom:6px; font-size:10px; }
@media(max-width:1100px) { h2 { font-size:20px; } }
@media(max-width:600px) { .metric-cards { left:16px; right:16px; top:16px; gap:7px; } .metric-cards > div { padding:12px 10px; } .metric-cards strong { font-size:22px; } .metric-cards span { font-size:8px; letter-spacing:.4px; } .heading { left:16px; top:110px; } .heading .eyebrow { display:none; } .view-tools { right:16px; bottom:58px; } .room { inset:150px 0 90px; } .temperature-scale { left:16px; bottom:58px; width:95px; } .view-caption { bottom:24px; font-size:10px; white-space:nowrap; } .instructions { display:none; } }
</style>
