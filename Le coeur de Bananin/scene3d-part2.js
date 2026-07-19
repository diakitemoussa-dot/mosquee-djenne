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

// Raycaster pour la détection de clics sur les objets (ex: bouton Plane)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Suivi continu de la souris pour l'effet de dispersion des particules de poussière
// (setupPlaneButton met à jour `mouse` uniquement au clic, on ajoute le suivi au mousemove ici).
window.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}, { passive: true });

const dustMousePlane = new THREE.Plane();
const dustMouseIntersect = new THREE.Vector3();
const dustMouseTarget = new THREE.Vector3();
const dustPlaneNormal = new THREE.Vector3();

// Bulle de texte et gestion de sa visibilité
let textBubble = null;
const BUBBLE_VISIBILITY_DISTANCE = 6; // Distance max pour voir la bulle

// Contrôle de vitesse du Plane
let planeObject = null;
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

// Position/rotation d'entrée de la caméra en partie 2, converties depuis les coordonnées
// Blender (Z-up) vers Three.js (Y-up) : X=BX, Y=BZ, Z=-BY (convention du projet).
const CAMERA_ENTRY_POSITION = new THREE.Vector3(-26.97, 3.8183, 24.31);
const CAMERA_ENTRY_ROTATION = new THREE.Euler(
  THREE.MathUtils.degToRad(94.607),
  THREE.MathUtils.degToRad(27.221),
  0,
  'XYZ'
);

// Ciel de jour procédural (dégradé + nuages générés par bruit en shader, aucune image/
// texture) : la partie 2 n'a plus de ciel visuel depuis la suppression de l'ancien dôme
// GLB "WEB_Sky", elle affichait juste la couleur de fond plate du fog.
let skyMaterial = null;

function setupPlaneButton(plane, onClickCallback) {
  plane.userData.isButton = true;
  const onMouseClick = (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(plane);

    if (intersects.length > 0) {
      onClickCallback();
    }
  };

  window.addEventListener('click', onMouseClick);
  plane.userData.clickListener = onMouseClick;
}

function createTextBubble(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Fond blanc arrondi
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  const radius = 10;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(canvas.width - radius, 0);
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
  ctx.lineTo(canvas.width, canvas.height - radius - 12);
  ctx.quadraticCurveTo(canvas.width, canvas.height - 12, canvas.width - radius, canvas.height - 12);
  ctx.lineTo(canvas.width * 0.6, canvas.height - 12);
  ctx.lineTo(canvas.width * 0.55, canvas.height);
  ctx.lineTo(canvas.width * 0.5, canvas.height - 12);
  ctx.lineTo(radius, canvas.height - 12);
  ctx.quadraticCurveTo(0, canvas.height - 12, 0, canvas.height - radius - 12);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.fill();
  ctx.stroke();

  // Texte noir, avec retour à la ligne automatique pour les phrases longues
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxTextWidth = canvas.width - 24;
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  if (currentLine) lines.push(currentLine);

  const lineHeight = 22;
  const textAreaCenterY = (canvas.height - 12) / 2;
  const startY = textAreaCenterY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(3, 1.5, 1);
  return sprite;
}


function createProceduralSky() {
  const geometry = new THREE.SphereGeometry(400, 32, 16);
  skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      horizonColor: { value: new THREE.Color(0xfef2d8) },
      zenithColor: { value: new THREE.Color(0x5f86c9) },
      // Teinte basse crème/dorée mais légèrement assombrie (au lieu du violet du fog),
      // pour un horizon chaud sans être trop clair ni trop sombre.
      lowSkyColor: { value: new THREE.Color(0xcdb888) },
      cloudColor: { value: new THREE.Color(0xfffaf0) },
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldDir;
      uniform float time;
      uniform vec3 horizonColor;
      uniform vec3 zenithColor;
      uniform vec3 lowSkyColor;
      uniform vec3 cloudColor;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p *= 2.02;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        float h = clamp(vWorldDir.y, -1.0, 1.0);
        float skyT = smoothstep(-0.05, 0.6, h);
        vec3 sky = mix(horizonColor, zenithColor, skyT);
        // Vers l'horizon bas, fondu dans une teinte violacée claire (transition douce, sans
        // assombrir tout le bas du ciel visible).
        sky = mix(lowSkyColor, sky, smoothstep(-0.3, -0.02, h));

        vec2 cloudUv = vWorldDir.xz / (vWorldDir.y + 0.35) * 0.5 + vec2(time * 0.008, 0.0);
        float clouds = fbm(cloudUv * 1.6);
        clouds = smoothstep(0.55, 0.85, clouds);
        float cloudBand = smoothstep(0.05, 0.25, h) * smoothstep(0.85, 0.45, h);
        clouds *= cloudBand;

        vec3 color = mix(sky, cloudColor, clouds);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, skyMaterial);
  mesh.renderOrder = -1000;
  return mesh;
}

function init(gltf) {
  scene = gltf.scene;
  camera = findCamera(gltf) || new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.copy(CAMERA_ENTRY_POSITION);
  camera.rotation.copy(CAMERA_ENTRY_ROTATION);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  makeShadable(gltf);

  // Violet foncé de la charte graphique (depuis la suppression du dôme de ciel WEB_Sky).
  const FOG_COLOR = 0x55415d;
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.035);
  scene.add(createProceduralSky());
  camera.far = Math.max(camera.far, 500);
  camera.updateProjectionMatrix();

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
  controls.maxDistance = 20;
  controls.minDistance = getStructureCollisionRadius(gltf, controls.target) + COLLISION_MARGIN;
  controls.update();

  addLighting(scene, controls.target);

  terrainMesh = gltf.scene.getObjectByName('Meshy_output') || null;

  // Bulle aux coordonnées précises (depuis Blender, converties en Three.js)
  // Conversion Blender (X, Y, Z) → Three.js (X, Z, -Y)
  textBubble = createTextBubble('clique sur l\'avion en papier et découvre !');
  scene.add(textBubble);
  textBubble.position.set(-28.978, 4.65, 16.621);
  textBubble.scale.multiplyScalar(0.15);
  textBubble.visible = false;

  // Configuration du Plane comme bouton interactif pour naviguer vers la partie 1
  planeObject = gltf.scene.getObjectByName('plane');
  if (planeObject) {
    setupPlaneButton(planeObject, () => {
      // Naviguer vers la partie 1
      if (typeof window.goToPart1 === 'function') {
        window.goToPart1();
      }
    });

    // Configurer le slider de vitesse du Plane
}

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

  // Créer les particules de poussière, centrées sur le modèle (la caméra orbite
  // autour de ce point, pas de l'origine de la scène) pour qu'elles soient visibles.
  const dustParticles = createDustParticles(scene);
  dustParticles.position.copy(controls.target);
  scene.add(dustParticles);
  window.dustParticles = dustParticles; // Expose globally pour la boucle d'animation

  clock.start();
  renderer.setAnimationLoop(() => {
    controls.update();
    preventTerrainClipping();
    if (mixer) mixer.update(clock.getDelta());
    if (skyMaterial) skyMaterial.uniforms.time.value = clock.elapsedTime;

    // Mettre à jour les particules de poussière
    if (window.dustParticles && window.dustParticles.userData.dustMaterial) {
      const dustMaterial = window.dustParticles.userData.dustMaterial;
      dustMaterial.uniforms.time.value = performance.now() * 0.001;

      // Projeter le curseur sur un plan face caméra, à la profondeur du nuage de
      // particules, pour obtenir un point 3D que le shader peut utiliser pour disperser
      // les particules proches (effet de répulsion au passage du curseur).
      raycaster.setFromCamera(mouse, camera);
      camera.getWorldDirection(dustPlaneNormal);
      dustMousePlane.setFromNormalAndCoplanarPoint(dustPlaneNormal, window.dustParticles.position);
      if (raycaster.ray.intersectPlane(dustMousePlane, dustMouseIntersect)) {
        dustMouseTarget.copy(dustMouseIntersect).sub(window.dustParticles.position);
      }
      // Lissage (lerp) de la position utilisée par le shader vers la cible : l'effet
      // suit le curseur avec un net retard doux, au lieu de sauter instantanément.
      dustMaterial.uniforms.mouseWorld.value.lerp(dustMouseTarget, 0.035);

      // Déplacement permanent : on écrit directement dans l'attribut position
      // (pas seulement dans le shader) pour que les particules écartées par le
      // curseur restent écartées au lieu de revenir à leur position de départ.
      const posAttr = window.dustParticles.geometry.attributes.position;
      const posArr = posAttr.array;
      const mw = dustMaterial.uniforms.mouseWorld.value;
      const mouseRadius = dustMaterial.uniforms.mouseRadius.value;
      const permanentPushStrength = 0.6;
      let dustMoved = false;
      for (let i = 0; i < posArr.length; i += 3) {
        const dx = posArr[i] - mw.x;
        const dy = posArr[i + 1] - mw.y;
        const dz = posArr[i + 2] - mw.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < mouseRadius * mouseRadius && distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const t = 1 - dist / mouseRadius;
          const force = t * t * permanentPushStrength;
          posArr[i] += (dx / dist) * force;
          posArr[i + 1] += (dy / dist) * force;
          posArr[i + 2] += (dz / dist) * force;
          dustMoved = true;
        }
      }
      if (dustMoved) posAttr.needsUpdate = true;
    }

    // Gestion de la visibilité de la bulle selon la distance caméra
    if (textBubble) {
      const distance = camera.position.distanceTo(textBubble.position);
      textBubble.visible = distance < BUBBLE_VISIBILITY_DISTANCE;
    }

    // Rotation lente et constante du Plane
    if (planeObject) {
      planeObject.rotation.z += 0.01;
    }

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

function createDustParticles(scene) {
  // Configuration des particules
  const config = {
    particleCount: 1300,
    radius: 50,
    speed: 0.005,
    gravity: 0.0005,
    oscillationSpeed: 0.3,
    oscillationAmount: 2,
    opacity: 0.4,
    particleSize: 1.0,
    color: new THREE.Color(200 / 255, 200 / 255, 200 / 255),
    // Rayon d'influence du curseur et force de dispersion des particules proches
    mouseRadius: 2.2,
    mouseStrength: 1.6
  };

  // Créer la géométrie
  const geometry = new THREE.BufferGeometry();

  // Générer positions aléatoires dans une sphère
  const positions = new Float32Array(config.particleCount * 3);
  for (let i = 0; i < config.particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const r = config.radius * Math.random();

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);

  // Vertex Shader
  const vertexShader = `
    uniform float time;
    uniform float speed;
    uniform float gravity;
    uniform float oscillationSpeed;
    uniform float oscillationAmount;
    uniform float radius;
    uniform float particleSize;
    uniform vec3 mouseWorld;
    uniform float mouseRadius;
    uniform float mouseStrength;

    void main() {
      // La position vient directement de l'attribut, déplacé de façon permanente
      // côté CPU quand le curseur pousse une particule : pas de gravité, pas
      // d'oscillation et pas de répulsion temporaire ici, pour qu'une particule
      // poussée reste exactement là où elle a été poussée.
      vec3 pos = position;

      // Projection caméra
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      // Taille atténuée par la distance pour un effet volumétrique cohérent
      gl_PointSize = particleSize * (80.0 / -mvPosition.z);
    }
  `;

  // Fragment Shader
  const fragmentShader = `
    uniform vec3 dustColor;
    uniform float opacity;

    void main() {
      // Créer un disque doux (gradient radial)
      vec2 center = gl_PointCoord - 0.5;
      float dist = length(center);

      // Discard pixels en dehors du rayon
      if (dist > 0.5) discard;

      // Dégradé alpha : opaque au centre, transparent aux bords
      float alpha = (1.0 - dist * 2.0) * opacity;

      gl_FragColor = vec4(dustColor, alpha);
    }
  `;

  // Créer le matériau avec les shaders
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      speed: { value: config.speed },
      gravity: { value: config.gravity },
      oscillationSpeed: { value: config.oscillationSpeed },
      oscillationAmount: { value: config.oscillationAmount },
      radius: { value: config.radius },
      dustColor: { value: config.color },
      opacity: { value: config.opacity },
      particleSize: { value: config.particleSize },
      mouseWorld: { value: new THREE.Vector3(1e6, 1e6, 1e6) },
      mouseRadius: { value: config.mouseRadius },
      mouseStrength: { value: config.mouseStrength }
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  // Créer le mesh Points
  const dustParticles = new THREE.Points(geometry, material);
  dustParticles.userData.dustMaterial = material;

  return dustParticles;
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

// Fonction pour naviguer vers la partie 1
window.goToPart1 = function goToPart1() {
  const revealPart1 = () => {
    container.classList.remove('visible');
    container.hidden = true;
    const scene3dDiv = document.getElementById('scene3d');
    if (scene3dDiv) {
      scene3dDiv.hidden = false;
      if (typeof window.playRevealAnimation === 'function') {
        window.playRevealAnimation();
      }
      if (typeof window.startScene3D === 'function') {
        window.startScene3D();
      }
      scene3dDiv.classList.add('visible');
    }
  };

  if (typeof window.playPaperUnfoldTransition === 'function') {
    window.playPaperUnfoldTransition(revealPart1);
  } else {
    // Fallback si paper-transition.js n'a pas chargé : comportement direct.
    revealPart1();
  }
};
