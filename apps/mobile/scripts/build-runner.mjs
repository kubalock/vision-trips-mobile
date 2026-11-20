// Bundles the background runner (runner/trip-watch.runner.ts) into one plain script for @capacitor/background-runner,
// which loads it from the app bundle (public/ is copied into the build). The runner's engine is not a browser, so
// the notification rules are taken from the contracts source directly: the package entry would also pull in zod.
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'runner/trip-watch.runner.ts')],
  outfile: resolve(root, 'public/runners/trip-watch.js'),
  bundle: true,
  format: 'iife',
  // Conservative syntax for the Android runner's QuickJS-based engine and older iOS JavaScriptCore.
  target: 'es2017',
  platform: 'neutral',
  alias: { '@vision-trips/contracts': resolve(root, '../../packages/contracts/src/trip-notifications.ts') },
  legalComments: 'none',
  logLevel: 'warning',
});
