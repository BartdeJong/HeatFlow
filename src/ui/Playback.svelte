<script lang="ts">
import { app, resetSimulation, SPEEDS, furnitureWarnings } from '../state/app.svelte';
const placementWarning = $derived(app.placementMessage || furnitureWarnings(app.room).join(' '));
function time(s: number) { const h = Math.floor(s / 3600); const m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min ${Math.floor(s % 60).toString().padStart(2, '0')} s`; }
</script>
<div class="playback" aria-label="Simulation controls">
  <div class="actions"><button class="primary" onclick={() => app.running = !app.running}><span aria-hidden="true">{app.running ? 'Ⅱ' : '▶'}</span> {app.running ? 'Pause' : 'Play'}</button><button onclick={resetSimulation} aria-label="Reset simulation">↺ Reset</button><select aria-label="Simulation speed" bind:value={app.speed}>{#each SPEEDS as speed}<option value={speed}>{speed}× speed</option>{/each}</select></div>
  <div class="timing"><span>ELAPSED <strong>{time(app.stats.elapsed)}</strong></span><span>ACHIEVED <strong>{app.stats.achievedSpeed.toFixed(1)}× <small>/ {app.speed}×</small></strong></span></div>
</div>
{#if app.stats.diagnostics.failure}<p class="global-warning" role="alert">Simulation paused: {app.stats.diagnostics.failure}</p>{/if}
{#if placementWarning}<p class="global-warning" role="status">{placementWarning}</p>{/if}
<style>
.playback { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:16px 24px; background:var(--surface); border-bottom:1px solid var(--border); }
.actions { display:flex; gap:8px; flex-wrap:wrap; } button,select { font-size:12px; } .primary { min-width:100px; } .primary span { margin-right:6px; }
.timing { display:flex; gap:24px; } .timing > span { display:flex; flex-direction:column; gap:5px; color:var(--muted); font-size:9px; letter-spacing:1px; } strong { color:var(--text); font-size:13px; font-weight:500; letter-spacing:0; font-variant-numeric:tabular-nums; } small { color:var(--muted); font-size:11px; }
.global-warning { margin:0; padding:12px 24px; background:#38251b; color:#ffca9b; font-size:13px; }
@media(max-width:600px) { .playback { padding:12px 16px; gap:14px; } .timing { gap:24px; } }
</style>
