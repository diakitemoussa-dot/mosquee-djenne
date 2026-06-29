/* Mode AR — Android (WebXR / Scene Viewer) + iOS (Quick Look)
 * Utilise <model-viewer> de Google qui gère les deux plateformes
 * avec un simple GLB, sans USDZ ni code WebXR custom.
 */

export async function enter() {
  const viewer = document.getElementById('mosqueArViewer');
  if (!viewer) {
    _toast('Composant AR non trouvé');
    return;
  }

  // Attendre que le custom element model-viewer soit défini et upgradé
  await customElements.whenDefined('model-viewer');

  if (typeof viewer.activateAR !== 'function') {
    _toast('AR non disponible sur cet appareil');
    return;
  }

  // Feedback si la session AR échoue
  viewer.addEventListener('ar-status', (e) => {
    if (e.detail.status === 'failed') {
      _toast('AR non disponible sur cet appareil');
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
