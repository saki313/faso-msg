// ============================================================================
// FasoMsg — scripts/construire.js
// Construction du client : agrégation des modules (esbuild, MIT) et copie de
// la bibliothèque Olm compilée en WebAssembly à côté du bundle.
//   npm run build
// ============================================================================

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '..');

(async () => {
  await esbuild.build({
    entryPoints: [path.join(racine, 'client', 'main.mjs')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: path.join(racine, 'public', 'app.js'),
    // Olm contient des require("fs"/"path"/"crypto") pour son exécution sous
    // Node ; dans le navigateur ces branches ne s'exécutent jamais : on les
    // déclare simplement externes pour l'agrégation.
    external: ['fs', 'path', 'crypto'],
    // Licences des bibliothèques agrégées conservées dans le bundle.
    legalComments: 'inline',
    logLevel: 'info',
  });

  // Olm : la bibliothèque charge son fichier .wasm au démarrage.
  fs.copyFileSync(
    path.join(racine, 'node_modules', '@matrix-org', 'olm', 'olm.wasm'),
    path.join(racine, 'public', 'olm.wasm'),
  );
  console.log('Client construit : public/app.js + public/olm.wasm');
})();
