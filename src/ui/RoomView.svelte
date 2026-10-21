<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { createRenderer, type HeatmapRenderer } from '../render/heatmap';
  import { Simulation } from '../sim/simulation';
  import { sliderFromU } from '../sim/config';
  import { app, updateRoom } from '../state/app.svelte';

  let canvas: HTMLCanvasElement;
  let roomEl: HTMLDivElement;
  let renderer: HeatmapRenderer | undefined;
  let sim = new Simulation($state.snapshot(app.room));
  let dragging = $state(false);
  let hover = $state<{ x: number; y: number; px: number; py: number; temp: number } | null>(null);
  let hoverRaw: { x: number; y: number; px: number; py: number } | null = null;

  // Rebuild the grid when the room size changes.
  $effect(() => {
    app.room.widthM;
    app.room.heightM;
    untrack(() => {
      sim = new Simulation($state.snapshot(app.room));
    });
  });

  // Push live-adjustable settings into the running simulation.
  $effect(() => {
    const r = $state.snapshot(app.room);
    sim.setRoom(r);
  });

  $effect(() => {
    app.resetToken;
    untrack(() => sim.reset());
  });

  function pointToRoom(e: PointerEvent) {
    const rect = roomEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * app.room.widthM;
    const y = ((e.clientY - rect.top) / rect.height) * app.room.heightM;
    return { x, y, px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent) {
    roomEl.setPointerCapture(e.pointerId);
    dragging = true;
    const p = pointToRoom(e);
    updateRoom({ sourceX: p.x, sourceY: p.y });
    hoverRaw = p;
  }

  function onPointerMove(e: PointerEvent) {
    const p = pointToRoom(e);
    hoverRaw = p;
    if (dragging) updateRoom({ sourceX: p.x, sourceY: p.y });
  }

  function onPointerUp(e: PointerEvent) {
    dragging = false;
    if (e.pointerType !== 'mouse') hoverRaw = null;
  }

  function onKey(e: KeyboardEvent) {
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
    updateRoom({ sourceX: app.room.sourceX + v[0], sourceY: app.room.sourceY + v[1] });
  }

  onMount(() => {
    renderer = createRenderer(canvas);
    let raf = 0;
    let last = performance.now();
    let lastStats = 0;
    let dispMin = app.stats.tMin;
    let dispMax = app.stats.tMax;

    const frame = (now: number) => {
      const wallDt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (app.running) sim.advance(wallDt * app.speed);

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
          ? { ...hoverRaw, temp: sim.sample(hoverRaw.x, hoverRaw.y) }
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

  const wallPx = $derived(4 + 12 * sliderFromU(app.room.uValue));
</script>

<div class="stage">
  <div
    class="room"
    bind:this={roomEl}
    style:--ar={app.room.widthM / app.room.heightM}
    role="application"
    aria-label="Room. Drag to place the heat source."
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onpointerleave={() => (hoverRaw = null)}
  >
    <canvas bind:this={canvas}></canvas>
    <div class="walls" style:border-width="{wallPx}px"></div>
    <div
      class="source"
      class:dragging
      style:left="{(app.room.sourceX / app.room.widthM) * 100}%"
      style:top="{(app.room.sourceY / app.room.heightM) * 100}%"
      role="slider"
      tabindex="0"
      aria-label="Heat source position"
      aria-valuetext="x {app.room.sourceX.toFixed(1)} m, y {app.room.sourceY.toFixed(1)} m"
      aria-valuenow={app.room.sourceX}
      onkeydown={onKey}
    ></div>
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
  canvas {
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
  .source {
    position: absolute;
    width: 28px;
    height: 28px;
    margin: -14px 0 0 -14px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff 0 25%, #ff5a1f 26% 60%, rgba(255, 90, 31, 0.3) 61%);
    border: 2px solid #fff;
    box-shadow: 0 0 12px rgba(255, 120, 40, 0.9);
    cursor: grab;
    touch-action: none;
  }
  .source.dragging {
    cursor: grabbing;
    transform: scale(1.15);
  }
  .source:focus-visible {
    outline: 3px solid #5aa9ff;
    outline-offset: 3px;
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
