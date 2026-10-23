<script lang="ts">
  import { app, updateFootprint } from '../state/app.svelte';
  import { isValidFootprint, roomFootprint, type FootprintPoint } from '../sim/footprint';

  let draft = $state('');
  let applied = '';
  let message = $state('');
  let selectedWall = $state(-1);
  let drag: { pointerId: number; wallIndex: number; start: FootprintPoint; original: FootprintPoint[]; moved: boolean } | null = null;
  let outlineSvg: SVGSVGElement;

  $effect(() => {
    const room = app.room;
    const value = roomFootprint(room).map((point) => `${point.x}, ${point.y}`).join('\n');
    if (value !== applied) {
      draft = value;
      applied = value;
      message = '';
      selectedWall = -1;
    }
  });

  function parse(): FootprintPoint[] | null {
    const rows = draft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const points: FootprintPoint[] = [];
    for (const line of rows) {
      const values = line.split(/[,\s]+/).map(Number);
      if (values.length !== 2 || !values.every(Number.isFinite)) return null;
      points.push({ x: values[0], y: values[1] });
    }
    return points;
  }

  function editorPoints(): FootprintPoint[] {
    const points = parse();
    return points && points.length >= 3 ? points : roomFootprint(app.room);
  }

  function pointText(points: FootprintPoint[]): string {
    return points.map((point) => `${point.x}, ${point.y}`).join('\n');
  }

  function applyPoints(points: FootprintPoint[]) {
    if (!isValidFootprint(points, app.room.widthM, app.room.heightM)) {
      message = 'That change would make the outline invalid. Keep straight, non-crossing walls inside the room bounds.';
      return false;
    }
    if (!updateFootprint(points)) {
      message = app.placementMessage;
      return false;
    }
    applied = pointText(points);
    draft = applied;
    message = 'Floorplan updated.';
    return true;
  }

  function apply() {
    const points = parse();
    if (!points || !isValidFootprint(points, app.room.widthM, app.room.heightM)) {
      message = 'Use 4–32 valid points inside the room bounds. Connect them in order with horizontal or vertical edges; the outline must not cross itself.';
      return;
    }
    applyPoints(points);
  }

  function useRectangle() {
    applyPoints([
      { x: 0, y: 0 }, { x: app.room.widthM, y: 0 },
      { x: app.room.widthM, y: app.room.heightM }, { x: 0, y: app.room.heightM },
    ]);
  }

  const editorScale = $derived(Math.min(96 / app.room.widthM, 96 / app.room.heightM));
  const editorOffsetX = $derived((120 - app.room.widthM * editorScale) / 2);
  const editorOffsetY = $derived((120 - app.room.heightM * editorScale) / 2);
  const points = $derived(editorPoints());
  function svgX(x: number) { return editorOffsetX + x * editorScale; }
  function svgY(y: number) { return editorOffsetY + y * editorScale; }
  function wallLabel(points: FootprintPoint[], index: number): string {
    const a = points[index], b = points[(index + 1) % points.length];
    const direction = a.y === b.y ? 'horizontal' : 'vertical';
    return `Wall ${index + 1} · ${direction} · ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(1)} m`;
  }
  function svgPoint(event: PointerEvent): FootprintPoint {
    const bounds = outlineSvg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * 120;
    const y = (event.clientY - bounds.top) / bounds.height * 120;
    return { x: (x - editorOffsetX) / editorScale, y: (y - editorOffsetY) / editorScale };
  }

  function startDrag(event: PointerEvent, wallIndex: number) {
    if (event.button !== 0) return;
    const points = editorPoints();
    if (wallIndex >= points.length) return;
    selectedWall = wallIndex;
    outlineSvg.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, wallIndex, start: svgPoint(event), original: points.map((point) => ({ ...point })), moved: false };
    message = 'Drag the selected wall to move it.';
  }

  function moveWall(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const points = drag.original.map((point) => ({ ...point }));
    const a = points[drag.wallIndex], b = points[(drag.wallIndex + 1) % points.length];
    const current = svgPoint(event);
    const horizontal = a.y === b.y;
    const delta = horizontal ? current.y - drag.start.y : current.x - drag.start.x;
    if (Math.abs(delta) < 0.01) return;
    drag.moved = true;
    if (horizontal) {
      a.y += delta;
      b.y += delta;
    } else {
      a.x += delta;
      b.x += delta;
    }
    if (isValidFootprint(points, app.room.widthM, app.room.heightM)) {
      draft = pointText(points);
      message = 'Release to apply the wall position.';
    } else {
      message = 'This wall cannot move there; the outline must remain valid and inside the room.';
    }
  }

  function finishDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasMoved = drag.moved;
    drag = null;
    if (wasMoved) {
      const points = parse();
      if (points) applyPoints(points);
    } else {
      message = 'Select a wall segment below, then drag it to move it.';
    }
  }

  function addInset() {
    const points = editorPoints();
    const index = selectedWall;
    if (index < 0 || index >= points.length) return;
    const a = points[index], b = points[(index + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1.2) {
      message = 'Select a wall at least 1.2 m long to add an inset.';
      return;
    }
    let signedArea = 0;
    for (let i = 0; i < points.length; i++) {
      const current = points[i], next = points[(i + 1) % points.length];
      signedArea += current.x * next.y - next.x * current.y;
    }
    const direction = Math.sign(signedArea);
    const horizontal = a.y === b.y;
    const inward = horizontal ? direction * Math.sign(b.x - a.x) : -direction * Math.sign(b.y - a.y);
    const span = length * 0.25;
    const start = horizontal
      ? { x: a.x + (b.x - a.x) * 0.375, y: a.y }
      : { x: a.x, y: a.y + (b.y - a.y) * 0.375 };
    const end = horizontal
      ? { x: a.x + (b.x - a.x) * 0.625, y: a.y }
      : { x: a.x, y: a.y + (b.y - a.y) * 0.625 };
    const maxDepth = Math.min(0.75, app.room.widthM / 6, app.room.heightM / 6);
    for (const depth of [maxDepth, maxDepth * 0.75, maxDepth * 0.5, maxDepth * 0.25]) {
      const first = horizontal ? { x: start.x, y: start.y + inward * depth } : { x: start.x + inward * depth, y: start.y };
      const second = horizontal ? { x: end.x, y: end.y + inward * depth } : { x: end.x + inward * depth, y: end.y };
      const candidate = [
        ...points.slice(0, index + 1),
        start, first, second, end,
        ...points.slice(index + 1),
      ];
      if (isValidFootprint(candidate, app.room.widthM, app.room.heightM)) {
        applyPoints(candidate);
        selectedWall = index + 2;
        return;
      }
    }
    message = 'There is not enough clear room inside this wall to add an inset.';
  }

  function removeInset() {
    const points = editorPoints();
    const index = selectedWall;
    if (index < 0 || points.length < 8) return;
    const count = points.length;
    const rotated = Array.from({ length: count }, (_, offset) => points[(index - 2 + offset + count) % count]);
    const [outsideStart, stepStart, insetStart, insetEnd, stepEnd, outsideEnd] = rotated;
    const horizontalBase = insetStart.y === insetEnd.y;
    const isInset = horizontalBase
      ? stepStart.y === outsideStart.y && stepEnd.y === outsideEnd.y &&
        stepStart.x === insetStart.x && stepEnd.x === insetEnd.x &&
        outsideStart.y === outsideEnd.y
      : stepStart.x === outsideStart.x && stepEnd.x === outsideEnd.x &&
        stepStart.y === insetStart.y && stepEnd.y === insetEnd.y &&
        outsideStart.x === outsideEnd.x;
    if (!isInset) {
      message = 'Select the short inner wall of an inset to remove it.';
      return;
    }
    const candidate = [outsideStart, outsideEnd, ...rotated.slice(6)];
    if (applyPoints(candidate)) selectedWall = -1;
  }

  function canRemoveInset(): boolean {
    const points = editorPoints();
    if (selectedWall < 0 || points.length < 8) return false;
    const count = points.length;
    const rotated = Array.from({ length: count }, (_, offset) => points[(selectedWall - 2 + offset + count) % count]);
    const [outsideStart, stepStart, insetStart, insetEnd, stepEnd, outsideEnd] = rotated;
    return insetStart.y === insetEnd.y
      ? stepStart.y === outsideStart.y && stepEnd.y === outsideEnd.y &&
        stepStart.x === insetStart.x && stepEnd.x === insetEnd.x && outsideStart.y === outsideEnd.y
      : stepStart.x === outsideStart.x && stepEnd.x === outsideEnd.x &&
        stepStart.y === insetStart.y && stepEnd.y === insetEnd.y && outsideStart.x === outsideEnd.x;
  }
</script>

<fieldset>
  <legend>Floorplan</legend>
  <p class="hint">Select a wall and drag it to reshape the room. Add an inset to create a new 90° step, or remove one by selecting its short inner wall.</p>
  <svg bind:this={outlineSvg} viewBox="0 0 120 120" role="group" aria-label="Interactive floorplan outline"
    onpointermove={moveWall} onpointerup={finishDrag} onpointercancel={finishDrag}>
    <polygon points={points.map((point) => `${svgX(point.x)},${svgY(point.y)}`).join(' ')} />
    {#each points as point, index}
      {@const next = points[(index + 1) % points.length]}
      <line
        class:selected={selectedWall === index}
        x1={svgX(point.x)} y1={svgY(point.y)} x2={svgX(next.x)} y2={svgY(next.y)}
        role="button" tabindex="0" aria-label={wallLabel(points, index)}
        onpointerdown={(event) => startDrag(event, index)}
        onclick={() => selectedWall = index}
        onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectedWall = index; }}
      />
    {/each}
    {#each points as point}
      <circle cx={svgX(point.x)} cy={svgY(point.y)} r="2" />
    {/each}
  </svg>
  <div class="wall-picker" aria-label="Select a wall">
    {#each points as _, index}
      <button class:selected={selectedWall === index} aria-pressed={selectedWall === index} onclick={() => selectedWall = index}>
        {wallLabel(points, index)}
      </button>
    {/each}
  </div>
  <div class="actions">
    <button onclick={addInset} disabled={selectedWall < 0}>Add inset</button>
    <button onclick={removeInset} disabled={!canRemoveInset()}>Remove inset</button>
    <button onclick={useRectangle}>Use rectangle</button>
  </div>
  <label for="floorplan-points">Outline points · metres</label>
  <textarea id="floorplan-points" bind:value={draft} rows="6" spellcheck="false" aria-describedby="floorplan-hint"></textarea>
  <p id="floorplan-hint" class="hint">One X, Y corner per line, in order around the room. Each wall must be straight and at 90°. You can also edit the coordinates and apply them.</p>
  <div class="actions"><button onclick={apply}>Apply coordinates</button></div>
  {#if message}<p class="status" role="status">{message}</p>{/if}
</fieldset>

<style>
  svg {
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-height: 15rem;
    margin: 0.45rem 0;
    border: 1px solid var(--border, #384351);
    border-radius: 0.45rem;
    background: var(--surface, #111820);
    touch-action: none;
  }
  polygon { fill: #65c7a51b; stroke: #65c7a5; stroke-width: 1.2; }
  line { stroke: #aab5c2; stroke-width: 3; cursor: grab; vector-effect: non-scaling-stroke; }
  line:active { cursor: grabbing; }
  line.selected { stroke: #ffb454; stroke-width: 5; }
  circle { fill: #f3f6fa; stroke: #17212d; stroke-width: 1; pointer-events: none; }
  .wall-picker { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.45rem 0; }
  .wall-picker button { padding: 0.3rem 0.45rem; font-size: 0.7rem; }
  .wall-picker button.selected { border-color: #ffb454; color: #ffb454; }
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 7rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border, #384351);
    border-radius: 0.45rem;
    background: var(--surface, #111820);
    color: inherit;
    font: 0.85rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
    resize: vertical;
  }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.55rem; }
  .status { margin: 0.45rem 0 0; color: var(--muted, #aab5c2); font-size: 0.78rem; }
</style>
