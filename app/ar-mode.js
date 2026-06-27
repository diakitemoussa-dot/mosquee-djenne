import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL    = 'assets/models/djenne-mosque-only.glb';
const INITIAL_SCALE = 0.08;
const SCALE_MIN    = 0.02;
const SCALE_MAX    = 0.5;

/* ---------- État module ---------- */
let _renderer = null;
let _scene    = null;
let _camera   = null;
let _session  = null;
let _hitTestSource = null;
let _mosque   = null;
let _reticle  = null;
let _placed   = false;

/* ---------- Gestes ---------- */
const _ptrs       = new Map();
let _lastPinchDist = null;

/* ---------- DOM ---------- */
let _overlay = null;
let _hintEl  = null;

/* ========== API publique ========== */

export async function enter() {
  if (!navigator.xr) { _toast('AR non disponible sur cet appareil'); return; }

  const supported = await navigator.xr
    .isSessionSupported('immersive-ar')
    .catch(() => false);
  if (!supported) { _toast('AR non disponible sur cet appareil'); return; }

  _renderer = window.MosqueScene.renderer;
  _scene    = window.MosqueScene.scene;
  _camera   = window.MosqueScene.camera;

  window.MosqueScene.pauseLoop();
  window.MosqueScene.controls.enabled = false;

  try {
    await _loadModel();
    await _startSession();
  } catch (err) {
    console.error('[AR]', err);
    _toast('Impossible de démarrer la session AR');
    _exit();
  }
}

/* ========== Privé ========== */

function _loadModel() {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        _mosque = gltf.scene;
        _mosque.scale.setScalar(INITIAL_SCALE);
        _mosque.visible = false;
        _scene.add(_mosque);
        resolve();
      },
      undefined,
      (err) => { _toast('Erreur de chargement du modèle AR'); reject(err); }
    );
  });
}

async function _startSession() {
  _session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.getElementById('arOverlay') },
  });
  _session.addEventListener('end', _exit);

  _renderer.xr.enabled = true;
  await _renderer.xr.setSession(_session);

  const viewerSpace    = await _session.requestReferenceSpace('viewer');
  _hitTestSource       = await _session.requestHitTestSource({ space: viewerSpace });

  _buildReticle();
  _setupGestures();
  _showOverlay();
  _renderer.setAnimationLoop(_onXRFrame);
}

function _buildReticle() {
  const geo = new THREE.RingGeometry(0.1, 0.13, 32);
  geo.rotateX(-Math.PI / 2);
  _reticle = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xf9d58b, side: THREE.DoubleSide })
  );
  _reticle.matrixAutoUpdate = false;
  _reticle.visible = false;
  _scene.add(_reticle);
}

function _onXRFrame(t, frame) {
  if (!frame) return;
  const refSpace = _renderer.xr.getReferenceSpace();
  const hits     = frame.getHitTestResults(_hitTestSource);

  if (!_placed) {
    if (hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      _reticle.matrix.fromArray(pose.transform.matrix);
      _reticle.visible = true;
    } else {
      _reticle.visible = false;
    }
  }

  _renderer.render(_scene, _camera);
}

function _onTap() {
  if (_placed || !_reticle.visible) return;
  _placed = true;
  _mosque.position.setFromMatrixPosition(_reticle.matrix);
  _mosque.visible = true;
  _reticle.visible = false;
  _setHint('Pincez pour redimensionner · Marchez autour pour explorer');
  setTimeout(() => { if (_hintEl) _hintEl.style.opacity = '0'; }, 4000);
}

function _setupGestures() {
  const el = _renderer.domElement;
  el.addEventListener('pointerdown',   _onPtrDown,   { passive: true });
  el.addEventListener('pointermove',   _onPtrMove,   { passive: true });
  el.addEventListener('pointerup',     _onPtrUp,     { passive: true });
  el.addEventListener('pointercancel', _onPtrUp,     { passive: true });
}

function _teardownGestures() {
  const el = _renderer.domElement;
  el.removeEventListener('pointerdown',   _onPtrDown);
  el.removeEventListener('pointermove',   _onPtrMove);
  el.removeEventListener('pointerup',     _onPtrUp);
  el.removeEventListener('pointercancel', _onPtrUp);
}

function _onPtrDown(e) {
  _ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (_ptrs.size === 1) _onTap();
}

function _onPtrMove(e) {
  if (!_placed) return;
  const prev = _ptrs.get(e.pointerId);
  _ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (_ptrs.size === 2) {
    const pts  = [..._ptrs.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (_lastPinchDist !== null) {
      const ratio = dist / _lastPinchDist;
      const s = THREE.MathUtils.clamp(_mosque.scale.x * ratio, SCALE_MIN, SCALE_MAX);
      _mosque.scale.setScalar(s);
    }
    _lastPinchDist = dist;
  } else if (_ptrs.size === 1 && prev) {
    _mosque.rotation.y += (e.clientX - prev.x) * 0.01;
  }
}

function _onPtrUp(e) {
  _ptrs.delete(e.pointerId);
  if (_ptrs.size < 2) _lastPinchDist = null;
}

function _showOverlay() {
  _overlay = document.getElementById('arOverlay');
  _hintEl  = document.getElementById('arHint');
  document.getElementById('arQuit').onclick = () => _session?.end();
  _overlay.removeAttribute('aria-hidden');
  _setHint('Pointez vers un sol plat · Appuyez pour poser la mosquée');
}

function _setHint(text) {
  if (!_hintEl) return;
  _hintEl.style.opacity = '1';
  _hintEl.textContent = text;
}

function _toast(msg) {
  const stage = document.getElementById('mosqueStage');
  if (!stage) return;
  const el = document.createElement('div');
  el.className = 'mq-toast';
  el.textContent = msg;
  stage.appendChild(el);
  void el.offsetWidth;
  el.classList.add('visible');
  setTimeout(() => el.remove(), 3500);
}

function _exit() {
  if (!_renderer) return;
  _renderer.setAnimationLoop(null);
  _renderer.xr.enabled = false;
  _teardownGestures();

  if (_mosque)  { _scene.remove(_mosque);  _mosque  = null; }
  if (_reticle) {
    _reticle.geometry.dispose();
    _reticle.material.dispose();
    _scene.remove(_reticle);
    _reticle = null;
  }
  _hitTestSource?.cancel();
  _hitTestSource = null;
  _session       = null;
  _placed        = false;
  _ptrs.clear();
  _lastPinchDist = null;

  _overlay?.setAttribute('aria-hidden', 'true');
  if (_hintEl) _hintEl.style.opacity = '0';

  window.MosqueScene.controls.enabled = true;
  window.MosqueScene.resumeLoop();
  _renderer = null;
}
