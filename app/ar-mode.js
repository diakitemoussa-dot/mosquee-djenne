/* Mode AR — Android (Scene Viewer / WebXR) + iOS (Quick Look)
 * Utilise <model-viewer> de Google — un seul GLB gère tout.
 */

export async function enter() {
  const viewer = document.getElementById('mosqueArViewer');
  if (!viewer) {
    _toast('Composant AR non trouvé');
    return;
  }

  // Attendre que le custom element soit complètement défini
  await customElements.whenDefined('model-viewer');

  // Vérifier si AR est supporté sur cet appareil
  if (!viewer.canActivateAR) {
    _toast('AR non disponible (ARCore ou iOS 12+ requis)');
    return;
  }

  viewer.addEventListener('ar-status', (e) => {
    const s = e.detail.status;
    if (s === 'failed') {
      _toast('Impossible de lancer l\'AR — vérifiez ARCore');
    }
  }, { once: true });

  viewer.activateAR();
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
