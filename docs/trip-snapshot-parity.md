# TripSnapshot parity with the PHP plugin

This matrix compares the standalone API snapshot with the customer-facing PHP domain model. “Excluded” means intentionally not sent to a device.

| Area | Snapshot coverage | Classification |
| --- | --- | --- |
| Trip identity, stage, dates, duration and theme | Customer-facing essentials | Implemented |
| Trip classification | Holiday types, traveller type, sector, countries, group/gift flags | Implemented in schema v3 |
| Brand | Identity, styling, contact and emergency details | Implemented |
| Brand editorial/legal | Slogan, about, hours, address, social/review/privacy links | Implemented in schema v3 |
| Travellers | Names, lead, meals and assistance | Implemented |
| Traveller readiness | Nationality, passport expiry and insurance for primary-customer access | Implemented in schema v3 |
| Customer contact/marketing | Address, marketing preferences and VIP status | Excluded: unnecessary personal data |
| Itinerary core | All element kinds, route, dates, supplier-safe details, images and documents | Implemented |
| Itinerary operations | Codes, next-day arrival, package, terms, ticket/confirmation readiness | Implemented in schema v3 |
| Rooms, cabins and passenger allocations | Customer-visible details | Implemented |
| Cruise ports and destinations | Airtable-backed content | Implemented |
| Widgety, Google Places, AI, live flights and weather | Availability state only | Provider-derived; adapters/credentials required |
| Payments and milestones | Totals, schedule, actions, resort total, due dates and alternative currency | Implemented in schema v3 |
| Supplier/internal finances | Net, commission, margin and supplier balances | Excluded: agent-only data |
| Protection | Licensing, contract type, member proposition, T-ATOL/global/ITE holder and organiser rules | Implemented in schema v3 |
| Documents | Supplier files, generated confirmation/quotation and invoice | Implemented |
| Agent-only documents | Letters, front file and net-cost reports | Excluded from customer snapshot |
| Communications and upsells | Sent customer messages and customer-safe extras | Implemented |
| Quote acceptance write-back | Five-section forced review, explicit evidence, receipt, notifications and deposit handoff | Implemented |
| Analytics, audit logs and raw Airtable data | None | Excluded |

The snapshot is an allowlisted mobile contract, not a serialization of PHP `$raw` arrays.
