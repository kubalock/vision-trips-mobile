import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT = 'vision:idempotent';

/**
 * Opts a session-authenticated route into `Idempotency-Key` replay. Nothing else is replayed: routes are cached only
 * when they ask for it, never by default, because a stored response is handed back without running the controller.
 *
 * Before any stored response is looked up, the request's own access token is validated, including the entitlement
 * re-check, so a revoked session gets `access_revoked` rather than its earlier reply. Keys are scoped to the booking
 * and the session itself (its ID survives token renewal, so automatic retries still match), because a replay skips
 * the controller's own checks (`fellowTraveller`, `requireVerified()`): a share session or a legacy-assurance
 * session of the same Customer must never be handed a response stored for a verified lead session.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT, true);
