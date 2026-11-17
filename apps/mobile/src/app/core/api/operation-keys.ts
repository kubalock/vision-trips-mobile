import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';

/**
 * `Idempotency-Key`s for writes. A key is made once per operation, before the session manager runs it, so the retry
 * after a token renewal sends the same key. For high-value operations (quotation acceptance, payment links) the key
 * is also kept after an attempt that ended without a clear answer (no connection, a timeout, a server fault): the
 * server may have done the work and lost only its reply, so the traveller's next try with the same details gets that
 * stored reply instead of doing it twice. The same goes for 409 `idempotency_in_progress` (the first attempt is still
 * running on the server): a fresh key would start the operation a second time. A success or any other clear refusal
 * (4xx) forgets the key.
 *
 * Kept in memory only: after the app restarts, a retry is a new operation.
 */
@Injectable({ providedIn: 'root' })
export class OperationKeys {
  private readonly pending = new Map<string, string>();
  /** Waits before asking again, with the same key, while the server is still running the first attempt. */
  retryDelaysMs: readonly number[] = [1_000, 2_000, 4_000];

  /**
   * Runs `attempt` with one key, reusing a key left by an earlier unanswered attempt with the same details. While
   * the server reports the operation still in progress, asks again a few times with that key for its stored reply.
   */
  async run<T>(operation: string, details: unknown, attempt: (key: string) => Promise<T>): Promise<T> {
    const id = `${operation}:${JSON.stringify(details ?? null)}`;
    const key = this.pending.get(id) ?? crypto.randomUUID();
    this.pending.set(id, key);
    for (let retry = 0; ; retry++) {
      try {
        const result = await attempt(key);
        this.pending.delete(id);
        return result;
      } catch (error) {
        if (isOperationInProgress(error) && retry < this.retryDelaysMs.length) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelaysMs[retry]));
          continue;
        }
        if (!isUnanswered(error)) this.pending.delete(id);
        throw error;
      }
    }
  }
}

/** The request may have reached the server and done its work even though no usable answer came back. */
export function isUnanswered(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return error instanceof Error && error.name === 'TimeoutError';
  return error.status === 0 || error.status === 408 || error.status >= 500 || isOperationInProgress(error);
}

/** The server is still working on an earlier attempt with this key; its result arrives with the same key later. */
export function isOperationInProgress(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 409 && error.error?.code === 'idempotency_in_progress';
}
