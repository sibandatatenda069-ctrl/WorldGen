(() => {
  "use strict";

  const canvas = document.getElementById("worldCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const stage = document.querySelector(".world-stage");
  const buffer = document.createElement("canvas");
  const bufferCtx = buffer.getContext("2d", { alpha: false });

  const elements = {
    seedInput: document.getElementById("seedInput"),
    worldSeedLabel: document.getElementById("worldSeedLabel"),
    worldName: document.getElementById("worldName"),
    coordinates: document.getElementById("coordinates"),
    chunkId: document.getElementById("chunkId"),
    biomeName: document.getElementById("biomeName"),
    biomeSwatch: document.getElementById("biomeSwatch"),
    elevationStat: document.getElementById("elevationStat"),
    lodStat: document.getElementById("lodStat"),
    objectStat: document.getElementById("objectStat"),
    zoomLabel: document.getElementById("zoomLabel"),
    profileName: document.getElementById("profileName"),
    scale: document.getElementById("scaleSlider"),
    elevation: document.getElementById("elevationSlider"),
    sea: document.getElementById("seaSlider"),
    biome: document.getElementById("biomeSlider"),
    scaleValue: document.getElementById("scaleValue"),
    elevationValue: document.getElementById("elevationValue"),
    seaValue: document.getElementById("seaValue"),
    biomeValue: document.getElementById("biomeValue"),
    grid: document.getElementById("gridToggle"),
    contours: document.getElementById("contourToggle"),
    objects: document.getElementById("objectsToggle"),
    toast: document.getElementById("toast"),
    playerArrow: document.querySelector(".player-marker svg")
  };

  const CHUNK_SIZE = 16;
  const RENDER_RESOLUTION = 4;
  const BIOMES = {
    deepWater: { name: "DEEP OCEAN", color: [21, 52, 57], object: null },
    water: { name: "OPEN WATER", color: [27, 73, 73], object: null },
    shallows: { name: "COASTAL WATER", color: [43, 94, 84], object: null },
    beach: { name: "SANDY SHORE", color: [164, 148, 86], object: "rock" },
    desert: { name: "ARID DESERT", color: [158, 128, 69], object: "cactus" },
    dryland: { name: "DRY GRASSLAND", color: [121, 130, 70], object: "rock" },
    plains: { name: "OPEN PLAINS", color: [91, 132, 69], object: "tree" },
    forest: { name: "TEMPERATE FOREST", color: [49, 91, 57], object: "tree" },
    rainforest: { name: "DENSE RAINFOREST", color: [38, 76, 51], object: "tree" },
    tundra: { name: "ALPINE TUNDRA", color: [112, 124, 105], object: "rock" },
    rock: { name: "ROCKY HIGHLANDS", color: [111, 114, 101], object: "rock" },
    snow: { name: "SNOW-CAPPED PEAKS", color: [201, 205, 195], object: "rock" }
  };

  const state = {
    seed: 28479153,
    scale: 64,
    elevation: 1,
    sea: .42,
    diversity: .72,
    profile: "balanced",
    camera: { x: 0, y: 0 },
    zoom: 1,
    width: 0,
    height: 0,
    dirty: true,
    keys: new Set(),
    dragging: false,
    dragOrigin: null,
    dragCamera: null,
    facing: 0,
    lastFrame: performance.now(),
    lastRender: 0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  // A fast, deterministic integer hash. Every procedural decision ultimately
  // flows through this function and the currently active numeric seed.
  function hash2D(x, y, salt = 0) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = (h + Math.imul((state.seed + salt) | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  function valueNoise(x, y, salt) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash2D(ix, iy, salt);
    const b = hash2D(ix + 1, iy, salt);
    const c = hash2D(ix, iy + 1, salt);
    const d = hash2D(ix + 1, iy + 1, salt);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  function fbm(x, y, salt, octaves = 5) {
    let value = 0;
    let amplitude = .52;
    let frequency = 1;
    let total = 0;
    for (let i = 0; i < octaves; i += 1) {
      value += valueNoise(x * frequency, y * frequency, salt + i * 977) * amplitude;
      total += amplitude;
      amplitude *= .5;
      frequency *= 2.03;
    }
    return value / total;
  }

  function heightAt(x, y) {
    const frequency = lerp(.0064, .016, (state.scale - 32) / 68);
    const broad = fbm(x * frequency * .28, y * frequency * .28, 101, 4);
    const terrain = fbm(x * frequency, y * frequency, 211, 5);
    const ridgeNoise = fbm((x + 340) * frequency * .67, (y - 170) * frequency * .67, 307, 4);
    const ridges = 1 - Math.abs(ridgeNoise * 2 - 1);
    let height = broad * .45 + terrain * .42 + ridges * .13;
    height = (height - .5) * state.elevation + .5;
    return clamp(height, 0, 1);
  }

  function terrainAt(x, y) {
    const height = heightAt(x, y);
    const sea = state.sea;
    let biome;
    let moisture = 0;
    let temperature = 0;

    if (height < sea - .105) biome = BIOMES.deepWater;
    else if (height < sea - .025) biome = BIOMES.water;
    else if (height < sea) biome = BIOMES.shallows;
    else if (height < sea + .025) biome = BIOMES.beach;
    else {
      const climateFrequency = .007 + state.diversity * .007;
      moisture = fbm((x + 940) * climateFrequency, (y - 420) * climateFrequency, 401, 3);
      const latitudeWave = Math.sin((y + (state.seed % 3000)) * .0022) * .14;
      temperature = clamp(fbm((x - 700) * climateFrequency * .57, (y + 510) * climateFrequency * .57, 503, 3) + latitudeWave - (height - sea) * .48, 0, 1);

      if (height > .83) biome = BIOMES.snow;
      else if (height > .735) biome = temperature < .43 ? BIOMES.tundra : BIOMES.rock;
      else if (temperature < .28) biome = BIOMES.tundra;
      else if (moisture < .24 && temperature > .48) biome = BIOMES.desert;
      else if (moisture < .39) biome = BIOMES.dryland;
      else if (moisture > .71 && temperature > .47) biome = BIOMES.rainforest;
      else if (moisture > .55) biome = BIOMES.forest;
      else biome = BIOMES.plains;
    }
    return { height, biome, moisture, temperature };
  }

  function colorFor(sample, x, y, lod, loadedDistance) {
    const source = sample.biome.color;
    const grain = (hash2D(Math.floor(x * 2), Math.floor(y * 2), 701) - .5) * (lod === 0 ? 8 : 4);
    const altitudeShade = (sample.height - state.sea) * 18;
    let factor = 1 + altitudeShade / 100 + grain / 100;

    if (sample.biome === BIOMES.water || sample.biome === BIOMES.deepWater || sample.biome === BIOMES.shallows) {
      factor += Math.sin((x + y) * .35) * .018;
    }
    if (elements.contours.checked && sample.height > state.sea) {
      const line = (sample.height * 18) % 1;
      if (line < .085) factor *= .79;
    }
    if (loadedDistance === 3) factor *= .78;
    else if (loadedDistance > 3) factor *= .48;
    if (lod === 2) factor *= .88;

    return [
      clamp(Math.round(source[0] * factor), 0, 255),
      clamp(Math.round(source[1] * factor), 0, 255),
      clamp(Math.round(source[2] * factor), 0, 255)
    ];
  }

  function getTilePixels() {
    return 7.2 * state.zoom;
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    state.width = Math.max(1, rect.width);
    state.height = Math.max(1, rect.height);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.dirty = true;
  }

  function drawTerrain() {
    const width = state.width;
    const height = state.height;
    if (!width || !height) return;

    const resolution = RENDER_RESOLUTION;
    const renderWidth = Math.ceil(width / resolution);
    const renderHeight = Math.ceil(height / resolution);
    if (buffer.width !== renderWidth || buffer.height !== renderHeight) {
      buffer.width = renderWidth;
      buffer.height = renderHeight;
    }
    const image = bufferCtx.createImageData(renderWidth, renderHeight);
    const pixels = image.data;
    const tilePixels = getTilePixels();
    const playerChunkX = Math.floor(state.camera.x / CHUNK_SIZE);
    const playerChunkY = Math.floor(state.camera.y / CHUNK_SIZE);

    for (let py = 0; py < renderHeight; py += 1) {
      const sy = (py + .5) * resolution;
      const normY = Math.abs(sy - height / 2) / (height / 2);
      for (let px = 0; px < renderWidth; px += 1) {
        const sx = (px + .5) * resolution;
        const normX = Math.abs(sx - width / 2) / (width / 2);
        const distance = Math.max(normX, normY);
        const lod = distance > .78 ? 2 : distance > .54 ? 1 : 0;
        let worldX = state.camera.x + (sx - width / 2) / tilePixels;
        let worldY = state.camera.y + (sy - height / 2) / tilePixels;

        // Lower detail levels sample a coarser coordinate grid.
        if (lod === 1) {
          worldX = Math.floor(worldX / 1.25) * 1.25;
          worldY = Math.floor(worldY / 1.25) * 1.25;
        } else if (lod === 2) {
          worldX = Math.floor(worldX / 3.25) * 3.25;
          worldY = Math.floor(worldY / 3.25) * 3.25;
        }

        const chunkX = Math.floor(worldX / CHUNK_SIZE);
        const chunkY = Math.floor(worldY / CHUNK_SIZE);
        const loadedDistance = Math.max(Math.abs(chunkX - playerChunkX), Math.abs(chunkY - playerChunkY));
        const sample = terrainAt(worldX, worldY);
        const color = colorFor(sample, worldX, worldY, lod, loadedDistance);
        const index = (py * renderWidth + px) * 4;
        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
        pixels[index + 3] = 255;
      }
    }

    bufferCtx.putImageData(image, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, renderWidth, renderHeight, 0, 0, width, height);
    ctx.restore();

    drawChunkGrid();
    if (elements.objects.checked) drawObjects();
    drawEdgeLOD();
    updateInspector();
  }

  function drawChunkGrid() {
    if (!elements.grid.checked) return;
    const tilePixels = getTilePixels();
    const minX = state.camera.x - state.width / 2 / tilePixels;
    const maxX = state.camera.x + state.width / 2 / tilePixels;
    const minY = state.camera.y - state.height / 2 / tilePixels;
    const maxY = state.camera.y + state.height / 2 / tilePixels;
    const startChunkX = Math.floor(minX / CHUNK_SIZE);
    const endChunkX = Math.ceil(maxX / CHUNK_SIZE);
    const startChunkY = Math.floor(minY / CHUNK_SIZE);
    const endChunkY = Math.ceil(maxY / CHUNK_SIZE);
    const currentChunkX = Math.floor(state.camera.x / CHUNK_SIZE);
    const currentChunkY = Math.floor(state.camera.y / CHUNK_SIZE);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = "500 7px 'DM Mono', monospace";
    ctx.textBaseline = "top";
    for (let chunkX = startChunkX; chunkX <= endChunkX; chunkX += 1) {
      const screenX = (chunkX * CHUNK_SIZE - state.camera.x) * tilePixels + state.width / 2;
      const distance = Math.abs(chunkX - currentChunkX);
      ctx.strokeStyle = distance <= 3 ? "rgba(229,241,230,.18)" : "rgba(229,241,230,.07)";
      ctx.beginPath();
      ctx.moveTo(Math.round(screenX) + .5, 0);
      ctx.lineTo(Math.round(screenX) + .5, state.height);
      ctx.stroke();
    }
    for (let chunkY = startChunkY; chunkY <= endChunkY; chunkY += 1) {
      const screenY = (chunkY * CHUNK_SIZE - state.camera.y) * tilePixels + state.height / 2;
      const distance = Math.abs(chunkY - currentChunkY);
      ctx.strokeStyle = distance <= 3 ? "rgba(229,241,230,.18)" : "rgba(229,241,230,.07)";
      ctx.beginPath();
      ctx.moveTo(0, Math.round(screenY) + .5);
      ctx.lineTo(state.width, Math.round(screenY) + .5);
      ctx.stroke();
    }

    // Label nearby chunk cells in the upper-left corner of each chunk.
    ctx.fillStyle = "rgba(236,244,237,.28)";
    for (let cy = startChunkY; cy < endChunkY; cy += 1) {
      for (let cx = startChunkX; cx < endChunkX; cx += 1) {
        if (Math.max(Math.abs(cx - currentChunkX), Math.abs(cy - currentChunkY)) > 3) continue;
        const screenX = (cx * CHUNK_SIZE - state.camera.x) * tilePixels + state.width / 2;
        const screenY = (cy * CHUNK_SIZE - state.camera.y) * tilePixels + state.height / 2;
        if (screenX > -50 && screenY > -20 && screenX < state.width && screenY < state.height) {
          ctx.fillText(`${signed(cx)} / ${signed(cy)}`, screenX + 5, screenY + 5);
        }
      }
    }
    ctx.restore();
  }

  function objectChance(biome) {
    if (biome === BIOMES.rainforest) return .15;
    if (biome === BIOMES.forest) return .115;
    if (biome === BIOMES.plains) return .026;
    if (biome === BIOMES.dryland) return .018;
    if (biome === BIOMES.desert) return .026;
    if (biome === BIOMES.rock || biome === BIOMES.tundra) return .035;
    if (biome === BIOMES.beach) return .012;
    return 0;
  }

  function hasObject(x, y, biome) {
    return hash2D(x, y, 809) < objectChance(biome);
  }

  function drawObjects() {
    const tilePixels = getTilePixels();
    if (tilePixels < 4.2) return;
    const halfTilesX = state.width / 2 / tilePixels;
    const halfTilesY = state.height / 2 / tilePixels;
    const minX = Math.floor(state.camera.x - halfTilesX) - 1;
    const maxX = Math.ceil(state.camera.x + halfTilesX) + 1;
    const minY = Math.floor(state.camera.y - halfTilesY) - 1;
    const maxY = Math.ceil(state.camera.y + halfTilesY) + 1;
    const currentChunkX = Math.floor(state.camera.x / CHUNK_SIZE);
    const currentChunkY = Math.floor(state.camera.y / CHUNK_SIZE);

    ctx.save();
    ctx.lineCap = "round";
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const chunkDistance = Math.max(
          Math.abs(Math.floor(x / CHUNK_SIZE) - currentChunkX),
          Math.abs(Math.floor(y / CHUNK_SIZE) - currentChunkY)
        );
        if (chunkDistance > 2) continue;
        const sample = terrainAt(x + .5, y + .5);
        if (!sample.biome.object || !hasObject(x, y, sample.biome)) continue;
        const jitterX = (hash2D(x, y, 811) - .5) * tilePixels * .5;
        const jitterY = (hash2D(x, y, 821) - .5) * tilePixels * .5;
        const screenX = (x + .5 - state.camera.x) * tilePixels + state.width / 2 + jitterX;
        const screenY = (y + .5 - state.camera.y) * tilePixels + state.height / 2 + jitterY;
        const size = clamp(tilePixels * .65, 2.7, 7);
        drawObject(screenX, screenY, size, sample.biome.object, hash2D(x, y, 827));
      }
    }
    ctx.restore();
  }

  function drawObject(x, y, size, type, variant) {
    if (type === "tree") {
      ctx.strokeStyle = "rgba(24,36,23,.75)";
      ctx.lineWidth = Math.max(1, size * .16);
      ctx.beginPath();
      ctx.moveTo(x, y + size * .55);
      ctx.lineTo(x, y - size * .05);
      ctx.stroke();
      ctx.fillStyle = variant > .45 ? "#243f28" : "#2b4d2f";
      ctx.beginPath();
      ctx.arc(x, y - size * .25, size * .46, 0, Math.PI * 2);
      ctx.arc(x - size * .28, y, size * .31, 0, Math.PI * 2);
      ctx.arc(x + size * .28, y, size * .31, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === "cactus") {
      ctx.strokeStyle = "#455f39";
      ctx.lineWidth = Math.max(1.2, size * .25);
      ctx.beginPath();
      ctx.moveTo(x, y + size * .55);
      ctx.lineTo(x, y - size * .5);
      ctx.moveTo(x, y - size * .05);
      ctx.lineTo(x + size * .37, y - size * .25);
      ctx.moveTo(x, y + size * .14);
      ctx.lineTo(x - size * .32, y - size * .03);
      ctx.stroke();
    } else {
      ctx.fillStyle = variant > .5 ? "#73766c" : "#666b61";
      ctx.beginPath();
      ctx.moveTo(x - size * .48, y + size * .34);
      ctx.lineTo(x - size * .18, y - size * .42);
      ctx.lineTo(x + size * .42, y - size * .18);
      ctx.lineTo(x + size * .5, y + size * .38);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawEdgeLOD() {
    const gradient = ctx.createRadialGradient(
      state.width / 2, state.height / 2, Math.min(state.width, state.height) * .25,
      state.width / 2, state.height / 2, Math.max(state.width, state.height) * .69
    );
    gradient.addColorStop(0, "rgba(5,9,7,0)");
    gradient.addColorStop(.65, "rgba(5,9,7,.015)");
    gradient.addColorStop(1, "rgba(5,9,7,.34)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);
  }

  function countChunkObjects(chunkX, chunkY) {
    let count = 0;
    const startX = chunkX * CHUNK_SIZE;
    const startY = chunkY * CHUNK_SIZE;
    for (let y = startY; y < startY + CHUNK_SIZE; y += 1) {
      for (let x = startX; x < startX + CHUNK_SIZE; x += 1) {
        const biome = terrainAt(x + .5, y + .5).biome;
        if (biome.object && hasObject(x, y, biome)) count += 1;
      }
    }
    return count;
  }

  function updateInspector() {
    const chunkX = Math.floor(state.camera.x / CHUNK_SIZE);
    const chunkY = Math.floor(state.camera.y / CHUNK_SIZE);
    const sample = terrainAt(state.camera.x, state.camera.y);
    const elevation = Math.max(0, Math.round((sample.height - state.sea) / Math.max(.01, 1 - state.sea) * 2400));
    elements.coordinates.innerHTML = `X ${paddedSigned(Math.round(state.camera.x))}&nbsp;&nbsp; Z ${paddedSigned(Math.round(state.camera.y))}`;
    elements.chunkId.textContent = `${signed(chunkX)} / ${signed(chunkY)}`;
    elements.biomeName.textContent = sample.biome.name;
    elements.biomeSwatch.style.background = `rgb(${sample.biome.color.join(",")})`;
    elements.elevationStat.textContent = `${elevation.toLocaleString()} m`;
    elements.lodStat.textContent = "LOD 0";
    elements.objectStat.textContent = String(countChunkObjects(chunkX, chunkY));
  }

  function signed(number) {
    return `${number >= 0 ? "+" : "−"}${String(Math.abs(number)).padStart(2, "0")}`;
  }

  function paddedSigned(number) {
    return `${number >= 0 ? "+" : "−"}${String(Math.abs(number)).padStart(4, "0")}`;
  }

  function seedFromInput() {
    const raw = elements.seedInput.value.replace(/[^0-9]/g, "");
    const parsed = Number(raw);
    const normalized = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed % 2147483647) : 1;
    elements.seedInput.value = String(normalized);
    return normalized;
  }

  function worldTitle(seed) {
    const adjectives = ["Verdant", "Silent", "Mossbound", "Ancient", "Wild", "Emerald", "Sunken", "Silver", "Endless", "High"];
    const nouns = ["Reach", "Frontier", "Expanse", "Wilds", "Hollow", "March", "Basin", "Crown", "Vale", "Drift"];
    const a = Math.abs((seed * 7) ^ (seed >>> 5)) % adjectives.length;
    const n = Math.abs((seed * 13) ^ (seed >>> 7)) % nouns.length;
    return `THE ${adjectives[a]} ${nouns[n]}`.toUpperCase();
  }

  function applySeed(withTransition = true) {
    if (withTransition) stage.classList.add("generating");
    state.seed = seedFromInput();
    state.camera.x = 0;
    state.camera.y = 0;
    elements.worldSeedLabel.textContent = `SEED ${state.seed}`;
    elements.worldName.textContent = worldTitle(state.seed);
    state.dirty = true;
    window.setTimeout(() => {
      stage.classList.remove("generating");
      state.dirty = true;
    }, withTransition ? 320 : 0);
  }

  function setZoom(nextZoom) {
    state.zoom = clamp(nextZoom, .55, 1.8);
    elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    state.dirty = true;
  }

  function updateRange(range) {
    const min = Number(range.min);
    const max = Number(range.max);
    const value = Number(range.value);
    range.style.setProperty("--value", `${(value - min) / (max - min) * 100}%`);
  }

  function syncControls() {
    state.scale = Number(elements.scale.value);
    state.elevation = Number(elements.elevation.value) / 100;
    state.sea = Number(elements.sea.value) / 100;
    state.diversity = Number(elements.biome.value) / 100;
    elements.scaleValue.textContent = `${elements.scale.value}%`;
    elements.elevationValue.textContent = `${state.elevation.toFixed(2)}×`;
    elements.seaValue.textContent = `${elements.sea.value}%`;
    elements.biomeValue.textContent = `${elements.biome.value}%`;
    [elements.scale, elements.elevation, elements.sea, elements.biome].forEach(updateRange);
    state.dirty = true;
  }

  function applyPreset(name) {
    const presets = {
      islands: { scale: 78, elevation: 88, sea: 55, biome: 82 },
      balanced: { scale: 64, elevation: 100, sea: 42, biome: 72 },
      highlands: { scale: 48, elevation: 137, sea: 33, biome: 58 }
    };
    const preset = presets[name];
    if (!preset) return;
    elements.scale.value = preset.scale;
    elements.elevation.value = preset.elevation;
    elements.sea.value = preset.sea;
    elements.biome.value = preset.biome;
    state.profile = name;
    elements.profileName.textContent = name.toUpperCase();
    document.querySelectorAll("[data-preset]").forEach((button) => button.classList.toggle("selected", button.dataset.preset === name));
    syncControls();
  }

  let toastTimer;
  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 1800);
  }

  async function copySeed() {
    const value = String(state.seed);
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      elements.seedInput.select();
      document.execCommand("copy");
      window.getSelection()?.removeAllRanges();
    }
    showToast(`Seed ${value} copied`);
  }

  function randomizeSeed() {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    elements.seedInput.value = String((array[0] % 999999999) + 1);
    applySeed(true);
  }

  function animationLoop(now) {
    const delta = Math.min((now - state.lastFrame) / 1000, .05);
    state.lastFrame = now;
    let dx = 0;
    let dy = 0;
    if (state.keys.has("w") || state.keys.has("arrowup")) dy -= 1;
    if (state.keys.has("s") || state.keys.has("arrowdown")) dy += 1;
    if (state.keys.has("a") || state.keys.has("arrowleft")) dx -= 1;
    if (state.keys.has("d") || state.keys.has("arrowright")) dx += 1;
    if (dx || dy) {
      const length = Math.hypot(dx, dy);
      const speed = 18 / Math.sqrt(state.zoom);
      state.camera.x += dx / length * speed * delta;
      state.camera.y += dy / length * speed * delta;
      state.facing = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      elements.playerArrow.style.transform = `rotate(${state.facing}deg)`;
      state.dirty = true;
    }
    // Cap expensive noise rerenders while moving, while keeping controls responsive.
    if (state.dirty && now - state.lastRender > 55) {
      drawTerrain();
      state.dirty = false;
      state.lastRender = now;
    }
    requestAnimationFrame(animationLoop);
  }

  document.getElementById("generateButton").addEventListener("click", () => applySeed(true));
  document.getElementById("randomSeed").addEventListener("click", randomizeSeed);
  document.getElementById("copySeed").addEventListener("click", copySeed);
  elements.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") applySeed(true);
  });
  elements.seedInput.addEventListener("input", () => {
    elements.seedInput.value = elements.seedInput.value.replace(/[^0-9]/g, "").slice(0, 10);
  });

  [elements.scale, elements.elevation, elements.sea, elements.biome].forEach((range) => {
    range.addEventListener("input", () => {
      document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("selected"));
      elements.profileName.textContent = "CUSTOM";
      syncControls();
    });
  });
  [elements.grid, elements.contours, elements.objects].forEach((toggle) => toggle.addEventListener("change", () => { state.dirty = true; }));
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));

  document.getElementById("zoomIn").addEventListener("click", () => setZoom(state.zoom + .15));
  document.getElementById("zoomOut").addEventListener("click", () => setZoom(state.zoom - .15));
  document.getElementById("centerButton").addEventListener("click", () => {
    state.camera.x = 0;
    state.camera.y = 0;
    state.dirty = true;
    showToast("Returned to world origin");
  });
  document.getElementById("fullscreenButton").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch (_) {
      showToast("Fullscreen is unavailable here");
    }
  });

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(state.zoom * (event.deltaY > 0 ? .91 : 1.1));
  }, { passive: false });

  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.dragOrigin = { x: event.clientX, y: event.clientY };
    state.dragCamera = { ...state.camera };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    const tilePixels = getTilePixels();
    state.camera.x = state.dragCamera.x - (event.clientX - state.dragOrigin.x) / tilePixels;
    state.camera.y = state.dragCamera.y - (event.clientY - state.dragOrigin.y) / tilePixels;
    state.dirty = true;
  });
  function endDrag(event) {
    state.dragging = false;
    if (event?.pointerId != null && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key) && document.activeElement !== elements.seedInput) {
      event.preventDefault();
      state.keys.add(key);
    }
  });
  window.addEventListener("keyup", (event) => state.keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => state.keys.clear());

  const guideDialog = document.getElementById("guideDialog");
  document.getElementById("helpButton").addEventListener("click", () => guideDialog.showModal());
  document.getElementById("closeGuide").addEventListener("click", () => guideDialog.close());
  guideDialog.addEventListener("click", (event) => {
    if (event.target === guideDialog) guideDialog.close();
  });
  document.getElementById("collapsePanel").addEventListener("click", () => document.querySelector(".control-panel").classList.toggle("collapsed"));

  document.querySelectorAll(".main-nav a").forEach((link) => {
    link.addEventListener("click", (event) => {
      document.querySelectorAll(".main-nav a").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
      if (link.getAttribute("href") === "#guide") {
        event.preventDefault();
        guideDialog.showModal();
      }
    });
  });

  if (window.matchMedia("(max-width: 820px)").matches) {
    document.querySelector(".control-panel").classList.add("collapsed");
  }
  new ResizeObserver(resizeCanvas).observe(stage);
  document.addEventListener("fullscreenchange", resizeCanvas);
  syncControls();
  applySeed(false);
  resizeCanvas();
  requestAnimationFrame(animationLoop);
})();
