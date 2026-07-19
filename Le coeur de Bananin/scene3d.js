import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const container = document.getElementById('scene3d');
const scrollSpace = document.getElementById('scroll-space');
const skyScreen = document.getElementById('sky-screen');

const MAX_PARALLAX_OFFSET = 0.12;
const MAX_PARALLAX_TILT = THREE.MathUtils.degToRad(1);
const PARALLAX_SMOOTHING = 0.06;
// Quand la souris s'arrête, la parallaxe revient doucement au centre
// (l'état au repos est toujours la composition propre — pas de "dispersion").
const IDLE_DELAY_MS = 140;
const IDLE_RECENTER = 0.9;

let renderer = null;
let scene = null;
let camera = null;
let mixer = null;
let actions = [];
let timelineDuration = 0;
let started = false;
let loadedGltf = null;
let initPending = false;

const basePosition = new THREE.Vector3();
const baseQuaternion = new THREE.Quaternion();
const mouseTarget = { x: 0, y: 0 };
const mouseCurrent = { x: 0, y: 0 };
const tempRight = new THREE.Vector3();
const tempUp = new THREE.Vector3();
const tiltQuaternion = new THREE.Quaternion();
const tiltEuler = new THREE.Euler();
const tempForward = new THREE.Vector3();
let lastMoveTime = 0;
let startTime = 0;

const BIRD_COUNT = 10;
const birds = [];

function wrapRange(value, range) {
  const span = range * 2;
  return (((value % span) + span) % span) - range;
}

function drawBird(ctx, canvas, wingLift) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(45, 38, 32, 0.8)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const spread = 16;
  const lift = wingLift * 13;
  ctx.beginPath();
  ctx.moveTo(cx - spread, cy - lift);
  ctx.quadraticCurveTo(cx - spread / 2, cy + lift * 0.3, cx, cy);
  ctx.quadraticCurveTo(cx + spread / 2, cy + lift * 0.3, cx + spread, cy - lift);
  ctx.stroke();
}

const LAYER_NAMES = ['les roches-no-bg', 'la falaise-no-bg', 'image-removebg-preview'];

function getLayerDepthGaps() {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(baseQuaternion);
  const worldPos = new THREE.Vector3();
  const depths = LAYER_NAMES
    .map((name) => scene.getObjectByName(name))
    .filter(Boolean)
    .map((obj) => {
      obj.getWorldPosition(worldPos);
      return worldPos.clone().sub(basePosition).dot(forward);
    })
    .sort((a, b) => a - b);

  const gaps = [];
  for (let i = 0; i < depths.length - 1; i += 1) {
    const margin = (depths[i + 1] - depths[i]) * 0.15;
    gaps.push([depths[i] + margin, depths[i + 1] - margin]);
  }
  return gaps.length ? gaps : [[3, 8]];
}

// Cri d'aigle lié aux sprites créés ci-dessous : déclenché occasionnellement (les
// grands rapaces crient plus rarement qu'un chœur de petits oiseaux), avec un pool
// de lecteurs pour permettre à deux cris de se chevaucher. Ne démarre qu'au premier
// scroll (cf. window.startBirdChirps).
// Son "Eagle cry" © orangefreesounds.com — CC BY-NC 4.0, usage non commercial, crédit requis.
const CHIRP_SOURCES = ['asset/audio/eagle-cry.mp3'];
const CHIRP_POOL_SIZE = 2;
const chirpPools = CHIRP_SOURCES.map((src) => {
  const pool = Array.from({ length: CHIRP_POOL_SIZE }, () => {
    const audio = new Audio(src);
    audio.preload = 'auto';
    return audio;
  });
  return { pool, index: 0 };
});

let chirpsMuted = false;
window.setChirpMuted = function setChirpMuted(muted) {
  chirpsMuted = muted;
  chirpPools.forEach(({ pool }) => {
    pool.forEach((audio) => { audio.muted = muted; });
  });
  BIKE_BELL_AUDIO.muted = muted;
};

function playBirdChirp() {
  if (!birds.length) return;
  const group = chirpPools[Math.floor(Math.random() * chirpPools.length)];
  const audio = group.pool[group.index];
  group.index = (group.index + 1) % group.pool.length;
  audio.currentTime = 0;
  audio.muted = chirpsMuted;
  audio.volume = THREE.MathUtils.randFloat(0.2, 0.4);
  audio.playbackRate = THREE.MathUtils.randFloat(0.95, 1.08);
  audio.play().catch(() => {});
}

function scheduleBirdChirp() {
  const delay = THREE.MathUtils.randFloat(7000, 16000);
  setTimeout(() => {
    playBirdChirp();
    scheduleBirdChirp();
  }, delay);
}

let chirpsStarted = false;
window.startBirdChirps = function startBirdChirps() {
  if (chirpsStarted) return;
  chirpsStarted = true;
  scheduleBirdChirp();
};

// Premier cri d'aigle garanti dès le 4e scroll environ, indépendamment du minuteur
// aléatoire (qui régit les cris suivants).
const EAGLE_FIRST_CRY_PROGRESS = 0.05;
let eagleFirstCryDone = false;

function maybeTriggerFirstEagleCry(progress) {
  if (eagleFirstCryDone || progress < EAGLE_FIRST_CRY_PROGRESS) return;
  eagleFirstCryDone = true;
  playBirdChirp();
}

// Son de cloche de vélo, déclenché vers la fin du scroll de la partie 1, juste avant
// l'apparition de la partie 2 (cf. MODEL_FADE_START = 0.9). Rejoué chaque fois que le
// scroll traverse ce seuil, en avançant ou en revenant en arrière.
const BIKE_BELL_AUDIO = new Audio('asset/audio/bike.mp3');
BIKE_BELL_AUDIO.preload = 'auto';
const BIKE_BELL_PROGRESS = 0.8;
let bikeBellLastProgress = 0;

function playBikeBell() {
  BIKE_BELL_AUDIO.muted = chirpsMuted;
  BIKE_BELL_AUDIO.currentTime = 0;
  BIKE_BELL_AUDIO.play().catch(() => {});
}

function maybeTriggerBikeBell(progress) {
  const wasAbove = bikeBellLastProgress >= BIKE_BELL_PROGRESS;
  const isAbove = progress >= BIKE_BELL_PROGRESS;
  if (wasAbove !== isAbove) playBikeBell();
  bikeBellLastProgress = progress;
}

function createBirds() {
  const gaps = getLayerDepthGaps();

  for (let i = 0; i < BIRD_COUNT; i += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    const scale = THREE.MathUtils.randFloat(0.18, 0.35);
    sprite.scale.set(scale, scale * 0.625, 1);
    scene.add(sprite);

    const [gapMin, gapMax] = gaps[i % gaps.length];

    birds.push({
      sprite,
      ctx,
      canvas,
      texture,
      depth: THREE.MathUtils.randFloat(gapMin, gapMax),
      range: THREE.MathUtils.randFloat(5, 8),
      lateralOffset: THREE.MathUtils.randFloat(-6, 6),
      lateralSpeed: THREE.MathUtils.randFloat(0.5, 1) * (Math.random() < 0.5 ? 1 : -1),
      vertical: THREE.MathUtils.randFloat(-1, 2.2),
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: THREE.MathUtils.randFloat(0.7, 1.3),
      flapPhase: Math.random() * Math.PI * 2,
      flapSpeed: THREE.MathUtils.randFloat(6, 9),
    });
  }
}

function updateBirds(elapsedSeconds) {
  tempForward.set(0, 0, -1).applyQuaternion(baseQuaternion);
  birds.forEach((bird) => {
    const lateral = wrapRange(bird.lateralOffset + elapsedSeconds * bird.lateralSpeed, bird.range);
    const bob = Math.sin(elapsedSeconds * bird.bobSpeed + bird.bobPhase) * 0.35;

    bird.sprite.position.copy(basePosition)
      .addScaledVector(tempForward, bird.depth)
      .addScaledVector(tempRight, lateral)
      .addScaledVector(tempUp, bird.vertical + bob);

    const wingLift = Math.sin(elapsedSeconds * bird.flapSpeed + bird.flapPhase);
    drawBird(bird.ctx, bird.canvas, wingLift);
    bird.texture.needsUpdate = true;
  });
}

function findCamera(gltf) {
  if (gltf.cameras && gltf.cameras.length) return gltf.cameras[0];
  let found = null;
  gltf.scene.traverse((obj) => {
    if (!found && obj.isCamera) found = obj;
  });
  return found;
}

function onResize() {
  if (!renderer) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  if (camera && camera.isPerspectiveCamera) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function onMouseMove(event) {
  mouseTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseTarget.y = (event.clientY / window.innerHeight) * 2 - 1;
  lastMoveTime = performance.now();
}

function applyParallaxAndRender() {
  // Si la souris est immobile depuis un court instant, la cible revient au centre.
  if (performance.now() - lastMoveTime > IDLE_DELAY_MS) {
    mouseTarget.x *= IDLE_RECENTER;
    mouseTarget.y *= IDLE_RECENTER;
  }

  mouseCurrent.x += (mouseTarget.x - mouseCurrent.x) * PARALLAX_SMOOTHING;
  mouseCurrent.y += (mouseTarget.y - mouseCurrent.y) * PARALLAX_SMOOTHING;

  tempRight.set(1, 0, 0).applyQuaternion(baseQuaternion);
  tempUp.set(0, 1, 0).applyQuaternion(baseQuaternion);

  camera.position.copy(basePosition)
    .addScaledVector(tempRight, mouseCurrent.x * MAX_PARALLAX_OFFSET)
    .addScaledVector(tempUp, -mouseCurrent.y * MAX_PARALLAX_OFFSET);

  tiltEuler.set(-mouseCurrent.y * MAX_PARALLAX_TILT, mouseCurrent.x * MAX_PARALLAX_TILT, 0);
  tiltQuaternion.setFromEuler(tiltEuler);
  camera.quaternion.copy(baseQuaternion).multiply(tiltQuaternion);

  updateBirds((performance.now() - startTime) / 1000);

  renderer.render(scene, camera);
}

const LAYER_BLUR_PX = {
  'image-removebg-preview': 0.8,
  'les roches-no-bg': 0.6,
};

function blurTexture(texture, blurPx) {
  const image = texture.image;
  if (!image || !image.width) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(image, 0, 0);
  const blurred = new THREE.CanvasTexture(canvas);
  blurred.colorSpace = texture.colorSpace;
  blurred.flipY = texture.flipY;
  blurred.needsUpdate = true;
  return blurred;
}

const modelMaterials = [];

function makeUnlit(gltf) {
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const source = obj.material;
    const blurPx = LAYER_BLUR_PX[obj.name];
    const map = source.map && blurPx ? blurTexture(source.map, blurPx) : source.map || null;
    const basic = new THREE.MeshBasicMaterial({
      map,
      color: source.map ? 0xffffff : source.color,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
    });
    obj.material = basic;
    modelMaterials.push(basic);
  });
}

// Le modèle 3D (mosquée, sky, rochers...) s'estompe sur les 10 derniers % du scroll,
// pour laisser place à la partie suivante — les oiseaux (sprites indépendants) restent visibles.
const MODEL_FADE_START = 0.9;

function updateModelFade(progress) {
  const fadeSpan = 1 - MODEL_FADE_START;
  const opacity = progress <= MODEL_FADE_START
    ? 1
    : 1 - (progress - MODEL_FADE_START) / fadeSpan;
  modelMaterials.forEach((mat) => {
    mat.opacity = opacity;
  });
  if (skyScreen) {
    skyScreen.style.opacity = opacity;
  }
  // L'ambiance de vent s'atténue en même temps que le reste de la partie 1.
  if (typeof window.setAmbientVolume === 'function') {
    window.setAmbientVolume(opacity);
  }
  // La partie 2 (modèle interactif) prend le relais une fois la partie 1 totalement effacée.
  if (typeof window.setScene3DPart2Visible === 'function') {
    window.setScene3DPart2Visible(opacity <= 0.001);
  }
}

// Textes narratifs qui apparaissent/disparaissent à des moments précis du scroll,
// avec un léger fondu en entrée/sortie de part et d'autre de leur plage de visibilité.
const STORY_TEXTS = [
  { id: 'story-text-1', start: 0.015, end: 0.05, fade: 0.01 },
  { id: 'story-text-2', start: 0.06, end: 0.1, fade: 0.01 },
  { id: 'story-text-3', start: 0.12, end: 0.155, fade: 0.01 },
  { id: 'story-title-1', start: 0.155, end: 0.19, fade: 0.015 },
  { id: 'story-text-4', start: 0.21, end: 0.245, fade: 0.01 },
  { id: 'story-text-5', start: 0.28, end: 0.315, fade: 0.01 },
  { id: 'story-hud-1', start: 0.385, end: 0.47, fade: 0.015 },
  { id: 'story-hud-2', start: 0.505, end: 0.575, fade: 0.015 },
  { id: 'story-hud-3', start: 0.63, end: 0.68, fade: 0.015 },
  { id: 'story-hud-4', start: 0.715, end: 0.75, fade: 0.015 },
];

function updateStoryTexts(progress) {
  STORY_TEXTS.forEach(({ id, start, end, fade }) => {
    const el = document.getElementById(id);
    if (!el) return;
    let opacity = 0;
    if (progress >= start && progress <= end) {
      const inRatio = fade > 0 ? Math.min((progress - start) / fade, 1) : 1;
      const outRatio = fade > 0 ? Math.min((end - progress) / fade, 1) : 1;
      opacity = Math.min(inRatio, outRatio);
    }
    el.style.opacity = opacity;
  });
}

function setProgress(progress) {
  updateModelFade(progress);
  updateStoryTexts(progress);
  maybeTriggerFirstEagleCry(progress);
  maybeTriggerBikeBell(progress);
  if (!mixer || !actions.length) return;
  // On repart de la base propre (sans décalage de parallaxe) avant de rejouer l'animation :
  // sinon, si la caméra n'a pas sa propre animation à cet instant, mixer.update() ne
  // touche pas camera.position, et le décalage de la souris de la frame précédente serait
  // capturé comme nouvelle position de base — ce qui fait dériver la vue à chaque scroll.
  camera.position.copy(basePosition);
  camera.quaternion.copy(baseQuaternion);
  // Toutes les animations partagent la même timeline globale (comme dans Blender) :
  // on ne remet PAS chaque clip à l'échelle de sa propre durée, sinon un objet animé
  // seulement sur une petite portion du temps semble jouer en même temps que les autres.
  actions.forEach((action) => {
    action.time = progress * timelineDuration;
  });
  mixer.update(0);
  basePosition.copy(camera.position);
  baseQuaternion.copy(camera.quaternion);
}

function getScrollProgress() {
  const maxScroll = scrollSpace.offsetHeight - window.innerHeight;
  if (maxScroll <= 0) return 0;
  return Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
}

// Vitesse de scroll normalisée (0 à 1), utilisée pour faire "souffler" le vent plus
// fort quand l'utilisateur scrolle vite — impression de vitesse/traversée du vent.
// On calcule une moyenne glissante sur une fenêtre de temps (pas juste l'écart entre
// deux événements scroll, trop bruité : un simple cran de molette peut sembler très
// rapide sur un instant très court). En dessous de WIND_SPEED_MIN, intensité = 0.
const WIND_WINDOW_MS = 300;
const WIND_SPEED_MIN = 3; // px/ms moyen sur la fenêtre — en dessous, scroll "normal"
const WIND_SPEED_REFERENCE = 7; // px/ms moyen considéré comme un scroll "très rapide"
const scrollSamples = [];

function updateWindSpeedFromScroll() {
  const now = performance.now();
  const y = window.scrollY;
  scrollSamples.push({ t: now, y });
  while (scrollSamples.length > 1 && now - scrollSamples[0].t > WIND_WINDOW_MS) {
    scrollSamples.shift();
  }
  const oldest = scrollSamples[0];
  const dt = now - oldest.t;
  if (dt > 60) {
    const distance = Math.abs(y - oldest.y);
    const speed = distance / dt;
    const intensity = Math.max(0, Math.min((speed - WIND_SPEED_MIN) / (WIND_SPEED_REFERENCE - WIND_SPEED_MIN), 1));
    if (typeof window.setWindIntensity === 'function') {
      window.setWindIntensity(intensity);
    }
  }
}

let rafPending = false;
function onScroll() {
  updateWindSpeedFromScroll();
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    setProgress(getScrollProgress());
    rafPending = false;
  });
}

function init(gltf) {
  scene = gltf.scene;
  camera = findCamera(gltf);
  makeUnlit(gltf);
  basePosition.copy(camera.position);
  baseQuaternion.copy(camera.quaternion);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const firstChild = container.firstChild;
  if (firstChild) {
    container.insertBefore(renderer.domElement, firstChild);
  } else {
    container.appendChild(renderer.domElement);
  }

  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    actions = gltf.animations.map((clip) => {
      const action = mixer.clipAction(clip);
      action.play();
      action.paused = true;
      return action;
    });
    timelineDuration = Math.max(...gltf.animations.map((clip) => clip.duration));
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });

  onResize();
  setProgress(getScrollProgress());
  createBirds();
  startTime = performance.now();

  renderer.setAnimationLoop(applyParallaxAndRender);
}

let glbReadyCallback = null;

// Même seuil que le choix d'image phone/pc du logo de chargement (style.css) : sous
// 700px on charge un modèle dédié smartphone, au-dessus le modèle PC habituel. Le
// reste de la logique (caméra, animation, parallaxe) est identique dans les deux cas.
const MOBILE_MODEL_BREAKPOINT_PX = 700;
const MODEL_PATH = window.innerWidth <= MOBILE_MODEL_BREAKPOINT_PX
  ? 'asset/model/scene-bananin-mobile.glb'
  : 'asset/model/scene-bananin.glb';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.164.0/examples/jsm/libs/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.load(
  MODEL_PATH,
  (gltf) => {
    loadedGltf = gltf;
    if (glbReadyCallback) glbReadyCallback();
  },
  (event) => {
    if (window.onScene3DProgress && event.total) {
      window.onScene3DProgress(event.loaded / event.total);
    }
  },
);

window.onScene3DReady = function onScene3DReady(callback) {
  if (loadedGltf) callback();
  else glbReadyCallback = callback;
};

function startWhenReady() {
  if (loadedGltf) {
    if (!renderer) {
      init(loadedGltf);
    } else {
      renderer.setAnimationLoop(applyParallaxAndRender);
    }
    initPending = false;
  } else if (!initPending) {
    initPending = true;
    setTimeout(startWhenReady, 100);
  }
}

window.startScene3D = function startScene3D() {
  startWhenReady();
};
