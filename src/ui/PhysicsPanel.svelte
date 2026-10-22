<script lang="ts">
  import { app, updateModel, updateSource, updateThermostat, updateOpening, furnitureWarnings } from '../state/app.svelte';
  import { DEFAULT_FLOOR_LAYERS, emitterPreset, floorLayers, getModel, roofLayers, wallLayers, type EmitterConfig, type EnvironmentConfig, type ModelConfig, type SensorConfig, type ThermalLayer } from '../sim/model';
  const model = $derived(getModel(app.room));
  const source = $derived(app.selection?.kind === 'source' ? app.room.sources.find((s) => s.id === app.selection!.id) : undefined);
  const opening = $derived(app.selection?.kind === 'opening' ? app.room.openings.find((o) => o.id === app.selection!.id) : undefined);
  const sensor = $derived(app.room.thermostat.sensor ?? { mode: 'average' as const, x: app.room.widthM / 2, y: app.room.heightM / 2, z: 1.1, lagSeconds: 0 });
  const warnings = $derived(furnitureWarnings(app.room));
  function environment(patch: Partial<EnvironmentConfig>) { updateModel({ environment: { ...model.environment, ...patch } }); }
  function sensing(patch: Partial<SensorConfig>) { updateThermostat({ sensor: { ...sensor, ...patch } }); }
  function layerList(kind: 'wall' | 'roof' | 'floor'): ThermalLayer[] {
    return kind === 'wall' ? wallLayers(app.room) : kind === 'roof' ? roofLayers(app.room) : floorLayers(app.room);
  }
  function layers(kind: 'wall' | 'roof' | 'floor', list: ThermalLayer[]) {
    if (kind === 'floor') updateModel({ floor: { ...model.floor, layers: list } });
    else updateModel({ [kind === 'wall' ? 'wallLayers' : 'roofLayers']: list });
  }
  function changeLayer(kind: 'wall' | 'roof' | 'floor', index: number, patch: Partial<ThermalLayer>) {
    layers(kind, layerList(kind).map((l, i) => i === index ? { ...l, ...patch } : l));
  }
  function emitter(patch: Partial<EmitterConfig>) {
    if (source) updateSource(source.id, { emitter: { ...(source.emitter ?? emitterPreset('ideal')), ...patch } });
  }
  function floorPreset(name: string) {
    if (name === 'ground') updateModel({ floor: { boundary: 'ground', temperatureC: 10, layers: structuredClone(DEFAULT_FLOOR_LAYERS) } });
    else if (name === 'adjacent') updateModel({ floor: { boundary: 'adjacent', temperatureC: 20, layers: DEFAULT_FLOOR_LAYERS.slice(0, 2).map((l) => ({ ...l })) } });
    else updateModel({ floor: { ...model.floor, boundary: 'outside' } });
  }
</script>

<fieldset>
  <legend>Physical model</legend>
  <label>Resolution
    <select value={model.quality} onchange={(e) => updateModel({ quality: e.currentTarget.value as ModelConfig['quality'] })}>
      <option value="fast">Fast · 8 cells · for 300×</option>
      <option value="coarse">Coarse · 24 cells</option><option value="balanced">Balanced · 32 cells</option><option value="fine">Fine · 48 cells</option>
    </select>
  </label>
  {#if model.quality === 'fast'}
    <p class="hint">Fast mode uses a coarse airflow and temperature grid for accelerated runs. Local plumes and small temperature differences need a detailed mode. Changing resolution restarts the run.</p>
  {/if}
  <label>Floor preset
    <select value={model.floor.boundary} onchange={(e) => floorPreset(e.currentTarget.value)}>
      <option value="ground">Ground floor · 10 °C ground</option><option value="adjacent">Above heated room · 20 °C</option><option value="outside">Exposed floor · outdoor air</option>
    </select>
  </label>
  <label>Outdoor conditions
    <select value={model.environment.preset} onchange={(e) => environment({ preset: e.currentTarget.value as EnvironmentConfig['preset'] })}>
      <option value="constant">Constant conditions</option><option value="clear-day">Synthetic clear day</option><option value="cold-day">Synthetic cold day</option>
    </select>
  </label>
  <label class="check"><input type="checkbox" checked={model.radiation} onchange={(e) => updateModel({ radiation: e.currentTarget.checked })} />Surface thermal radiation</label>
  <p class="hint">Surfaces and furniture store heat. Floor heating warms the slab before the room. Daily presets repeat deterministically; they are synthetic weather.</p>
  {#if app.placementMessage || warnings.length}<p class="warning" role="status">{app.placementMessage || warnings.join(' ')}</p>{/if}
  <details>
    <summary>Advanced physics</summary>
    <div class="controls">
      <label>Envelope leakage at 4 Pa (air changes/hour)<input type="number" min="0" max="10" step="0.05" value={model.leakageACH} onchange={(e) => updateModel({ leakageACH: e.currentTarget.valueAsNumber })} /></label>
      {#if model.floor.boundary !== 'outside'}<label>Floor boundary (°C)<input type="number" min="-50" max="60" step="1" value={model.floor.temperatureC} onchange={(e) => updateModel({ floor: { ...model.floor, temperatureC: e.currentTarget.valueAsNumber } })} /></label>{/if}
      <label>Thermostat sensing
        <select value={sensor.mode} onchange={(e) => sensing({ mode: e.currentTarget.value as SensorConfig['mode'] })}>
          <option value="point">Point sensor</option><option value="average">Room average</option>
        </select>
      </label>
      {#if sensor.mode === 'point'}
        {#each [{ key: 'x' as const, max: app.room.widthM }, { key: 'y' as const, max: app.room.heightM }, { key: 'z' as const, max: app.room.ceilingM }] as axis}
          <label>Sensor {axis.key.toUpperCase()} (m)<input type="number" min="0" max={axis.max} step="0.1" value={sensor[axis.key]} onchange={(e) => sensing({ [axis.key]: e.currentTarget.valueAsNumber })} /></label>
        {/each}
      {/if}
      <label>Sensor response lag (s)<input type="number" min="0" max="3600" step="5" value={sensor.lagSeconds} onchange={(e) => sensing({ lagSeconds: e.currentTarget.valueAsNumber })} /></label>
      {#each [
        { key: 'windMps' as const, label: 'Wind speed (m/s)', min: 0, max: 40, step: 0.5 },
        { key: 'windDirectionDeg' as const, label: 'Wind from (° clockwise from north)', min: 0, max: 360, step: 5 },
        { key: 'orientationDeg' as const, label: 'Room orientation (° clockwise from north)', min: 0, max: 360, step: 5 },
        { key: 'startHour' as const, label: 'Starting hour', min: 0, max: 24, step: 0.5 },
        { key: 'solarWm2' as const, label: 'Direct solar irradiance (W/m²)', min: 0, max: 1400, step: 10 },
        { key: 'diffuseWm2' as const, label: 'Diffuse solar irradiance (W/m²)', min: 0, max: 600, step: 10 },
        { key: 'sunElevationDeg' as const, label: 'Sun elevation (°)', min: -90, max: 90, step: 5 },
        { key: 'sunAzimuthDeg' as const, label: 'Sun azimuth (° clockwise from north)', min: 0, max: 360, step: 5 },
        { key: 'skyOffsetC' as const, label: 'Sky cooling below outdoor air (°C)', min: 0, max: 40, step: 1 },
      ] as input}
        <label>{input.label}<input type="number" min={input.min} max={input.max} step={input.step} value={model.environment[input.key]} onchange={(e) => environment({ [input.key]: e.currentTarget.valueAsNumber })} /></label>
      {/each}
      <p class="hint">Irradiance and sun angles apply to constant conditions. Daily presets calculate the sun and weather from the starting hour. North is the back wall when orientation is 0°.</p>
      {#each ['wall', 'roof', 'floor'] as kind}
        {@const key = kind as 'wall' | 'roof' | 'floor'}
        <details class="layers">
          <summary>{kind === 'roof' ? 'Ceiling' : kind === 'wall' ? 'Wall' : 'Floor'} construction layers</summary>
          <p class="hint">Inside to outside. Layer properties exclude surface film resistance.</p>
          {#each layerList(key) as layer, index}
            <div class="layer">
              <label>Layer name<input type="text" maxlength="60" value={layer.label} onchange={(e) => changeLayer(key, index, { label: e.currentTarget.value })} /></label>
              {#each [{ key: 'thicknessM' as const, label: 'Thickness (m)', min: 0.001, max: 2, step: 0.001 },
                { key: 'k' as const, label: 'Conductivity (W/mK)', min: 0.005, max: 400, step: 0.01 },
                { key: 'density' as const, label: 'Density (kg/m³)', min: 1, max: 23000, step: 10 },
                { key: 'cp' as const, label: 'Specific heat (J/kgK)', min: 100, max: 5000, step: 10 }] as input}
                <label>{input.label}<input type="number" min={input.min} max={input.max} step={input.step} value={layer[input.key]} onchange={(e) => changeLayer(key, index, { [input.key]: e.currentTarget.valueAsNumber })} /></label>
              {/each}
              <button disabled={layerList(key).length <= 1} onclick={() => layers(key, layerList(key).filter((_, i) => i !== index))}>Remove layer</button>
            </div>
          {/each}
          <button disabled={layerList(key).length >= 12} onclick={() => layers(key, [...layerList(key), { label: 'New layer', thicknessM: 0.1, k: 0.04, density: 40, cp: 1400 }])}>+ Layer</button>
          {#if key !== 'floor'}<button onclick={() => updateModel(key === 'wall' ? { wallLayers: undefined } : { roofLayers: undefined })}>Use material presets</button>{/if}
        </details>
      {/each}
      <p class="hint">Custom wall/ceiling layers override the material sliders. The illustrated pitched roof sits above the ceiling; no attic air is simulated. Resolution changes restart the simulation.</p>
    </div>
  </details>
  {#if source?.kind === 'heat'}
    <details open>
      <summary>Emitter · source {source.id}</summary>
      <div class="controls">
        <label>Emitter type<select value={source.emitter?.kind ?? 'ideal'} onchange={(e) => updateSource(source.id, { emitter: emitterPreset(e.currentTarget.value as EmitterConfig['kind']) })}>
          <option value="radiator">Radiator</option><option value="convector">Convector</option><option value="ideal">Ideal air source</option>
        </select></label>
        {#if source.emitter && source.emitter.kind !== 'ideal'}
          {#each [{ key: 'widthM' as const, label: 'Width (m)', min: 0.05, max: 4, step: 0.05 },
            { key: 'heightM' as const, label: 'Height (m)', min: 0.05, max: 3, step: 0.05 },
            { key: 'depthM' as const, label: 'Depth (m)', min: 0.02, max: 1, step: 0.01 },
            { key: 'capacityJPerK' as const, label: 'Heat capacity (J/K)', min: 1, max: 1000000, step: 1000 },
            { key: 'emissivity' as const, label: 'Emissivity', min: 0, max: 1, step: 0.05 }] as input}
            <label>{input.label}<input type="number" min={input.min} max={input.max} step={input.step} value={source.emitter[input.key]} onchange={(e) => emitter({ [input.key]: e.currentTarget.valueAsNumber })} /></label>
          {/each}
        {/if}
      </div>
    </details>
  {/if}
  {#if opening?.kind === 'window'}
    <label>Window solar transmittance<input type="number" min="0" max="1" step="0.05" value={opening.solarTransmittance ?? 0.6} onchange={(e) => updateOpening(opening.id, { solarTransmittance: e.currentTarget.valueAsNumber })} /></label>
  {/if}

  {#if app.stats.diagnostics.failure}<p class="warning" role="alert">Simulation paused: {app.stats.diagnostics.failure}</p>{/if}
  <dl class="readings">
    <dt>Thermostat sensor</dt><dd>{app.stats.diagnostics.sensorC.toFixed(1)} °C</dd>
    <dt>Stored heat (0 °C reference)</dt><dd>{(app.stats.diagnostics.storedEnergyJ / 3_600_000).toFixed(2)} kWh</dd>
    <dt>Energy balance error</dt><dd>{(app.stats.diagnostics.relativeEnergyError * 100).toPrecision(2)}%</dd>
    <dt>Ventilation</dt><dd>{app.stats.diagnostics.ventilationACH.toFixed(2)} ACH</dd>
    <dt>Ventilation heat loss</dt><dd>{app.stats.heatLoss.ventilationW.toFixed(0)} W</dd>
    <dt>Solar heat gain</dt><dd>{app.stats.diagnostics.solarW.toFixed(0)} W</dd>
    <dt>Current outdoor air</dt><dd>{app.stats.diagnostics.outsideC.toFixed(1)} °C</dd>
  </dl>
  <details>
    <summary>Surface temperatures and solver checks</summary>
    <p class="hint">Rendering {app.stats.renderFPS.toFixed(0)} FPS · numerical checks describe solver convergence.</p>
    <dl class="readings">
      <dt>Pressure residual</dt><dd>{app.stats.diagnostics.pressureResidual.toExponential(2)}</dd>
      <dt>Maximum divergence</dt><dd>{app.stats.diagnostics.maxDivergence.toExponential(2)} s⁻¹</dd>
      <dt>Pressure iterations</dt><dd>{app.stats.diagnostics.iterations}</dd>
      {#each app.stats.diagnostics.surfaceTemperatures as surface (surface.id)}<dt>{surface.label}</dt><dd>{surface.temperatureC.toFixed(1)} °C</dd>{/each}
    </dl>
    <p class="hint">Stored energy uses a fixed 0 °C reference, including air, construction, furniture and emitters.</p>
  </details>
  <p class="hint">Older links retain their room settings. Predictions change with the new physics. Browser airflow is an approximation; compare resolutions for your room.</p>
</fieldset>

<style>
  fieldset { margin: 0; padding: 10px 12px 12px; border: 1px solid #343845; border-radius: 8px; display: flex; flex-direction: column; gap: 10px; }
  legend { padding: 0 6px; color: #9aa3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  input, select, button { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid #3d4254; background: #262a35; color: inherit; min-width: 0; max-width: 100%; box-sizing: border-box; }
  button, select { min-height: 36px; } button, summary { cursor: pointer; } button:disabled { opacity: .5; cursor: default; }
  .check { flex-direction: row; gap: 8px; align-items: center; }
  .controls { display: flex; flex-direction: column; gap: 10px; padding-top: 10px; }
  .hint { color: #929bb1; font-size: 12px; margin: 0; }
  .readings { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; font-size: 12px; margin: 6px 0; }
  .readings dt { color: #9aa3b8; } .readings dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .warning { color: #ffbe83; font-size: 12px; margin: 0; }
  summary { font-size: 13px; color: #bcc7dd; } .layers { border-top: 1px solid #343845; padding-top: 10px; }
  .layer { display: flex; flex-direction: column; gap: 6px; padding: 8px; margin: 8px 0; background: #222630; border-radius: 5px; }
</style>
