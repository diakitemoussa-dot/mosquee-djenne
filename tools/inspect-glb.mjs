// tools/inspect-glb.mjs — inspecte clips, nœuds racine et bbox d'un GLB Draco
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3d';

const path = process.argv[2];
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

const doc = await io.read(path);
const root = doc.getRoot();

console.log('=== ANIMATIONS ===');
for (const a of root.listAnimations()) console.log('-', JSON.stringify(a.getName()));

console.log('=== NŒUDS (top-level scene) ===');
for (const s of root.listScenes())
  for (const n of s.listChildren()) console.log('-', JSON.stringify(n.getName()));

console.log('=== TOUS LES NŒUDS ===');
for (const n of root.listNodes()) console.log('-', JSON.stringify(n.getName()));
