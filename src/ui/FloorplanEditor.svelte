<script lang="ts">
  import {
    addInteriorWall,
    addOpening,
    app,
    removeInteriorWall,
    removeOpening,
    select,
    updateFootprint,
    updateInteriorWall,
    updateOpening,
    type FootprintUpdateOptions,
  } from '../state/app.svelte';
  import { LIMITS, type InteriorWall, type Opening } from '../sim/config';
  import {
    footprintContains,
    footprintWalls,
    isValidFootprint,
    roomFootprint,
    simplifyFootprint,
    type FootprintPoint,
  } from '../sim/footprint';
  import { interiorWallPlacementError } from '../sim/interior-walls';

  const MAP_WIDTH = 400;
  const MAP_HEIGHT = 300;
  const SNAP = 0.1;
  const EPSILON = 1e-6;

  type DragState =
    | { kind: 'perimeter'; pointerId: number; index: number; start: FootprintPoint; original: FootprintPoint[] }
    | { kind: 'corner'; pointerId: number; index: number; original: FootprintPoint[] }
    | { kind: 'draw-wall'; pointerId: number; start: FootprintPoint; wall: InteriorWall }
    | { kind: 'move-wall'; pointerId: number; id: number; start: FootprintPoint; original: InteriorWall }
    | { kind: 'resize-wall'; pointerId: number; id: number; endpoint: 'start' | 'end'; original: InteriorWall }
    | { kind: 'move-opening'; pointerId: number; id: number; wallIndex: number; start: FootprintPoint; original: Opening }
    | { kind: 'resize-opening'; pointerId: number; id: number; wallIndex: number; endpoint: 'start' | 'end'; original: Opening };

  let mapSvg: SVGSVGElement;
  let editorDialog: HTMLDialogElement;
  let fullscreen = $state(false);
  let drag = $state<DragState | null>(null);
  let selectedPerimeterWall = $state(-1);
  let selectedInteriorWallId = $state<number | null>(null);
  let selectedOpeningId = $state<number | null>(null);
  let addingInteriorWall = $state(false);
  let footprintPreview = $state<FootprintPoint[] | null>(null);
  let footprintPreviewValid = $state(true);
  let footprintPreviewMessage = $state('');
  let footprintPreviewOptions = $state<FootprintUpdateOptions | undefined>(undefined);
  let interiorWallPreview = $state<InteriorWall | null>(null);
  let interiorWallPreviewValid = $state(true);
  let openingPreview = $state<{ id: number; pos: number; length: number } | null>(null);
  let message = $state('');

  const mapScale = $derived(Math.min(
    (MAP_WIDTH - 80) / Math.max(app.room.widthM, 5),
    (MAP_HEIGHT - 70) / Math.max(app.room.heightM, 5),
  ));
  const mapLeft = $derived((MAP_WIDTH - app.room.widthM * mapScale) / 2);
  const mapTop = $derived((MAP_HEIGHT - app.room.heightM * mapScale) / 2);
  const displayedFootprint = $derived(footprintPreview ?? roomFootprint(app.room));
  const displayedWalls = $derived(footprintWalls({ ...app.room, footprint: displayedFootprint }));
  const minorGrid = $derived(Math.max(1, mapScale * SNAP));
  const majorGrid = $derived(minorGrid * 5);

  function svgX(x: number): number { return mapLeft + x * mapScale; }
  function svgY(y: number): number { return mapTop + y * mapScale; }
  function svgPoint(point: FootprintPoint): string { return `${svgX(point.x)},${svgY(point.y)}`; }

  function worldPoint(event: PointerEvent): FootprintPoint {
    const bounds = mapSvg.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * MAP_WIDTH;
    const y = (event.clientY - bounds.top) / bounds.height * MAP_HEIGHT;
    return { x: (x - mapLeft) / mapScale, y: (y - mapTop) / mapScale };
  }

  function snap(value: number): number {
    return Math.round(value / SNAP) * SNAP;
  }

  function snapPoint(point: FootprintPoint): FootprintPoint {
    return { x: snap(point.x), y: snap(point.y) };
  }

  function snapCornerToExistingPoint(
    point: FootprintPoint,
    original: FootprintPoint[],
    draggedIndex: number,
  ): FootprintPoint {
    let nearest: FootprintPoint | undefined;
    let nearestDistance = SNAP;
    for (let index = 0; index < original.length; index++) {
      if (index === draggedIndex) continue;
      const candidate = original[index];
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (distance <= nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return nearest ? { ...nearest } : snapPoint(point);
  }

  function normalizeFootprint(points: FootprintPoint[]): {
    points: FootprintPoint[];
    widthM: number;
    heightM: number;
    translation: FootprintPoint;
  } {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const translation = { x: -minX, y: -minY };
    return {
      points: points.map((point) => ({ x: point.x + translation.x, y: point.y + translation.y })),
      widthM: maxX - minX,
      heightM: maxY - minY,
      translation,
    };
  }

  function previewFootprint(points: FootprintPoint[]) {
    const simplified = simplifyFootprint(points);
    const normalized = normalizeFootprint(simplified);
    const merged = simplified.length !== points.length;
    const openingAnchors = merged && app.room.openings.length
      ? openingAnchorsForMergedEdges(points, normalized)
      : undefined;
    footprintPreview = normalized.points;
    footprintPreviewOptions = {
      widthM: normalized.widthM,
      heightM: normalized.heightM,
      translation: normalized.translation,
      ...(openingAnchors ? { openingAnchors } : {}),
    };
    footprintPreviewMessage = openingAnchors === null
      ? 'Move or remove an opening on a collapsed wall before merging these points.'
      : '';
    footprintPreviewValid =
      normalized.widthM >= LIMITS.size.min && normalized.widthM <= LIMITS.size.max &&
      normalized.heightM >= LIMITS.size.min && normalized.heightM <= LIMITS.size.max &&
      isValidFootprint(normalized.points, normalized.widthM, normalized.heightM) &&
      openingAnchors !== null;
  }

  function applyFootprint(points: FootprintPoint[], options?: FootprintUpdateOptions): boolean {
    const simplified = simplifyFootprint(points);
    const normalized = normalizeFootprint(simplified);
    const updateOptions = options ?? {
      widthM: normalized.widthM,
      heightM: normalized.heightM,
      translation: normalized.translation,
    };
    if (!isValidFootprint(normalized.points, updateOptions.widthM, updateOptions.heightM)) {
      message = 'Keep the outline orthogonal, non-crossing, and within the allowed room dimensions.';
      return false;
    }
    if (!updateFootprint(normalized.points, updateOptions)) {
      message = app.placementMessage;
      return false;
    }
    footprintPreview = null;
    footprintPreviewOptions = undefined;
    message = 'Floorplan updated.';
    return true;
  }

  function setPointerCapture(event: PointerEvent) {
    event.preventDefault();
    mapSvg.setPointerCapture(event.pointerId);
  }

  function beginPerimeterDrag(event: PointerEvent, index: number) {
    if (event.button !== 0 || addingInteriorWall) return;
    event.stopPropagation();
    setPointerCapture(event);
    selectedPerimeterWall = index;
    selectedInteriorWallId = null;
    selectedOpeningId = null;
    const original = roomFootprint(app.room).map((point) => ({ ...point }));
    drag = { kind: 'perimeter', pointerId: event.pointerId, index, start: worldPoint(event), original };
    message = 'Drag to move this wall. The room outline snaps to 10 cm.';
  }

  function beginCornerDrag(event: PointerEvent, index: number) {
    if (event.button !== 0 || addingInteriorWall) return;
    event.stopPropagation();
    setPointerCapture(event);
    selectedPerimeterWall = -1;
    selectedInteriorWallId = null;
    selectedOpeningId = null;
    drag = { kind: 'corner', pointerId: event.pointerId, index, original: roomFootprint(app.room).map((point) => ({ ...point })) };
    message = 'Drag the corner to reshape both connected walls.';
  }

  function beginInteriorWallDrag(event: PointerEvent, wall: InteriorWall) {
    if (event.button !== 0 || addingInteriorWall) return;
    event.stopPropagation();
    setPointerCapture(event);
    selectedPerimeterWall = -1;
    selectedInteriorWallId = wall.id;
    selectedOpeningId = null;
    const start = worldPoint(event);
    drag = { kind: 'move-wall', pointerId: event.pointerId, id: wall.id, start, original: { ...wall, start: { ...wall.start }, end: { ...wall.end } } };
    message = 'Drag the wall perpendicular to its length. Endpoints can be resized.';
  }

  function beginInteriorWallResize(event: PointerEvent, wall: InteriorWall, endpoint: 'start' | 'end') {
    if (event.button !== 0) return;
    event.stopPropagation();
    setPointerCapture(event);
    selectedInteriorWallId = wall.id;
    drag = { kind: 'resize-wall', pointerId: event.pointerId, id: wall.id, endpoint, original: { ...wall, start: { ...wall.start }, end: { ...wall.end } } };
    message = 'Drag the endpoint to resize the wall.';
  }

  function beginOpeningDrag(event: PointerEvent, opening: Opening, endpoint?: 'start' | 'end') {
    if (event.button !== 0) return;
    event.stopPropagation();
    const wallIndex = opening.wallIndex ?? footprintWalls(app.room).find((wall) => wall.side === opening.side)?.index ?? 0;
    setPointerCapture(event);
    selectedOpeningId = opening.id;
    selectedPerimeterWall = wallIndex;
    selectedInteriorWallId = null;
    select({ kind: 'opening', id: opening.id });
    const original = { ...opening };
    drag = endpoint
      ? { kind: 'resize-opening', pointerId: event.pointerId, id: opening.id, wallIndex, endpoint, original }
      : { kind: 'move-opening', pointerId: event.pointerId, id: opening.id, wallIndex, start: worldPoint(event), original };
    message = endpoint ? 'Drag the opening edge to resize it.' : 'Drag the opening along its wall.';
  }

  function beginWallDrawing(event: PointerEvent) {
    if (!addingInteriorWall || drag || event.button !== 0) return;
    event.preventDefault();
    const start = snapPoint(worldPoint(event));
    if (!footprintContains(app.room, start.x, start.y)) {
      message = 'Start the new wall inside the room outline.';
      return;
    }
    const wall: InteriorWall = {
      id: -1,
      start,
      end: start,
      thicknessM: 0.1,
    };
    setPointerCapture(event);
    drag = { kind: 'draw-wall', pointerId: event.pointerId, start, wall };
    interiorWallPreview = wall;
    interiorWallPreviewValid = false;
    message = 'Drag to draw a straight, free-standing wall.';
  }

  function setInteriorPreview(wall: InteriorWall) {
    interiorWallPreview = wall;
    interiorWallPreviewValid = interiorWallPlacementError(app.room, wall, wall.id < 0 ? undefined : wall.id) === null;
  }

  function movePointer(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = snapPoint(worldPoint(event));
    if (drag.kind === 'perimeter') {
      const points = drag.original.map((point) => ({ ...point }));
      const a = points[drag.index], b = points[(drag.index + 1) % points.length];
      const originalA = drag.original[drag.index];
      const delta = a.y === b.y ? current.y - drag.start.y : current.x - drag.start.x;
      if (a.y === b.y) {
        a.y = snap(originalA.y + delta);
        b.y = a.y;
      } else {
        a.x = snap(originalA.x + delta);
        b.x = a.x;
      }
      previewFootprint(points);
      message = footprintPreviewValid
        ? 'Release to apply the wall position.'
        : footprintPreviewMessage || 'This position would make the room outline invalid.';
      return;
    }
    if (drag.kind === 'corner') {
      const points = drag.original.map((point) => ({ ...point }));
      const previous = (drag.index + points.length - 1) % points.length;
      const next = (drag.index + 1) % points.length;
      const original = drag.original[drag.index];
      const point = snapCornerToExistingPoint(worldPoint(event), drag.original, drag.index);
      points[drag.index] = point;
      if (drag.original[previous].y === original.y) points[previous].y = point.y;
      else points[previous].x = point.x;
      if (drag.original[next].y === original.y) points[next].y = point.y;
      else points[next].x = point.x;
      previewFootprint(points);
      message = footprintPreviewValid
        ? 'Release to apply the new corner.'
        : footprintPreviewMessage || 'This corner position would make the outline invalid.';
      return;
    }
    if (drag.kind === 'draw-wall') {
      const dx = current.x - drag.start.x, dy = current.y - drag.start.y;
      const end = Math.abs(dx) >= Math.abs(dy)
        ? { x: current.x, y: drag.start.y }
        : { x: drag.start.x, y: current.y };
      const wall = { ...drag.wall, end };
      setInteriorPreview(wall);
      message = interiorWallPreviewValid
        ? 'Release to add this 10 cm wall.'
        : interiorWallPlacementError(app.room, wall) ?? 'Choose a longer, free-standing wall position.';
      return;
    }
    if (drag.kind === 'move-wall') {
      const wall = drag.original;
      const horizontal = wall.start.y === wall.end.y;
      const delta = horizontal ? current.y - drag.start.y : current.x - drag.start.x;
      const snappedDelta = snap(delta);
      const candidate = horizontal
        ? { ...wall, start: { x: wall.start.x, y: snap(wall.start.y + snappedDelta) }, end: { x: wall.end.x, y: snap(wall.end.y + snappedDelta) } }
        : { ...wall, start: { x: snap(wall.start.x + snappedDelta), y: wall.start.y }, end: { x: snap(wall.end.x + snappedDelta), y: wall.end.y } };
      setInteriorPreview(candidate);
      message = interiorWallPreviewValid ? 'Release to move the wall.' : interiorWallPlacementError(app.room, candidate, wall.id) ?? 'That wall position is not valid.';
      return;
    }
    if (drag.kind === 'resize-wall') {
      const wall = drag.original;
      const point = { ...wall[drag.endpoint] };
      if (wall.start.y === wall.end.y) point.x = current.x;
      else point.y = current.y;
      setInteriorPreview({ ...wall, [drag.endpoint]: point });
      message = interiorWallPreviewValid ? 'Release to resize the wall.' : interiorWallPlacementError(app.room, interiorWallPreview!, wall.id) ?? 'That wall size is not valid.';
      return;
    }
    if (drag.kind === 'move-opening' || drag.kind === 'resize-opening') {
      const openingDrag = drag;
      const wall = footprintWalls(app.room).find((candidate) => candidate.index === openingDrag.wallIndex);
      if (!wall) return;
      const direction = {
        x: (wall.end.x - wall.start.x) / wall.length,
        y: (wall.end.y - wall.start.y) / wall.length,
      };
      const original = openingDrag.original;
      if (openingDrag.kind === 'move-opening') {
        const delta = (current.x - openingDrag.start.x) * direction.x + (current.y - openingDrag.start.y) * direction.y;
        const pos = Math.max(original.length / 2, Math.min(wall.length - original.length / 2, snap(original.pos + delta)));
        openingPreview = { id: original.id, pos, length: original.length };
      } else {
        const fixed = openingDrag.endpoint === 'start'
          ? original.pos + original.length / 2
          : original.pos - original.length / 2;
        const pointerPosition = (current.x - wall.start.x) * direction.x + (current.y - wall.start.y) * direction.y;
        const moving = Math.max(0, Math.min(wall.length, pointerPosition));
        const length = Math.max(LIMITS.openingLength.min, Math.min(3, snap(Math.abs(moving - fixed))));
        const pos = openingDrag.endpoint === 'start' ? fixed - length / 2 : fixed + length / 2;
        const boundedPos = Math.max(length / 2, Math.min(wall.length - length / 2, pos));
        openingPreview = { id: original.id, pos: boundedPos, length };
      }
      return;
    }
  }

  function finishPointer(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completed = drag;
    drag = null;
    if (completed.kind === 'perimeter' || completed.kind === 'corner') {
      const preview = footprintPreview;
      if (preview && footprintPreviewValid && footprintPreviewOptions) applyFootprint(preview, footprintPreviewOptions);
      else if (preview) message = footprintPreviewMessage || 'The outline change was not applied because it is invalid.';
      footprintPreview = null;
      footprintPreviewOptions = undefined;
      footprintPreviewMessage = '';
    } else if (completed.kind === 'draw-wall') {
      const wall = interiorWallPreview;
      if (wall && interiorWallPreviewValid) {
        const id = addInteriorWall(wall.start, wall.end);
        if (id !== null) {
          selectedInteriorWallId = id;
          message = 'Interior wall added.';
        } else message = app.placementMessage;
      } else if (wall) message = interiorWallPlacementError(app.room, wall) ?? 'Draw a wall at least 0.1 m long, clear of boundaries and other walls.';
      interiorWallPreview = null;
    } else if (completed.kind === 'move-wall' || completed.kind === 'resize-wall') {
      const wall = interiorWallPreview;
      if (wall && interiorWallPreviewValid && updateInteriorWall(completed.id, { start: wall.start, end: wall.end })) {
        message = 'Interior wall updated.';
      } else if (wall) message = app.placementMessage || interiorWallPlacementError(app.room, wall, completed.id) || 'Interior wall update was not applied.';
      interiorWallPreview = null;
    } else if (completed.kind === 'move-opening' || completed.kind === 'resize-opening') {
      if (openingPreview?.id === completed.id) {
        updateOpening(completed.id, { pos: openingPreview.pos, length: openingPreview.length });
        message = 'Opening updated.';
      }
      openingPreview = null;
    }
  }

  function cancelPointer(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    footprintPreview = null;
    footprintPreviewOptions = undefined;
    interiorWallPreview = null;
    openingPreview = null;
    message = 'Edit cancelled.';
  }

  function openingAnchorsFor(points: FootprintPoint[]): Record<number, { wallIndex: number; pos: number }> | null {
    const normalized = normalizeFootprint(points);
    const targetWalls = footprintWalls({ ...app.room, widthM: normalized.widthM, heightM: normalized.heightM, footprint: normalized.points });
    const oldWalls = footprintWalls(app.room);
    const anchors: Record<number, { wallIndex: number; pos: number }> = {};
    for (const opening of app.room.openings) {
      const oldIndex = opening.wallIndex ?? oldWalls.find((wall) => wall.side === opening.side)?.index ?? 0;
      const oldWall = oldWalls.find((wall) => wall.index === oldIndex);
      if (!oldWall) return null;
      const oldDirection = {
        x: (oldWall.end.x - oldWall.start.x) / oldWall.length,
        y: (oldWall.end.y - oldWall.start.y) / oldWall.length,
      };
      const center = {
        x: oldWall.start.x + oldDirection.x * opening.pos + normalized.translation.x,
        y: oldWall.start.y + oldDirection.y * opening.pos + normalized.translation.y,
      };
      const target = targetWalls.find((wall) => {
        const direction = { x: (wall.end.x - wall.start.x) / wall.length, y: (wall.end.y - wall.start.y) / wall.length };
        const cross = Math.abs((center.x - wall.start.x) * direction.y - (center.y - wall.start.y) * direction.x);
        const position = (center.x - wall.start.x) * direction.x + (center.y - wall.start.y) * direction.y;
        return Math.abs(Math.abs(oldDirection.x * direction.x + oldDirection.y * direction.y) - 1) < EPSILON &&
          cross < EPSILON && position - opening.length / 2 >= -EPSILON &&
          position + opening.length / 2 <= wall.length + EPSILON;
      });
      if (!target) return null;
      const direction = { x: (target.end.x - target.start.x) / target.length, y: (target.end.y - target.start.y) / target.length };
      anchors[opening.id] = {
        wallIndex: target.index,
        pos: (center.x - target.start.x) * direction.x + (center.y - target.start.y) * direction.y,
      };
    }
    return anchors;
  }

  function openingAnchorsForMergedEdges(
    rawPoints: FootprintPoint[],
    normalized: ReturnType<typeof normalizeFootprint>,
  ): Record<number, { wallIndex: number; pos: number }> | null {
    const oldWalls = footprintWalls(app.room);
    if (rawPoints.length !== oldWalls.length) return null;
    const newWalls = footprintWalls({
      ...app.room,
      widthM: normalized.widthM,
      heightM: normalized.heightM,
      footprint: normalized.points,
    });
    const anchors: Record<number, { wallIndex: number; pos: number }> = {};
    for (const opening of app.room.openings) {
      const oldIndex = opening.wallIndex ?? oldWalls.find((wall) => wall.side === opening.side)?.index ?? 0;
      const start = rawPoints[oldIndex];
      const end = rawPoints[(oldIndex + 1) % rawPoints.length];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      if (length < EPSILON) return null;
      const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      const center = {
        x: start.x + direction.x * opening.pos + normalized.translation.x,
        y: start.y + direction.y * opening.pos + normalized.translation.y,
      };
      const target = newWalls.find((wall) => {
        const targetDirection = {
          x: (wall.end.x - wall.start.x) / wall.length,
          y: (wall.end.y - wall.start.y) / wall.length,
        };
        const cross = Math.abs((center.x - wall.start.x) * targetDirection.y - (center.y - wall.start.y) * targetDirection.x);
        const position = (center.x - wall.start.x) * targetDirection.x + (center.y - wall.start.y) * targetDirection.y;
        return Math.abs(Math.abs(direction.x * targetDirection.x + direction.y * targetDirection.y) - 1) < EPSILON &&
          cross < EPSILON && position - opening.length / 2 >= -EPSILON &&
          position + opening.length / 2 <= wall.length + EPSILON;
      });
      if (!target) return null;
      const targetDirection = {
        x: (target.end.x - target.start.x) / target.length,
        y: (target.end.y - target.start.y) / target.length,
      };
      anchors[opening.id] = {
        wallIndex: target.index,
        pos: (center.x - target.start.x) * targetDirection.x + (center.y - target.start.y) * targetDirection.y,
      };
    }
    return anchors;
  }

  function addInset() {
    const points = roomFootprint(app.room);
    const index = selectedPerimeterWall;
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
    const start = horizontal
      ? { x: snap(a.x + (b.x - a.x) * 0.375), y: a.y }
      : { x: a.x, y: snap(a.y + (b.y - a.y) * 0.375) };
    const end = horizontal
      ? { x: snap(a.x + (b.x - a.x) * 0.625), y: a.y }
      : { x: a.x, y: snap(a.y + (b.y - a.y) * 0.625) };
    const maxDepth = snap(Math.min(0.75, app.room.widthM / 6, app.room.heightM / 6));
    const depths = [...new Set([maxDepth, maxDepth * 0.75, maxDepth * 0.5, maxDepth * 0.25].map(snap))]
      .filter((depth) => depth >= SNAP);
    for (const depth of depths) {
      const first = horizontal ? { x: start.x, y: snap(start.y + inward * depth) } : { x: snap(start.x + inward * depth), y: start.y };
      const second = horizontal ? { x: end.x, y: snap(end.y + inward * depth) } : { x: snap(end.x + inward * depth), y: end.y };
      const candidate = [...points.slice(0, index + 1), start, first, second, end, ...points.slice(index + 1)];
      const anchors = openingAnchorsFor(candidate);
      if (isValidFootprint(normalizeFootprint(candidate).points, app.room.widthM, app.room.heightM) && anchors) {
        if (applyFootprint(candidate, { ...normalizeFootprint(candidate), openingAnchors: anchors })) {
          selectedPerimeterWall = index + 2;
        }
        return;
      }
    }
    message = 'There is not enough clear room to add an inset without moving an opening.';
  }

  function removeInset() {
    const points = roomFootprint(app.room);
    const index = selectedPerimeterWall;
    if (index < 0 || points.length < 8 || !canRemoveInset()) return;
    const count = points.length;
    const rotated = Array.from({ length: count }, (_, offset) => points[(index - 2 + offset + count) % count]);
    const candidate = [rotated[0], rotated[5], ...rotated.slice(6)];
    const anchors = openingAnchorsFor(candidate);
    if (!anchors) {
      message = 'Move or remove the openings in this inset before removing it.';
      return;
    }
    if (applyFootprint(candidate, { ...normalizeFootprint(candidate), openingAnchors: anchors })) selectedPerimeterWall = -1;
  }

  function canRemoveInset(): boolean {
    const points = roomFootprint(app.room);
    const index = selectedPerimeterWall;
    if (index < 0 || points.length < 8) return false;
    const count = points.length;
    const rotated = Array.from({ length: count }, (_, offset) => points[(index - 2 + offset + count) % count]);
    const [outsideStart, stepStart, insetStart, insetEnd, stepEnd, outsideEnd] = rotated;
    return insetStart.y === insetEnd.y
      ? stepStart.y === outsideStart.y && stepEnd.y === outsideEnd.y &&
        stepStart.x === insetStart.x && stepEnd.x === insetEnd.x && outsideStart.y === outsideEnd.y
      : stepStart.x === outsideStart.x && stepEnd.x === outsideEnd.x &&
        stepStart.y === insetStart.y && stepEnd.y === insetEnd.y && outsideStart.x === outsideEnd.x;
  }

  function useRectangle() {
    const points = [
      { x: 0, y: 0 }, { x: app.room.widthM, y: 0 },
      { x: app.room.widthM, y: app.room.heightM }, { x: 0, y: app.room.heightM },
    ];
    const anchors = openingAnchorsFor(points);
    if (!anchors) {
      message = 'The current openings do not fit on the rectangular outline. Move or remove them first.';
      return;
    }
    applyFootprint(points, { widthM: app.room.widthM, heightM: app.room.heightM, translation: { x: 0, y: 0 }, openingAnchors: anchors });
    selectedPerimeterWall = -1;
  }

  function selectOpening(opening: Opening) {
    selectedOpeningId = opening.id;
    selectedInteriorWallId = null;
    select({ kind: 'opening', id: opening.id });
  }

  function createOpening(kind: 'window' | 'door') {
    addOpening(kind);
    const opening = app.room.openings.at(-1);
    if (opening) selectOpening(opening);
  }

  function currentOpening(opening: Opening): Opening {
    return openingPreview?.id === opening.id
      ? { ...opening, pos: openingPreview.pos, length: openingPreview.length }
      : opening;
  }

  function openingEnds(opening: Opening) {
    const wallIndex = opening.wallIndex ?? footprintWalls(app.room).find((wall) => wall.side === opening.side)?.index ?? 0;
    const wall = footprintWalls(app.room).find((candidate) => candidate.index === wallIndex);
    if (!wall) return null;
    const active = currentOpening(opening);
    const direction = { x: (wall.end.x - wall.start.x) / wall.length, y: (wall.end.y - wall.start.y) / wall.length };
    const start = { x: wall.start.x + direction.x * (active.pos - active.length / 2), y: wall.start.y + direction.y * (active.pos - active.length / 2) };
    const end = { x: wall.start.x + direction.x * (active.pos + active.length / 2), y: wall.start.y + direction.y * (active.pos + active.length / 2) };
    return { wallIndex, start, end, center: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  }

  function selectedInteriorWall(): InteriorWall | undefined {
    return app.room.interiorWalls?.find((wall) => wall.id === selectedInteriorWallId);
  }

  function activateWithKeyboard(event: KeyboardEvent, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  }

  function openFullscreen() {
    if (editorDialog.open) return;
    editorDialog.showModal();
    fullscreen = true;
  }

  function closeFullscreen() {
    if (editorDialog.open) editorDialog.close();
    fullscreen = false;
  }
</script>

<dialog bind:this={editorDialog} class="floorplan-dialog" class:fullscreen onclose={() => fullscreen = false}>
  <fieldset class="floorplan-editor">
    <legend>Floorplan</legend>
    <p class="hint">Drag a wall or corner to reshape the room. Corners snap to existing points, merging coincident points and straight wall runs. Use the map to edit openings and isolated interior walls. Geometry snaps to 10 cm.</p>

    <div class="tool-row">
      <button class:active={addingInteriorWall} aria-pressed={addingInteriorWall}
        onclick={() => { addingInteriorWall = !addingInteriorWall; selectedInteriorWallId = null; message = addingInteriorWall ? 'Drag inside the room to draw a free-standing wall.' : ''; }}>
        {addingInteriorWall ? 'Cancel wall' : '+ Interior wall'}
      </button>
      <button onclick={addInset} disabled={selectedPerimeterWall < 0}>Add inset</button>
      <button onclick={removeInset} disabled={!canRemoveInset()}>Remove inset</button>
      <button onclick={useRectangle}>Use rectangle</button>
      {#if fullscreen}
        <button class="close-fullscreen" onclick={closeFullscreen}>Close full screen</button>
      {:else}
        <button aria-label="Edit floorplan full screen" onclick={openFullscreen}>Full screen</button>
      {/if}
    </div>

    <svg bind:this={mapSvg} viewBox="0 0 400 300" role="application" aria-label="Interactive 2D floorplan map"
      onpointerdown={beginWallDrawing} onpointermove={movePointer} onpointerup={finishPointer} onpointercancel={cancelPointer}>
    <defs>
      <pattern id="floorplan-minor-grid" width={minorGrid} height={minorGrid} patternUnits="userSpaceOnUse">
        <path d={`M ${minorGrid} 0 H 0 V ${minorGrid}`} fill="none" stroke="#aab5c21c" stroke-width="0.45" />
      </pattern>
      <pattern id="floorplan-major-grid" width={majorGrid} height={majorGrid} patternUnits="userSpaceOnUse">
        <path d={`M ${majorGrid} 0 H 0 V ${majorGrid}`} fill="none" stroke="#aab5c233" stroke-width="0.7" />
      </pattern>
      <clipPath id="floorplan-room-clip">
        <polygon points={displayedFootprint.map(svgPoint).join(' ')} />
      </clipPath>
    </defs>
    <rect width="400" height="300" fill="#111820" />
    <polygon class:invalid={!footprintPreviewValid} class="room-shape" points={displayedFootprint.map(svgPoint).join(' ')} />
    <g clip-path="url(#floorplan-room-clip)">
      <rect x={mapLeft} y={mapTop} width={app.room.widthM * mapScale} height={app.room.heightM * mapScale} fill="url(#floorplan-minor-grid)" />
      <rect x={mapLeft} y={mapTop} width={app.room.widthM * mapScale} height={app.room.heightM * mapScale} fill="url(#floorplan-major-grid)" />
    </g>

    {#each displayedWalls as wall (wall.index)}
      {@const selected = wall.index === selectedPerimeterWall}
      <line class="perimeter-hit" x1={svgX(wall.start.x)} y1={svgY(wall.start.y)} x2={svgX(wall.end.x)} y2={svgY(wall.end.y)}
        role="button" tabindex="0" aria-label={`Room wall ${wall.index + 1}, ${wall.length.toFixed(1)} metres`}
        onpointerdown={(event) => beginPerimeterDrag(event, wall.index)}
        onkeydown={(event) => activateWithKeyboard(event, () => { selectedPerimeterWall = wall.index; })} />
      <line class:selected class="perimeter-wall" x1={svgX(wall.start.x)} y1={svgY(wall.start.y)} x2={svgX(wall.end.x)} y2={svgY(wall.end.y)} />
    {/each}

    {#each displayedFootprint as point, index}
      <circle class="corner-hit" cx={svgX(point.x)} cy={svgY(point.y)} r="10" role="button" tabindex="0" aria-label={`Room corner ${index + 1}`}
        onpointerdown={(event) => beginCornerDrag(event, index)}
        onkeydown={(event) => activateWithKeyboard(event, () => { selectedPerimeterWall = -1; })} />
      <circle class="corner-dot" cx={svgX(point.x)} cy={svgY(point.y)} r="3" />
    {/each}

    {#each app.room.interiorWalls ?? [] as originalWall (originalWall.id)}
      {@const wall = interiorWallPreview?.id === originalWall.id ? interiorWallPreview : originalWall}
      {@const selected = selectedInteriorWallId === originalWall.id}
      <line class="interior-hit" x1={svgX(wall.start.x)} y1={svgY(wall.start.y)} x2={svgX(wall.end.x)} y2={svgY(wall.end.y)}
        role="button" tabindex="0" aria-label={`Interior wall ${wall.id}`}
        onpointerdown={(event) => beginInteriorWallDrag(event, originalWall)}
        onkeydown={(event) => activateWithKeyboard(event, () => { selectedInteriorWallId = wall.id; })} />
      <line class:selected class:invalid={!interiorWallPreviewValid && interiorWallPreview?.id === wall.id}
        class="interior-wall" x1={svgX(wall.start.x)} y1={svgY(wall.start.y)} x2={svgX(wall.end.x)} y2={svgY(wall.end.y)}
        stroke-width={Math.max(4, wall.thicknessM * mapScale)} />
      {#if selected}
        <circle class="wall-handle" cx={svgX(wall.start.x)} cy={svgY(wall.start.y)} r="5"
          role="button" tabindex="0" aria-label={`Resize start of interior wall ${wall.id}`}
          onpointerdown={(event) => beginInteriorWallResize(event, originalWall, 'start')}
          onkeydown={(event) => activateWithKeyboard(event, () => { selectedInteriorWallId = wall.id; })} />
        <circle class="wall-handle" cx={svgX(wall.end.x)} cy={svgY(wall.end.y)} r="5"
          role="button" tabindex="0" aria-label={`Resize end of interior wall ${wall.id}`}
          onpointerdown={(event) => beginInteriorWallResize(event, originalWall, 'end')}
          onkeydown={(event) => activateWithKeyboard(event, () => { selectedInteriorWallId = wall.id; })} />
      {/if}
    {/each}

    {#if interiorWallPreview?.id === -1}
      <line class:invalid={!interiorWallPreviewValid} class="interior-wall preview-wall"
        x1={svgX(interiorWallPreview.start.x)} y1={svgY(interiorWallPreview.start.y)}
        x2={svgX(interiorWallPreview.end.x)} y2={svgY(interiorWallPreview.end.y)}
        stroke-width={Math.max(4, interiorWallPreview.thicknessM * mapScale)} />
    {/if}

    {#each app.room.openings as opening (opening.id)}
      {@const ends = openingEnds(opening)}
      {#if ends}
        {@const selected = selectedOpeningId === opening.id}
        <line class:window-opening={opening.kind === 'window'} class:door-opening={opening.kind === 'door'}
          class:selected class="opening-hit" x1={svgX(ends.start.x)} y1={svgY(ends.start.y)} x2={svgX(ends.end.x)} y2={svgY(ends.end.y)}
          role="button" tabindex="0" aria-label={`${opening.kind} ${opening.id}`}
          onpointerdown={(event) => beginOpeningDrag(event, opening)}
          onkeydown={(event) => activateWithKeyboard(event, () => selectOpening(opening))} />
        <line class:window-opening={opening.kind === 'window'} class:door-opening={opening.kind === 'door'}
          class:selected class="opening-mark" x1={svgX(ends.start.x)} y1={svgY(ends.start.y)} x2={svgX(ends.end.x)} y2={svgY(ends.end.y)} />
        {#if selected}
          <circle class="opening-handle" cx={svgX(ends.start.x)} cy={svgY(ends.start.y)} r="4"
            role="button" tabindex="0" aria-label={`Resize start of ${opening.kind} ${opening.id}`}
            onpointerdown={(event) => beginOpeningDrag(event, opening, 'start')}
            onkeydown={(event) => activateWithKeyboard(event, () => selectOpening(opening))} />
          <circle class="opening-handle" cx={svgX(ends.end.x)} cy={svgY(ends.end.y)} r="4"
            role="button" tabindex="0" aria-label={`Resize end of ${opening.kind} ${opening.id}`}
            onpointerdown={(event) => beginOpeningDrag(event, opening, 'end')}
            onkeydown={(event) => activateWithKeyboard(event, () => selectOpening(opening))} />
        {/if}
      {/if}
    {/each}

    {#if drag?.kind === 'draw-wall' && interiorWallPreview}
      <circle class="draw-point" cx={svgX(interiorWallPreview.start.x)} cy={svgY(interiorWallPreview.start.y)} r="3" />
    {/if}

    <text class="dimension" x="200" y="17" text-anchor="middle">
      {footprintPreviewOptions?.widthM ?? app.room.widthM} m × {footprintPreviewOptions?.heightM ?? app.room.heightM} m
    </text>
    </svg>

  <div class="legend" aria-label="Map legend">
    <span><i class="window-swatch"></i> Window</span>
    <span><i class="door-swatch"></i> Door</span>
    <span><i class="partition-swatch"></i> Interior wall</span>
  </div>

  <div class="actions">
    <button onclick={() => createOpening('window')} disabled={app.room.openings.length >= LIMITS.openings}>+ Window</button>
    <button onclick={() => createOpening('door')} disabled={app.room.openings.length >= LIMITS.openings}>+ Door</button>
    {#if selectedInteriorWall()}
      <button class="danger" onclick={() => {
        removeInteriorWall(selectedInteriorWallId!);
        selectedInteriorWallId = null;
        interiorWallPreview = null;
        message = 'Interior wall removed.';
      }}>Remove selected wall</button>
    {/if}
  </div>

  {#if app.room.interiorWalls?.length}
    <div class="wall-list" aria-label="Interior walls">
      {#each app.room.interiorWalls as wall (wall.id)}
        <button class:selected={selectedInteriorWallId === wall.id} aria-pressed={selectedInteriorWallId === wall.id}
          onclick={() => { selectedInteriorWallId = wall.id; selectedPerimeterWall = -1; selectedOpeningId = null; }}>
          Wall {wall.id} · {Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y).toFixed(1)} m
        </button>
      {/each}
    </div>
  {/if}

  {#if app.room.openings.length}
    <ul class="opening-list" aria-label="Windows and doors">
      {#each app.room.openings as opening (opening.id)}
        <li class:selected={selectedOpeningId === opening.id}>
          <button class="opening-select" aria-pressed={selectedOpeningId === opening.id}
            onclick={() => selectOpening(opening)}>
            {opening.kind === 'window' ? 'Window' : 'Door'} {opening.id} · {currentOpening(opening).length.toFixed(1)} m
          </button>
          <button aria-pressed={opening.open} onclick={() => updateOpening(opening.id, { open: !opening.open })}>
            {opening.open ? 'Open' : 'Closed'}
          </button>
          <button aria-label="Remove {opening.kind} {opening.id}" onclick={() => {
            removeOpening(opening.id);
            if (selectedOpeningId === opening.id) selectedOpeningId = null;
          }}>×</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if selectedInteriorWall()}
    {@const wall = selectedInteriorWall()!}
    <p class="hint selected-detail">Selected wall: {Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y).toFixed(1)} m long, {(wall.thicknessM * 100).toFixed(0)} cm thick. Drag the wall to move it or drag an endpoint to resize it.</p>
  {/if}
    {#if message}<p class="status" role="status">{message}</p>{/if}
  </fieldset>
</dialog>

<style>
  .floorplan-dialog {
    display: block;
    position: static;
    box-sizing: border-box;
    width: 100%;
    max-width: none;
    max-height: none;
    inset: auto;
    margin: 0;
    padding: 0;
    overflow: visible;
    border: 0;
    color: inherit;
    background: transparent;
  }
  .floorplan-dialog::backdrop { background: rgb(0 0 0 / 75%); }
  .floorplan-dialog:modal {
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: clamp(0.6rem, 2vw, 1.5rem);
    overflow: auto;
    border: 0;
    border-radius: 0;
    background: var(--panel, #111820);
  }
  .floorplan-dialog:modal .floorplan-editor { max-width: 1400px; margin-inline: auto; }
  .floorplan-dialog:modal .floorplan-editor svg { max-height: 68vh; }
  .floorplan-editor { min-width: 0; }
  .hint { color: var(--muted, #aab5c2); font-size: 0.78rem; }
  .tool-row, .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.5rem 0; }
  .tool-row button, .actions button, .wall-list button, .opening-list button { font-size: 0.75rem; }
  button.active, button.selected { border-color: #ffb454; color: #ffb454; }
  button.danger { color: #ffaaa0; }
  svg {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: auto;
    max-height: 24rem;
    margin: 0.45rem 0;
    border: 1px solid var(--border, #384351);
    border-radius: 0.45rem;
    touch-action: none;
    user-select: none;
  }
  .room-shape { fill: #65c7a51b; stroke: #65c7a5; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
  .room-shape.invalid { fill: #d854541b; stroke: #e66b6b; }
  .perimeter-hit, .interior-hit, .opening-hit { fill: none; stroke: transparent; stroke-width: 18; pointer-events: stroke; cursor: grab; }
  .perimeter-wall { fill: none; stroke: #aab5c2; stroke-width: 3; pointer-events: none; vector-effect: non-scaling-stroke; }
  .perimeter-wall.selected { stroke: #ffb454; stroke-width: 5; }
  .corner-hit { fill: transparent; stroke: transparent; cursor: nwse-resize; }
  .corner-dot { fill: #f3f6fa; stroke: #17212d; stroke-width: 1; pointer-events: none; }
  .interior-hit { stroke-width: 20; }
  .interior-wall { fill: none; stroke: #efb477; stroke-linecap: butt; pointer-events: none; vector-effect: non-scaling-stroke; }
  .interior-wall.selected { stroke: #ff9e43; }
  .interior-wall.invalid, .preview-wall.invalid { stroke: #e66b6b; }
  .preview-wall { pointer-events: none; stroke-dasharray: 5 3; }
  .wall-handle, .opening-handle { fill: #fff; stroke: #1a2633; stroke-width: 1.5; cursor: crosshair; }
  .opening-hit { stroke-width: 18; }
  .opening-mark { fill: none; stroke-width: 4; pointer-events: none; vector-effect: non-scaling-stroke; }
  .opening-mark.window-opening { stroke: #51c8f4; }
  .opening-mark.door-opening { stroke: #dfac63; }
  .opening-mark.selected { stroke-width: 6; }
  .opening-hit.window-opening { stroke: transparent; }
  .opening-hit.door-opening { stroke: transparent; }
  .opening-handle { cursor: ew-resize; }
  .draw-point { fill: #e7f2fb; pointer-events: none; }
  .dimension { fill: #c7d1dc; font: 10px system-ui, sans-serif; pointer-events: none; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.75rem; color: var(--muted, #aab5c2); font-size: 0.72rem; }
  .legend span { display: inline-flex; align-items: center; gap: 0.25rem; }
  .legend i { display: inline-block; width: 0.75rem; height: 0.2rem; }
  .window-swatch { background: #51c8f4; }
  .door-swatch { background: #dfac63; }
  .partition-swatch { background: #efb477; }
  .wall-list { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.45rem 0; }
  .opening-list { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.5rem 0; padding: 0; list-style: none; }
  .opening-list li { display: flex; align-items: center; gap: 0.35rem; }
  .opening-list li.selected { color: #ffb454; }
  .opening-select { flex: 1; text-align: left; }
  .selected-detail { margin-bottom: 0.25rem; }
  .status { margin: 0.45rem 0 0; color: var(--muted, #aab5c2); font-size: 0.78rem; }
</style>
