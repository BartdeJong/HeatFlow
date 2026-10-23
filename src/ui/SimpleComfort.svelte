<script lang="ts">
  import { app, updateInsulationLevel, updateRoom, updateThermostat } from '../state/app.svelte';
  import { LIMITS } from '../sim/config';
  import { INSULATION_LEVELS, isInsulationLevel, matchingInsulationLevel } from '../sim/insulation';

  const insulationLevel = $derived(matchingInsulationLevel(app.room));

  function chooseInsulationLevel(value: string) {
    if (isInsulationLevel(value)) updateInsulationLevel(value);
  }
</script>

<fieldset>
  <legend>Heating</legend>
  <label class="check">
    <input type="checkbox" checked={app.room.thermostat.enabled}
      onchange={(event) => updateThermostat({ enabled: event.currentTarget.checked })} />
    Automatic heating
  </label>
  <label>
    <span>Target temperature <output>{app.room.thermostat.targetC.toFixed(1)} °C</output></span>
    <input type="range" min={LIMITS.thermostatTarget.min} max={LIMITS.thermostatTarget.max}
      step={LIMITS.thermostatTarget.step} value={app.room.thermostat.targetC}
      oninput={(event) => updateThermostat({ targetC: event.currentTarget.valueAsNumber })} />
  </label>
</fieldset>

<fieldset>
  <legend>Outside temperature</legend>
  <label>
    <span>Outdoor air <output>{app.room.outsideC.toFixed(0)} °C</output></span>
    <input type="range" min={LIMITS.outside.min} max={LIMITS.outside.max} step={LIMITS.outside.step}
      value={app.room.outsideC} oninput={(event) => updateRoom({ outsideC: event.currentTarget.valueAsNumber })} />
  </label>
</fieldset>

<fieldset>
  <legend>Heating method</legend>
  <label>
    How heat is delivered
    <select value={app.room.heatingMode}
      onchange={(event) => updateRoom({ heatingMode: event.currentTarget.value as typeof app.room.heatingMode })}>
      <option value="point">Individual heaters</option>
      <option value="underfloor">Underfloor heating</option>
    </select>
  </label>
</fieldset>

<fieldset>
  <legend>Insulation level</legend>
  <label>
    General insulation
    <select value={insulationLevel ?? 'custom'} onchange={(event) => chooseInsulationLevel(event.currentTarget.value)}>
      {#if !insulationLevel}<option value="custom" disabled>Custom / mixed levels</option>{/if}
      {#each INSULATION_LEVELS as level}
        <option value={level.id}>
          {level.label} · {level.wallM * 100} / {level.roofM * 100} / {level.floorM * 100} cm
        </option>
      {/each}
    </select>
  </label>
  <p class="hint">Thicknesses are listed as wall / roof / floor. Existing insulation materials are preserved.</p>
</fieldset>

<fieldset>
  <legend>Air circulation</legend>
  <p class="simple-air-status"><span aria-hidden="true"></span>Always on in Simple view</p>
  <p class="hint">Air circulation stays on when you return to Advanced view.</p>
</fieldset>

<style>
  .check { flex-direction:row; align-items:center; gap:8px; }
  .check input[type='checkbox'] { margin:0; flex:none; }
  .simple-air-status { display:flex; align-items:center; gap:8px; margin:0; font-size:13px; }
  .simple-air-status span { width:8px; height:8px; border-radius:50%; background:#78cfaa; box-shadow:0 0 8px #78cfaa66; }
</style>
