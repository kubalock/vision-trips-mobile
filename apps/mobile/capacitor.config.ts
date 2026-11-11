import type { CapacitorConfig } from '@capacitor/cli';

// Set CAP_DEV=1 when syncing a build that talks to a plain-HTTP API on your computer (local testing only).
const developmentDevice = process.env['CAP_DEV'] === '1';

const config: CapacitorConfig = {
  appId: 'uk.co.visiontrips.app',
  appName: 'Vision Trips',
  webDir: 'dist/mobile/browser',
  // Send HttpClient requests through the native layer: no browser CORS or mixed-content blocking inside the app.
  plugins: { CapacitorHttp: { enabled: true } },
  ...(developmentDevice ? { server: { cleartext: true } } : {}),
};

export default config;
