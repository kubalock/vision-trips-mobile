import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT = 'vision:idempotent';

/**
 * Opts a session-authenticated route into `Idempotency-Key` replay. Nothing else is replayed: routes are cached only
 * when they ask for it, never by default, because a stored response is handed back without running the controller.
 *
 * Before any stored response is looked up, the request's own access token is validated, including the entitlement
 * re-check, so a revoked session gets `access_revoked` rather than its earlier reply. Keys are scoped to the session's
 * booking and verified Customer (or, without a Customer, to the session itself), so another branch, booking or
 * person can never be handed someone else's stored response.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT, true);
