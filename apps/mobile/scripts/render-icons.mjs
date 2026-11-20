// Renders the native app artwork from the SVG sources in resources/ (the PNGs are committed, so a fresh checkout
// doesn't need this). Run after changing an SVG: `npm run icons:render`, then `npm run icons:native`.
//   icon-only.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png → @capacitor/assets
//   android/notification/drawable-*/ic_stat_vision.png → copied into android/ by scripts/native-setup.mjs
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const resources = resolve(dirname(fileURLToPath(import.meta.url)), '../resources');
// Each SVG declares its full-size width and height, so it renders at that size and is only ever scaled down.
const render = (svg, png, size) => {
  mkdirSync(dirname(resolve(resources, png)), { recursive: true });
  return sharp(resolve(resources, svg)).resize(size, size).png().toFile(resolve(resources, png));
};

await Promise.all([
  render('icon.svg', 'icon-only.png', 1024),
  render('icon-foreground.svg', 'icon-foreground.png', 1024),
  render('icon-background.svg', 'icon-background.png', 1024),
  render('splash.svg', 'splash.png', 2732),
  render('splash-dark.svg', 'splash-dark.png', 2732),
  // Android status-bar icon: 24dp at each density.
  ...Object.entries({ mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 })
    .map(([density, size]) => render('notification.svg', `android/notification/drawable-${density}/ic_stat_vision.png`, size)),
]);
console.log('Rendered native artwork into resources/.');
