# WorldGen

An interactive, deterministic procedural terrain explorer built with the Canvas 2D API and no runtime dependencies.

## Features

- Reproducible numeric world seeds
- Five-octave fractal noise terrain
- Infinite 16 × 16 tile chunk coordinates
- Climate-driven biome and deterministic object placement
- Three levels of distance-based terrain detail
- Keyboard, drag, and scroll exploration
- 64 × 64 terrain mesh export in OBJ and binary glTF (`.glb`) formats

## Terrain export

Choose **OBJ** or **GLB** in the Terrain Export control, move to the area you want, and select **Export Mesh**. The downloaded mesh contains 4,225 vertices, smooth normals, biome vertex colors, and 8,192 triangles.

## Run locally

Serve the repository with any static web server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.
