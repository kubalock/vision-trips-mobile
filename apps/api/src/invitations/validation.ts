import { BadRequestException } from '@nestjs/common';
import type { InvitationErrorCode } from '@vision-trips/contracts';
import type * as z from 'zod/mini';

/** Parses a request body with its runtime schema; the first problem becomes a 400 with a readable message. */
export function parseRequest<S extends z.ZodMiniType>(schema: S, body: unknown, code?: InvitationErrorCode): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const message = result.error.issues[0]?.message || 'The request is not valid.';
  throw new BadRequestException(code ? { statusCode: 400, code, message } : { statusCode: 400, message });
}

/** Checks a response against its contract before it leaves the API, so drift fails loudly in tests. */
export function checkedResponse<S extends z.ZodMiniType>(schema: S, value: z.input<S>): z.output<S> {
  return schema.parse(value);
}
