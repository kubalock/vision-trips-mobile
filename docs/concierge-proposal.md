# Trip concierge for the mobile app — architecture and safety proposal

Status: **proposal only, not implemented.** Direct messaging to the agent (`POST /trips/current/messages`, callback requests) stays the reliable path whatever is decided here. Nothing below should be built until it is explicitly approved.

The PHP plugin (1.9–1.10) has a concierge. Its rules are a useful reference, but its design depends on WordPress (page-rendered context, options-table caps, site-wide transients). This proposal keeps the Nest API as the trust boundary.

## 1. Scope and context

- **One trip only.** The context is built server-side from the snapshot the session may already see (`TripsService.snapshot` with the session's `accessScope`). A fellow traveller's concierge sees the fellow-traveller snapshot: no prices, payments or supplier references.
- **Never in the context:** Airtable base, record or collaborator IDs, emails other than the agent's published one, passport numbers (not even masked), payment links, other bookings or quotations, Members/financial fields.
- Context sources: itinerary, travellers' names (not documents), documents list, service steps, the brand's templates and terms, inclusions/exclusions, cached destination and hotel copy, live flight status already fetched. Roughly 10–15k tokens, rebuilt from the cached snapshot rather than a fresh Airtable fan-out.

## 2. Research and sources

- Optional web research limited to an allow-list of official domains (gov.uk/FCDO, TravelHealthPro, the airline, airport, cruise line, hotel and tourist-board sites).
- Every researched statement carries its source link, shown as a chip under the answer. Answers about entry rules **without** an official source are rejected by validation (section 4).

## 3. Hand-off rules (always to the agent)

Hand off, do not answer, when the question involves: changes or new bookings; confirming anything; prices or quotes for extras; refunds, cancellations and complaints; room, seat or assistance requests; medical advice; visa or entry decisions for a specific person; safety decisions. The customer is told what can safely be said and that the agent has the question.

## 4. Response validation (server-side, before anything is shown)

Reject and hand off when an answer:
- promises or confirms anything ("I've booked", "guaranteed", "confirmed");
- contains an amount that is not already in the customer's snapshot (compare as numbers, so £1,500 = £1,500.00);
- states a visa/entry/health rule without an allow-listed source;
- names a competitor or internal finance (commission, net, margin);
- contains anything that looks like an ID, email or link outside the allow-list.

Model output is parsed from a tagged block only; anything outside it is discarded.

## 5. Records and notifications

- Each exchange is written as a comment on the Booking (as messages are today): question, answer or hand-off reason, sources, and whether it was a fellow traveller.
- Hand-offs notify the agent by the existing acceptance-notification email path, with a link to the booking — never the customer's full chat.

## 6. Abuse, rate and cost limits

- Per session: e.g. 10 questions/hour; per booking: 30/day; per base: a daily cap; global kill switch (`CONCIERGE_ENABLED=false`).
- Separate rate-limit bucket from messages, acceptance and profile updates (`DurableAuthStore.consumeRateLimit`).
- Input length cap (e.g. 500 characters); one research call per question at most.
- Cost: answers cached 24 h per (booking content version, normalised question); daily token budget per base with graceful fallback to "Message your agent".

## 7. Retention and deletion

- The device keeps the visible conversation per trip, namespaced by trip and identity like other cached data, and clears it on sign-out, trip removal and branch switch.
- The server stores no chat transcript beyond the Booking comments; model-provider requests are sent without customer names or emails and with data-retention disabled where the provider allows.
- Customer deletion requests are handled by deleting the Booking comments through the agent's normal process.

## 8. Rollout

1. Off by default per member (Members field or environment allow-list).
2. Shadow mode: answers generated and validated but only logged, for agents to review.
3. Limited pilot with one member, then wider.

## Open decisions for product

- Which members pilot it, and whether fellow travellers get it at all.
- Daily budget per member, and who pays.
- Whether research is on by default.
