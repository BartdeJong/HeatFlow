<script lang="ts">
  import {
    addOpening,
    addProbe,
    addSource,
    app,
    addFurniture,
    moveItem,
    removeOpening,
    removeFurniture,
    removeProbe,
    removeSource,
    resetSimulation,
    select,
    setRoom,
    SPEEDS,
    updateOpening,
    updateRoom,
    updateRoof,
    updateSource,
    updateThermostat,
    updateWall,
  } from '../state/app.svelte';
  import {
    INSULATIONS,
    LIMITS,
    ROOF_MATERIALS,
    OPENING_SIDES,
    WALL_MATERIALS,
    holdPowerKW,
    furnitureSize,
    roofU,
    wallLength,
    wallU,
    type InsulationId,
    type RoofMaterialId,
    type WallMaterialId,
    type WallSide,
  } from '../sim/config';
  import { PALETTES, PALETTE_IDS, paletteCssGradient, type PaletteId } from '../render/palette';
  import Graph from './Graph.svelte';
  import { deleteRoom, listSavedRooms, saveRoom } from '../persist/storage';
  import { shareUrl } from '../persist/share';

  let saved = $state(listSavedRooms());
  let name = $state('My room');
  let selected = $state('');
  let message = $state('');
  let holdMsg = $state('');

  function holdSource(id: number) {
    const res = holdPowerKW($state.snapshot(app.room), id, 20);
    if (!res) return;
    updateSource(id, { powerKW: res.kW });
    holdMsg = res.reachable
      ? `Set to ${res.kW.toFixed(2)} kW – the room should settle near 20 °C.`
      : `20 °C can't be reached with this source (limit ${res.kW.toFixed(2)} kW).`;
    setTimeout(() => (holdMsg = ''), 4000);
  }
  const names = $derived(Object.keys(saved).sort());
  const wallUValue = $derived(wallU(app.room.wall));
  const roofUValue = $derived(roofU(app.room.roof));
  const selectedSource = $derived(
    app.selection?.kind === 'source'
      ? app.room.sources.find((s) => s.id === app.selection!.id)
      : undefined,
  );
  const selectedFurniture = $derived(
    app.selection?.kind === 'furniture'
      ? app.room.furniture.find((f) => f.id === app.selection!.id)
      : undefined,
  );
  const selectedFurnitureSize = $derived(
    selectedFurniture ? furnitureSize(selectedFurniture.kind, app.room.widthM) : undefined,
  );
  const heatingPowerKW = $derived(
    app.room.sources
      .filter((source) => source.kind === 'heat')
      .reduce((sum, source) => sum + source.powerKW, 0),
  );

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

  function fmtPower(w: number): string {
    return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${w.toFixed(0)} W`;
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
          <option value={s}>{s === 1 ? 'Real time (1×)' : `${s}× real time`}</option>
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
    <legend>Thermostat</legend>
    <label class="check">
      <input
        type="checkbox"
        checked={app.room.thermostat.enabled}
        onchange={(e) => updateThermostat({ enabled: e.currentTarget.checked })}
      />
      Automatic heating
    </label>
    <p
      class="thermostat-state"
      class:heating={app.room.thermostat.enabled && heatingPowerKW > 0 && app.stats.thermostatHeating}
      aria-live="polite"
    >
      <strong>Status</strong>
      {#if !app.room.thermostat.enabled}
        Off — heat sources run manually
      {:else if heatingPowerKW <= 0}
        No powered heat source
      {:else if !app.running}
        Simulation paused
      {:else if app.stats.thermostatHeating}
        Heating — {heatingPowerKW.toFixed(1)} kW enabled
      {:else}
        Holding — resumes at ≤{(app.room.thermostat.targetC - app.room.thermostat.deadbandC / 2).toFixed(2)} °C
      {/if}
    </p>
    <label>
      <span>Target <output>{app.room.thermostat.targetC.toFixed(1)} °C</output></span>
      <input
        type="range"
        min={LIMITS.thermostatTarget.min}
        max={LIMITS.thermostatTarget.max}
        step={LIMITS.thermostatTarget.step}
        value={app.room.thermostat.targetC}
        oninput={(e) => updateThermostat({ targetC: e.currentTarget.valueAsNumber })}
      />
    </label>
    <label>
      <span>Deadband width <output>{app.room.thermostat.deadbandC.toFixed(1)} °C</output></span>
      <input
        type="range"
        min={LIMITS.thermostatDeadband.min}
        max={LIMITS.thermostatDeadband.max}
        step={LIMITS.thermostatDeadband.step}
        value={app.room.thermostat.deadbandC}
        oninput={(e) => updateThermostat({ deadbandC: e.currentTarget.valueAsNumber })}
      />
    </label>
    <p class="hint">
      Starts off. When enabled, all heat sources run at their set power until the room average reaches target + half the deadband, then pause until it falls below target − half the deadband. Cooling sources remain manual.
    </p>
  </fieldset>

  <fieldset>
    <legend>Energy &amp; heat loss</legend>
    <dl class="stats">
      <dt>Heat delivered</dt><dd>{app.stats.heatingKWh.toFixed(3)} kWh</dd>
      <dt>Cooling delivered</dt><dd>{app.stats.coolingKWh.toFixed(3)} kWh</dd>
      <dt>Current heat loss</dt><dd>{fmtPower(app.stats.heatLoss.totalW)}</dd>
      <dt>Roof</dt><dd>{fmtPower(app.stats.heatLoss.roofW)}</dd>
      <dt>Walls</dt><dd>{fmtPower(app.stats.heatLoss.wallsW)}</dd>
      <dt>Floor</dt><dd>{fmtPower(app.stats.heatLoss.floorW)}</dd>
      <dt>Windows &amp; doors</dt><dd>{fmtPower(app.stats.heatLoss.openingsW)}</dd>
    </dl>
    <p class="hint">Positive heat loss leaves the room; negative values mean heat is entering from outside. Energy totals accumulate while the simulation runs and clear on reset.</p>
  </fieldset>

  <fieldset>
    <legend>Display</legend>
    <label>
      Colour palette
      <select bind:value={app.palette}>
        {#each PALETTE_IDS as id}
          <option value={id}>{PALETTES[id].label}</option>
        {/each}
      </select>
    </label>
    <label class="check">
      <input
        type="checkbox"
        checked={app.room.convection}
        onchange={(e) => updateRoom({ convection: e.currentTarget.checked })}
      />
      Air currents (hot air rises)
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={app.exterior} />
      House exterior (walls &amp; roof)
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={app.showVectors} />
      Heat-flow arrows
    </label>
    {#if app.room.convection}
      <p class="hint">Warm air rises in this side view. Toggling this restarts the simulation.</p>
    {/if}
  </fieldset>

  <fieldset>
    <legend>Furniture</legend>
    <div class="row">
      <button onclick={() => addFurniture('sofa')} disabled={app.room.furniture.length >= LIMITS.furniture}>
        + Sofa
      </button>
      <button onclick={() => addFurniture('table')} disabled={app.room.furniture.length >= LIMITS.furniture}>
        + Table
      </button>
    </div>
    <ul class="items">
      {#each app.room.furniture as item (item.id)}
        {@const size = furnitureSize(item.kind, app.room.widthM)}
        <li class:sel={app.selection?.kind === 'furniture' && app.selection.id === item.id}>
          <button class="item" onclick={() => select({ kind: 'furniture', id: item.id })}>
            {item.kind === 'sofa' ? '🛋 Sofa' : '▰ Table'} {item.id} · {size.widthM.toFixed(1)} m
          </button>
          <button onclick={() => removeFurniture(item.id)} aria-label="Remove furniture {item.id}">🗑</button>
        </li>
      {/each}
    </ul>
    {#if selectedFurniture}
      <label>
        <span>Position <output>{selectedFurniture.x.toFixed(1)} m</output></span>
        <input
          type="range"
          min={selectedFurnitureSize ? selectedFurnitureSize.widthM / 2 : 0}
          max={selectedFurnitureSize ? app.room.widthM - selectedFurnitureSize.widthM / 2 : app.room.widthM}
          step="0.1"
          value={selectedFurniture.x}
          oninput={(e) => moveItem('furniture', selectedFurniture.id, e.currentTarget.valueAsNumber, 0)}
        />
      </label>
    {/if}
    <p class="hint">Furniture has thermal mass and exchanges heat with nearby air. Drag items across the floor; changes affect the simulation.</p>
  </fieldset>

  <fieldset>
    <legend>Sources</legend>
    <div class="row">
      <button onclick={() => addSource('heat')} disabled={app.room.sources.length >= LIMITS.sources}>
        + Heat
      </button>
      <button onclick={() => addSource('cold')} disabled={app.room.sources.length >= LIMITS.sources}>
        + Cold
      </button>
    </div>
    <ul class="items">
      {#each app.room.sources as s (s.id)}
        <li class:sel={app.selection?.kind === 'source' && app.selection.id === s.id}>
          <button class="item" onclick={() => select({ kind: 'source', id: s.id })}>
            <span class="dot {s.kind}"></span>
            {s.kind === 'heat' ? 'Heat' : 'Cold'} {s.id} · {s.powerKW.toFixed(1)} kW
          </button>
          <button onclick={() => removeSource(s.id)} aria-label="Remove source {s.id}">🗑</button>
        </li>
      {/each}
    </ul>
    {#if selectedSource}
      <label>
        <span>
          {selectedSource.kind === 'heat' ? 'Output' : 'Cooling'}
          <output>{selectedSource.powerKW.toFixed(1)} kW</output>
        </span>
        <input
          type="range"
          min={LIMITS.power.min}
          max={LIMITS.power.max}
          step={LIMITS.power.step}
          value={selectedSource.powerKW}
          oninput={(e) => updateSource(selectedSource.id, { powerKW: e.currentTarget.valueAsNumber })}
        />
      </label>
      <button onclick={() => holdSource(selectedSource.id)}>⚖ Hold room at 20 °C</button>
      {#if holdMsg}<p class="hint">{holdMsg}</p>{/if}
    {:else}
      <p class="hint">Select a source to adjust it. Click or drag in the room to move the selected one.</p>
    {/if}
  </fieldset>

  <fieldset>
    <legend>Walls</legend>
    <label>
      Material
      <select
        value={app.room.wall.material}
        onchange={(e) => updateWall({ material: e.currentTarget.value as WallMaterialId })}
      >
        {#each WALL_MATERIALS as m}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </label>
    <label>
      <span>Thickness <output>{(app.room.wall.thicknessM * 100).toFixed(0)} cm</output></span>
      <input
        type="range"
        min={LIMITS.thickness.min}
        max={LIMITS.thickness.max}
        step={LIMITS.thickness.step}
        value={app.room.wall.thicknessM}
        oninput={(e) => updateWall({ thicknessM: e.currentTarget.valueAsNumber })}
      />
    </label>
    <label>
      Insulation type
      <select
        value={app.room.wall.insulation}
        onchange={(e) => updateWall({ insulation: e.currentTarget.value as InsulationId })}
      >
        {#each INSULATIONS as m}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </label>
    <label>
      <span>
        Insulation thickness <output>{(app.room.wall.insulationM * 100).toFixed(0)} cm</output>
      </span>
      <input
        type="range"
        min={LIMITS.insulation.min}
        max={LIMITS.insulation.max}
        step={LIMITS.insulation.step}
        value={app.room.wall.insulationM}
        oninput={(e) => updateWall({ insulationM: e.currentTarget.valueAsNumber })}
      />
    </label>
    <p class="hint">Wall U-value <output>{wallUValue.toFixed(2)} W/m²K</output> (lower is better).</p>
  </fieldset>

  <fieldset>
    <legend>Roof</legend>
    <label>
      Covering
      <select
        value={app.room.roof.material}
        onchange={(e) => updateRoof({ material: e.currentTarget.value as RoofMaterialId })}
      >
        {#each ROOF_MATERIALS as m}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </label>
    <label>
      <span>Pitch <output>{app.room.roof.pitchDeg.toFixed(0)}°</output></span>
      <input
        type="range"
        min={LIMITS.pitch.min}
        max={LIMITS.pitch.max}
        step={LIMITS.pitch.step}
        value={app.room.roof.pitchDeg}
        oninput={(e) => updateRoof({ pitchDeg: e.currentTarget.valueAsNumber })}
      />
    </label>
    <label>
      <span>Roof insulation <output>{(app.room.roof.insulationM * 100).toFixed(0)} cm</output></span>
      <input
        type="range"
        min={LIMITS.roofInsulation.min}
        max={LIMITS.roofInsulation.max}
        step={LIMITS.roofInsulation.step}
        value={app.room.roof.insulationM}
        oninput={(e) => updateRoof({ insulationM: e.currentTarget.valueAsNumber })}
      />
    </label>
    <p class="hint">
      Roof U-value <output>{roofUValue.toFixed(2)} W/m²K</output>. The covering is visual only.
    </p>
  </fieldset>

  <fieldset>
    <legend>Windows &amp; doors</legend>
    <div class="row">
      <button onclick={() => addOpening('window')} disabled={app.room.openings.length >= LIMITS.openings}>
        + Window
      </button>
      <button onclick={() => addOpening('door')} disabled={app.room.openings.length >= LIMITS.openings}>
        + Door
      </button>
    </div>
    {#each app.room.openings as o (o.id)}
      {@const len = wallLength(app.room, o.side)}
      <div class="opening" class:sel={app.selection?.kind === 'opening' && app.selection.id === o.id}>
        <div class="row">
          <button class="item" onclick={() => select({ kind: 'opening', id: o.id })}>
            {o.kind === 'window' ? '🪟 Window' : '🚪 Door'} {o.id}
          </button>
          <button
            class:primary={o.open}
            onclick={() => updateOpening(o.id, { open: !o.open })}
            aria-pressed={o.open}
          >
            {o.open ? 'Open' : 'Closed'}
          </button>
          <button onclick={() => removeOpening(o.id)} aria-label="Remove opening {o.id}">🗑</button>
        </div>
        <label>
          Wall
          <select
            value={o.side}
            onchange={(e) => updateOpening(o.id, { side: e.currentTarget.value as WallSide })}
          >
            {#each OPENING_SIDES as s}<option value={s.id}>{s.label}</option>{/each}
          </select>
        </label>
        <label>
          <span>Position <output>{o.pos.toFixed(1)} m</output></span>
          <input
            type="range"
            min="0"
            max={len}
            step="0.1"
            value={o.pos}
            oninput={(e) => updateOpening(o.id, { pos: e.currentTarget.valueAsNumber })}
          />
        </label>
        <label>
          <span>Width <output>{o.length.toFixed(1)} m</output></span>
          <input
            type="range"
            min={LIMITS.openingLength.min}
            max={Math.max(LIMITS.openingLength.min, len - 0.2)}
            step={LIMITS.openingLength.step}
            value={o.length}
            oninput={(e) => updateOpening(o.id, { length: e.currentTarget.valueAsNumber })}
          />
        </label>
      </div>
    {/each}
    <p class="hint">Windows and doors sit in the left or right wall. Click one on the wall to open or close it. Open ones lose a lot of heat.</p>
  </fieldset>

  <fieldset>
    <legend>Temperature graph</legend>
    <div class="row">
      <button onclick={addProbe} disabled={app.room.probes.length >= LIMITS.probes}>+ Probe</button>
      {#each app.room.probes as p (p.id)}
        <button onclick={() => removeProbe(p.id)} aria-label="Remove probe {p.id}">✕ {p.id}</button>
      {/each}
    </div>
    <Graph />
    <p class="hint">Drag numbered probes in the room to measure any spot.</p>
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
      <span>Ceiling height <output>{app.room.ceilingM.toFixed(1)} m</output></span>
      <input
        type="range"
        min={LIMITS.size.min}
        max={LIMITS.size.max}
        step={LIMITS.size.step}
        value={app.room.ceilingM}
        oninput={(e) => updateRoom({ ceilingM: e.currentTarget.valueAsNumber })}
      />
    </label>
    <label>
      <span>Length (depth) <output>{app.room.heightM.toFixed(1)} m</output></span>
      <input
        type="range"
        min={LIMITS.size.min}
        max={LIMITS.size.max}
        step={LIMITS.size.step}
        value={app.room.heightM}
        oninput={(e) => updateRoom({ heightM: e.currentTarget.valueAsNumber })}
      />
    </label>
    <label>
      <span>Outside temperature <output>{app.room.outsideC.toFixed(0)} °C</output></span>
      <input
        type="range"
        min={LIMITS.outside.min}
        max={LIMITS.outside.max}
        step={LIMITS.outside.step}
        value={app.room.outsideC}
        oninput={(e) => updateRoom({ outsideC: e.currentTarget.valueAsNumber })}
      />
    </label>
    <p class="hint">The room is shown from the side; length is the depth into the screen. Changing the size restarts the simulation. The colour scale adapts to the current temperatures.</p>
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
    <div class="bar" style:background={paletteCssGradient(app.palette)}></div>
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
  .thermostat-state {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
    padding: 7px 9px;
    border-radius: 6px;
    background: #262a35;
    color: #9aa3b8;
    font-size: 12px;
  }
  .thermostat-state strong {
    color: #d1d5df;
  }
  .thermostat-state.heating {
    color: #ffb27a;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .items li,
  .opening > .row {
    display: flex;
    gap: 6px;
  }
  .items li.sel .item,
  .opening.sel > .row .item {
    border-color: #5aa9ff;
  }
  .item {
    flex: 1;
    text-align: left;
    min-width: 0;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 4px;
  }
  .dot.heat {
    background: #ff5a1f;
  }
  .dot.cold {
    background: #2f8bff;
  }
  .opening {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: 1px solid #343845;
    border-radius: 6px;
  }
  .opening.sel {
    border-color: #5aa9ff;
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
