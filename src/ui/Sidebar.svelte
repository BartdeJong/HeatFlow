<script lang="ts">
  import { tick } from 'svelte';
  import {
    addOpening,
    addProbe,
    addSource,
    app,
    moveItem,
    removeOpening,
    removeProbe,
    removeSource,
    select,
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
    WALL_MATERIALS,
    holdPowerKW,
    roofU,
    wallLength,
    wallU,
    type InsulationId,
    type HeatingMode,
    type RoofMaterialId,
    type WallMaterialId,
  } from '../sim/config';
  import { footprintWalls } from '../sim/footprint';
  import { PALETTES, PALETTE_IDS } from '../render/palette';
  import { TEMPERATURE_MIN_C, ROOM_TEMPERATURE_C, TEMPERATURE_MAX_C, gradientOpacityValue } from '../render/temperature-scale';
  import Graph from './Graph.svelte';
  import FurniturePanel from './FurniturePanel.svelte';
  import PhysicsPanel from './PhysicsPanel.svelte';
  import FloorplanEditor from './FloorplanEditor.svelte';

  let holdMsg = $state('');

  function gradientOpacityLabel() {
    if (!app.showTemperatureGradient) return 'Off';
    const opacity = gradientOpacityValue(app.gradientOpacity) * 100;
    return opacity > 0 && opacity < 0.5 ? '<0.5%' : `${Math.round(opacity)}%`;
  }

  function holdSource(id: number) {
    const res = holdPowerKW($state.snapshot(app.room), id, 20);
    if (!res) return;
    updateSource(id, { powerKW: res.kW });
    holdMsg = res.reachable
      ? `Estimated steady demand: ${res.kW.toFixed(2)} kW. Sun, sky cooling and transient storage can change the result.`
      : `20 °C can't be reached with this source (limit ${res.kW.toFixed(2)} kW).`;
    setTimeout(() => (holdMsg = ''), 4000);
  }
  const wallUValue = $derived(wallU(app.room.wall));
  const roofUValue = $derived(roofU(app.room.roof));
  const selectedSource = $derived(
    app.selection?.kind === 'source'
      ? app.room.sources.find((s) => s.id === app.selection!.id)
      : undefined,
  );
  const heatingPowerKW = $derived(app.room.sources.filter((s) => s.kind === 'heat').reduce((sum, s) => sum + s.powerKW, 0));
  const hasCeilingFan = $derived(app.room.sources.some((s) => s.kind === 'fan'));
  const fanRunning = $derived(app.room.sources.some((s) => s.kind === 'fan' && s.fanEnabled !== false));
  const selectedProbe = $derived(app.selection?.kind === 'probe' ? app.room.probes.find((p) => p.id === app.selection!.id) : undefined);
  const sliceLength = $derived(app.sliceAxis === 'x' ? app.room.widthM : app.sliceAxis === 'y' ? app.room.heightM : app.room.ceilingM);
  const roomWalls = $derived(footprintWalls(app.room));

  const tabs = ['Setup', 'Climate', 'Display', 'Results'] as const;
  let active = $state<(typeof tabs)[number]>('Setup');
  $effect(() => {
    const selection = app.selection;
    if (!selection) return;
    const tab = selection.kind === 'probe' ? 'Results' : 'Setup';
    active = tab;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled) return;
      const panel = document.getElementById(`panel-${tab}`);
      const target = document.getElementById(`inspect-${selection.kind}`);
      if (panel && target && !panel.hidden) {
        panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20;
      }
    });
    return () => { cancelled = true; };
  });
  function tabKey(event: KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length;
    active = tabs[next];
    document.getElementById(`tab-${active}`)?.focus();
  }
  function fmtPower(w: number): string {
    return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${w.toFixed(0)} W`;
  }
</script>
{#snippet positionControls(item: { id: number; x: number; y: number; z: number }, kind: 'source' | 'probe', ceilingMounted = false)}
  {#each (ceilingMounted
    ? [{ key: 'x' as const, label: 'X · width', max: app.room.widthM }, { key: 'y' as const, label: 'Y · length', max: app.room.heightM }]
    : [{ key: 'x' as const, label: 'X · width', max: app.room.widthM }, { key: 'y' as const, label: 'Y · length', max: app.room.heightM }, { key: 'z' as const, label: 'Z · height above floor', max: app.room.ceilingM }]) as axis}
    <label>
      <span>{axis.label}<output>{item[axis.key].toFixed(1)} m</output></span>
      <input type="range" min="0" max={axis.max} step="0.1" value={item[axis.key]}
        oninput={(e) => { const p = { ...item, [axis.key]: e.currentTarget.valueAsNumber }; moveItem(kind, item.id, p.x, p.y, p.z); }} />
    </label>
  {/each}
{/snippet}

<aside class="sidebar" aria-label="Room inspector">
<div class="inspector-heading"><span>ROOM INSPECTOR</span><span class="inspector-badge">3D</span></div>
<div class="tabs" role="tablist" aria-label="Settings sections">
{#each tabs as tab, index}<button id="tab-{tab}" role="tab" aria-selected={active === tab} aria-controls="panel-{tab}" tabindex={active === tab ? 0 : -1} onclick={() => active = tab} onkeydown={(e) => tabKey(e, index)}>{tab}</button>{/each}
</div>
<div class="inspector-content" id="panel-Setup" role="tabpanel" aria-labelledby="tab-Setup" tabindex="0" hidden={active !== 'Setup'}>
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
      <span>Length <output>{app.room.heightM.toFixed(1)} m</output></span>
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

    <p class="hint">The room uses X for width, Y for length, and Z for height. Changing the size restarts the simulation. The colour scale stays at {TEMPERATURE_MIN_C}–{TEMPERATURE_MAX_C} °C, with a faint tint near {ROOM_TEMPERATURE_C} °C.</p>
  </fieldset>
  <FloorplanEditor />
  <fieldset id="inspect-source">
    <legend>Sources</legend>
    <label>
      Heating delivery
      <select
        value={app.room.heatingMode}
        onchange={(e) => updateRoom({ heatingMode: e.currentTarget.value as HeatingMode })}
      >
        <option value="point">Individual emitters</option>
        <option value="underfloor">Underfloor heating</option>
      </select>
    </label>
    {#if app.room.heatingMode === 'underfloor'}
      <p class="hint">Heat sources warm the floor slab; their position is ignored. The slab releases stored heat after switch-off. Cold sources remain point-based.</p>
    {/if}
    <div class="row">
      <button onclick={() => addSource('heat')} disabled={app.room.sources.length >= LIMITS.sources}>
        + Heat
      </button>
      <button onclick={() => addSource('cold')} disabled={app.room.sources.length >= LIMITS.sources}>
        + Cold
      </button>
      <button onclick={() => addSource('fan')} disabled={app.room.sources.length >= LIMITS.sources || hasCeilingFan}>
        + Fan
      </button>
    </div>
    <ul class="items">
      {#each app.room.sources as s (s.id)}
        <li class:sel={app.selection?.kind === 'source' && app.selection.id === s.id}>
          <button class="item" onclick={() => select({ kind: 'source', id: s.id })}>
            <span class="dot {s.kind}"></span>
            {#if s.kind === 'fan'}
              Ceiling fan {s.id}{#if s.fanEnabled === false} · Off{/if}
            {:else}
              {s.kind === 'cold' ? 'Cold' : app.room.heatingMode === 'underfloor' ? 'Underfloor' : 'Heat'} {s.id} · {s.powerKW.toFixed(1)} kW
            {/if}
          </button>
          <button onclick={() => removeSource(s.id)} aria-label="Remove source {s.id}">×</button>
        </li>
      {/each}
    </ul>
    {#if selectedSource}
      {#if selectedSource.kind === 'fan'}
        <label class="check">
          <input type="checkbox" checked={selectedSource.fanEnabled !== false}
            onchange={(e) => updateSource(selectedSource.id, { fanEnabled: e.currentTarget.checked })} />
          Fan on
        </label>
        <label>
          <span>Fan speed <output>{(selectedSource.fanSpeedMps ?? 1.2).toFixed(1)} m/s</output></span>
          <input type="range" min="0.3" max="2.5" step="0.1" value={selectedSource.fanSpeedMps ?? 1.2}
            oninput={(e) => updateSource(selectedSource.id, { fanSpeedMps: e.currentTarget.valueAsNumber })} />
        </label>
        <label>
          <span>Blade diameter <output>{(selectedSource.fanDiameterM ?? 1.2).toFixed(1)} m</output></span>
          <input type="range" min="0.5" max="2" step="0.1" value={selectedSource.fanDiameterM ?? 1.2}
            oninput={(e) => updateSource(selectedSource.id, { fanDiameterM: e.currentTarget.valueAsNumber })} />
        </label>
        {@render positionControls(selectedSource, 'source', true)}
        <p class="hint">Drag the fan marker or adjust X and Y to move it. Its mount stays at the ceiling.</p>
      {:else}
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
        {@render positionControls(selectedSource, 'source')}
        <button onclick={() => holdSource(selectedSource.id)}>↗ Estimate power for 20 °C</button>
        {#if holdMsg}<p class="hint">{holdMsg}</p>{/if}
        {#if selectedSource.kind === 'heat'}<PhysicsPanel section="emitter" />{/if}
      {/if}
    {:else}
      <p class="hint">Select a source to adjust its power and 3D position. Drag it to move; Shift-drag to change height.</p>
    {/if}
  </fieldset>
<div id="inspect-furniture"><FurniturePanel /></div>
  <fieldset id="inspect-opening">
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
      {@const len = wallLength(app.room, o.wallIndex ?? o.side)}
      <div class="opening" class:sel={app.selection?.kind === 'opening' && app.selection.id === o.id}>
        <div class="row">
          <button class="item" onclick={() => select({ kind: 'opening', id: o.id })}>
            {o.kind === 'window' ? 'Window' : 'Door'} {o.id}
          </button>
          <button
            class:primary={o.open}
            onclick={() => updateOpening(o.id, { open: !o.open })}
            aria-pressed={o.open}
          >
            {o.open ? 'Open' : 'Closed'}
          </button>
          <button onclick={() => removeOpening(o.id)} aria-label="Remove opening {o.id}">×</button>
        </div>
        {#if o.kind === 'window'}<label>Solar transmittance<input type="number" min="0" max="1" step="0.05" value={o.solarTransmittance ?? 0.6} onchange={(e) => updateOpening(o.id, { solarTransmittance: e.currentTarget.valueAsNumber })} /></label>{/if}
        <label>
          Wall
          <select
            value={o.wallIndex ?? 0}
            onchange={(e) => {
              const wall = roomWalls[Number(e.currentTarget.value)];
              if (wall) updateOpening(o.id, { wallIndex: wall.index, side: wall.side ?? 'top' });
            }}
          >
            {#each roomWalls as wall}<option value={wall.index}>{wall.side ? wall.side[0].toUpperCase() + wall.side.slice(1) : `Wall ${wall.index + 1}`}</option>{/each}
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
          <span>Opening height <output>{o.heightM.toFixed(1)} m</output></span>
          <input type="range" min="0.3" max={app.room.ceilingM} step="0.1" value={o.heightM}
            oninput={(e) => updateOpening(o.id, { heightM: e.currentTarget.valueAsNumber })} />
        </label>
        <label>
          <span>Sill above floor <output>{o.sillM.toFixed(1)} m</output></span>
          <input type="range" min="0" max={app.room.ceilingM - o.heightM} step="0.1" value={o.sillM}
            oninput={(e) => updateOpening(o.id, { sillM: e.currentTarget.valueAsNumber })} />
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
    <p class="hint">Windows and doors can sit in any vertical wall. Click one on the wall to open or close it. Open ones lose a lot of heat.</p>
  </fieldset>
</div>
<div class="inspector-content" id="panel-Climate" role="tabpanel" aria-labelledby="tab-Climate" tabindex="0" hidden={active !== 'Climate'}>
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
      When enabled, all heat sources run at their set power until the configured sensor reaches target + half the deadband, then pause until it falls below target − half the deadband. Cooling sources remain manual.
    </p>
  </fieldset>
<fieldset><legend>Outdoor temperature</legend>    <label>
      <span>Outside temperature <output>{app.room.outsideC.toFixed(0)} °C</output></span>
      <input
        type="range"
        min={LIMITS.outside.min}
        max={LIMITS.outside.max}
        step={LIMITS.outside.step}
        value={app.room.outsideC}
        oninput={(e) => updateRoom({ outsideC: e.currentTarget.valueAsNumber })}
      />
    </label></fieldset>
<PhysicsPanel />
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
    <p class="hint">Wall U-value <output>{wallUValue.toFixed(2)} W/m²K</output> (lower is better). The floor has its own construction in Physical model.</p>
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
</div>
<div class="inspector-content" id="panel-Display" role="tabpanel" aria-labelledby="tab-Display" tabindex="0" hidden={active !== 'Display'}>
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
      <input type="checkbox" bind:checked={app.showTemperatureGradient} />
      Show temperature gradient
    </label>
    <label>
      <span>Gradient opacity <output>{gradientOpacityLabel()}</output></span>
      <input type="range" min="0" max="1" step="0.01" bind:value={app.gradientOpacity} disabled={!app.showTemperatureGradient} />
    </label>
    <label>
      View
      <select bind:value={app.view}>
        <option value="volume">3D temperature volume</option>
        <option value="slice">Temperature slice</option>
      </select>
    </label>
    {#if app.view === 'slice'}
      <label>
        Slice orientation
        <select bind:value={app.sliceAxis}>
          <option value="z">Horizontal (Z · height)</option>
          <option value="y">Vertical (Y · length)</option>
          <option value="x">Vertical (X · width)</option>
        </select>
      </label>
      <label>
        <span>Slice position <output>{(app.sliceFraction * sliceLength).toFixed(1)} m</output></span>
        <input type="range" min="0" max="1" step="0.01" bind:value={app.sliceFraction} />
      </label>
    {/if}
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
    <label class="check">
      <input type="checkbox" bind:checked={app.showFps} />
      Show framerate
    </label>
    {#if app.room.convection || fanRunning}
      <label class="check">
        <input type="checkbox" bind:checked={app.showAirflow} />
        Show airflow trails
      </label>
      {#if app.room.convection}<p class="hint">Warm air rises and circulates through the 3D room. Toggling convection restarts the simulation.</p>{/if}
    {:else}
      <p class="hint">Heat clouds show the air temperature throughout the room. Enable air currents or add a ceiling fan to see airflow trails.</p>
    {/if}
  </fieldset>
</div>
<div class="inspector-content" id="panel-Results" role="tabpanel" aria-labelledby="tab-Results" tabindex="0" hidden={active !== 'Results'}>
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
  <fieldset id="inspect-probe">
    <legend>Temperature graph</legend>
    <div class="row">
      <button onclick={addProbe} disabled={app.room.probes.length >= LIMITS.probes}>+ Probe</button>
      {#each app.room.probes as p (p.id)}
        <button onclick={() => removeProbe(p.id)} aria-label="Remove probe {p.id}">✕ {p.id}</button>
      {/each}
    </div>
    {#if selectedProbe}
      <p class="hint">Probe {selectedProbe.id} position</p>
      {@render positionControls(selectedProbe, 'probe')}
    {/if}
    <Graph />
    <p class="hint">Select a numbered probe to set its 3D position. Arrow keys move markers; Page Up/Down changes height.</p>
  </fieldset>
<PhysicsPanel section="diagnostics" />
</div>
</aside>
<style>

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    overflow: hidden;
    min-height: 0;
    min-width: 0;
    background: var(--surface);
    border-left: 1px solid var(--border);
    position: relative;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .row > button:not(.primary) {
    flex: 0 0 auto;
  }

  .stats {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0;
    font-size: 13px;
  }
  .stats dt {
    color: var(--muted);
  }
  .stats dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .thermostat-state {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
    padding: 7px 9px;
    border-radius: 6px;
    background: #262a35;
    color: var(--muted);
    font-size: 12px;
  }
  .thermostat-state strong {
    color: #d1d5df;
  }
  .thermostat-state.heating {
    color: var(--accent);
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
  .dot.fan {
    background: #9bc8ec;
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

.inspector-heading { display:flex; justify-content:space-between; align-items:center; padding:22px 20px 18px; color:var(--muted); font-size:10px; letter-spacing:1.5px; }
.inspector-badge { border:1px solid var(--border); border-radius:4px; padding:3px 5px; color:var(--accent); }
.tabs { display:grid; grid-template-columns:repeat(4,1fr); padding:0 16px; border-bottom:1px solid var(--border); }
.tabs button { border:0; border-radius:0; background:transparent; color:var(--muted); font-size:12px; padding:12px 4px; border-bottom:2px solid transparent; }
.tabs button[aria-selected='true'] { border-bottom-color:var(--accent); color:var(--text); }
.inspector-content { overflow-y:auto; min-height:0; padding:20px 16px; display:flex; flex-direction:column; gap:20px; }
.inspector-content[hidden] { display:none; }
</style>
