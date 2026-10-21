<script lang="ts">
  import { app, resetSimulation, setRoom, SPEEDS, updateRoom } from '../state/app.svelte';
  import { LIMITS, sliderFromU, uFromSlider } from '../sim/config';
  import { paletteCssGradient } from '../render/palette';
  import { deleteRoom, listSavedRooms, saveRoom } from '../persist/storage';
  import { shareUrl } from '../persist/share';

  let saved = $state(listSavedRooms());
  let name = $state('My room');
  let selected = $state('');
  let message = $state('');

  const names = $derived(Object.keys(saved).sort());

  function flash(text: string) {
    message = text;
    setTimeout(() => {
      if (message === text) message = '';
    }, 3000);
  }

  function onSave() {
    const n = name.trim();
    if (!n) return flash('Enter a name first.');
    if (!saveRoom(n, $state.snapshot(app.room))) return flash('Could not save (storage unavailable).');
    saved = listSavedRooms();
    selected = n;
    flash(`Saved “${n}”.`);
  }

  function onLoad() {
    const room = saved[selected];
    if (!room) return;
    setRoom(room);
    name = selected;
    flash(`Loaded “${selected}”.`);
  }

  function onDelete() {
    if (!selected) return;
    deleteRoom(selected);
    saved = listSavedRooms();
    selected = '';
  }

  async function onShare() {
    const url = shareUrl($state.snapshot(app.room));
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copied to clipboard.');
    } catch {
      flash('Link placed in the address bar.');
    }
  }

  function fmtTime(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min ${sec.toString().padStart(2, '0')} s`;
  }
</script>

<aside class="sidebar">
  <h1>🔥 HeatFlow</h1>

  <fieldset>
    <legend>Simulation</legend>
    <div class="row">
      <button class="primary" onclick={() => (app.running = !app.running)}>
        {app.running ? '⏸ Pause' : '▶ Play'}
      </button>
      <button onclick={resetSimulation}>↺ Reset</button>
    </div>
    <label>
      Speed
      <select bind:value={app.speed}>
        {#each SPEEDS as s}
          <option value={s}>{s}× real time</option>
        {/each}
      </select>
    </label>
    <dl class="stats">
      <dt>Elapsed</dt><dd>{fmtTime(app.stats.elapsed)}</dd>
      <dt>Average</dt><dd>{app.stats.mean.toFixed(1)} °C</dd>
      <dt>Hottest</dt><dd>{app.stats.max.toFixed(1)} °C</dd>
    </dl>
  </fieldset>

  <fieldset>
    <legend>Heat source</legend>
    <label>
      <span>Output <output>{app.room.powerKW.toFixed(1)} kW</output></span>
      <input
        type="range"
        min={LIMITS.power.min}
        max={LIMITS.power.max}
        step={LIMITS.power.step}
        value={app.room.powerKW}
        oninput={(e) => updateRoom({ powerKW: e.currentTarget.valueAsNumber })}
      />
    </label>
    <p class="hint">Drag the glowing dot in the room to move it.</p>
  </fieldset>

  <fieldset>
    <legend>Walls</legend>
    <label>
      <span>Insulation <output>U = {app.room.uValue.toFixed(2)} W/m²K</output></span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={sliderFromU(app.room.uValue)}
        oninput={(e) => updateRoom({ uValue: uFromSlider(e.currentTarget.valueAsNumber) })}
      />
      <span class="ends"><span>Poor</span><span>Excellent</span></span>
    </label>
  </fieldset>

  <fieldset>
    <legend>Room</legend>
    <label>
      <span>Width <output>{app.room.widthM.toFixed(1)} m</output></span>
      <input
        type="range"
        min={LIMITS.size.min}
        max={LIMITS.size.max}
        step={LIMITS.size.step}
        value={app.room.widthM}
        oninput={(e) => updateRoom({ widthM: e.currentTarget.valueAsNumber })}
      />
    </label>
    <label>
      <span>Height <output>{app.room.heightM.toFixed(1)} m</output></span>
      <input
        type="range"
        min={LIMITS.size.min}
        max={LIMITS.size.max}
        step={LIMITS.size.step}
        value={app.room.heightM}
        oninput={(e) => updateRoom({ heightM: e.currentTarget.valueAsNumber })}
      />
    </label>
    <p class="hint">Changing the size restarts the simulation. Outside is 0 °C. The colour scale adapts to the current temperatures.</p>
  </fieldset>

  <fieldset>
    <legend>Save &amp; share</legend>
    <div class="row">
      <input type="text" bind:value={name} maxlength="40" aria-label="Room name" />
      <button onclick={onSave}>Save</button>
    </div>
    {#if names.length}
      <div class="row">
        <select bind:value={selected} aria-label="Saved rooms">
          <option value="">Saved rooms…</option>
          {#each names as n}<option value={n}>{n}</option>{/each}
        </select>
        <button onclick={onLoad} disabled={!selected}>Load</button>
        <button onclick={onDelete} disabled={!selected} aria-label="Delete saved room">🗑</button>
      </div>
    {/if}
    <button onclick={onShare}>🔗 Copy share link</button>
    <p class="hint status" aria-live="polite">{message}</p>
  </fieldset>

  <div class="legend" aria-label="Temperature scale">
    <div class="bar" style:background={paletteCssGradient()}></div>
    <div class="ticks">
      <span>{Math.round(app.stats.tMax)} °C</span>
      <span>{Math.round((app.stats.tMax + app.stats.tMin) / 2)} °C</span>
      <span>{Math.round(app.stats.tMin)} °C</span>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    overflow-y: auto;
    background: #1b1d24;
    position: relative;
  }
  h1 {
    margin: 0;
    font-size: 22px;
  }
  fieldset {
    margin: 0;
    padding: 10px 12px 12px;
    border: 1px solid #343845;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  legend {
    padding: 0 6px;
    color: #9aa3b8;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 14px;
  }
  label > span:first-child {
    display: flex;
    justify-content: space-between;
  }
  output {
    color: #ffb27a;
    font-variant-numeric: tabular-nums;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #7c849a;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row > input[type='text'],
  .row > select {
    flex: 1;
    min-width: 0;
  }
  button,
  select,
  input[type='text'] {
    font: inherit;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #3d4254;
    background: #262a35;
    color: inherit;
    min-height: 40px;
  }
  button {
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: #30364a;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.primary {
    background: #d9531e;
    border-color: #d9531e;
    flex: 1;
  }
  .row > button:not(.primary) {
    flex: 0 0 auto;
  }
  input[type='range'] {
    width: 100%;
    min-height: 28px;
    accent-color: #ff7a33;
  }
  .stats {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0;
    font-size: 13px;
  }
  .stats dt {
    color: #9aa3b8;
  }
  .stats dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: #7c849a;
  }
  .status {
    min-height: 1.2em;
    color: #8fd18f;
  }
  .legend {
    display: flex;
    gap: 8px;
    height: 120px;
  }
  .bar {
    width: 18px;
    border-radius: 4px;
  }
  .ticks {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-size: 12px;
    color: #9aa3b8;
  }
  @media (max-width: 800px) {
    .legend {
      height: 90px;
    }
  }
</style>
