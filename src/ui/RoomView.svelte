<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createRenderer, type HeatmapRenderer } from '../render/heatmap';
  import { Simulation } from '../sim/simulation';
  import { app, moveItem, recorder, select, updateOpening } from '../state/app.svelte';

  let canvas: HTMLCanvasElement;
  let roomEl: HTMLDivElement;
  let renderer: HeatmapRenderer | undefined;
  let sim = new Simulation($state.snapshot(app.room));
  let simKey = `${app.room.widthM}|${app.room.heightM}|${app.room.ceilingM}|${app.room.convection}`;
  let drag = $state<{ kind: 'source' | 'probe'; id: number } | null>(null);
  let hover = $state<{ px: number; py: number; temp: number } | null>(null);
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
    const y = ((e.clientY - rect.top) / rect.height) * app.room.heightM;
    return { x, y, px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function move(kind: 'source' | 'probe', id: number, x: number, y: number) {
    moveItem(kind, id, x, y);
    if (kind === 'probe') recorder.clearSeries(`p${id}`);
  }

  function startDrag(e: PointerEvent, kind: 'source' | 'probe', id: number) {
    e.stopPropagation();
    roomEl.setPointerCapture(e.pointerId);
    select({ kind, id });
    drag = { kind, id };
  }

  function onPointerDown(e: PointerEvent) {
    const sel = app.selection;
    if (!sel || sel.kind === 'opening') return;
    roomEl.setPointerCapture(e.pointerId);
    drag = { kind: sel.kind, id: sel.id };
    const p = pointToRoom(e);
    move(sel.kind, sel.id, p.x, p.y);
    hoverRaw = p;
  }

  function onPointerMove(e: PointerEvent) {
    const p = pointToRoom(e);
    hoverRaw = p;
    if (drag) move(drag.kind, drag.id, p.x, p.y);
  }

  function onPointerUp(e: PointerEvent) {
    drag = null;
    if (e.pointerType !== 'mouse') hoverRaw = null;
  }

  function onKey(e: KeyboardEvent, kind: 'source' | 'probe', id: number, x: number, y: number) {
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
    const { widthM: w, heightM: h } = app.room;
    switch (o.side) {
      case 'top':
        return { x1: a, y1: 0, x2: b, y2: 0 };
      case 'bottom':
        return { x1: a, y1: h, x2: b, y2: h };
      case 'left':
        return { x1: 0, y1: a, x2: 0, y2: b };
      default:
        return { x1: w, y1: a, x2: w, y2: b };
    }
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
        });
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
</script>

<div class="stage">
  <div
    class="room"
    bind:this={roomEl}
    style:--ar={app.room.widthM / app.room.heightM}
    role="application"
    aria-label="Room. Select a source or probe, then drag to place it."
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => (hoverRaw = null)}
  >
    <canvas class="map" bind:this={canvas}></canvas>
    <div class="walls" style:border-width="{wallPx}px"></div>

    <svg
      class="openings"
      viewBox="0 0 {app.room.widthM} {app.room.heightM}"
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
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => toggleOpening(e, o.id, o.open)}
        >
          <line {...seg} class="hit" style:stroke-width="{wallPx + 10}px" />
          <line {...seg} class="body" style:stroke-width="{wallPx + 2}px" />
        </g>
      {/each}
    </svg>

    {#each app.room.sources as s (s.id)}
      <div
        class="marker source {s.kind}"
        class:dragging={drag?.kind === 'source' && drag.id === s.id}
        class:sel={app.selection?.kind === 'source' && app.selection.id === s.id}
        style:left={pct(s.x, app.room.widthM)}
        style:top={pct(s.y, app.room.heightM)}
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
        style:top={pct(p.y, app.room.heightM)}
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

    {#if app.room.convection}
      <div class="badge" aria-hidden="true">Side view ↑ up</div>
    {/if}
    {#if hover}
      <div class="tip" style:left="{hover.px}px" style:top="{hover.py}px">
        {hover.temp.toFixed(1)} °C
      </div>
    {/if}
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
  .room {
    position: relative;
    aspect-ratio: var(--ar);
    width: min(100cqw, calc(100cqh * var(--ar)));
    touch-action: none;
    cursor: crosshair;
    user-select: none;
    background: #111;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
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
  .opening {
    pointer-events: auto;
    cursor: pointer;
  }
  .opening line {
    vector-effect: non-scaling-stroke;
    stroke-linecap: butt;
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
