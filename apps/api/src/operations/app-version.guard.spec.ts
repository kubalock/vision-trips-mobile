import { HttpException } from '@nestjs/common';
import { AppVersionGuard, compareVersions, parseVersion } from './app-version.guard.js';

function context(headers: Record<string, string>, method = 'GET') {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const request = { method, get: (name: string) => lower[name.toLowerCase()] };
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }) } as never;
}

function refusal(run: () => unknown): Record<string, unknown> {
  try { run(); } catch (error) { if (error instanceof HttpException) return { status: error.getStatus(), ...(error.getResponse() as object) }; throw error; }
  throw new Error('Expected the request to be refused.');
}

describe('AppVersionGuard', () => {
  const guard = new AppVersionGuard();
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('refuses installed apps below the minimum with 426 and where to update', () => {
    process.env.VISION_MIN_APP_VERSION = '1.2.0';
    expect(refusal(() => guard.canActivate(context({ 'X-Vision-Platform': 'android', 'X-Vision-App-Version': '1.1.9' })))).toEqual({
      status: 426, statusCode: 426, code: 'app_update_required', message: 'Please update the Vision Trips app to continue.', minimumVersion: '1.2.0',
      updateUrl: 'https://play.google.com/store/apps/details?id=uk.co.visiontrips.app',
    });
    expect(guard.canActivate(context({ 'X-Vision-Platform': 'android', 'X-Vision-App-Version': '1.2.0' }))).toBe(true);
    expect(guard.canActivate(context({ 'X-Vision-Platform': 'ios', 'X-Vision-App-Version': '1.10.0' }))).toBe(true);
  });

  it('uses a per-platform minimum and store link when set', () => {
    process.env.VISION_MIN_APP_VERSION = '1.0.0';
    process.env.VISION_MIN_APP_VERSION_IOS = '2.0.0';
    process.env.VISION_APP_STORE_URL_IOS = 'https://apps.apple.com/app/id123';
    expect(refusal(() => guard.canActivate(context({ 'X-Vision-Platform': 'ios', 'X-Vision-App-Version': '1.9.9' })))).toMatchObject({ minimumVersion: '2.0.0', updateUrl: 'https://apps.apple.com/app/id123' });
    expect(guard.canActivate(context({ 'X-Vision-Platform': 'android', 'X-Vision-App-Version': '1.9.9' }))).toBe(true);
  });

  it('never refuses the web app, automations, unreadable versions, sign-outs or when no minimum is set', () => {
    process.env.VISION_MIN_APP_VERSION = '9.0.0';
    expect(guard.canActivate(context({}))).toBe(true);
    expect(guard.canActivate(context({ 'X-Vision-Platform': 'web', 'X-Vision-App-Version': '1.0.0' }))).toBe(true);
    expect(guard.canActivate(context({ 'X-Vision-Platform': 'android', 'X-Vision-App-Version': 'latest' }))).toBe(true);
    expect(guard.canActivate(context({ 'X-Vision-Platform': 'android', 'X-Vision-App-Version': '1.0.0' }, 'DELETE'))).toBe(true);
    delete process.env.VISION_MIN_APP_VERSION;
    expect(guard.canActivate(context({ 'X-Vision-Platform': 'android', 'X-Vision-App-Version': '0.0.1' }))).toBe(true);
  });

  it('compares versions numerically', () => {
    expect(compareVersions(parseVersion('1.10.0')!, parseVersion('1.9.9')!)).toBeGreaterThan(0);
    expect(compareVersions(parseVersion('2.0.0')!, parseVersion('2.0.0')!)).toBe(0);
    expect(parseVersion('1.2')).toBeNull();
  });
});
