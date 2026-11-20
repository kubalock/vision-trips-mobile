// Applies the native changes the app needs to the android/ and ios/ projects (committed since 2026-11-20; the script
// still rebuilds everything if a platform is removed and added again with `npx cap add`): what
// @capacitor/background-runner needs, the app icons and launch screens, the notification icon, backup rules, the iOS
// privacy manifest and the version numbers. Safe to run any number of times; runs after every `npx cap sync`
// (package.json "capacitor:sync:after"). Projects that haven't been added yet are skipped.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// App icons and launch screens: generated from resources/ by @capacitor/assets whenever those images changed or a
// platform was (re)added, which would bring back Capacitor's placeholder artwork. A stamp records what was used.
const artwork = ['icon-only.png', 'icon-foreground.png', 'icon-background.png', 'splash.png', 'splash-dark.png'];
const artworkHash = createHash('sha256');
for (const file of artwork) artworkHash.update(readFileSync(resolve(root, 'resources', file)));
const stampValue = artworkHash.digest('hex');
const platforms = ['android', 'ios'].filter((platform) => existsSync(resolve(root, platform)));
const stale = platforms.filter((platform) => !existsSync(resolve(root, platform, '.vision-artwork')) || readFileSync(resolve(root, platform, '.vision-artwork'), 'utf8') !== stampValue);
if (stale.length) {
  execFileSync('npm', ['run', 'icons:native', '--', ...stale.map((platform) => `--${platform}`)], { cwd: root, stdio: 'ignore' });
  for (const platform of stale) writeFileSync(resolve(root, platform, '.vision-artwork'), stampValue);
  changes.push(`app icons and launch screens (${stale.join(', ')})`);
}

// Android status-bar icon for notifications (capacitor.config.ts LocalNotifications.smallIcon and the background check).
const res = resolve(root, 'android/app/src/main/res');
if (existsSync(res)) {
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const source = resolve(root, `resources/android/notification/drawable-${density}/ic_stat_vision.png`);
    const target = resolve(res, `drawable-${density}/ic_stat_vision.png`);
    if (existsSync(target) && readFileSync(target).equals(readFileSync(source))) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    changes.push(relative(root, target));
  }
  // Android 12+ draws its own launch screen (the app icon on a colour): the same colours as the app's start-up screen.
  for (const [folder, colour] of [['values', '#f6f6f5'], ['values-night', '#121415']]) {
    const file = resolve(res, folder, 'vision_launch.xml');
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="vision_launch_background">${colour}</color>\n</resources>\n`;
    if (existsSync(file) && readFileSync(file, 'utf8') === xml) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, xml);
    changes.push(relative(root, file));
  }
  edit(resolve(res, 'values/styles.xml'), (text) => text.includes('windowSplashScreenBackground') ? text : text.replace(
    /(<style name="AppTheme\.NoActionBarLaunch" parent="Theme\.SplashScreen">\n)/,
    '$1        <item name="windowSplashScreenBackground">@color/vision_launch_background</item>\n'));
}

// Android backups: the saved sessions are encrypted with Keystore keys that never leave the phone, so a restored copy
// can't be read on another phone, and the background check's watch tokens are plain text. Nothing is backed up or
// copied to a new phone: customers open their invitation link again (or use a trusted device) there.
edit(resolve(root, 'android/app/src/main/AndroidManifest.xml'), (text) => {
  let result = text.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  if (!result.includes('android:dataExtractionRules=')) result = result.replace('android:allowBackup="false"', 'android:allowBackup="false"\n        android:dataExtractionRules="@xml/data_extraction_rules"\n        android:fullBackupContent="false"');
  return result;
});
if (existsSync(res)) {
  const file = resolve(res, 'xml/data_extraction_rules.xml');
  const xml = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Android 12+: nothing goes to cloud backup or to a new phone (see scripts/native-setup.mjs). -->\n<data-extraction-rules>\n    <cloud-backup>\n'
    + ['root', 'file', 'database', 'sharedpref', 'external'].map((domain) => `        <exclude domain="${domain}" path="." />\n`).join('')
    + '    </cloud-backup>\n    <device-transfer>\n'
    + ['root', 'file', 'database', 'sharedpref', 'external'].map((domain) => `        <exclude domain="${domain}" path="." />\n`).join('')
    + '    </device-transfer>\n</data-extraction-rules>\n';
  if (!existsSync(file) || readFileSync(file, 'utf8') !== xml) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, xml); changes.push(relative(root, file)); }
}

// iOS privacy manifest (resources/ios/PrivacyInfo.xcprivacy): copied in and added to the app target's resources.
const iosApp = resolve(root, 'ios/App/App');
if (existsSync(iosApp)) {
  const source = resolve(root, 'resources/ios/PrivacyInfo.xcprivacy');
  const target = resolve(iosApp, 'PrivacyInfo.xcprivacy');
  if (!existsSync(target) || !readFileSync(target).equals(readFileSync(source))) { copyFileSync(source, target); changes.push(relative(root, target)); }
  edit(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), (text) => {
    if (text.includes('PrivacyInfo.xcprivacy')) return text;
    const fileRef = 'A11CE0000000000000000001';
    const buildFile = 'A11CE0000000000000000002';
    return text
      .replace('/* Begin PBXBuildFile section */\n', `/* Begin PBXBuildFile section */\n\t\t${buildFile} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRef} /* PrivacyInfo.xcprivacy */; };\n`)
      .replace('/* Begin PBXFileReference section */\n', `/* Begin PBXFileReference section */\n\t\t${fileRef} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n`)
      .replace(/(\t+)(504EC30E1FED79650016851F \/\* Assets\.xcassets \*\/,\n)/, `$1$2$1${fileRef} /* PrivacyInfo.xcprivacy */,\n`)
      .replace(/(\t+)(504EC30F1FED79650016851F \/\* Assets\.xcassets in Resources \*\/,\n)/, `$1$2$1${buildFile} /* PrivacyInfo.xcprivacy in Resources */,\n`);
  });
}

// Version numbers from package.json: "1.4.2" is the version customers see, and the build number the stores need to
// increase with every upload is 10402 (major × 10000 + minor × 100 + patch), unless VISION_BUILD_NUMBER is set.
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!match || Number(match[2]) > 99 || Number(match[3]) > 99) throw new Error(`package.json version must be major.minor.patch with minor and patch below 100, not "${version}".`);
const build = process.env.VISION_BUILD_NUMBER?.trim() || String(Number(match[1]) * 10_000 + Number(match[2]) * 100 + Number(match[3]));
if (!/^[1-9]\d{0,8}$/.test(build)) throw new Error(`The build number must be a positive whole number, not "${build}".`);
edit(resolve(appModule, 'build.gradle'), (text) => text.replace(/versionCode \d+/, `versionCode ${build}`).replace(/versionName "[^"]*"/, `versionName "${version}"`));
edit(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), (text) => text.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`).replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`));

console.log(changes.length ? `Native setup updated: ${changes.join(', ')}` : 'Native setup: nothing to change.');
