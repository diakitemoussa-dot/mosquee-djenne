(function () {
  // Timing (doit rester synchronisé avec les valeurs CSS dans style.css :
  // délai max des bandes = 375ms, durée d'animation par bande = 700ms).
  const FULL_COVER_MS = 1075; // délai max (375) + durée d'une bande (700)
  const PAUSE_MS = 200;
  const FADE_MS = 725;

  const overlay = document.getElementById('paper-unfold-overlay');

  window.playPaperUnfoldTransition = function playPaperUnfoldTransition(onFullyCovered) {
    if (!overlay) {
      if (typeof onFullyCovered === 'function') onFullyCovered();
      return;
    }

    // Réinitialiser l'état avant de rejouer (au cas où la transition a déjà tourné).
    overlay.hidden = false;
    overlay.classList.remove('fading-out');
    overlay.classList.remove('unfolding');
    overlay.style.opacity = '';

    // Forcer un reflow pour que le retrait de la classe 'unfolding' soit bien pris en
    // compte avant de la rajouter (sinon l'animation ne se relance pas si elle a déjà joué).
    void overlay.offsetWidth;

    overlay.classList.add('unfolding');

    setTimeout(() => {
      if (typeof onFullyCovered === 'function') onFullyCovered();
    }, FULL_COVER_MS);

    setTimeout(() => {
      overlay.classList.add('fading-out');
    }, FULL_COVER_MS + PAUSE_MS);

    setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove('unfolding');
      overlay.classList.remove('fading-out');
    }, FULL_COVER_MS + PAUSE_MS + FADE_MS);
  };
})();
