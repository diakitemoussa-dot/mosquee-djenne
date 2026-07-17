# Fondu de bord aquarelle pour Meshy_output — Partie 2 Bananin — Design

**Goal:** Faire en sorte que le pourtour extérieur du mesh `Meshy_output` (petite flaque de terrain/rocher, partie 2 de "Le cœur de Bananin") s'affiche avec un bord flou et irrégulier façon aquarelle, plus quelques petites taches isolées dispersées juste au-delà du bord, au lieu de son bord géométrique net actuel — entièrement en code (aucune retouche Blender, aucun ré-export GLB).

## Contexte technique découvert

- `Meshy_output` est un nœud du GLB `scene-partie2.glb` référençant le mesh `output.001` : seulement **28 sommets**, bbox locale ~0.12 × 0.01 × 0.16 unité, échelle de nœud ×68.35 (empreinte monde ≈ 8×11 unités, plat).
- Il utilise un matériau exclusif, `Material_0.002` (aucune autre instance), avec sa propre texture `baseColorTexture` 2048×2048, déjà en `alphaMode: BLEND` côté glTF.
- Les UV de ce mesh sont un mapping planaire simple, occupant une petite sous-région du texture atlas : U ≈ 0.609–0.638, V ≈ 0.793–0.838.
- `makeShadable()` (dans `scene3d-part2.js`) reconstruit déjà tous les matériaux de la scène en `MeshStandardMaterial({ transparent: true, alphaTest: 0.1, ... })` — la transparence est donc déjà activée globalement ; il ne manque qu'un `alphaMap` pour ce mesh précis.

**Implication de design :** avec seulement 28 sommets, un fondu porté par les sommets (couleur/alpha par vertex) produirait un bord anguleux et non flou. L'approche doit être **texture-space** (un masque alpha généré par canvas, aligné sur la petite zone UV du mesh via `texture.offset`/`texture.repeat`), pour un rendu net indépendant de la faible résolution du maillage.

## Approche

Dans `scene3d-part2.js`, après avoir localisé `terrainMesh` (`Meshy_output`) dans `init()` :

1. **Calculer la bbox UV réelle** du mesh à partir de son attribut `uv` de géométrie (min/max sur tous les sommets), avec une marge de sécurité (ex. +15% de padding autour) pour laisser de la place au fondu et aux taches sans les couper.
2. **Générer un masque alpha procédural** via un `<canvas>` offscreen (résolution fixe, ex. 512×512, indépendante du mesh) :
   - Fond blanc opaque (alpha = 1 → terrain visible) partout.
   - Une forme centrale occupant l'essentiel du canvas, dont le bord est rendu flou et irrégulier via plusieurs dégradés radiaux légèrement décalés/randomisés (pas un cercle parfait) plutôt qu'un simple `radialGradient` unique.
   - Quelques (3–6) petites taches isolées à opacité partielle, dispersées juste au-delà du bord principal, à des angles/rayons aléatoires — mimant des gouttes d'aquarelle.
   - Le canvas encode l'alpha en niveaux de gris (R=G=B) puisque `THREE.Material.alphaMap` échantillonne le canal vert du texel.
3. **Convertir en `THREE.CanvasTexture`**, régler `offset`/`repeat` pour que ce masque 0–1 se cale exactement sur la petite bbox UV réelle du mesh (calculée à l'étape 1), pas sur l'espace UV 0–1 complet de la scène.
4. **Assigner** `terrainMesh.material.alphaMap = maskTexture` (le matériau du mesh est déjà `transparent: true` via `makeShadable`).
5. Exposer les paramètres visuels ajustables en constantes en haut du fichier : largeur de la zone de flou, intensité de l'irrégularité du bord, nombre/taille/opacité des taches — pour un réglage rapide après vérification visuelle dans le navigateur.

## Fichiers concernés

- `Le coeur de Bananin/scene3d-part2.js` — seul fichier modifié. Nouvelle fonction (ex. `buildTerrainEdgeFadeMask(terrainMesh)`) appelée juste après la ligne où `terrainMesh` est assigné dans `init()` (actuellement ligne ~138).

## Vérification

Serveur local (`cd "Le coeur de Bananin" && npx --yes http-server -p 8080 .`), scroller jusqu'à la partie 2, observer le bord de la flaque de terrain sous plusieurs angles de caméra (orbite libre) : le bord doit apparaître flou/irrégulier avec quelques petites taches dispersées, sans changement du reste du rendu (éclairage, ombres, collision caméra sur le terrain restent inchangés — `preventTerrainClipping` continue de raycaster sur la géométrie réelle, non affectée par le masque visuel).

## Hors scope

- Pas de retouche de la texture source dans Blender, pas de ré-export GLB.
- Pas de changement du comportement de collision caméra (`preventTerrainClipping`) — le fondu est purement visuel (alpha), la géométrie de collision reste identique.
- Pas d'animation du fondu (masque statique, généré une fois au chargement).
