/// <reference types="@capacitor/background-runner" />
import type { CapacitorConfig } from '@capacitor/cli';

// Set CAP_DEV=1 when syncing a build that talks to a plain-HTTP API on your computer (local testing only).
const developmentDevice = process.env['CAP_DEV'] === '1';

const config: CapacitorConfig = {
  appId: 'uk.co.visiontrips.app',
  appName: 'Vision Trips',
  webDir: 'dist/mobile/browser',
  // Send HttpClient requests through the native layer: no browser CORS or mixed-content blocking inside the app.
  plugins: {
    CapacitorHttp: { enabled: true },
    // Checks saved trips for changes while the app isn't open (src/background/trip-watch.ts). 15 minutes is
    // Android's minimum; both systems decide the real timing. The label is also the iOS background task identifier
    // (scripts/native-setup.mjs adds it to Info.plist).
    BackgroundRunner: { label: 'uk.co.visiontrips.app.trip-check', src: 'runners/trip-watch.js', event: 'checkTrips', repeat: true, interval: 15, autoStart: true },
  },
  // Local builds serve the app from http://localhost on Android so <img>/<video> can load plain-HTTP media from the
  // API: at the default https://localhost the web view blocks it as mixed content (API requests go through
  // CapacitorHttp, images don't; `allowMixedContent` alone still blocks srcset images).
  ...(developmentDevice ? { server: { cleartext: true, androidScheme: 'http' } } : {}),
};

export default config;
