<script lang="ts">
  import { app, addFurniture, removeFurniture, select, updateFurniture } from '../state/app.svelte';
  import { FURNITURE_PRESETS, FURNITURE_MATERIALS, LIMITS, type FurnitureMaterial } from '../sim/config';
  import { furnitureExtent } from '../sim/furniture';

  const selected = $derived(app.selection?.kind === 'furniture' ? app.room.furniture.find((f) => f.id === app.selection!.id) : undefined);
  const extent = $derived(selected ? furnitureExtent(selected) : [0, 0]);
  const temperature = $derived(selected ? app.furnitureTemperatures[selected.id] : undefined);
</script>

<fieldset>
  <legend>Furniture</legend>
  <div class="presets">
    {#each FURNITURE_PRESETS as p}
      <button onclick={() => addFurniture(p.id)} disabled={app.room.furniture.length >= LIMITS.furniture}>+ {p.label}</button>
    {/each}
  </div>
  <ul>
    {#each app.room.furniture as f (f.id)}
      <li>
        <button class="item" class:selected={app.selection?.kind === 'furniture' && app.selection.id === f.id}
          onclick={() => select({ kind: 'furniture', id: f.id })}>
          {FURNITURE_PRESETS.find((p) => p.id === f.kind)?.label} {f.id}
          <span>{f.widthM.toFixed(1)} × {f.depthM.toFixed(1)} × {f.heightM.toFixed(1)} m</span>
        </button>
        <button onclick={() => removeFurniture(f.id)} aria-label="Remove furniture {f.id}">✕</button>
      </li>
    {/each}
  </ul>
  {#if selected}
    <label>
      Furniture material
      <select value={selected.material} onchange={(e) => updateFurniture(selected.id, { material: e.currentTarget.value as FurnitureMaterial })}>
        {#each FURNITURE_MATERIALS as m}<option value={m.id}>{m.label}</option>{/each}
      </select>
    </label>
    {#each [{ key: 'x' as const, label: 'Furniture X', min: extent[0] / 2, max: app.room.widthM - extent[0] / 2 },
      { key: 'y' as const, label: 'Furniture Y', min: extent[1] / 2, max: app.room.heightM - extent[1] / 2 },
      { key: 'widthM' as const, label: 'Furniture width', min: 0.4, max: selected.rotation === 90 ? app.room.heightM : app.room.widthM },
      { key: 'depthM' as const, label: 'Furniture depth', min: 0.4, max: selected.rotation === 90 ? app.room.widthM : app.room.heightM },
      { key: 'heightM' as const, label: 'Furniture height', min: 0.4, max: app.room.ceilingM }] as control}
      <label>
        <span>{control.label}<output>{selected[control.key].toFixed(1)} m</output></span>
        <input type="range" aria-label={control.label} min={control.min} max={control.max} step="0.1" value={selected[control.key]}
          oninput={(e) => updateFurniture(selected.id, { [control.key]: e.currentTarget.valueAsNumber })} />
      </label>
    {/each}
    <button onclick={() => updateFurniture(selected.id, { rotation: selected.rotation === 0 ? 90 : 0 })}>↻ Rotate 90° <span>({selected.rotation}°)</span></button>
    {#if temperature !== undefined}
      <p class="temperature">Furniture temperature <output>{temperature.toFixed(1)} °C</output></p>
    {/if}
  {/if}
  <p class="hint">Drag furniture in the room to move it. Solid parts redirect air and store heat; gaps under tables remain open. Changing furniture restarts the simulation.</p>
</fieldset>

<style>

  .presets { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

  button { cursor: pointer; }
  button:hover:not(:disabled) { background: #30364a; }
  button:disabled { opacity: 0.5; cursor: default; }
  button.selected { border-color: #f0b77c; background: #3b3028; }
  button:focus-visible { outline: 2px solid #89c8ff; outline-offset: 3px; }
  button > span { color: #a3aabc; font-size: 11px; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; }
  li { display: flex; gap: 6px; }
  .item { flex: 1; text-align: left; }
  .item span { display: block; margin-top: 3px; }

  .temperature { margin: 0; font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; }
</style>
