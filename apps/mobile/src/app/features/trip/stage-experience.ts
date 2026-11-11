import type { ItineraryItem, TripSnapshot } from '@vision-trips/contracts';
import { formatEuropeanDate } from '../../shared/european-date.pipe';

export interface ChecklistItem { id: string; title: string; text: string; level: 'done' | 'todo' | 'alert'; locked: boolean }

export function todayAndUpcoming(itinerary: ItineraryItem[], now = new Date()): { today: ItineraryItem[]; upcoming: ItineraryItem[] } {
  const date = localDate(now);
  const sorted = [...itinerary].filter((item) => item.startDate).sort((left, right) => `${left.startDate}${left.startTime || ''}`.localeCompare(`${right.startDate}${right.startTime || ''}`));
  return { today: sorted.filter((item) => item.startDate === date), upcoming: sorted.filter((item) => item.startDate! > date).slice(0, 2) };
}

export function buildChecklist(trip: TripSnapshot, now = new Date()): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const payments = trip.payments;
  if (payments && payments.balance !== null && payments.balance > 0.009) items.push({ id: 'balance', title: 'Pay your balance', text: `${money(payments.balance, payments.currency)} outstanding${payments.balanceDueDate ? `, due ${formatEuropeanDate(payments.balanceDueDate)}` : ''}.`, level: payments.items.some((item) => item.status === 'overdue') ? 'alert' : 'todo', locked: true });
  else if (payments) items.push({ id: 'balance', title: 'Paid in full', text: 'Nothing left to pay to us.', level: 'done', locked: true });
  if (trip.protection.hasFlight) {
    const short = trip.travellers.filter((traveller) => passportNeedsAttention(traveller.passportExpiry, trip.summary.returnDate, now)).map((traveller) => traveller.firstName || traveller.name);
    items.push({ id: 'passports', title: short.length ? 'Check passport validity' : 'Passports', text: short.length ? `${short.join(', ')}: the passport on file expires within six months of your return.` : 'Check every passport is valid for the destination and your return date.', level: short.length ? 'alert' : 'todo', locked: short.length > 0 });
    items.push({ id: 'api', title: 'Advance passenger information', text: 'Most airlines require passport details before travel. Complete this in the airline app once tickets are issued.', level: 'todo', locked: false });
  }
  const entry = entryRequirementHint(trip.summary.countries);
  if (entry) items.push({ id: 'entry', title: 'Entry requirements', text: entry, level: 'todo', locked: false });
  const uninsured = trip.travellers.filter((traveller) => !traveller.insuranceStatus || /no|none|not/i.test(traveller.insuranceStatus));
  items.push({ id: 'insurance', title: 'Travel insurance', text: uninsured.length ? `${uninsured.map((traveller) => traveller.firstName || traveller.name).join(', ')} may not have insurance recorded. Confirm suitable cover is in place.` : 'Make sure your policy covers every traveller, planned activities and medical conditions.', level: uninsured.length ? 'alert' : 'todo', locked: uninsured.length > 0 });
  items.push({ id: 'advice', title: 'Official travel advice', text: `Read current FCDO advice for ${trip.summary.countries[0] || 'your destination'} before departure.`, level: 'todo', locked: false });
  return items;
}

export function countdownTo(trip: TripSnapshot, now = new Date()): { days: number; hours: number; minutes: number } | null {
  if (!trip.summary.departureDate) return null;
  const first = trip.itinerary.filter((item) => item.kind === 'flight' && item.startDate === trip.summary.departureDate).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))[0];
  const target = Date.parse(`${trip.summary.departureDate}T${first?.startTime || '00:00'}:00`); if (!Number.isFinite(target)) return null;
  const seconds = Math.max(0, Math.floor((target - now.getTime()) / 1000));
  return { days: Math.floor(seconds / 86_400), hours: Math.floor((seconds % 86_400) / 3_600), minutes: Math.floor((seconds % 3_600) / 60) };
}

export function passportNeedsAttention(expiry: string | null, returnDate: string | null, now = new Date()): boolean {
  if (!expiry) return false; const baseline = returnDate ? Date.parse(`${returnDate}T12:00:00`) : now.getTime(); const sixMonths = new Date(baseline); sixMonths.setMonth(sixMonths.getMonth() + 6); return Date.parse(`${expiry}T12:00:00`) < sixMonths.getTime();
}

function entryRequirementHint(countries: string[]): string {
  const value = countries.join(' ').toLowerCase();
  if (value.includes('united states')) return 'Apply for an ESTA at least 72 hours before travel and check current US entry rules.';
  if (value.includes('canada')) return 'Most UK passport holders need an eTA before flying to Canada.';
  if (value.includes('australia')) return 'Arrange the appropriate Australian visitor permission before travel.';
  if (value.includes('new zealand')) return 'An NZeTA is normally required before travel.';
  if (value.includes('india')) return 'An approved visa is required before travel.';
  if (value.includes('egypt')) return 'Check and arrange the correct Egyptian visa before travel.';
  return countries.length ? 'Passport, visa, health and entry rules can change. Check the official advice for every traveller.' : '';
}
function money(amount: number, currency: string): string { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount); }
function localDate(value: Date): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
