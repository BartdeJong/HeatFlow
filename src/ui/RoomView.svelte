<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createRenderer, type HeatmapRenderer } from '../render/heatmap';
  import { Simulation } from '../sim/simulation';
  import { furnitureSize, ROOF_MATERIALS, roofGeometry } from '../sim/config';
  import type { HeatFlowVector } from '../sim/simulation';
  import { app, moveItem, recorder, select, updateOpening } from '../state/app.svelte';

  let canvas: HTMLCanvasElement;
  let roomEl: HTMLDivElement;
  let renderer: HeatmapRenderer | undefined;
  let sim = $state.raw(new Simulation($state.snapshot(app.room)));
  let simKey = `${app.room.widthM}|${app.room.heightM}|${app.room.ceilingM}|${app.room.convection}`;
  let drag = $state<{ kind: 'source' | 'probe' | 'furniture'; id: number } | null>(null);
  let dragOffsetX = 0;
  let hover = $state<{ px: number; py: number; temp: number } | null>(null);
  let vectors = $state<HeatFlowVector[]>([]);
  let hoverRaw: { x: number; y: number; px: number; py: number } | null = null;

  // Rebuild the grid only when size or convection mode actually change.
  $effect(() => {
    const key = `${app.room.widthM}|${app.room.heightM}|${app.room.ceilingM}|${app.room.convection}`;
    untrack(() => {
      if (key === simKey) return;
      simKey = key;
      sim = new Simulation($state.snapshot(app.room));
      recorder.clear();
      app.graphTick++;
    });
  });

  // Push live-adjustable settings into the running simulation.
  $effect(() => {
    const r = $state.snapshot(app.room);
    untrack(() => sim.setRoom(r));
  });

  $effect(() => {
    app.resetToken;
    untrack(() => {
      sim.reset();
      recorder.clear();
      app.graphTick++;
    });
  });

  $effect(() => {
    const p = app.palette;
    renderer?.setPalette(p);
  });

  $effect(() => {
    const keep = new Set(['avg', ...app.room.probes.map((p) => `p${p.id}`)]);
    untrack(() => recorder.removeSeriesExcept(keep));
  });

  function pointToRoom(e: PointerEvent) {
    const rect = roomEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * app.room.widthM;
    const y = ((e.clientY - rect.top) / rect.height) * app.room.ceilingM;
    return { x, y, px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function move(kind: 'source' | 'probe' | 'furniture', id: number, x: number, y: number) {
    moveItem(kind, id, x, y);
    if (kind === 'probe') recorder.clearSeries(`p${id}`);
  }

  function startDrag(e: PointerEvent, kind: 'source' | 'probe' | 'furniture', id: number) {
    e.stopPropagation();
    roomEl.setPointerCapture(e.pointerId);
    select({ kind, id });
    drag = { kind, id };
    const p = pointToRoom(e);
    dragOffsetX = kind === 'furniture' ? (app.room.furniture.find((f) => f.id === id)?.x ?? p.x) - p.x : 0;
  }

  function onPointerDown(e: PointerEvent) {
    const sel = app.selection;
    if (!sel || sel.kind === 'opening') return;
    roomEl.setPointerCapture(e.pointerId);
    drag = { kind: sel.kind, id: sel.id };
    dragOffsetX = 0;
    const p = pointToRoom(e);
    move(sel.kind, sel.id, p.x, p.y);
    hoverRaw = p;
  }

  function onPointerMove(e: PointerEvent) {
    const p = pointToRoom(e);
    hoverRaw = p;
    if (drag) move(drag.kind, drag.id, p.x + dragOffsetX, p.y);
  }

  function onPointerUp(e: PointerEvent) {
    drag = null;
    if (e.pointerType !== 'mouse') hoverRaw = null;
  }

  function onKey(
    e: KeyboardEvent,
    kind: 'source' | 'probe' | 'furniture',
    id: number,
    x: number,
    y: number,
  ) {
    const step = e.shiftKey ? 0.5 : 0.1;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    move(kind, id, x + v[0], y + v[1]);
  }

  function toggleOpening(e: Event, id: number, open: boolean) {
    e.stopPropagation();
    select({ kind: 'opening', id });
    updateOpening(id, { open: !open });
  }

  function segment(o: { side: string; pos: number; length: number }) {
    const a = o.pos - o.length / 2;
    const b = o.pos + o.length / 2;
    // With the exterior shown, the opening fills the wall thickness, centred on the wall.
    const off = showExt ? t / 2 : 0;
    return o.side === 'left'
      ? { x1: -off, y1: a, x2: -off, y2: b }
      : { x1: app.room.widthM + off, y1: a, x2: app.room.widthM + off, y2: b };
  }

  onMount(() => {
    renderer = createRenderer(canvas, app.palette);
    let raf = 0;
    let last = performance.now();
    let lastStats = 0;
    let dispMin = app.stats.tMin;
    let dispMax = app.stats.tMax;

    const frame = (now: number) => {
      const wallDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (app.running) {
        sim.advance(wallDt * app.speed);
        const values: Record<string, number> = { avg: sim.stats().mean };
        for (const p of app.room.probes) values[`p${p.id}`] = sim.sample(p.x, p.y);
        if (recorder.record(sim.elapsed, values)) app.graphTick++;
      }

      const s = sim.stats();
      const targetMin = Math.floor(s.min / 2) * 2;
      const targetMax = Math.max(targetMin + 10, Math.ceil(s.max / 2) * 2);
      dispMin += (targetMin - dispMin) * 0.1;
      dispMax += (targetMax - dispMax) * 0.1;
      renderer!.render(sim, dispMin, dispMax);

      if (now - lastStats > 200) {
        lastStats = now;
        Object.assign(app.stats, {
          elapsed: sim.elapsed,
          min: s.min,
          max: s.max,
          mean: s.mean,
          tMin: dispMin,
          tMax: dispMax,
          heatingKWh: sim.energyUseKWh().heating,
          coolingKWh: sim.energyUseKWh().cooling,
          thermostatHeating: sim.thermostatHeatingOn(),
        });
        app.stats.heatLoss = sim.heatLossBreakdownW();
        vectors = app.showVectors ? sim.vectorField() : [];
        hover = hoverRaw
          ? { px: hoverRaw.px, py: hoverRaw.py, temp: sim.sample(hoverRaw.x, hoverRaw.y) }
          : null;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(() => renderer?.resize());
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer?.dispose();
    };
  });

  const wallPx = $derived(3 + 30 * (app.room.wall.thicknessM + app.room.wall.insulationM));
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  const showExt = $derived(app.exterior);
  const W = $derived(app.room.widthM);
  const H = $derived(app.room.ceilingM);
  const t = $derived(app.room.wall.thicknessM + app.room.wall.insulationM);
  const geo = $derived(roofGeometry(app.room));
  const tanP = $derived(Math.tan((app.room.roof.pitchDeg * Math.PI) / 180));
  const roofMat = $derived(ROOF_MATERIALS.find((r) => r.id === app.room.roof.material)!);
  const ROOF_BASE_D = 0.1;
  const ROOF_FACE_D = 0.07;
  const roofInsulationD = $derived(app.room.roof.insulationM);
  const ROOF_D = $derived(ROOF_BASE_D + roofInsulationD);
  // Extent of the drawing in metres, relative to the room's top-left corner.
  const ox = $derived(showExt ? t + geo.overhangM : 0);
  const oTop = $derived(showExt ? t + geo.rise : 0);
  const oBottom = $derived(showExt ? t : 0);
  const totW = $derived(W + 2 * ox);
  const totH = $derived(H + oTop + oBottom);
  const envSide = $derived(showExt ? Math.max(1.6, W * 0.42) : 0);
  const envSky = $derived(showExt ? Math.max(1.25, H * 0.55) : 0);
  const envGround = $derived(showExt ? Math.max(1.2, H * 0.48) : 0);
  const sceneLeft = $derived(ox + envSide);
  const sceneTop = $derived(oTop + envSky);
  const sceneW = $derived(totW + 2 * envSide);
  const sceneH = $derived(totH + envSky + envGround);
  const groundY = $derived(H + oBottom + 0.025);
  const fenceTop = $derived(groundY + 0.28);
  const fenceBottom = $derived(groundY + 0.9);
  const fenceLeftEnd = $derived(W / 2 - 0.72);
  const fenceRightStart = $derived(W / 2 + 0.72);
  const fenceLeftPosts = $derived(
    Array.from({ length: 5 }, (_, i) => -sceneLeft + 0.16 + (fenceLeftEnd + sceneLeft - 0.32) * (i / 4)),
  );
  const fenceRightPosts = $derived(
    Array.from({ length: 5 }, (_, i) => fenceRightStart + (W + sceneLeft - 0.16 - fenceRightStart) * (i / 4)),
  );
  const eaveY = $derived(-t + geo.overhangM * tanP);
  const apexY = $derived(-t - geo.rise);
  const roofBand = $derived(
    `M${-t - geo.overhangM} ${eaveY}L${W / 2} ${apexY}L${W + t + geo.overhangM} ${eaveY}` +
      `V${eaveY + ROOF_D}L${W / 2} ${apexY + ROOF_D}L${-t - geo.overhangM} ${eaveY + ROOF_D}Z`,
  );
  const roofLeft = $derived(
    `M${-t - geo.overhangM} ${eaveY}L${W / 2} ${apexY}L${W / 2} ${apexY + ROOF_FACE_D}L${-t - geo.overhangM} ${eaveY + ROOF_FACE_D}Z`,
  );
  const roofRight = $derived(
    `M${W / 2} ${apexY}L${W + t + geo.overhangM} ${eaveY}L${W + t + geo.overhangM} ${eaveY + ROOF_FACE_D}L${W / 2} ${apexY + ROOF_FACE_D}Z`,
  );
  const roofCoreLeft = $derived(
    `M${-t - geo.overhangM} ${eaveY + ROOF_FACE_D}L${W / 2} ${apexY + ROOF_FACE_D}L${W / 2} ${apexY + ROOF_D}L${-t - geo.overhangM} ${eaveY + ROOF_D}Z`,
  );
  const roofCoreRight = $derived(
    `M${W / 2} ${apexY + ROOF_FACE_D}L${W + t + geo.overhangM} ${eaveY + ROOF_FACE_D}L${W + t + geo.overhangM} ${eaveY + ROOF_D}L${W / 2} ${apexY + ROOF_D}Z`,
  );
  const wallRing = $derived(
    `M${-t} ${-t}H${W + t}V${H + t}H${-t}Z M0 0V${H}H${W}V0Z`,
  );
  const insulationRing = $derived(
    app.room.wall.insulationM > 0
      ? `M${-app.room.wall.insulationM} ${-app.room.wall.insulationM}H${W + app.room.wall.insulationM}V${H + app.room.wall.insulationM}H${-app.room.wall.insulationM}Z M0 0V${H}H${W}V0Z`
      : '',
  );
  const frameStyle = $derived(
    `--far:${sceneW / sceneH};--rl:${(sceneLeft / sceneW) * 100}%;--rt:${(sceneTop / sceneH) * 100}%;--rw:${(W / sceneW) * 100}%;--rh:${(H / sceneH) * 100}%`,
  );
</script>

<div class="stage">
  <div class="frame" class:ext={showExt} style={frameStyle}>
    {#if showExt}
      <svg class="ext" viewBox="{-sceneLeft} {-sceneTop} {sceneW} {sceneH}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="x-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#78bddd" />
            <stop offset=".58" stop-color="#b9e1e8" />
            <stop offset="1" stop-color="#f4e8d2" />
          </linearGradient>
          <linearGradient id="x-cloud" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fffdf1" />
            <stop offset="1" stop-color="#e8e3dc" />
          </linearGradient>
          <linearGradient id="x-grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#a8d778" />
            <stop offset=".48" stop-color="#8fc95f" />
            <stop offset="1" stop-color="#69a84c" />
          </linearGradient>
          <linearGradient id="x-path" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#c9aa83" />
            <stop offset=".5" stop-color="#d2b48f" />
            <stop offset="1" stop-color="#b9916a" />
          </linearGradient>
          <pattern id="x-paper" width="0.24" height="0.24" patternUnits="userSpaceOnUse">
            <circle cx=".04" cy=".07" r=".009" fill="#fff" fill-opacity=".3" />
            <circle cx=".16" cy=".18" r=".008" fill="#6e7770" fill-opacity=".16" />
            <path d="M.08 .21l.04-.02m.1-.16l.03-.015" stroke="#fff" stroke-opacity=".22" stroke-width=".008" />
          </pattern>
          <pattern id="x-grass-marks" width=".65" height=".5" patternUnits="userSpaceOnUse">
            <path d="M.12 .42q-.02-.12-.09-.2m.09.2q.01-.16.08-.24m.27.13q-.02-.1-.08-.16m.08.16q.02-.12.1-.18m.22.15q-.01-.09-.06-.14" fill="none" stroke="#477c43" stroke-opacity=".38" stroke-width=".018" />
            <circle cx=".34" cy=".41" r=".012" fill="#f4e7a1" />
          </pattern>
          <pattern id="x-path-marks" width=".8" height=".62" patternUnits="userSpaceOnUse">
            <path d="M.1 .18l.08-.025m.36 .26l.1-.02m-.21 .3l.07-.015m.29-.53l.06-.018" stroke="#896d52" stroke-opacity=".35" stroke-width=".018" />
            <circle cx=".62" cy=".11" r=".018" fill="#e7d1b2" fill-opacity=".7" />
          </pattern>
          <linearGradient id="x-wall-shade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#000" stop-opacity=".12" />
            <stop offset=".18" stop-color="#fff" stop-opacity=".06" />
            <stop offset=".52" stop-color="#fff" stop-opacity=".02" />
            <stop offset="1" stop-color="#000" stop-opacity=".14" />
          </linearGradient>
          <linearGradient id="x-roof-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity=".15" />
            <stop offset="1" stop-color="#000" stop-opacity=".18" />
          </linearGradient>
          <pattern id="x-brick" width="0.5" height="0.2" patternUnits="userSpaceOnUse">
            <rect width="0.5" height="0.2" fill="#ad5743" />
            <path d="M0 0.1H0.5M0.25 0V0.1M0 0.1V0.2M0.5 0.1V0.2" stroke="#d7b8a8" stroke-width="0.018" fill="none" />
            <path d="M0 0.012H0.5M0 0.188H0.5" stroke="#733c32" stroke-opacity=".32" stroke-width="0.012" />
          </pattern>
          <pattern id="x-wood" width="0.8" height="0.18" patternUnits="userSpaceOnUse">
            <rect width="0.8" height="0.18" fill="#9b7048" />
            <path d="M0 0.012H0.8M0 0.168H0.8M0.3 0.04C0.42 0.03 0.52 0.05 0.68 0.04M0.08 0.12C0.2 0.1 0.32 0.13 0.46 0.11" stroke="#d1aa76" stroke-opacity=".62" stroke-width="0.012" fill="none" />
          </pattern>
          <pattern id="x-concrete" width="1" height="1" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="#a7a9ab" />
            <path d="M0.08 0.2l.12-.04m.46.1l.08.03m-.38.4l.1-.02m.32.22l.08-.03m-.56.04l.07.02" stroke="#85898c" stroke-opacity=".55" stroke-width="0.025" />
          </pattern>
          <pattern id="x-aerated" width="0.6" height="0.3" patternUnits="userSpaceOnUse">
            <rect width="0.6" height="0.3" fill="#dedbd2" />
            <path d="M0 0.012H0.6M0 0.288H0.6M0.3 0.012V0.15M0 0.15H0.6M0.15 0.15V0.288" stroke="#b9b5aa" stroke-width="0.018" />
          </pattern>
          <pattern id="x-roof-left" width="0.45" height="0.22" patternUnits="userSpaceOnUse" patternTransform="rotate({-app.room.roof.pitchDeg})">
            <rect width="0.45" height="0.22" fill={roofMat.color} />
            {#if app.room.roof.material === 'metal'}
              <path d="M0.08 0V0.22M0.22 0V0.22M0.36 0V0.22" stroke="#27303a" stroke-opacity=".45" stroke-width="0.025" />
              <path d="M0.1 0V0.22M0.24 0V0.22M0.38 0V0.22" stroke="#fff" stroke-opacity=".28" stroke-width="0.012" />
            {:else if app.room.roof.material === 'thatch'}
              <path d="M0 0.04Q0.12 0.01 0.24 0.04T0.45 0.04M0 0.11Q0.12 0.08 0.24 0.11T0.45 0.11M0 0.18Q0.12 0.15 0.24 0.18T0.45 0.18" fill="none" stroke="#665332" stroke-opacity=".62" stroke-width="0.018" />
              <path d="M0.03 0.02l.08.07m.17-.04l.1.07m.03.04l.08.07" stroke="#f0d69b" stroke-opacity=".5" stroke-width="0.012" />
            {:else if app.room.roof.material === 'slate'}
              <path d="M0 0.012H0.45M0 0.208H0.45M0.15 0.012V0.11M0.375 0.11V0.208M0.075 0.11V0.208" stroke="#202832" stroke-opacity=".62" stroke-width="0.02" />
              <path d="M0.02 0.03H0.13M0.25 0.13H0.36" stroke="#d9e1e9" stroke-opacity=".2" stroke-width="0.012" />
            {:else}
              <path d="M0 0.012H0.45M0 0.208H0.45M0.225 0.012V0.208" stroke="#16191d" stroke-opacity=".48" stroke-width="0.025" />
              <path d="M0.02 0.04H0.2M0.25 0.04H0.43" stroke="#fff" stroke-opacity=".2" stroke-width="0.012" />
            {/if}
          </pattern>
          <pattern id="x-roof-right" width="0.45" height="0.22" patternUnits="userSpaceOnUse" patternTransform="rotate({app.room.roof.pitchDeg})">
            <rect width="0.45" height="0.22" fill={roofMat.color} />
            {#if app.room.roof.material === 'metal'}
              <path d="M0.08 0V0.22M0.22 0V0.22M0.36 0V0.22" stroke="#27303a" stroke-opacity=".45" stroke-width="0.025" />
              <path d="M0.1 0V0.22M0.24 0V0.22M0.38 0V0.22" stroke="#fff" stroke-opacity=".28" stroke-width="0.012" />
            {:else if app.room.roof.material === 'thatch'}
              <path d="M0 0.04Q0.12 0.01 0.24 0.04T0.45 0.04M0 0.11Q0.12 0.08 0.24 0.11T0.45 0.11M0 0.18Q0.12 0.15 0.24 0.18T0.45 0.18" fill="none" stroke="#665332" stroke-opacity=".62" stroke-width="0.018" />
              <path d="M0.03 0.02l.08.07m.17-.04l.1.07m.03.04l.08.07" stroke="#f0d69b" stroke-opacity=".5" stroke-width="0.012" />
            {:else if app.room.roof.material === 'slate'}
              <path d="M0 0.012H0.45M0 0.208H0.45M0.15 0.012V0.11M0.375 0.11V0.208M0.075 0.11V0.208" stroke="#202832" stroke-opacity=".62" stroke-width="0.02" />
              <path d="M0.02 0.03H0.13M0.25 0.13H0.36" stroke="#d9e1e9" stroke-opacity=".2" stroke-width="0.012" />
            {:else}
              <path d="M0 0.012H0.45M0 0.208H0.45M0.225 0.012V0.208" stroke="#16191d" stroke-opacity=".48" stroke-width="0.025" />
              <path d="M0.02 0.04H0.2M0.25 0.04H0.43" stroke="#fff" stroke-opacity=".2" stroke-width="0.012" />
            {/if}
          </pattern>
          <pattern id="x-insulation" width="0.16" height="0.16" patternUnits="userSpaceOnUse">
            <rect width="0.16" height="0.16" fill="#d9c58f" />
            <path d="M0 0.04q.04-.06.08 0t.08 0M0 0.12q.04-.06.08 0t.08 0" fill="none" stroke="#aa9462" stroke-opacity=".55" stroke-width="0.012" />
          </pattern>
        </defs>
        <rect x={-sceneLeft} y={-sceneTop} width={sceneW} height={sceneH} fill="url(#x-sky)" />
        <rect x={-sceneLeft} y={-sceneTop} width={sceneW} height={sceneH} fill="url(#x-paper)" opacity=".56" />
        <path
          d={`M${-sceneLeft} ${groundY - 0.25}Q${-sceneLeft + envSide * 0.6} ${groundY - 0.8} ${-ox} ${groundY - 0.3}Q${W / 2} ${groundY - 0.05} ${W + ox} ${groundY - 0.35}Q${W + sceneLeft * 0.55} ${groundY - 0.85} ${W + sceneLeft} ${groundY - 0.25}V${groundY + 0.2}H${-sceneLeft}Z`}
          fill="#a6c99a"
          opacity=".8"
        />
        <rect x={-sceneLeft} y={groundY} width={sceneW} height={sceneH - (groundY + sceneTop)} fill="url(#x-grass)" />
        <rect x={-sceneLeft} y={groundY} width={sceneW} height={sceneH - (groundY + sceneTop)} fill="url(#x-grass-marks)" opacity=".58" />
        <g fill="url(#x-cloud)" stroke="#746b60" stroke-opacity=".4" stroke-width=".022" stroke-linejoin="round">
          <path
            transform={`translate(${-sceneLeft + 0.05} ${-oTop - envSky * 0.68}) scale(${envSide / 2.3})`}
            d="M.18 .72C.02 .58.11 .3.42 .32.45.02.86-.08 1.08.22 1.4-.05 1.86.13 1.86.52c.32-.04.46.3.22.5.3.22.15.57-.18.65-.19.31-.59.32-.81.07-.3.22-.68.06-.7-.28-.33.07-.6-.14-.56-.45-.33.07-.57-.22-.5-.53.25-.07.39.03.48.24.14-.03.24-.01.37.05Z"
          />
          <path
            transform={`translate(${W + ox + 0.02} ${-oTop - envSky * 0.64}) scale(${envSide / 2.3})`}
            d="M.18 .72C.02 .58.11 .3.42 .32.45.02.86-.08 1.08.22 1.4-.05 1.86.13 1.86.52c.32-.04.46.3.22.5.3.22.15.57-.18.65-.19.31-.59.32-.81.07-.3.22-.68.06-.7-.28-.33.07-.6-.14-.56-.45-.33.07-.57-.22-.5-.53.25-.07.39.03.48.24.14-.03.24-.01.37.05Z"
          />
        </g>
        <g stroke="#687e58" stroke-width=".035" stroke-linejoin="round">
          <path d={`M${-ox - envSide * 0.62} ${groundY}v-1.05`} stroke="#806244" stroke-width=".11" />
          <path d={`M${-ox - envSide * 0.98} ${groundY - 1.05}c-.12-.42.2-.72.56-.68.02-.45.51-.67.86-.4.28-.45.88-.37 1.04.05.45-.08.7.28.56.66.38.22.32.62-.01.78h-2.93c-.3-.1-.34-.32-.08-.41Z`} fill="#709b65" stroke-width=".025" />
          <g fill="#91b574" stroke="none" opacity=".85">
            <circle cx={-ox - envSide * 0.83} cy={groundY - 1.32} r=".21" />
            <circle cx={-ox - envSide * 0.62} cy={groundY - 1.55} r=".24" />
            <circle cx={-ox - envSide * 0.42} cy={groundY - 1.34} r=".2" />
            <circle cx={W + ox + envSide * 0.36} cy={groundY - 1.43} r=".22" />
            <circle cx={W + ox + envSide * 0.58} cy={groundY - 1.68} r=".25" />
            <circle cx={W + ox + envSide * 0.79} cy={groundY - 1.42} r=".2" />
          </g>
          <g fill="none" stroke="#557d4e" stroke-width=".025" stroke-linecap="round" opacity=".72">
            <path d={`M${-ox - envSide * 0.86} ${groundY - 1.22}q.16-.13.29-.02m-.1-.18q.15-.12.26 0m.13-.3q.13-.1.25.02`} />
            <path d={`M${W + ox + envSide * 0.43} ${groundY - 1.3}q.16-.13.29-.02m-.1-.18q.15-.12.26 0m.13-.3q.13-.1.25.02`} />
          </g>
          <path d={`M${W + ox + envSide * 0.58} ${groundY}v-1.1`} stroke="#806244" stroke-width=".11" />
          <path d={`M${W + ox + envSide * 0.18} ${groundY - 1.1}c-.1-.38.2-.68.52-.64.02-.42.49-.62.82-.37.26-.42.83-.34.98.05.42-.08.65.26.52.62.36.2.3.58-.01.73h-2.75c-.28-.09-.32-.3-.08-.39Z`} fill="#769f67" stroke-width=".025" />
          <g fill="#91b574" stroke="none" opacity=".82">
            <circle cx={W + ox + envSide * 0.35} cy={groundY - 1.35} r=".2" />
            <circle cx={W + ox + envSide * 0.57} cy={groundY - 1.58} r=".23" />
            <circle cx={W + ox + envSide * 0.78} cy={groundY - 1.36} r=".19" />
          </g>
        </g>
        <!-- Dark attic cavity keeps the roof layers distinct from the heatmap. -->
        <path d="M{-t} {-t}L{W / 2} {apexY + ROOF_D}L{W + t} {-t}Z" fill="#2b2622" />
        <path d={roofLeft} fill="url(#x-roof-left)" />
        <path d={roofRight} fill="url(#x-roof-right)" />
        <path d={roofCoreLeft} fill={roofInsulationD > 0 ? 'url(#x-insulation)' : '#76583f'} />
        <path d={roofCoreRight} fill={roofInsulationD > 0 ? 'url(#x-insulation)' : '#76583f'} />
        <path d={roofBand} fill="url(#x-roof-shade)" stroke="#332a27" stroke-width="0.055" stroke-linejoin="round" />
        <path
          d={`M${-t - geo.overhangM} ${eaveY + ROOF_D}L${W / 2} ${apexY + ROOF_D}L${W + t + geo.overhangM} ${eaveY + ROOF_D}`}
          fill="none"
          stroke="#d7b58d"
          stroke-width="0.045"
          stroke-linejoin="round"
        />
        <path
          d={`M${-t - geo.overhangM} ${eaveY + ROOF_D / 2}L${-t - geo.overhangM} ${eaveY + ROOF_D + 0.04}M${W + t + geo.overhangM} ${eaveY + ROOF_D / 2}L${W + t + geo.overhangM} ${eaveY + ROOF_D + 0.04}`}
          fill="none"
          stroke="#2d2724"
          stroke-width="0.07"
          stroke-linecap="square"
        />
        <g fill="#69737a" stroke="#30363b" stroke-width="0.025">
          <circle cx={-t - geo.overhangM + 0.05} cy={eaveY + ROOF_D + 0.035} r="0.055" />
          <circle cx={W + t + geo.overhangM - 0.05} cy={eaveY + ROOF_D + 0.035} r="0.055" />
        </g>
        <!-- Wall structure, with insulation visible at the room-facing edge. -->
        <path
          fill-rule="evenodd"
          fill="url(#x-{app.room.wall.material})"
          stroke="#51413a"
          stroke-width="0.035"
          d={wallRing}
        />
        <path fill-rule="evenodd" d={wallRing} fill="url(#x-wall-shade)" pointer-events="none" />
        {#if app.room.wall.insulationM > 0}
          <path fill-rule="evenodd" d={insulationRing} fill="url(#x-insulation)" stroke="#9b885e" stroke-width="0.018" />
        {/if}
        <!-- A concrete footing and a fine inner plaster edge finish the cutaway. -->
        <path
          d={`M${-t - 0.04} ${H + t - 0.12}H${W + t + 0.04}V${H + t}H${-t - 0.04}Z`}
          fill="url(#x-concrete)"
          stroke="#4e5355"
          stroke-width="0.035"
        />
        <path d={`M0 0V${H}H${W}V0`} fill="none" stroke="#eee6d9" stroke-opacity=".9" stroke-width="0.035" />
        <g fill="none" stroke="#815333" stroke-linecap="round" stroke-linejoin="round">
          <path d={`M${-sceneLeft + 0.1} ${fenceTop}H${fenceLeftEnd}M${fenceRightStart} ${fenceTop}H${W + sceneLeft - 0.1}`} stroke-width=".09" />
          <path d={`M${-sceneLeft + 0.1} ${fenceBottom - 0.16}H${fenceLeftEnd}M${fenceRightStart} ${fenceBottom - 0.16}H${W + sceneLeft - 0.1}`} stroke="#a77645" stroke-width=".1" />
          {#each fenceLeftPosts as x}
            <path d={`M${x} ${fenceTop - 0.15}V${fenceBottom}`} stroke="#8d5d38" stroke-width=".16" />
            <path d={`M${x - 0.05} ${fenceTop - 0.15}V${fenceBottom}`} stroke="#d0a16b" stroke-opacity=".62" stroke-width=".035" />
          {/each}
          {#each fenceRightPosts as x}
            <path d={`M${x} ${fenceTop - 0.15}V${fenceBottom}`} stroke="#8d5d38" stroke-width=".16" />
            <path d={`M${x - 0.05} ${fenceTop - 0.15}V${fenceBottom}`} stroke="#d0a16b" stroke-opacity=".62" stroke-width=".035" />
          {/each}
        </g>
        <path
          d={`M${W / 2 - 0.42} ${groundY}L${W / 2 + 0.42} ${groundY}L${W / 2 + 1.75} ${sceneH - sceneTop}L${W / 2 - 1.75} ${sceneH - sceneTop}Z`}
          fill="url(#x-path)"
          stroke="#8a7157"
          stroke-opacity=".62"
          stroke-width=".035"
        />
        <path
          d={`M${W / 2 - 0.42} ${groundY}L${W / 2 + 0.42} ${groundY}L${W / 2 + 1.75} ${sceneH - sceneTop}L${W / 2 - 1.75} ${sceneH - sceneTop}Z`}
          fill="url(#x-path-marks)"
          opacity=".72"
        />
        <path
          d={`M${W / 2 - 0.42} ${groundY}L${W / 2 - 1.75} ${sceneH - sceneTop}M${W / 2 + 0.42} ${groundY}L${W / 2 + 1.75} ${sceneH - sceneTop}`}
          fill="none"
          stroke="#f0d9b5"
          stroke-opacity=".7"
          stroke-width=".045"
        />
        <path
          d={`M${W * 0.22} ${apexY + (eaveY - apexY) * 0.62 - 0.72}h.34v.83h-.34zM${W * 0.22 - 0.06} ${apexY + (eaveY - apexY) * 0.62 - 0.73}h.46v.09h-.46z`}
          fill="url(#x-brick)"
          stroke="#5a4035"
          stroke-width=".035"
        />
      </svg>
    {/if}
  <div
    class="room"
    bind:this={roomEl}
    role="application"
    aria-label="Room side view. Select a source or probe, then drag to place it."
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => (hoverRaw = null)}
  >
    <canvas class="map" bind:this={canvas}></canvas>
    {#if !showExt}<div class="walls" style:border-width="{wallPx}px"></div>{/if}

    <svg
      class="openings"
      viewBox="0 0 {app.room.widthM} {app.room.ceilingM}"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {#each app.room.openings as o (o.id)}
        {@const seg = segment(o)}
        {@const sel = app.selection?.kind === 'opening' && app.selection.id === o.id}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <g
          class="opening {o.kind}"
          class:open={o.open}
          class:sel
          class:scaled={showExt}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => toggleOpening(e, o.id, o.open)}
        >
          <line {...seg} class="hit" style:stroke-width="{showExt ? t : wallPx + 10}px" />
          <line {...seg} class="body" style:stroke-width="{showExt ? t : wallPx + 2}px" />
        </g>
      {/each}
    </svg>

    {#if app.showVectors}
      <svg
        class="vectors"
        viewBox="0 0 {app.room.widthM} {app.room.ceilingM}"
        preserveAspectRatio="none"
        aria-label="Heat-flow vectors"
      >
        <defs>
          <marker id="heat-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="0.12" markerHeight="0.12" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#fff" />
          </marker>
        </defs>
        {#each vectors as vector}
          {@const length = Math.max(sim.dx * 0.45, Math.min(sim.dx * 1.7, sim.dx * (0.35 + Math.log1p(vector.magnitude) * 0.45)))}
          <line
            x1={vector.x}
            y1={vector.y}
            x2={vector.x + (vector.dx / vector.magnitude) * length}
            y2={vector.y + (vector.dy / vector.magnitude) * length}
            stroke="#18212a"
            stroke-opacity=".55"
            stroke-width=".055"
          />
          <line
            x1={vector.x}
            y1={vector.y}
            x2={vector.x + (vector.dx / vector.magnitude) * length}
            y2={vector.y + (vector.dy / vector.magnitude) * length}
            stroke="#fff"
            stroke-width=".027"
            marker-end="url(#heat-arrow)"
          />
        {/each}
      </svg>
    {/if}

    <svg
      class="furniture"
      viewBox="0 0 {app.room.widthM} {app.room.ceilingM}"
      preserveAspectRatio="none"
      aria-label="Furniture"
    >
      {#each app.room.furniture as item (item.id)}
        {@const size = furnitureSize(item.kind, app.room.widthM)}
        {@const x = item.x - size.widthM / 2}
        {@const y = app.room.ceilingM - size.heightM}
        <g
          class="furniture-item {item.kind}"
          class:selected={app.selection?.kind === 'furniture' && app.selection.id === item.id}
          role="button"
          tabindex="0"
          aria-label="Move {item.kind} {item.id}"
          onpointerdown={(e) => startDrag(e, 'furniture', item.id)}
          onfocus={() => select({ kind: 'furniture', id: item.id })}
          onkeydown={(e) => onKey(e, 'furniture', item.id, item.x, app.room.ceilingM)}
        >
          {#if item.kind === 'sofa'}
            <rect class="furniture-shadow" x={x - 0.05} y={y + size.heightM - 0.07} width={size.widthM + 0.1} height=".1" rx=".05" />
            <rect class="sofa-body" x={x + size.widthM * 0.06} y={y + size.heightM * 0.28} width={size.widthM * 0.88} height={size.heightM * 0.67} rx=".12" />
            <rect class="sofa-back" x={x + size.widthM * 0.08} y={y + size.heightM * 0.03} width={size.widthM * 0.84} height={size.heightM * 0.46} rx=".1" />
            <rect class="sofa-arm" x={x} y={y + size.heightM * 0.35} width={size.widthM * 0.14} height={size.heightM * 0.52} rx=".06" />
            <rect class="sofa-arm" x={x + size.widthM * 0.86} y={y + size.heightM * 0.35} width={size.widthM * 0.14} height={size.heightM * 0.52} rx=".06" />
            <path d={`M${item.x} ${y + size.heightM * 0.12}v${size.heightM * 0.3}`} stroke="#f4d6bc" stroke-width=".025" />
          {:else}
            <rect class="furniture-shadow" x={x - 0.06} y={y + size.heightM - 0.06} width={size.widthM + 0.12} height=".08" rx=".04" />
            <rect class="table-top" x={x} y={y + size.heightM * 0.22} width={size.widthM} height={size.heightM * 0.2} rx=".035" />
            <path class="table-leg" d={`M${x + size.widthM * 0.12} ${y + size.heightM * 0.4}v${size.heightM * 0.55}m${size.widthM * 0.76} 0v-${size.heightM * 0.55}`} />
          {/if}
        </g>
      {/each}
    </svg>

    {#each app.room.sources as s (s.id)}
      <div
        class="marker source {s.kind}"
        class:dragging={drag?.kind === 'source' && drag.id === s.id}
        class:sel={app.selection?.kind === 'source' && app.selection.id === s.id}
        style:left={pct(s.x, app.room.widthM)}
        style:top={pct(s.y, app.room.ceilingM)}
        role="slider"
        tabindex="0"
        aria-label="{s.kind === 'heat' ? 'Heat' : 'Cold'} source {s.id} position"
        aria-valuetext="x {s.x.toFixed(1)} m, y {s.y.toFixed(1)} m"
        aria-valuenow={s.x}
        onpointerdown={(e) => startDrag(e, 'source', s.id)}
        onfocus={() => select({ kind: 'source', id: s.id })}
        onkeydown={(e) => onKey(e, 'source', s.id, s.x, s.y)}
      ></div>
    {/each}

    {#each app.room.probes as p (p.id)}
      <div
        class="marker probe"
        class:dragging={drag?.kind === 'probe' && drag.id === p.id}
        class:sel={app.selection?.kind === 'probe' && app.selection.id === p.id}
        style:left={pct(p.x, app.room.widthM)}
        style:top={pct(p.y, app.room.ceilingM)}
        role="slider"
        tabindex="0"
        aria-label="Probe {p.id} position"
        aria-valuetext="x {p.x.toFixed(1)} m, y {p.y.toFixed(1)} m"
        aria-valuenow={p.x}
        onpointerdown={(e) => startDrag(e, 'probe', p.id)}
        onfocus={() => select({ kind: 'probe', id: p.id })}
        onkeydown={(e) => onKey(e, 'probe', p.id, p.x, p.y)}
      >
        <span>{p.id}</span>
      </div>
    {/each}

    {#if hover}
      <div class="tip" style:left="{hover.px}px" style:top="{hover.py}px">
        {hover.temp.toFixed(1)} °C
      </div>
    {/if}
  </div>
  </div>
</div>

<style>
  .stage {
    container-type: size;
    display: grid;
    place-items: center;
    min-height: 0;
    min-width: 0;
    padding: 16px;
    box-sizing: border-box;
  }
  .frame {
    position: relative;
    aspect-ratio: var(--far);
    width: min(100cqw, calc(100cqh * var(--far)));
  }
  .room {
    position: absolute;
    left: var(--rl);
    top: var(--rt);
    width: var(--rw);
    height: var(--rh);
    touch-action: none;
    cursor: crosshair;
    user-select: none;
    background: #111;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  }
  svg.ext {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    display: block;
  }
  canvas.map {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .walls {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    border-style: solid;
    border-color: rgba(245, 245, 250, 0.85);
    pointer-events: none;
    transition: border-width 0.15s;
  }
  .openings {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .vectors,
  .furniture {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    overflow: visible;
  }
  .furniture-item {
    pointer-events: visiblePainted;
    cursor: grab;
    touch-action: none;
  }
  .furniture-item:active {
    cursor: grabbing;
  }
  .furniture-item.selected {
    filter: drop-shadow(0 0 0.08px #fff) drop-shadow(0 0 0.08px #5aa9ff);
  }
  .furniture-shadow {
    fill: #1118;
  }
  .sofa-body {
    fill: #7e5546;
    stroke: #442e28;
    stroke-width: 0.035;
  }
  .sofa-back {
    fill: #9d6a54;
    stroke: #50372e;
    stroke-width: 0.035;
  }
  .sofa-arm {
    fill: #b77b5d;
    stroke: #50372e;
    stroke-width: 0.03;
  }
  .table-top {
    fill: #ae8052;
    stroke: #513d2b;
    stroke-width: 0.035;
  }
  .table-leg {
    fill: none;
    stroke: #61452e;
    stroke-width: 0.06;
  }
  .opening {
    pointer-events: auto;
    cursor: pointer;
  }
  .opening line {
    vector-effect: non-scaling-stroke;
    stroke-linecap: butt;
  }
  .opening.scaled line {
    vector-effect: none;
  }
  .opening .hit {
    stroke: transparent;
  }
  .window .body {
    stroke: #8fd3ff;
  }
  .door .body {
    stroke: #b9824f;
  }
  .opening.open .body {
    stroke-dasharray: 4 6;
    stroke: #ff9f43;
  }
  .opening.sel .body {
    filter: drop-shadow(0 0 4px #5aa9ff);
  }
  .marker {
    position: absolute;
    width: 28px;
    height: 28px;
    margin: -14px 0 0 -14px;
    border-radius: 50%;
    border: 2px solid #fff;
    cursor: grab;
    touch-action: none;
  }
  .marker.sel {
    outline: 2px solid #fff;
    outline-offset: 3px;
  }
  .marker.dragging {
    cursor: grabbing;
    transform: scale(1.15);
  }
  .marker:focus-visible {
    outline: 3px solid #5aa9ff;
    outline-offset: 3px;
  }
  .source.heat {
    background: radial-gradient(circle, #fff 0 25%, #ff5a1f 26% 60%, rgba(255, 90, 31, 0.3) 61%);
    box-shadow: 0 0 12px rgba(255, 120, 40, 0.9);
  }
  .source.cold {
    background: radial-gradient(circle, #fff 0 25%, #2f8bff 26% 60%, rgba(47, 139, 255, 0.3) 61%);
    box-shadow: 0 0 12px rgba(60, 150, 255, 0.9);
  }
  .probe {
    width: 20px;
    height: 20px;
    margin: -10px 0 0 -10px;
    border-radius: 4px;
    background: rgba(20, 22, 28, 0.85);
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
  }
  .badge {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.6);
    font-size: 12px;
    pointer-events: none;
  }
  .tip {
    position: absolute;
    transform: translate(12px, -140%);
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font-size: 13px;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
