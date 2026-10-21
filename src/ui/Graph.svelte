<script lang="ts">
  import { app, recorder } from '../state/app.svelte';

  const COLORS = ['#ffd24a', '#5ee0a0', '#ff7ad9'];
  let canvas: HTMLCanvasElement;
  let width = $state(300);
  const height = 150;

  const keys = $derived(['avg', ...app.room.probes.map((p) => `p${p.id}`)]);

  function label(key: string): string {
    return key === 'avg' ? 'Room average' : `Probe ${key.slice(1)}`;
  }

  function color(key: string): string {
    if (key === 'avg') return '#e8eaf0';
    const idx = app.room.probes.findIndex((p) => `p${p.id}` === key);
    return COLORS[idx % COLORS.length];
  }

  function fmt(s: number): string {
    return s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`;
  }

  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const padL = 34;
    const padB = 18;
    const padT = 6;
    const padR = 6;
    const times = recorder.times;
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of keys) {
      for (const v of recorder.series.get(k) ?? []) {
        if (Number.isNaN(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#7c849a';
    if (times.length < 2 || !Number.isFinite(lo)) {
      ctx.fillText('Run the simulation to record…', padL, height / 2);
      return;
    }
    lo = Math.floor(lo - 0.5);
    hi = Math.max(lo + 2, Math.ceil(hi + 0.5));
    const t0 = times[0];
    const t1 = Math.max(times[times.length - 1], t0 + 1);
    const X = (t: number) => padL + ((t - t0) / (t1 - t0)) * (width - padL - padR);
    const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (height - padT - padB);

    ctx.strokeStyle = '#2d3240';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.fillText(`${v.toFixed(0)}°`, padL - 4, y + 4);
    }
    ctx.textAlign = 'left';
    ctx.fillText(fmt(t0), padL, height - 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmt(t1), width - padR, height - 4);

    for (const k of keys) {
      const vals = recorder.series.get(k);
      if (!vals) continue;
      ctx.strokeStyle = color(k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < vals.length; i++) {
        if (Number.isNaN(vals[i])) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(X(times[i]), Y(vals[i]));
        else ctx.moveTo(X(times[i]), Y(vals[i]));
        pen = true;
      }
      ctx.stroke();
    }
  }

  $effect(() => {
    app.graphTick;
    keys;
    width;
    draw();
  });
</script>

<div class="graph" bind:clientWidth={width}>
  <canvas class="chart" bind:this={canvas} style:width="{width}px" style:height="{height}px"></canvas>
  <ul class="key">
    {#each keys as k}
      <li><i style:background={color(k)}></i>{label(k)}</li>
    {/each}
  </ul>
</div>

<style>
  .graph {
    width: 100%;
  }
  canvas.chart {
    display: block;
    background: #14161c;
    border-radius: 6px;
  }
  .key {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    color: #9aa3b8;
  }
  i {
    display: inline-block;
    width: 10px;
    height: 3px;
    margin-right: 5px;
    vertical-align: middle;
    border-radius: 2px;
  }
</style>
