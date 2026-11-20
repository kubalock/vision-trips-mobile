// Applies the native changes @capacitor/background-runner needs to the generated android/ and ios/ projects, which
// are not in git. Safe to run any number of times; runs after every `npx cap sync` (package.json
// "capacitor:sync:after"). Projects that haven't been added yet are skipped.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Must match plugins.BackgroundRunner.label in capacitor.config.ts.
const TASK_ID = 'uk.co.visiontrips.app.trip-check';
const changes = [];

function edit(file, change) {
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after !== before) { writeFileSync(file, after); changes.push(relative(root, file)); }
}

// Android: the runner's JavaScript engine ships as a local .aar the app module must be able to find.
const pluginLibs = resolve(dirname(createRequire(import.meta.url).resolve('@capacitor/background-runner/package.json')), 'android/src/main/libs');
const appModule = resolve(root, 'android/app');
edit(resolve(appModule, 'build.gradle'), (text) => {
  const line = `dirs '${relative(appModule, pluginLibs)}', 'libs'`;
  if (text.includes(line)) return text;
  return text.replace(/(flatDir\s*\{\n(\s*)dirs '\.\.\/capacitor-cordova-android-plugins\/src\/main\/libs', 'libs'\n)/, `$1$2${line}\n`);
});

// iOS: background modes and the task identifier in Info.plist, and the task registered at launch.
edit(resolve(root, 'ios/App/App/Info.plist'), (text) => {
  let result = text;
  if (!result.includes('<key>BGTaskSchedulerPermittedIdentifiers</key>')) {
    result = result.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>BGTaskSchedulerPermittedIdentifiers</key>\n\t<array>\n\t\t<string>${TASK_ID}</string>\n\t</array>\n</dict>\n</plist>\n`);
  }
  if (!result.includes('<key>UIBackgroundModes</key>')) {
    result = result.replace(/<\/dict>\s*<\/plist>\s*$/, '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>fetch</string>\n\t\t<string>processing</string>\n\t</array>\n</dict>\n</plist>\n');
  } else {
    for (const mode of ['fetch', 'processing']) {
      if (!new RegExp(`<key>UIBackgroundModes</key>\\s*<array>[\\s\\S]*?<string>${mode}</string>`).test(result)) {
        result = result.replace(/(<key>UIBackgroundModes<\/key>\s*<array>)/, `$1\n\t\t<string>${mode}</string>`);
      }
    }
  }
  return result;
});
edit(resolve(root, 'ios/App/App/AppDelegate.swift'), (text) => {
  let result = text;
  if (!result.includes('import CapacitorBackgroundRunner')) result = result.replace('import Capacitor\n', 'import Capacitor\nimport CapacitorBackgroundRunner\n');
  if (!result.includes('BackgroundRunnerPlugin.registerBackgroundTask()')) {
    result = result.replace(/(didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\?\) -> Bool \{\n)/,
      '$1        BackgroundRunnerPlugin.registerBackgroundTask()\n        BackgroundRunnerPlugin.handleApplicationDidFinishLaunching(launchOptions: launchOptions)\n');
  }
  return result;
});

console.log(changes.length ? `Native setup updated: ${changes.join(', ')}` : 'Native setup: nothing to change.');
