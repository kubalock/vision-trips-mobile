export const tripStages = [
  'quote',
  'quote_expired',
  'closed',
  'cancelled',
  'confirmed',
  'countdown',
  'prep',
  'departure',
  'travelling',
  'returning',
  'home',
  'past',
] as const;

export type TripStage = (typeof tripStages)[number];
export type AccessScope = 'primary_customer' | 'fellow_traveller';
export type FreshnessStatus = 'fresh' | 'stale' | 'offline';

export interface ThemeTokens {
  key: string;
  primaryColor: string;
  secondaryColor: string;
  displayFont: string;
  bodyFont: string;
  overlay: 'deep' | 'soft' | 'warm' | 'cool' | 'dusk';
  radius: 'crisp' | 'soft' | 'round';
  motif: string;
  spacingScale: number;
}

export interface TripSummary {
  reference: string;
  name: string;
  departureDate: string | null;
  returnDate: string | null;
  heroImageUrl: string | null;
}

export interface TripCapabilities {
  acceptQuotation: boolean;
  makePayment: boolean;
  shareWithTraveller: boolean;
  sendMessage: boolean;
}

export interface TripSnapshot {
  schemaVersion: 1;
  tripId: string;
  version: string;
  serverTime: string;
  stage: TripStage;
  accessScope: AccessScope;
  freshness: {
    status: FreshnessStatus;
    sourceUpdatedAt: string;
    nextRefreshAfter: string | null;
  };
  brand: {
    name: string;
    logoUrl: string | null;
    theme: ThemeTokens;
  };
  summary: TripSummary;
  travellers: TravellerSummary[];
  itinerary: ItineraryItem[];
  payments?: PaymentSummary;
  documents: TripDocument[];
  capabilities: TripCapabilities;
}

export type ItineraryKind = 'flight' | 'stay' | 'cruise' | 'transfer' | 'carhire' | 'parking' | 'train' | 'attraction' | 'misc';

export interface TravellerSummary {
  name: string;
  firstName: string;
  isLead: boolean;
  assistance: string[];
  meals: string[];
}

export interface ItineraryItem {
  id: string;
  kind: ItineraryKind;
  typeLabel: string;
  title: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  from: string | null;
  to: string | null;
  carrier: string | null;
  flightNumber: string | null;
  reference: string | null;
  address: string | null;
  notes: string | null;
  supplier: ItinerarySupplier | null;
  images: ItineraryImage[];
  rooms: RoomDetail[];
  cabins: CabinDetail[];
  passengers: PassengerAllocation[];
  cruisePorts: CruisePort[];
  emergencyContact: EmergencyContact | null;
  details: ItineraryDetail[];
}

export interface ItinerarySupplier {
  name: string;
  logoUrl: string | null;
  termsUrl: string | null;
}

export interface ItineraryImage {
  url: string;
  alt: string;
}

export interface RoomDetail {
  type: string;
  board: string | null;
  view: string | null;
  requests: string | null;
}

export interface CabinDetail {
  name: string;
  grade: string | null;
  number: string | null;
  deck: string | null;
  side: string | null;
  position: string | null;
  bed: string | null;
  dining: string | null;
}

export interface PassengerAllocation {
  name: string;
  bookingReference: string | null;
  travelClass: string | null;
  seat: string | null;
  cabinBaggage: string | null;
  checkedBaggage: string | null;
  extras: string | null;
  meal: string | null;
  assistance: string | null;
}

export interface CruisePort {
  day: string;
  port: string;
  arrivalTime: string | null;
  departureTime: string | null;
  description: string | null;
}

export interface EmergencyContact {
  name: string;
  phone: string;
}

export interface ItineraryDetail {
  label: string;
  value: string;
}

export interface PaymentItem {
  id: string;
  label: string;
  amount: number;
  currency: string;
  status: 'outstanding' | 'paid' | 'overdue' | 'local' | 'refund';
  dueDate: string | null;
  completedDate: string | null;
  canPay: boolean;
}

export interface PaymentSummary {
  currency: string;
  total: number;
  paid: number;
  balance: number;
  items: PaymentItem[];
}

export interface TripDocument {
  id: string;
  title: string;
  description: string;
  kind: 'confirmation' | 'invoice' | 'receipt' | 'supplier';
  url: string | null;
  offlineAvailable: boolean;
}

export interface LinkExchangeRequest {
  linkOrCode: string;
}

export interface LinkExchangeChallenge {
  exchangeId: string;
  brandName: string;
  tripHint: string;
  methods: Array<'postcode' | 'surname' | 'surname_dob' | 'otp'>;
  expiresAt: string;
}

export interface AuthorizedLinkExchange {
  status: 'authorized';
  exchangeId: string;
  expiresAt: string;
  snapshot: TripSnapshot;
  session: MobileSession;
}

export interface VerificationRequiredLinkExchange {
  status: 'verification_required';
  challenge: LinkExchangeChallenge;
}

export type LinkExchangeResponse = AuthorizedLinkExchange | VerificationRequiredLinkExchange;

export interface MobileSession {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

export interface RefreshSessionRequest {
  refreshToken: string;
}

export interface KnowledgeVerificationRequest {
  postcode: string;
}
