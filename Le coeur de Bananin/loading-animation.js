import { animate, createDrawable, splitText } from 'animejs';

// Effet d'écriture : les lettres de "LOADING" apparaissent une à une au démarrage
// (indépendant du pourcentage de chargement réel, purement décoratif à l'entrée).
const { chars } = splitText('#loading-word', { chars: true });
animate(chars, {
  opacity: [0, 1],
  translateY: [6, 0],
  delay: (_el, i) => i * 60,
  duration: 400,
  ease: 'outQuad',
});

// Ligne décorative "dessinée" en fonction du chargement réel, remplace l'ancienne
// barre de progression rectangulaire : son tracé (stroke) avance de 0 à 100% au
// même rythme que les assets/le modèle 3D se chargent.
const [drawLine] = createDrawable('#loading-draw-line');

let currentRatio = 0;

window.onLoadingProgress = function onLoadingProgress(ratio) {
  currentRatio = Math.max(0, Math.min(ratio, 1));
  animate(drawLine, {
    draw: `0 ${currentRatio}`,
    duration: 250,
    ease: 'outSine',
  });
};
