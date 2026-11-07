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
  gallery: ItineraryImage[];
  durationDays: number | null;
  countries: string[];
  holidayTypes: string[];
  travellerType: string | null;
  sector: string | null;
  totalTravellers: number;
  groupBooking: boolean;
  giftVoucher: boolean;
}

export interface TripCapabilities {
  acceptQuotation: boolean;
  makePayment: boolean;
  shareWithTraveller: boolean;
  sendMessage: boolean;
}

export interface TripSnapshot {
  schemaVersion: 3;
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
    profile: BrandProfile;
  };
  summary: TripSummary;
  experience: TripExperience;
  support: TripSupport;
  protection: TripProtection;
  bookingStatus: BookingStatus;
  quotation: QuotationState;
  timeline: TripTimeline;
  bookingJourney: BookingJourney;
  destinations: DestinationGuide[];
  extras: TripExtra[];
  communications: TripCommunication[];
  integrations: TripIntegrations;
  travellers: TravellerSummary[];
  itinerary: ItineraryItem[];
  payments?: PaymentSummary;
  documents: TripDocument[];
  capabilities: TripCapabilities;
}

export interface BrandProfile {
  slogan: string | null;
  about: string | null;
  address: string | null;
  openingHours: string | null;
  socialLinks: Array<{ network: 'instagram' | 'facebook' | 'linkedin' | 'x'; url: string }>;
  reviewLinks: Array<{ provider: 'trustpilot' | 'google'; url: string }>;
  privacyUrl: string | null;
  complaintsUrl: string | null;
}

export interface TripCommunication {
  id: string;
  type: string;
  subject: string;
  content: string | null;
  sentAt: string | null;
}

export interface TripIntegrations {
  liveFlightStatus: 'available' | 'not_configured' | 'not_applicable';
  weather: 'available' | 'not_configured' | 'not_applicable';
  destinationGuides: 'available' | 'not_available';
}

export type ExternalProviderState = 'ready' | 'pending' | 'not_configured' | 'not_applicable' | 'unavailable';
export interface ExternalProviderStatus { state: ExternalProviderState; source: string; message: string | null }
export interface LiveFlightStatus {
  itineraryItemId: string; flightNumber: string; route: string; carrier: string | null; airlineLogoUrl: string | null;
  status: 'unknown' | 'on_time' | 'delayed' | 'checkin' | 'go_to_gate' | 'boarding' | 'gate_closed' | 'departed' | 'en_route' | 'approaching' | 'arrived' | 'cancelled' | 'diverted';
  statusLabel: string; departure: { scheduled: string | null; actual: string | null; terminal: string | null; gate: string | null };
  arrival: { scheduled: string | null; actual: string | null; terminal: string | null; gate: string | null; baggageBelt: string | null };
  aircraft: string | null; delayMinutes: number; updatedAt: string;
}
export interface WeatherForecast {
  destinationId: string; place: string; temperature: number; label: string; icon: string; high: number; low: number;
  days: Array<{ date: string; high: number; low: number; label: string; icon: string }>;
}
export interface ExternalImage { url: string; attribution: string | null; official: boolean }
export interface PlaceProfile {
  itineraryItemId: string; placeId: string; name: string; address: string | null; rating: number | null; ratingCount: number;
  websiteUrl: string | null; phone: string | null; summary: string | null; mapsUrl: string | null; directionsUrl: string;
  coordinates: { latitude: number; longitude: number }; images: ExternalImage[]; aiDescription: string | null; aiPending: boolean;
}
export interface CruiseSection { title: string; items: Array<{ name: string; text: string | null; images: string[]; videoUrl: string | null }> }
export interface CruiseProfile {
  itineraryItemId: string; name: string; operator: string | null; introduction: string | null; coverImageUrl: string | null;
  profileImageUrl: string | null; facts: Array<{ label: string; value: string }>; sections: CruiseSection[];
  voyage: { reference: string; name: string | null; description: string | null; highlights: string | null; included: string | null; images: string[]; days: CruisePort[] } | null;
}
export interface EnrichedDestinationGuide extends DestinationGuide { images: ExternalImage[]; mapUrl: string | null; aiPending: boolean }
export interface PracticalGuide { id: string; kind: 'airline' | 'airport'; name: string; logoUrl: string | null; sections: Array<{ title: string; text: string }>; pending: boolean }
export interface ExternalTripContent {
  generatedAt: string; refreshAfterSeconds: number;
  providers: { flights: ExternalProviderStatus; weather: ExternalProviderStatus; places: ExternalProviderStatus; widgety: ExternalProviderStatus; ai: ExternalProviderStatus };
  flights: LiveFlightStatus[]; weather: WeatherForecast[]; stays: PlaceProfile[]; cruises: CruiseProfile[]; destinations: EnrichedDestinationGuide[]; guides: PracticalGuide[];
}

export interface TripExtra {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  supplierName: string | null;
}

export interface QuotationState {
  status: 'available' | 'expired' | 'not_applicable';
  expiresAt: string | null;
  canAccept: boolean;
  requiredConfirmations: string[];
  reviewSections: QuotationReviewSection[];
}

export type QuotationReviewSectionId = 'package' | 'names' | 'important' | 'protection' | 'terms';

export interface QuotationReviewSection {
  id: QuotationReviewSectionId;
  title: string;
  introduction: string;
  items: string[];
  links: Array<{ label: string; url: string }>;
}

export interface QuotationAcceptanceRequest {
  name: string;
  email: string;
  agreed: boolean;
  confirmations: string[];
}

export interface QuotationAcceptanceResponse {
  accepted: true;
  acceptedAt: string;
  receiptAvailable: true;
  paymentUrl: string | null;
  notifications: { customer: 'sent' | 'local_preview' | 'failed'; agent: 'sent' | 'local_preview' | 'failed' | 'not_configured' };
}

export type CustomerMessageTopic = 'itinerary' | 'payment' | 'documents' | 'accessibility' | 'other';

export interface CustomerMessageRequest {
  topic: CustomerMessageTopic;
  message: string;
}

export interface CustomerMessageResponse {
  sent: true;
  sentAt: string;
}

export interface PaymentLinkResponse {
  paymentId: string;
  url: string;
  amount: number;
  currency: string;
}

export interface FellowTravellerLinkResponse {
  url: string;
  expiresAt: string;
}

export interface TripTimeline {
  daysUntilDeparture: number | null;
  nextItemId: string | null;
  nextItemTitle: string | null;
  nextItemDate: string | null;
  nextItemTime: string | null;
}

export interface BookingJourney {
  steps: Array<{
    id: 'confirmation' | 'balance' | 'reconfirmation' | 'documents' | 'pre_departure_call' | 'post_trip_follow_up';
    title: string;
    description: string;
    date: string | null;
    status: 'complete' | 'current' | 'upcoming';
  }>;
  faqs: Array<{ id: string; question: string; answer: string }>;
  suggestedExtras: Array<{
    id: 'transfers' | 'airport' | 'flight_upgrade' | 'room_upgrade' | 'experiences' | 'cruise_packages' | 'instalments' | 'insurance' | 'extra_nights';
    title: string;
    description: string;
    enquiry: string;
  }>;
}

export interface RelatedQuotationSummary {
  comparisonId: string;
  reference: string;
  name: string;
  departureDate: string | null;
  returnDate: string | null;
  durationDays: number | null;
  total: number;
  currency: string;
  heroImageUrl: string | null;
  status: 'available' | 'expired';
  current: boolean;
}

export interface RelatedQuotationsResponse { quotations: RelatedQuotationSummary[] }
export interface OpenRelatedQuotationResponse { snapshot: TripSnapshot; session: MobileSession }

export interface DestinationGuide {
  id: string;
  name: string;
  country: string | null;
  overview: string | null;
  attractions: string[];
  practicalInformation: string | null;
  culturalInformation: string | null;
  travelAdviceUrl: string | null;
  imageUrl: string | null;
  coordinates: { latitude: number; longitude: number } | null;
}

export interface TripExperience {
  overview: string | null;
  personalisedMessage: string | null;
  agentName: string | null;
  surprise: { enabled: boolean; concealed: boolean; revealAt: string | null };
}

export interface TripSupport {
  companyName: string;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  emergencyPhone: string | null;
  outOfHoursUrl: string | null;
  outOfHoursEmail: string | null;
}

export interface TripProtection {
  scheme: 'atol' | 'non_air_package' | 'not_applicable' | 'unknown';
  atolNumber: string | null;
  licensing: string | null;
  summary: string;
  mode: string;
  contractType: 'package' | 'package_no_flight' | 'flight_only' | 'accommodation_only' | 'agent_services' | 'ticket_agent' | 'unknown';
  holderName: string | null;
  organiserName: string | null;
  hasFlight: boolean;
}

export interface BookingStatus {
  sourceStatus: string;
  cancellationDate: string | null;
  cancellationReason: string | null;
  supplierTicketsReceived: boolean;
  supplierConfirmationsReceived: boolean;
  tasks: {
    confirmation: boolean;
    reconfirmed: boolean;
    travelDocuments: boolean;
    preDepartureCall: boolean;
    followUp: boolean;
  };
}

export type ItineraryKind = 'flight' | 'stay' | 'cruise' | 'transfer' | 'carhire' | 'parking' | 'train' | 'attraction' | 'misc';

export interface TravellerSummary {
  name: string;
  firstName: string;
  isLead: boolean;
  assistance: string[];
  meals: string[];
  nationality: string | null;
  passportExpiry: string | null;
  insuranceStatus: string | null;
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
  fromCode: string | null;
  toCode: string | null;
  carrierCode: string | null;
  carrierLogoUrl: string | null;
  arrivesNextDay: boolean;
  packageIncluded: boolean;
  termsUrl: string | null;
  confirmationReceived: boolean;
  ticketsReceived: boolean;
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
  actionUrl: string | null;
}

export interface PaymentSummary {
  currency: string;
  total: number;
  paid: number;
  balance: number;
  items: PaymentItem[];
  totalIncludingResort: number | null;
  nextDueAmount: number | null;
  nextDueDate: string | null;
  balanceDueDate: string | null;
  alternativeCurrency: { currency: string; amount: number } | null;
  customPayments: { enabled: boolean; minimum: number; maximum: number };
}

export interface CustomPaymentLinkRequest { amount: number }

export interface TripDocument {
  id: string;
  title: string;
  description: string;
  kind: 'confirmation' | 'invoice' | 'receipt' | 'atol' | 'supplier';
  url: string | null;
  offlineAvailable: boolean;
  status: 'ready' | 'pending' | 'unavailable';
  downloadAction: string | null;
  version: string;
  updatedAt: string;
  mimeType: string;
}

export interface LinkExchangeRequest {
  linkOrCode: string;
  deviceTrustToken?: string;
}

export interface LocalTripExchangeRequest {
  baseId: string;
  recordId: string;
}

export interface LinkExchangeChallenge {
  exchangeId: string;
  brandName: string;
  tripHint: string;
  methods: Array<'postcode' | 'surname' | 'surname_dob' | 'otp'>;
  expiresAt: string;
  destinationHint: string | null;
  resendAvailableAt: string | null;
  remainingSends: number;
}

export interface AuthorizedLinkExchange {
  status: 'authorized';
  exchangeId: string;
  expiresAt: string;
  snapshot: TripSnapshot;
  session: MobileSession;
  trustedDeviceToken?: string;
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
