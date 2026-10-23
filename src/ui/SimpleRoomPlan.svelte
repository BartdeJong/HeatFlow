<script lang="ts">
  import { app, updateRoom } from '../state/app.svelte';
  import { LIMITS } from '../sim/config';
  import FloorplanEditor from './FloorplanEditor.svelte';
</script>

<fieldset>
  <legend>Room size</legend>
  <label>
    <span>Width <output>{app.room.widthM.toFixed(1)} m</output></span>
    <input type="range" min={LIMITS.size.min} max={LIMITS.size.max} step={LIMITS.size.step}
      value={app.room.widthM} oninput={(event) => updateRoom({ widthM: event.currentTarget.valueAsNumber })} />
  </label>
  <label>
    <span>Length <output>{app.room.heightM.toFixed(1)} m</output></span>
    <input type="range" min={LIMITS.size.min} max={LIMITS.size.max} step={LIMITS.size.step}
      value={app.room.heightM} oninput={(event) => updateRoom({ heightM: event.currentTarget.valueAsNumber })} />
  </label>
  <label>
    <span>Ceiling height <output>{app.room.ceilingM.toFixed(1)} m</output></span>
    <input type="range" min={LIMITS.size.min} max={LIMITS.size.max} step={LIMITS.size.step}
      value={app.room.ceilingM} oninput={(event) => updateRoom({ ceilingM: event.currentTarget.valueAsNumber })} />
  </label>
  <p class="hint">Changing the room size restarts the simulation. Drag the floorplan walls below to reshape the room.</p>
</fieldset>

<FloorplanEditor />
