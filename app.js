import * as THREE from "./vendor/three.module.min.js";

const canvas = document.getElementById("worldCanvas");
const stage = document.querySelector(".world-stage");
const CHUNK_SIZE = 16;
const CHUNK_RADIUS = 3;
const HEIGHT_SCALE = 34;
const DEFAULT_CAMERA_DISTANCE = 64;

const elements = {
  seedInput: document.getElementById("seedInput"),
  worldSeedLabel: document.getElementById("worldSeedLabel"),
  worldName: document.getElementById("worldName"),
  coordinates: document.getElementById("coordinates"),
  chunkId: document.getElementById("chunkId"),
  chunkCount: document.getElementById("chunkCount"),
  lodCount: document.getElementById("lodCount"),
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
  exportButton: document.getElementById("exportButton"),
  toast: document.getElementById("toast"),
  playerArrow: document.querySelector(".player-marker svg")
};

const BIOMES = {
  deepWater: { name: "DEEP OCEAN", color: [27, 65, 73], object: null },
  water: { name: "OPEN WATER", color: [37, 88, 91], object: null },
  shallows: { name: "COASTAL WATER", color: [57, 119, 111], object: null },
  beach: { name: "SANDY SHORE", color: [203, 181, 105], object: "rock" },
  desert: { name: "ARID DESERT", color: [199, 151, 76], object: "cactus" },
  dryland: { name: "DRY GRASSLAND", color: [151, 157, 78], object: "rock" },
  plains: { name: "OPEN PLAINS", color: [113, 164, 75], object: "tree" },
  forest: { name: "TEMPERATE FOREST", color: [57, 120, 67], object: "tree" },
  rainforest: { name: "DENSE RAINFOREST", color: [41, 95, 60], object: "tree" },
  tundra: { name: "ALPINE TUNDRA", color: [143, 153, 128], object: "rock" },
  rock: { name: "ROCKY HIGHLANDS", color: [129, 125, 111], object: "rock" },
  snow: { name: "SNOW-CAPPED PEAKS", color: [229, 229, 214], object: "rock" }
};

const state = {
  seed: 102787,
  scale: 64,
  elevation: 1,
  sea: .42,
  diversity: .72,
  profile: "balanced",
  exportFormat: "obj",
  player: { x: 0, z: 0 },
  orbit: { yaw: .72, pitch: .45, distance: DEFAULT_CAMERA_DISTANCE },
  keys: new Set(),
  pointer: null,
  facing: 0,
  activeChunk: "",
  lastFrame: performance.now(),
  lastInspector: 0,
  rebuildTimer: 0
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function hash2D(x, z, salt = 0) {
  let hash = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  hash = (hash + Math.imul((state.seed + salt) | 0, 1442695041)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295;
}

function valueNoise(x, z, salt) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2D(ix, iz, salt);
  const b = hash2D(ix + 1, iz, salt);
  const c = hash2D(ix, iz + 1, salt);
  const d = hash2D(ix + 1, iz + 1, salt);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

function fbm(x, z, salt, octaves = 5) {
  let value = 0;
  let amplitude = .52;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise(x * frequency, z * frequency, salt + octave * 977) * amplitude;
    total += amplitude;
    amplitude *= .5;
    frequency *= 2.03;
  }
  return value / total;
}

function heightAt(x, z) {
  const frequency = lerp(.0064, .016, (state.scale - 32) / 68);
  const broad = fbm(x * frequency * .28, z * frequency * .28, 101, 4);
  const terrain = fbm(x * frequency, z * frequency, 211, 5);
  const ridgeNoise = fbm((x + 340) * frequency * .67, (z - 170) * frequency * .67, 307, 4);
  const ridges = 1 - Math.abs(ridgeNoise * 2 - 1);
  let height = broad * .45 + terrain * .42 + ridges * .13;
  height = (height - .5) * state.elevation + .5;
  return clamp(height, 0, 1);
}

function terrainAt(x, z) {
  const height = heightAt(x, z);
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
    moisture = fbm((x + 940) * climateFrequency, (z - 420) * climateFrequency, 401, 3);
    const latitudeWave = Math.sin((z + (state.seed % 3000)) * .0022) * .14;
    temperature = clamp(
      fbm((x - 700) * climateFrequency * .57, (z + 510) * climateFrequency * .57, 503, 3)
        + latitudeWave - (height - sea) * .48,
      0,
      1
    );

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

function stylizedColor(sample, x, z) {
  const source = sample.biome.color;
  const grain = (hash2D(Math.floor(x * 1.8), Math.floor(z * 1.8), 701) - .5) * 13;
  const altitude = (sample.height - state.sea) * 18;
  const factor = 1 + grain / 100 + altitude / 100;
  return [
    clamp(Math.round(source[0] * factor), 0, 255),
    clamp(Math.round(source[1] * factor), 0, 255),
    clamp(Math.round(source[2] * factor), 0, 255)
  ];
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0xb7c5b4, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7c5b4);
scene.fog = new THREE.Fog(0xb7c5b4, 72, 178);

const camera = new THREE.PerspectiveCamera(46, 1, .1, 320);
const terrainRoot = new THREE.Group();
const objectRoot = new THREE.Group();
const atmosphereRoot = new THREE.Group();
scene.add(terrainRoot, objectRoot, atmosphereRoot);

const hemisphere = new THREE.HemisphereLight(0xf5f1d1, 0x344338, 1.2);
scene.add(hemisphere);
const sunLight = new THREE.DirectionalLight(0xfff0c2, 2.1);
sunLight.position.set(-42, 76, -26);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.left = -68;
sunLight.shadow.camera.right = 68;
sunLight.shadow.camera.top = 68;
sunLight.shadow.camera.bottom = -68;
sunLight.shadow.camera.near = 8;
sunLight.shadow.camera.far = 170;
sunLight.shadow.bias = -.0008;
sunLight.shadow.normalBias = .035;
scene.add(sunLight, sunLight.target);

const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: .96,
  metalness: 0,
  flatShading: true,
  side: THREE.DoubleSide
});
const contourMaterial = new THREE.MeshBasicMaterial({
  color: 0x17231d,
  wireframe: true,
  transparent: true,
  opacity: .14,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1
});
const chunkLineMaterial = new THREE.LineBasicMaterial({
  color: 0xd9efad,
  transparent: true,
  opacity: .52,
  depthTest: false
});

const waterGeometry = new THREE.PlaneGeometry(280, 280, 80, 80);
const waterMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: true,
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x2e7f87) }
    }
  ]),
  vertexShader: `
    #include <fog_pars_vertex>
    uniform float uTime;
    varying float vWave;
    void main() {
      vec3 p = position;
      float wave = sin(p.x * 0.105 + uTime) * 0.11;
      wave += cos(p.y * 0.13 - uTime * 0.72) * 0.075;
      p.z += wave;
      vWave = wave;
      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: `
    #include <fog_pars_fragment>
    uniform vec3 uColor;
    varying float vWave;
    void main() {
      vec3 color = uColor + vec3(vWave * 0.11);
      gl_FragColor = vec4(color, 0.77);
      #include <fog_fragment>
    }
  `
});
const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.rotation.x = -Math.PI / 2;
water.renderOrder = 2;
scene.add(water);

const markerRing = new THREE.Mesh(
  new THREE.RingGeometry(.55, .72, 28),
  new THREE.MeshBasicMaterial({ color: 0xb9ed63, transparent: true, opacity: .92, side: THREE.DoubleSide })
);
markerRing.rotation.x = -Math.PI / 2;
markerRing.renderOrder = 4;
const markerCore = new THREE.Mesh(
  new THREE.ConeGeometry(.22, .72, 5),
  new THREE.MeshBasicMaterial({ color: 0xd2ff7e })
);
scene.add(markerRing, markerCore);

const cloudGeometry = new THREE.DodecahedronGeometry(1, 1);
const cloudMaterial = new THREE.MeshBasicMaterial({
  color: 0xf3f1df,
  transparent: true,
  opacity: .5,
  depthWrite: false,
  fog: true
});
for (let cloudIndex = 0; cloudIndex < 10; cloudIndex += 1) {
  const cloud = new THREE.Group();
  const angle = cloudIndex * 2.399;
  const radius = 35 + (cloudIndex % 4) * 18;
  cloud.position.set(Math.cos(angle) * radius, 27 + (cloudIndex % 3) * 5, Math.sin(angle) * radius);
  cloud.userData.speed = .22 + (cloudIndex % 4) * .06;
  for (let puff = 0; puff < 3; puff += 1) {
    const mesh = new THREE.Mesh(cloudGeometry, cloudMaterial);
    mesh.position.set((puff - 1) * 2.2, Math.sin(puff * 2.1) * .5, 0);
    mesh.scale.set(2.6 + puff * .7, 1.1 + puff * .3, 1.5 + puff * .25);
    cloud.add(mesh);
  }
  atmosphereRoot.add(cloud);
}

function makeSunTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 128;
  textureCanvas.height = 128;
  const textureContext = textureCanvas.getContext("2d");
  const glow = textureContext.createRadialGradient(64, 64, 8, 64, 64, 62);
  glow.addColorStop(0, "rgba(255,249,190,1)");
  glow.addColorStop(.48, "rgba(255,237,150,.95)");
  glow.addColorStop(1, "rgba(255,237,150,0)");
  textureContext.fillStyle = glow;
  textureContext.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(textureCanvas);
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeSunTexture(),
  transparent: true,
  depthWrite: false,
  fog: false,
  color: 0xfff1a6
}));
sunSprite.scale.set(22, 22, 1);
sunSprite.position.set(-72, 82, -108);
atmosphereRoot.add(sunSprite);

const objectGeometries = {
  trunk: new THREE.CylinderGeometry(.14, .19, 1.1, 5),
  crown: new THREE.ConeGeometry(.72, 1.75, 6),
  rock: new THREE.IcosahedronGeometry(.55, 0),
  cactus: new THREE.CylinderGeometry(.17, .23, 1.65, 5)
};
const objectMaterials = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x704c32, roughness: 1, flatShading: true }),
  crown: new THREE.MeshStandardMaterial({ color: 0x326e3f, roughness: 1, flatShading: true }),
  rock: new THREE.MeshStandardMaterial({ color: 0x77776c, roughness: 1, flatShading: true }),
  cactus: new THREE.MeshStandardMaterial({ color: 0x628342, roughness: 1, flatShading: true })
};

const loadedChunks = new Map();

function lodForDistance(distance) {
  if (distance <= 1) return 0;
  if (distance <= 2) return 1;
  return 2;
}

function resolutionForLOD(lod) {
  return lod === 0 ? 16 : lod === 1 ? 8 : 4;
}

function buildChunkGeometry(chunkX, chunkZ, lod) {
  const resolution = resolutionForLOD(lod);
  const step = CHUNK_SIZE / resolution;
  const positions = [];
  const colors = [];
  const indices = [];
  const rowSize = resolution + 1;

  function pushColor(color, multiplier = 1) {
    const toLinear = (component) => {
      const value = clamp(component * multiplier / 255, 0, 1);
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    };
    colors.push(toLinear(color[0]), toLinear(color[1]), toLinear(color[2]));
  }

  for (let z = 0; z <= resolution; z += 1) {
    for (let x = 0; x <= resolution; x += 1) {
      const localX = x * step;
      const localZ = z * step;
      const worldX = chunkX * CHUNK_SIZE + localX;
      const worldZ = chunkZ * CHUNK_SIZE + localZ;
      const sample = terrainAt(worldX, worldZ);
      positions.push(localX, sample.height * HEIGHT_SCALE, localZ);
      pushColor(stylizedColor(sample, worldX, worldZ));
    }
  }

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const a = z * rowSize + x;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  function addSkirt(edgePoints) {
    const base = positions.length / 3;
    for (const [localX, localZ] of edgePoints) {
      const worldX = chunkX * CHUNK_SIZE + localX;
      const worldZ = chunkZ * CHUNK_SIZE + localZ;
      const sample = terrainAt(worldX, worldZ);
      const height = sample.height * HEIGHT_SCALE;
      const color = stylizedColor(sample, worldX, worldZ);
      positions.push(localX, height + .01, localZ);
      pushColor(color, 1);
      positions.push(localX, height - 3.2, localZ);
      pushColor(color, .82);
    }
    for (let point = 0; point < edgePoints.length - 1; point += 1) {
      const top = base + point * 2;
      const bottom = top + 1;
      const nextTop = top + 2;
      const nextBottom = top + 3;
      indices.push(top, bottom, nextTop, nextTop, bottom, nextBottom);
    }
  }

  const north = [];
  const east = [];
  const south = [];
  const west = [];
  for (let point = 0; point <= resolution; point += 1) {
    const position = point * step;
    north.push([position, 0]);
    east.push([CHUNK_SIZE, position]);
    south.push([CHUNK_SIZE - position, CHUNK_SIZE]);
    west.push([0, CHUNK_SIZE - position]);
  }
  addSkirt(north);
  addSkirt(east);
  addSkirt(south);
  addSkirt(west);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildChunkOutline(chunkX, chunkZ, lod) {
  const resolution = resolutionForLOD(lod);
  const step = CHUNK_SIZE / resolution;
  const points = [];
  function point(localX, localZ) {
    const worldX = chunkX * CHUNK_SIZE + localX;
    const worldZ = chunkZ * CHUNK_SIZE + localZ;
    points.push(localX, heightAt(worldX, worldZ) * HEIGHT_SCALE + .16, localZ);
  }
  for (let i = 0; i < resolution; i += 1) point(i * step, 0);
  for (let i = 0; i < resolution; i += 1) point(CHUNK_SIZE, i * step);
  for (let i = resolution; i > 0; i -= 1) point(i * step, CHUNK_SIZE);
  for (let i = resolution; i > 0; i -= 1) point(0, i * step);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

function createChunk(chunkX, chunkZ, lod) {
  const group = new THREE.Group();
  group.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE);
  group.userData = { chunkX, chunkZ, lod };

  const geometry = buildChunkGeometry(chunkX, chunkZ, lod);
  const terrain = new THREE.Mesh(geometry, terrainMaterial);
  terrain.castShadow = lod < 2;
  terrain.receiveShadow = true;
  group.add(terrain);

  const contour = new THREE.Mesh(geometry, contourMaterial);
  contour.position.y = .035;
  contour.visible = elements.contours.checked;
  contour.userData.layer = "contour";
  group.add(contour);

  const outline = new THREE.LineLoop(buildChunkOutline(chunkX, chunkZ, lod), chunkLineMaterial);
  outline.visible = elements.grid.checked;
  outline.renderOrder = 3;
  outline.userData.layer = "grid";
  group.add(outline);
  return group;
}

function disposeChunk(group) {
  const geometries = new Set();
  group.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
  });
  geometries.forEach((geometry) => geometry.dispose());
  terrainRoot.remove(group);
}

function objectChance(biome) {
  if (biome === BIOMES.rainforest) return .12;
  if (biome === BIOMES.forest) return .085;
  if (biome === BIOMES.plains) return .025;
  if (biome === BIOMES.dryland) return .018;
  if (biome === BIOMES.desert) return .025;
  if (biome === BIOMES.rock || biome === BIOMES.tundra) return .03;
  if (biome === BIOMES.beach) return .01;
  return 0;
}

function hasObject(x, z, biome) {
  return hash2D(x, z, 809) < objectChance(biome);
}

function clearInstances() {
  while (objectRoot.children.length) objectRoot.remove(objectRoot.children[0]);
}

function makeInstancedMesh(geometry, material, entries, transform) {
  if (!entries.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  entries.forEach((entry, index) => {
    transform(dummy, entry);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    const tint = .87 + entry.variant * .2;
    color.setRGB(tint, tint, tint);
    mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  objectRoot.add(mesh);
  return mesh;
}

function rebuildObjects(playerChunkX, playerChunkZ) {
  clearInstances();
  const trees = [];
  const rocks = [];
  const cacti = [];

  for (let chunkZ = playerChunkZ - 2; chunkZ <= playerChunkZ + 2; chunkZ += 1) {
    for (let chunkX = playerChunkX - 2; chunkX <= playerChunkX + 2; chunkX += 1) {
      const startX = chunkX * CHUNK_SIZE;
      const startZ = chunkZ * CHUNK_SIZE;
      for (let z = startZ; z < startZ + CHUNK_SIZE; z += 1) {
        for (let x = startX; x < startX + CHUNK_SIZE; x += 1) {
          const sample = terrainAt(x + .5, z + .5);
          if (!sample.biome.object || !hasObject(x, z, sample.biome)) continue;
          const entry = {
            x: x + .5 + (hash2D(x, z, 811) - .5) * .65,
            z: z + .5 + (hash2D(x, z, 821) - .5) * .65,
            y: sample.height * HEIGHT_SCALE,
            scale: .72 + hash2D(x, z, 827) * .72,
            rotation: hash2D(x, z, 829) * Math.PI * 2,
            variant: hash2D(x, z, 839)
          };
          if (sample.biome.object === "tree") trees.push(entry);
          else if (sample.biome.object === "cactus") cacti.push(entry);
          else rocks.push(entry);
        }
      }
    }
  }

  makeInstancedMesh(objectGeometries.trunk, objectMaterials.trunk, trees, (dummy, entry) => {
    dummy.position.set(entry.x, entry.y + .55 * entry.scale, entry.z);
    dummy.rotation.set(0, entry.rotation, 0);
    dummy.scale.setScalar(entry.scale);
  });
  makeInstancedMesh(objectGeometries.crown, objectMaterials.crown, trees, (dummy, entry) => {
    dummy.position.set(entry.x, entry.y + 1.58 * entry.scale, entry.z);
    dummy.rotation.set(0, entry.rotation, 0);
    dummy.scale.setScalar(entry.scale);
  });
  makeInstancedMesh(objectGeometries.rock, objectMaterials.rock, rocks, (dummy, entry) => {
    dummy.position.set(entry.x, entry.y + .28 * entry.scale, entry.z);
    dummy.rotation.set(entry.variant * .4, entry.rotation, entry.variant * .3);
    dummy.scale.set(entry.scale, entry.scale * (.48 + entry.variant * .3), entry.scale * (.7 + entry.variant * .25));
  });
  makeInstancedMesh(objectGeometries.cactus, objectMaterials.cactus, cacti, (dummy, entry) => {
    dummy.position.set(entry.x, entry.y + .8 * entry.scale, entry.z);
    dummy.rotation.set(0, entry.rotation, 0);
    dummy.scale.setScalar(entry.scale);
  });
  objectRoot.visible = elements.objects.checked;
}

function syncChunks(force = false) {
  const playerChunkX = Math.floor(state.player.x / CHUNK_SIZE);
  const playerChunkZ = Math.floor(state.player.z / CHUNK_SIZE);
  const desired = new Map();

  for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz += 1) {
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx += 1) {
      const chunkX = playerChunkX + dx;
      const chunkZ = playerChunkZ + dz;
      const distance = Math.max(Math.abs(dx), Math.abs(dz));
      desired.set(`${chunkX},${chunkZ}`, { chunkX, chunkZ, lod: lodForDistance(distance) });
    }
  }

  for (const [key, chunk] of loadedChunks) {
    const target = desired.get(key);
    if (force || !target || target.lod !== chunk.userData.lod) {
      disposeChunk(chunk);
      loadedChunks.delete(key);
    }
  }

  for (const [key, target] of desired) {
    if (loadedChunks.has(key)) continue;
    const chunk = createChunk(target.chunkX, target.chunkZ, target.lod);
    loadedChunks.set(key, chunk);
    terrainRoot.add(chunk);
  }

  rebuildObjects(playerChunkX, playerChunkZ);
  state.activeChunk = `${playerChunkX},${playerChunkZ}`;
  elements.chunkCount.textContent = String(loadedChunks.size);
  elements.lodCount.textContent = String([...loadedChunks.values()].filter((chunk) => chunk.userData.lod === 2).length);
  water.position.set(
    Math.floor(state.player.x / 64) * 64,
    state.sea * HEIGHT_SCALE + .03,
    Math.floor(state.player.z / 64) * 64
  );
  atmosphereRoot.position.x = Math.floor(state.player.x / 64) * 64;
  atmosphereRoot.position.z = Math.floor(state.player.z / 64) * 64;
  updateInspector(true);
}

function rebuildWorld(withTransition = false) {
  if (withTransition) stage.classList.add("generating");
  const rebuild = () => {
    syncChunks(true);
    water.position.y = state.sea * HEIGHT_SCALE + .03;
    if (withTransition) window.setTimeout(() => stage.classList.remove("generating"), 240);
  };
  if (withTransition) window.setTimeout(rebuild, 35);
  else rebuild();
}

function scheduleWorldRebuild() {
  clearTimeout(state.rebuildTimer);
  state.rebuildTimer = window.setTimeout(() => rebuildWorld(false), 130);
}

function countChunkObjects(chunkX, chunkZ) {
  let count = 0;
  const startX = chunkX * CHUNK_SIZE;
  const startZ = chunkZ * CHUNK_SIZE;
  for (let z = startZ; z < startZ + CHUNK_SIZE; z += 1) {
    for (let x = startX; x < startX + CHUNK_SIZE; x += 1) {
      const biome = terrainAt(x + .5, z + .5).biome;
      if (biome.object && hasObject(x, z, biome)) count += 1;
    }
  }
  return count;
}

function signed(number) {
  return `${number >= 0 ? "+" : "−"}${String(Math.abs(number)).padStart(2, "0")}`;
}

function paddedSigned(number) {
  return `${number >= 0 ? "+" : "−"}${String(Math.abs(number)).padStart(4, "0")}`;
}

function updateInspector(force = false) {
  const now = performance.now();
  if (!force && now - state.lastInspector < 250) return;
  state.lastInspector = now;
  const chunkX = Math.floor(state.player.x / CHUNK_SIZE);
  const chunkZ = Math.floor(state.player.z / CHUNK_SIZE);
  const sample = terrainAt(state.player.x, state.player.z);
  const elevation = Math.max(0, Math.round((sample.height - state.sea) / Math.max(.01, 1 - state.sea) * 2400));
  elements.coordinates.innerHTML = `X ${paddedSigned(Math.round(state.player.x))}&nbsp;&nbsp; Z ${paddedSigned(Math.round(state.player.z))}`;
  elements.chunkId.textContent = `${signed(chunkX)} / ${signed(chunkZ)}`;
  elements.biomeName.textContent = sample.biome.name;
  elements.biomeSwatch.style.background = `rgb(${sample.biome.color.join(",")})`;
  elements.elevationStat.textContent = `${elevation.toLocaleString()} m`;
  elements.lodStat.textContent = "LOD 0";
  elements.objectStat.textContent = String(countChunkObjects(chunkX, chunkZ));
}

function updateCamera() {
  const groundHeight = heightAt(state.player.x, state.player.z) * HEIGHT_SCALE;
  const targetY = groundHeight + 1.1;
  const horizontal = Math.cos(state.orbit.pitch) * state.orbit.distance;
  camera.position.set(
    state.player.x + Math.sin(state.orbit.yaw) * horizontal,
    targetY + Math.sin(state.orbit.pitch) * state.orbit.distance,
    state.player.z + Math.cos(state.orbit.yaw) * horizontal
  );
  camera.lookAt(state.player.x, targetY, state.player.z);

  markerRing.position.set(state.player.x, groundHeight + .15, state.player.z);
  markerCore.position.set(state.player.x, groundHeight + .65, state.player.z);
  markerCore.rotation.y = -state.facing * Math.PI / 180;

  sunLight.position.set(state.player.x - 42, groundHeight + 76, state.player.z - 26);
  sunLight.target.position.set(state.player.x, groundHeight, state.player.z);
}

function resizeRenderer() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function setCameraDistance(distance) {
  state.orbit.distance = clamp(distance, 18, 108);
  elements.zoomLabel.textContent = `${Math.round(DEFAULT_CAMERA_DISTANCE / state.orbit.distance * 100)}%`;
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
  const adjective = Math.abs((seed * 7) ^ (seed >>> 5)) % adjectives.length;
  const noun = Math.abs((seed * 13) ^ (seed >>> 7)) % nouns.length;
  return `THE ${adjectives[adjective]} ${nouns[noun]}`.toUpperCase();
}

function applySeed(withTransition = true) {
  state.seed = seedFromInput();
  state.player.x = 0;
  state.player.z = 0;
  state.activeChunk = "";
  elements.worldSeedLabel.textContent = `SEED ${state.seed}`;
  elements.worldName.textContent = worldTitle(state.seed);
  rebuildWorld(withTransition);
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
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.preset === name);
  });
  syncControls();
  rebuildWorld(false);
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
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  elements.seedInput.value = String((values[0] % 999999999) + 1);
  applySeed(true);
}

function buildExportMesh() {
  const tileCount = 64;
  const rowSize = tileCount + 1;
  const vertexCount = rowSize * rowSize;
  const startX = Math.floor(state.player.x) - tileCount / 2;
  const startZ = Math.floor(state.player.z) - tileCount / 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Uint8Array(vertexCount * 4);
  const indices = new Uint16Array(tileCount * tileCount * 6);
  let minimumHeight = Infinity;
  let maximumHeight = -Infinity;

  for (let z = 0; z <= tileCount; z += 1) {
    for (let x = 0; x <= tileCount; x += 1) {
      const vertex = z * rowSize + x;
      const worldX = startX + x;
      const worldZ = startZ + z;
      const sample = terrainAt(worldX, worldZ);
      const modelHeight = sample.height * HEIGHT_SCALE;
      const positionOffset = vertex * 3;
      const colorOffset = vertex * 4;
      positions[positionOffset] = x - tileCount / 2;
      positions[positionOffset + 1] = modelHeight;
      positions[positionOffset + 2] = z - tileCount / 2;
      minimumHeight = Math.min(minimumHeight, modelHeight);
      maximumHeight = Math.max(maximumHeight, modelHeight);

      const slopeX = (heightAt(worldX + 1, worldZ) - heightAt(worldX - 1, worldZ)) * HEIGHT_SCALE;
      const slopeZ = (heightAt(worldX, worldZ + 1) - heightAt(worldX, worldZ - 1)) * HEIGHT_SCALE;
      const normalLength = Math.hypot(slopeX, 2, slopeZ) || 1;
      normals[positionOffset] = -slopeX / normalLength;
      normals[positionOffset + 1] = 2 / normalLength;
      normals[positionOffset + 2] = -slopeZ / normalLength;

      const color = stylizedColor(sample, worldX, worldZ);
      colors[colorOffset] = color[0];
      colors[colorOffset + 1] = color[1];
      colors[colorOffset + 2] = color[2];
      colors[colorOffset + 3] = 255;
    }
  }

  let offset = 0;
  for (let z = 0; z < tileCount; z += 1) {
    for (let x = 0; x < tileCount; x += 1) {
      const a = z * rowSize + x;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      indices[offset++] = a;
      indices[offset++] = c;
      indices[offset++] = b;
      indices[offset++] = b;
      indices[offset++] = c;
      indices[offset++] = d;
    }
  }

  return {
    tileCount,
    vertexCount,
    startX,
    startZ,
    minimumHeight,
    maximumHeight,
    positions,
    normals,
    colors,
    indices
  };
}

function meshToOBJ(mesh) {
  const lines = [
    "# WorldGen stylized 3D terrain export",
    `# Seed: ${state.seed}`,
    `# World origin: X ${mesh.startX}, Z ${mesh.startZ}`,
    `o WorldGen_${state.seed}`
  ];
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const p = vertex * 3;
    const c = vertex * 4;
    lines.push(`v ${mesh.positions[p].toFixed(5)} ${mesh.positions[p + 1].toFixed(5)} ${mesh.positions[p + 2].toFixed(5)} ${(mesh.colors[c] / 255).toFixed(4)} ${(mesh.colors[c + 1] / 255).toFixed(4)} ${(mesh.colors[c + 2] / 255).toFixed(4)}`);
  }
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const n = vertex * 3;
    lines.push(`vn ${mesh.normals[n].toFixed(6)} ${mesh.normals[n + 1].toFixed(6)} ${mesh.normals[n + 2].toFixed(6)}`);
  }
  lines.push("s 1");
  for (let face = 0; face < mesh.indices.length; face += 3) {
    const a = mesh.indices[face] + 1;
    const b = mesh.indices[face + 1] + 1;
    const c = mesh.indices[face + 2] + 1;
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
}

function meshToGLB(mesh) {
  const positionBytes = new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  const normalBytes = new Uint8Array(mesh.normals.buffer, mesh.normals.byteOffset, mesh.normals.byteLength);
  const colorBytes = new Uint8Array(mesh.colors.buffer, mesh.colors.byteOffset, mesh.colors.byteLength);
  const indexBytes = new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
  const normalOffset = positionBytes.byteLength;
  const colorOffset = normalOffset + normalBytes.byteLength;
  const indexOffset = colorOffset + colorBytes.byteLength;
  const binaryLength = indexOffset + indexBytes.byteLength;
  const binary = new Uint8Array(binaryLength);
  binary.set(positionBytes, 0);
  binary.set(normalBytes, normalOffset);
  binary.set(colorBytes, colorOffset);
  binary.set(indexBytes, indexOffset);

  const half = mesh.tileCount / 2;
  const gltf = {
    asset: { version: "2.0", generator: "WorldGen 3D Terrain Explorer" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: `WorldGen Terrain ${state.seed}` }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{
      name: "Biome vertex colors",
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true
    }],
    buffers: [{ byteLength: binaryLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: colorOffset, byteLength: colorBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes.byteLength, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.vertexCount, type: "VEC3", min: [-half, mesh.minimumHeight, -half], max: [half, mesh.maximumHeight, half] },
      { bufferView: 1, componentType: 5126, count: mesh.vertexCount, type: "VEC3" },
      { bufferView: 2, componentType: 5121, normalized: true, count: mesh.vertexCount, type: "VEC4" },
      { bufferView: 3, componentType: 5123, count: mesh.indices.length, type: "SCALAR", min: [0], max: [mesh.vertexCount - 1] }
    ],
    extras: { seed: state.seed, worldOrigin: [mesh.startX, mesh.startZ], tileCount: mesh.tileCount, chunkSize: CHUNK_SIZE, seaLevel: state.sea }
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const paddedJSONLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
  const paddedBinaryLength = Math.ceil(binary.byteLength / 4) * 4;
  const totalLength = 12 + 8 + paddedJSONLength + 8 + paddedBinaryLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  const bytes = new Uint8Array(glb);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJSONLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + paddedJSONLength);
  bytes.set(jsonBytes, 20);
  const binaryHeader = 20 + paddedJSONLength;
  view.setUint32(binaryHeader, paddedBinaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  bytes.set(binary, binaryHeader + 8);
  return new Blob([glb], { type: "model/gltf-binary" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCurrentRegion() {
  const label = elements.exportButton.querySelector("span");
  elements.exportButton.disabled = true;
  label.textContent = "BUILDING MESH…";
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const mesh = buildExportMesh();
    const format = state.exportFormat;
    const blob = format === "glb" ? meshToGLB(mesh) : meshToOBJ(mesh);
    const x = Math.round(state.player.x).toString().replace("-", "n");
    const z = Math.round(state.player.z).toString().replace("-", "n");
    downloadBlob(blob, `worldgen-${state.seed}-x${x}-z${z}.${format}`);
    showToast(`${format.toUpperCase()} terrain mesh downloaded`);
  } catch (error) {
    console.error("Terrain export failed", error);
    showToast("Terrain export failed");
  } finally {
    elements.exportButton.disabled = false;
    label.textContent = "EXPORT MESH";
  }
}

function animate(now) {
  const delta = Math.min((now - state.lastFrame) / 1000, .05);
  state.lastFrame = now;
  let side = 0;
  let forward = 0;
  if (state.keys.has("w") || state.keys.has("arrowup")) forward += 1;
  if (state.keys.has("s") || state.keys.has("arrowdown")) forward -= 1;
  if (state.keys.has("a") || state.keys.has("arrowleft")) side -= 1;
  if (state.keys.has("d") || state.keys.has("arrowright")) side += 1;

  if (side || forward) {
    const length = Math.hypot(side, forward);
    side /= length;
    forward /= length;
    const forwardX = -Math.sin(state.orbit.yaw);
    const forwardZ = -Math.cos(state.orbit.yaw);
    const rightX = -forwardZ;
    const rightZ = forwardX;
    const sprint = state.keys.has("shift") ? 18 : 10;
    const moveX = (forwardX * forward + rightX * side) * sprint * delta;
    const moveZ = (forwardZ * forward + rightZ * side) * sprint * delta;
    state.player.x += moveX;
    state.player.z += moveZ;
    state.facing = Math.atan2(moveX, moveZ) * 180 / Math.PI;
    elements.playerArrow.style.transform = `rotate(${state.facing}deg)`;
    const chunkKey = `${Math.floor(state.player.x / CHUNK_SIZE)},${Math.floor(state.player.z / CHUNK_SIZE)}`;
    if (chunkKey !== state.activeChunk) syncChunks(false);
  }

  updateCamera();
  updateInspector(false);
  waterMaterial.uniforms.uTime.value = now * .001;
  markerRing.material.opacity = .68 + Math.sin(now * .004) * .22;
  markerRing.rotation.z = now * .00035;
  for (const cloud of atmosphereRoot.children) {
    if (cloud.userData.speed) cloud.position.x += cloud.userData.speed * delta;
    if (cloud.position.x > 100) cloud.position.x = -100;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
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
    scheduleWorldRebuild();
  });
});

elements.grid.addEventListener("change", () => {
  loadedChunks.forEach((chunk) => chunk.traverse((child) => {
    if (child.userData.layer === "grid") child.visible = elements.grid.checked;
  }));
});
elements.contours.addEventListener("change", () => {
  loadedChunks.forEach((chunk) => chunk.traverse((child) => {
    if (child.userData.layer === "contour") child.visible = elements.contours.checked;
  }));
});
elements.objects.addEventListener("change", () => { objectRoot.visible = elements.objects.checked; });

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});
document.querySelectorAll("[data-export-format]").forEach((button) => {
  button.addEventListener("click", () => {
    state.exportFormat = button.dataset.exportFormat;
    document.querySelectorAll("[data-export-format]").forEach((option) => {
      const selected = option === button;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
  });
});
elements.exportButton.addEventListener("click", exportCurrentRegion);

document.getElementById("zoomIn").addEventListener("click", () => setCameraDistance(state.orbit.distance * .82));
document.getElementById("zoomOut").addEventListener("click", () => setCameraDistance(state.orbit.distance * 1.2));
document.getElementById("centerButton").addEventListener("click", () => {
  state.player.x = 0;
  state.player.z = 0;
  syncChunks(false);
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
  setCameraDistance(state.orbit.distance * Math.exp(event.deltaY * .001));
}, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("pointerdown", (event) => {
  state.pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    yaw: state.orbit.yaw,
    pitch: state.orbit.pitch
  };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  state.orbit.yaw = state.pointer.yaw - (event.clientX - state.pointer.x) * .006;
  state.orbit.pitch = clamp(state.pointer.pitch + (event.clientY - state.pointer.y) * .0045, .2, 1.25);
});
function endPointer(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  state.pointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key) && document.activeElement !== elements.seedInput) {
    if (key !== "shift") event.preventDefault();
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
document.getElementById("collapsePanel").addEventListener("click", () => {
  document.querySelector(".control-panel").classList.toggle("collapsed");
});
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
new ResizeObserver(resizeRenderer).observe(stage);
document.addEventListener("fullscreenchange", resizeRenderer);
syncControls();
setCameraDistance(DEFAULT_CAMERA_DISTANCE);
resizeRenderer();
applySeed(false);
requestAnimationFrame(animate);
