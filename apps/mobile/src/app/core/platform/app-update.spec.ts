import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { AppUpdate, updateRequirement } from './app-update';
import { VtUpdateRequired } from '../../shared/update-required';

describe('app update required', () => {
  const refusal = (body: unknown, status = 426) => new HttpErrorResponse({ status, error: body });

  it('recognises the API asking for an update, and nothing else', () => {
    expect(updateRequirement(refusal({ code: 'app_update_required', minimumVersion: '1.2.0', updateUrl: 'https://play.google.com/store/apps/details?id=uk.co.visiontrips.app' })))
      .toEqual({ minimumVersion: '1.2.0', updateUrl: 'https://play.google.com/store/apps/details?id=uk.co.visiontrips.app' });
    expect(updateRequirement(refusal({ code: 'app_update_required', minimumVersion: '1.2.0', updateUrl: 'javascript:alert(1)' }))?.updateUrl).toBeNull();
    expect(updateRequirement(refusal({ code: 'something_else' }))).toBeNull();
    expect(updateRequirement(refusal({ code: 'app_update_required' }, 401))).toBeNull();
    expect(updateRequirement(new Error('offline'))).toBeNull();
  });

  it('shows "Update Vision Trips" with the store link until dismissed', () => {
    const fixture = TestBed.createComponent(VtUpdateRequired);
    const update = TestBed.inject(AppUpdate);
    const element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    expect(element.textContent?.trim()).toBe('');

    update.report(refusal({ code: 'app_update_required', minimumVersion: '1.2.0', updateUrl: 'https://apps.apple.com/app/id123' }));
    fixture.detectChanges();
    expect(element.querySelector('strong')?.textContent).toBe('Update Vision Trips');
    expect(element.querySelector('a')?.getAttribute('href')).toBe('https://apps.apple.com/app/id123');

    (element.querySelector('button[aria-label="Not now"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(element.textContent?.trim()).toBe('');
  });
});
