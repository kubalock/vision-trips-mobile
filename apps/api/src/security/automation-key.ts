import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/** Checks the `X-Vision-Key` header used by Airtable automations, in constant time. */
export function assertAutomationKey(supplied: string | undefined): void {
  const expected = process.env.VISION_AUTOMATION_KEY?.trim();
  if (!expected) throw new ServiceUnavailableException('Automation access is not configured.');
  const left = Buffer.from(supplied ?? '');
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new ForbiddenException('Invalid automation key.');
}
