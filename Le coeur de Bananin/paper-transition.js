(function () {
  // Timing (doit rester synchronisé avec les valeurs CSS dans style.css :
  // délai max des bandes = 375ms, durée d'animation par bande = 700ms).
  const FULL_COVER_MS = 1075; // délai max (375) + durée d'une bande (700)
  const PAUSE_MS = 200;
  const FADE_MS = 725;

  const overlay = document.getElementById('paper-unfold-overlay');

  // IDs des timeouts en cours, pour pouvoir les annuler si la transition est
  // redéclenchée avant la fin de la précédente (ex: double-clic rapide).
  let pendingTimeouts = [];

  window.playPaperUnfoldTransition = function playPaperUnfoldTransition(onFullyCovered) {
    if (!overlay) {
      if (typeof onFullyCovered === 'function') onFullyCovered();
      return;
    }

    // Annuler toute transition en cours avant d'en démarrer une nouvelle.
    pendingTimeouts.forEach(clearTimeout);
    pendingTimeouts = [];

    // Réinitialiser l'état avant de rejouer (au cas où la transition a déjà tourné).
    overlay.hidden = false;
    overlay.classList.remove('fading-out');
    overlay.classList.remove('unfolding');
    overlay.style.opacity = '';

    // Forcer un reflow pour que le retrait de la classe 'unfolding' soit bien pris en
    // compte avant de la rajouter (sinon l'animation ne se relance pas si elle a déjà joué).
    void overlay.offsetWidth;

    overlay.classList.add('unfolding');

    pendingTimeouts.push(setTimeout(() => {
      if (typeof onFullyCovered === 'function') onFullyCovered();
    }, FULL_COVER_MS));

    pendingTimeouts.push(setTimeout(() => {
      overlay.classList.add('fading-out');
    }, FULL_COVER_MS + PAUSE_MS));

    pendingTimeouts.push(setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('unfolding');
      overlay.classList.remove('fading-out');
    }, FULL_COVER_MS + PAUSE_MS + FADE_MS));
  };
})();
