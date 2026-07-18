const ASSETS_TO_PRELOAD = [
  'asset/image/la coline ..jpg',
  'asset/image/la falaise ..png',
  'asset/image/les roches ..png',
  'asset/image/sky.png',
];

const loadingScreen = document.getElementById('loading-screen');
const experience = document.getElementById('experience');
const revealCircle = document.getElementById('reveal-circle');
const scene3d = document.getElementById('scene3d');
const scene3dPart2 = document.getElementById('scene3d-part2');
const scrollSpace = document.getElementById('scroll-space');
const scrollHint = document.getElementById('scroll-hint');

const DELAY_BEFORE_SCENE3D = 2000;
const SCROLL_SPACE_MULTIPLIER = 40;

// Ambiance de vent en boucle pour la partie 1. Les navigateurs bloquent l'autoplay
// avec son tant qu'il n'y a pas eu d'interaction utilisateur, donc on retente au
// premier scroll/clic/touche si la tentative initiale échoue.
const ambientAudio = new Audio('asset/audio/wind-ambience.mp3');
ambientAudio.loop = true;
ambientAudio.preload = 'auto';
ambientAudio.volume = 0;

const AMBIENT_BASE_VOLUME = 0.28;
const AMBIENT_FADE_IN_MS = 2500;
// Impression de vitesse : quand l'utilisateur scrolle vite, le vent souffle plus fort
// et un peu plus vite (playbackRate), puis retombe doucement au calme.
const WIND_GUST_VOLUME_BOOST = 0.2;
const WIND_GUST_PITCH_BOOST = 0.35;
const WIND_GUST_DECAY = 0.93; // par frame

let ambientFadeRatio = 1;
let ambientFadeInProgress = 0;
let ambientStarted = false;
let windGustIntensity = 0;
let audioMuted = false;

function applyMuteState() {
  ambientAudio.muted = audioMuted;
  if (typeof window.setChirpMuted === 'function') {
    window.setChirpMuted(audioMuted);
  }
}

window.toggleAudioMute = function toggleAudioMute() {
  audioMuted = !audioMuted;
  applyMuteState();
  return audioMuted;
};

function applyAmbientVolume() {
  if (!ambientStarted) return;
  const base = AMBIENT_BASE_VOLUME * ambientFadeRatio * ambientFadeInProgress;
  const boosted = base + WIND_GUST_VOLUME_BOOST * windGustIntensity * ambientFadeRatio;
  ambientAudio.volume = Math.max(0, Math.min(boosted, 1));
  ambientAudio.playbackRate = 1 + WIND_GUST_PITCH_BOOST * windGustIntensity;
}

window.setAmbientVolume = function setAmbientVolume(ratio) {
  ambientFadeRatio = Math.max(0, Math.min(ratio, 1));
  applyAmbientVolume();
};

window.setWindIntensity = function setWindIntensity(intensity) {
  windGustIntensity = Math.max(windGustIntensity, Math.max(0, Math.min(intensity, 1)));
};

function decayWindGustLoop() {
  if (windGustIntensity > 0) {
    windGustIntensity *= WIND_GUST_DECAY;
    if (windGustIntensity < 0.005) windGustIntensity = 0;
    applyAmbientVolume();
  }
  requestAnimationFrame(decayWindGustLoop);
}
requestAnimationFrame(decayWindGustLoop);

function fadeInAmbient() {
  const start = performance.now();
  function step(ts) {
    ambientFadeInProgress = Math.min((ts - start) / AMBIENT_FADE_IN_MS, 1);
    applyAmbientVolume();
    if (ambientFadeInProgress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function tryStartAmbient() {
  if (ambientStarted) return;
  ambientAudio.play().then(() => {
    ambientStarted = true;
    fadeInAmbient();
    if (typeof window.startBirdChirps === 'function') {
      window.startBirdChirps();
    }
    AMBIENT_UNLOCK_EVENTS.forEach((evt) => {
      window.removeEventListener(evt, tryStartAmbient);
    });
  }).catch(() => {
    // Autoplay bloqué : on retentera au prochain événement d'interaction.
  });
}

// Seuls un clic/appui (pointerdown), une touche ou un tap comptent comme un vrai geste
// utilisateur pour les navigateurs — 'scroll'/'wheel' sont ignorés pour le déblocage audio,
// donc on ne s'appuie pas sur eux. Cliquer sur l'indication "Scroll" (rendue cliquable en
// CSS) déclenche ce déblocage de façon naturelle avant que l'utilisateur ne scrolle.
const AMBIENT_UNLOCK_EVENTS = ['pointerdown', 'click', 'keydown', 'touchstart'];
AMBIENT_UNLOCK_EVENTS.forEach((evt) => {
  window.addEventListener(evt, tryStartAmbient, { passive: true });
});

const audioToggleBtn = document.getElementById('audio-toggle');
audioToggleBtn.addEventListener('click', () => {
  const muted = window.toggleAudioMute();
  audioToggleBtn.classList.toggle('muted', muted);
  audioToggleBtn.setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son');
});

const TOTAL_UNITS = ASSETS_TO_PRELOAD.length + 1; // + le modèle 3D
let loadedCount = 0;
let glbProgress = 0;
let glbReady = false;

function refreshProgressBar() {
  const ratio = (loadedCount + glbProgress) / TOTAL_UNITS;
  if (typeof window.onLoadingProgress === 'function') {
    window.onLoadingProgress(ratio);
  }
  if (loadedCount === ASSETS_TO_PRELOAD.length && glbReady) {
    onLoadingComplete();
  }
}

function updateProgress() {
  loadedCount += 1;
  refreshProgressBar();
}

window.onScene3DProgress = function onScene3DProgress(ratio) {
  glbProgress = Math.min(ratio, 1);
  refreshProgressBar();
};

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = src;
  });
}

function onLoadingComplete() {
  setTimeout(() => {
    loadingScreen.classList.add('fade-out');
    // Aller directement à la partie 2 (sans experience ni animation de révélation)
    transitionToScene3D();
    loadingScreen.addEventListener('transitionend', () => {
      loadingScreen.remove();
    }, { once: true });
  }, 300);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function playRevealAnimation() {
  const maxRadius = Math.sqrt(
    window.innerWidth * window.innerWidth + window.innerHeight * window.innerHeight
  ) / 2 + 120;
  const duration = 3500;
  let start = null;

  function step(timestamp) {
    if (start === null) start = timestamp;
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / duration, 1);
    const radius = easeOutCubic(progress) * maxRadius;
    revealCircle.setAttribute('r', String(radius));
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      if (scrollHint) scrollHint.classList.add('visible');
      // Ne pas appeler transitionToScene3D ici si c'est appelé depuis goToPart1
    }
  }

  requestAnimationFrame(step);
}

// Exposer la fonction sur window pour qu'elle soit accessible depuis goToPart1
window.playRevealAnimation = playRevealAnimation;

function transitionToScene3D() {
  // Afficher la partie 2 d'abord (au lieu de la partie 1)
  scene3dPart2.hidden = false;
  scene3dPart2.classList.add('visible');
  scrollSpace.style.height = `${window.innerHeight * SCROLL_SPACE_MULTIPLIER}px`;
  if (typeof window.startScene3DPart2 === 'function') {
    window.startScene3DPart2();
  }
  window.addEventListener('scroll', hideScrollHint, { once: true, passive: true });
}

function hideScrollHint() {
  scrollHint.classList.remove('visible');
  scrollHint.classList.add('exit');
  scrollHint.addEventListener('animationend', () => {
    scrollHint.remove();
  }, { once: true });
}

ASSETS_TO_PRELOAD.forEach((src) => {
  preloadImage(src).then(updateProgress);
});

function waitForScene3DReady() {
  if (typeof window.onScene3DReady === 'function') {
    window.onScene3DReady(() => {
      glbReady = true;
      glbProgress = 1;
      refreshProgressBar();
    });
  } else {
    setTimeout(waitForScene3DReady, 50);
  }
}
waitForScene3DReady();
