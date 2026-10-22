# HeatFlow

Web-based simulation that visualizes how heat spreads inside a room and escapes through its walls.

## Run

```
npm install
npm run dev      # development server
npm test         # unit tests
npm run check    # type check
npm run build    # production build in dist/
```

## How it works

- 3D finite-volume heat model (`src/sim`), in real units (m, °C, W, W/m²K). X is room width, Y is floor-plan length, and Z is height above the floor.
- Heat and cold sources inject or remove power (kW) in a small volume at their X/Y/Z position. All six room faces lose heat as `U · A · ΔT`. The floor uses the wall construction; the ceiling uses separate roof insulation. All faces exchange heat with the outside temperature. Windows and doors replace their actual rectangular area, including opening height and sill height; overlapping openings are counted once.
- Air diffusivity is boosted to mimic turbulent mixing, and a thermal-mass factor stands in for wall surfaces and unmodelled contents. **Convection** enables 3D buoyancy, drag, solid-wall pressure projection and conservative heat transport: warm air rises along Z. This is a simplified educational model, not a building-design CFD tool. Openings model heat exchange, not ventilation flow.
- Place up to eight pieces of furniture: sofas, tables, cabinets and beds. Their solid parts displace air, close the corresponding velocity faces, and redirect convection. Table legs and tops are separate, leaving an air passage beneath the top. Furniture has its own heat capacity and conductivity, with conservative heat exchange between air and solid surfaces. Wood, upholstery and metal use different effective material parameters. Air statistics exclude solid furniture; the selected piece has a separate temperature readout.
- Underfloor heating distributes heater output across the floor; cold sources remain local. An optional thermostat switches heaters using the average air temperature and a configurable deadband. Energy totals and current heat losses are shown by enclosure component.
- Toggle **House exterior** for a translucent gable roof and walls, or **Heat-flow arrows** for 3D diffusion and advection directions. Roof pitch and covering affect appearance; roof insulation affects heat loss.
- WebGL2 ray-marches a 3D temperature texture. Switch to **Slice** to inspect horizontal or vertical sections along X, Y or Z. Canvas2D falls back to projected temperature planes in the same rotatable 3D scene.
- The longest grid dimension has 30 cells (20 with convection). Physical voxel dimensions match the room exactly, and the timestep accounts for diffusion and boundary loss. High speed settings can be limited by available CPU/GPU performance.
- Rooms can be saved in the browser and shared via a version 5 URL hash, including furniture, materials, dimensions and rotation. Original and version 2–4 links/saves still load; older rooms start with no furniture.

## 3D controls

- Drag empty space to rotate the room. Scroll or use **＋ / −** to zoom; **↺** in the view toolbar resets the camera.
- Drag a source or numbered probe to move it horizontally. **Shift-drag** changes its height. Select a marker to edit all three coordinates in the sidebar.
- With a marker focused, arrow keys move along X/Y; **Page Up / Page Down** move along Z. Hold **Shift** for larger keyboard steps.
- Add furniture from the **Furniture** panel. Drag the furniture itself or its handle to move it; select a piece to change its dimensions, material or rotation. Arrow keys move a focused furniture handle; **R** rotates it 90°. Adding, moving, resizing, rotating or changing a piece's material restarts the simulation.
- Use the slice orientation and position controls to inspect the interior. Hover reads the temperature on that slice; in volume mode it samples the horizontal plane at the current slice fraction (mid-height by default).
- Volume view shows temperature clouds throughout the air, with faint walls so interior heat remains visible. With convection enabled, **Show airflow trails** traces the simulated 3D velocity field, coloured by local temperature. Trail updates crossfade over 0.25 seconds and heat clouds use a 0.2-second display filter to keep fast simulation speeds readable. Probes and statistics use the live solver temperatures. Animated highlights indicate flow direction at a readable display speed; they do not measure air velocity.
- Click an opening's marker or sidebar toggle to open/close it; edit its wall, width, height and sill position in the sidebar.

Furniture uses the same coarse voxel grid as the air solver: thin parts expand to grid cells and narrow gaps can close. Overlapping parts share occupied cells, with the last piece supplying the material. Material values are educational approximations rather than specifications for real furniture. Furniture begins at the room's initial temperature. The model includes solid conduction and air/surface heat exchange, without radiation or detailed porous upholstery flow.

See [PLAN.md](./PLAN.md) and [FEATURES.md](./FEATURES.md).
