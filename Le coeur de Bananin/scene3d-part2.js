import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('scene3d-part2');

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let started = false;
let revealed = false;
let loadedGltf = null;
let mixer = null;
const clock = new THREE.Clock();

// Empêche la caméra de traverser les murs/toit du grenier (ATTIC) pendant l'orbite :
// on borne la distance minimale au rayon englobant de la structure (pas de raycasting,
// car ATTIC est positionné à l'intérieur des murs — un rayon sortant les toucherait
// immédiatement et coincerait la caméra collée à l'intérieur).
const COLLISION_MARGIN = 0.15;

function findCamera(gltf) {
  if (gltf.cameras && gltf.cameras.length) return gltf.cameras[0];
  let found = null;
  gltf.scene.traverse((obj) => {
    if (!found && obj.isCamera) found = obj;
  });
  return found;
}

// Contrairement à la partie 1 (style plat/illustratif), la partie 2 utilise un matériau
// qui réagit à la lumière pour que les ombres soient visibles pendant l'exploration 3D.
function makeShadable(gltf) {
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const source = obj.material;
    const standard = new THREE.MeshStandardMaterial({
      map: source.map || null,
      color: source.map ? 0xffffff : source.color,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
    });
    obj.material = standard;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function addLighting(scene, target) {
  const ambient = new THREE.HemisphereLight(0xfff3e0, 0x3a2f28, 0.9);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d6, 3);
  sun.position.set(target.x + 6, target.y + 10, target.z + 6);
  sun.target.position.copy(target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  scene.add(sun.target);
}

// ATTIC est l'objet central de l'expérience : la caméra orbite toujours autour de lui.
const ORBIT_TARGET_NAME = 'ATTIC';

function getModelCenter(gltf) {
  const attic = gltf.scene.getObjectByName(ORBIT_TARGET_NAME);
  if (attic) {
    const center = new THREE.Vector3();
    attic.getWorldPosition(center);
    return center;
  }
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const center = new THREE.Vector3();
  box.getCenter(center);
  return center;
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function init(gltf) {
  scene = gltf.scene;
  camera = findCamera(gltf) || new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  makeShadable(gltf);

  // Le brouillard se fond avec le fond crème de la page pour un effet de profondeur cohérent.
  const FOG_COLOR = 0xf4efe6;
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.035);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(getModelCenter(gltf));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxDistance = 7;
  controls.minDistance = getStructureCollisionRadius(gltf, controls.target) + COLLISION_MARGIN;
  controls.update();

  addLighting(scene, controls.target);

  terrainMesh = gltf.scene.getObjectByName('Meshy_output') || null;

  // Toutes les animations du modèle jouent en boucle continue, indépendamment du scroll.
  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach((clip) => {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat);
      action.play();
    });
  }

  window.addEventListener('resize', onResize);

  clock.start();
  renderer.setAnimationLoop(() => {
    controls.update();
    preventTerrainClipping();
    if (mixer) mixer.update(clock.getDelta());
    renderer.render(scene, camera);
  });
}

// Collider de terrain : empêche la caméra de traverser Meshy_output (le sol/rocher).
// On sonde la hauteur du terrain juste sous la position XZ de la caméra (rayon vertical
// depuis un point au-dessus), plutôt que de raycaster depuis ATTIC — ATTIC est posé sur/
// dans ce mesh, donc un rayon sortant depuis la cible le toucherait immédiatement.
const TERRAIN_MARGIN = 0.2;
const TERRAIN_PROBE_HEIGHT = 200;
let terrainMesh = null;
const terrainRaycaster = new THREE.Raycaster();
const terrainRayOrigin = new THREE.Vector3();
const TERRAIN_RAY_DIR = new THREE.Vector3(0, -1, 0);

function preventTerrainClipping() {
  if (!terrainMesh) return;
  terrainRayOrigin.set(camera.position.x, camera.position.y + TERRAIN_PROBE_HEIGHT, camera.position.z);
  terrainRaycaster.set(terrainRayOrigin, TERRAIN_RAY_DIR);
  terrainRaycaster.far = TERRAIN_PROBE_HEIGHT * 2;
  const hits = terrainRaycaster.intersectObject(terrainMesh, false);
  if (!hits.length) return;
  const floor = hits[0].point.y + TERRAIN_MARGIN;
  if (camera.position.y < floor) {
    camera.position.y = floor;
  }
}

// Distance entre le point d'orbite (ATTIC) et le point le plus éloigné de la structure
// (rock/roof/Wall/Window) — la caméra ne doit jamais s'approcher plus près que ça.
function getStructureCollisionRadius(gltf, target) {
  const atticNode = gltf.scene.getObjectByName(ORBIT_TARGET_NAME);
  if (!atticNode) return 0.5;
  const box = new THREE.Box3().setFromObject(atticNode);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  return sphere.center.distanceTo(target) + sphere.radius;
}

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.164.0/examples/jsm/libs/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
loader.load('asset/model/scene-partie2.glb', (gltf) => {
  loadedGltf = gltf;
});

function startWhenReady() {
  if (loadedGltf) {
    init(loadedGltf);
  } else {
    setTimeout(startWhenReady, 100);
  }
}

window.startScene3DPart2 = function startScene3DPart2() {
  if (started) return;
  started = true;
  startWhenReady();
};

window.setScene3DPart2Visible = function setScene3DPart2Visible(visible) {
  if (visible === revealed) return;
  revealed = visible;
  if (visible) {
    container.hidden = false;
    if (typeof window.startScene3DPart2 === 'function') window.startScene3DPart2();
    requestAnimationFrame(() => container.classList.add('visible'));
  } else {
    container.classList.remove('visible');
  }
};
