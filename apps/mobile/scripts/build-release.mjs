// Builds the app for the stores and copies it into android/ and ios/:
//   VISION_API_URL=https://api.example.com/v1 npm run build:release --workspace @vision-trips/mobile
// Optional: VISION_TRIP_LINK_HOSTS=trips.example.com (hosts whose /trip/ links the app accepts, comma-separated)
//           VISION_BUILD_NUMBER=10203 (otherwise worked out from the package.json version; see native-setup.mjs)
// Then archive in Android Studio (Build > Generate Signed App Bundle) and Xcode (Product > Archive). Never use
// build:device for a store build: it points at this computer and allows plain HTTP.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => { console.error(`build:release: ${message}`); process.exit(1); };

const apiUrl = process.env.VISION_API_URL?.trim().replace(/\/+$/, '') ?? '';
let parsed;
try { parsed = new URL(apiUrl); } catch { fail('set VISION_API_URL to the production API, e.g. https://api.example.com/v1'); }
if (parsed.protocol !== 'https:') fail(`VISION_API_URL must use https://, not ${parsed.protocol}`);
if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(parsed.hostname)) fail(`VISION_API_URL points at a local address (${parsed.hostname})`);
const linkHosts = process.env.VISION_TRIP_LINK_HOSTS?.trim() ?? '';
if (linkHosts && !/^[a-z0-9.-]+(,[a-z0-9.-]+)*$/i.test(linkHosts)) fail('VISION_TRIP_LINK_HOSTS must be host names separated by commas');

// The local-testing switches (plain HTTP, http://localhost origin) must not reach a store build.
const env = { ...process.env };
delete env.CAP_DEV;
const run = (command, args) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' });

run('npm', ['run', 'build:runner']);
run('npx', ['ng', 'build', '--configuration', 'production', '--define', `VISION_API_URL=${JSON.stringify(apiUrl)}`,
  ...(linkHosts ? ['--define', `VISION_TRIP_LINK_HOSTS=${JSON.stringify(linkHosts)}`] : [])]);
run('npx', ['cap', 'sync']);

for (const file of ['android/app/src/main/assets/capacitor.config.json', 'ios/App/App/capacitor.config.json']) {
  let config;
  try { config = JSON.parse(readFileSync(resolve(root, file), 'utf8')); } catch { continue; }
  if (config.server?.cleartext || config.server?.androidScheme === 'http') fail(`${file} still allows plain HTTP; sync again without CAP_DEV`);
}
console.log(`Release build ready for ${apiUrl}. Archive and sign it in Android Studio and Xcode.`);
