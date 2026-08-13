# WorldGen

A deterministic, stylized 3D procedural terrain explorer powered by Three.js. The renderer and its dependencies are vendored, so the application runs locally without an install or build step.

## Features

- Reproducible numeric world seeds
- Five-octave fractal terrain and climate noise
- Infinite 16 × 16 terrain chunks streamed around the player
- Three real geometry LOD levels with seam-covering terrain skirts
- Climate-driven biomes and instanced low-poly trees, rocks, and cacti
- Animated water, atmospheric fog, clouds, lighting, and soft shadows
- Orbit camera plus keyboard exploration
- 64 × 64 terrain mesh export in OBJ and binary glTF (`.glb`) formats

## Controls

- **WASD / arrow keys** — move through the world
- **Shift** — move faster
- **Drag** — orbit the 3D camera
- **Mouse wheel** — zoom
- **Chunk grid, contours, and objects** — toggle viewport layers

## Terrain export

Choose **OBJ** or **GLB** in the Terrain Export control, move to the area you want, and select **Export Mesh**. The downloaded mesh contains 4,225 vertices, smooth normals, biome vertex colors, and 8,192 triangles.

## Run locally

Serve the repository with any static web server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.
