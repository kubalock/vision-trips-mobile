import { SetMetadata } from '@nestjs/common';

export const NO_STORED_REPLAY = 'vision:no-stored-replay';

/**
 * Routes whose responses carry credentials (sessions, invitation links, trusted-device tokens) must never be written
 * to the idempotency store, where a replay would hand them out again and the database would hold them in clear text.
 * These routes ignore the `Idempotency-Key` header and implement their own duplicate protection where needed. Replay
 * is opt-in (`@Idempotent()`), so this marks routes that must never opt in.
 */
export const NoStoredReplay = (): MethodDecorator & ClassDecorator => SetMetadata(NO_STORED_REPLAY, true);
