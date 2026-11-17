import { tripStages } from './stages.js';

export { tripStages } from './stages.js';
export type TripStage = (typeof tripStages)[number];
export type AccessScope = 'primary_customer' | 'fellow_traveller';
/** `partial`: the trip itself refreshed, but some optional details couldn't be (see `incompleteSections`). */
export type FreshnessStatus = 'fresh' | 'stale' | 'offline' | 'partial';
/** Parts of a snapshot that can be left out when Airtable can't return them; everything else is required. */
/**
 * `brand`: the travel company's Brand record couldn't be read, so its name, theme, contacts, links, gallery and
 * payment settings in this snapshot are defaults (the app keeps its earlier copy of them).
 */
export type TripSection = 'itinerary_details' | 'destinations' | 'extras' | 'messages' | 'agent' | 'letters' | 'brand' | 'loyalty';

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
  /** Display typography, as on the website (PHP plugin Theme.php). All optional for older snapshots. */
  displayWeight?: number;
  /** Width axis in percent (Bricolage Grotesque, Fredoka). */
  displayStretch?: number;
  /** Fraunces SOFT (0–100) and WONK (0/1) axes. */
  displaySoft?: number;
  displayWonk?: number;
  /** Letter spacing in em. */
  tracking?: number;
  /** The theme's surface colour, used for the hero gradient. */
  wash?: string;
  buttonRadius?: string;
  /** Upper-case small kickers. */
  capsKickers?: boolean;
}

export interface TripSummary {
  reference: string;
  name: string;
  departureDate: string | null;
  returnDate: string | null;
  heroImageUrl: string | null;
  /** The hero image with its sizes and smaller copies; `heroImageUrl` stays for older clients. */
  heroImage?: ItineraryImage | null;
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

/**
 * Version 4 adds optional loyalty, traveller, agent, quotation-content and terminal fields and `quotation.accepted`.
 * Every addition is optional, so a v3 snapshot is a valid v4 one; clients that don't send
 * `X-Vision-Snapshot-Version: 4` are still told 3 (see the API's snapshot-version interceptor).
 */
export const TRIP_SNAPSHOT_SCHEMA_VERSION = 4;
export const SNAPSHOT_VERSION_HEADER = 'x-vision-snapshot-version';

export interface TripSnapshot {
  schemaVersion: 3 | 4;
  tripId: string;
  version: string;
  serverTime: string;
  stage: TripStage;
  accessScope: AccessScope;
  freshness: {
    status: FreshnessStatus;
    sourceUpdatedAt: string;
    nextRefreshAfter: string | null;
    /** Present when `status` is `partial`: what could not be refreshed this time. */
    incompleteSections?: TripSection[];
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
  /** The booking's agent and branch, when known. Never carries collaborator or record IDs. */
  agent?: TripAgent | null;
  /** Present only when the member's loyalty scheme is enabled and the booking takes part. */
  loyalty?: TripLoyalty | null;
  /** Structured quotation/booking content: inclusions, exclusions and the agent's videos. */
  content?: TripContent;
}

export interface TripAgent {
  name: string | null;
  /** Validated address; null when the collaborator has none or it isn't a valid email. */
  email: string | null;
  branchName: string | null;
  /** `tel:` link (digits and + only). */
  branchPhone: string | null;
}

export type LoyaltyTripState = 'quote' | 'pending' | 'post_return' | 'awarded';

/**
 * Booking-level loyalty only. The snapshot is cached per booking and shared by every customer linked to it, so a
 * customer's balance, its value and VIP status are never in it: they come from the verified account endpoint.
 */
export interface TripLoyalty {
  /** Points this trip earns; null when the booking has no figure (never shown as 0). */
  pointsEarned: number | null;
  state: LoyaltyTripState;
  /** The date the points become eligible (normally the return date). */
  eligibleFrom: string | null;
}

export interface TripContent {
  included: ContentListItem[];
  notIncluded: ContentListItem[];
  /** `booking` when the agent wrote the lists; `itinerary` when derived conservatively from the booked items. */
  includedSource: 'booking' | 'itinerary' | 'none';
  videoMessage: TripVideo | null;
  walkthrough: TripVideo | null;
}

export interface ContentListItem { text: string }

/**
 * GET /trips/current/walkthrough: the walkthrough with a freshly read attachment URL, fetched just before playback
 * (Airtable attachment URLs expire, so the copy in a saved snapshot may no longer play).
 */
export interface WalkthroughResponse { video: TripVideo | null }

export interface TripVideo {
  kind: 'file' | 'youtube' | 'vimeo';
  /** Direct https file URL, or a privacy-friendly https embed URL. Never autoplays. */
  url: string;
  mimeType: string | null;
  /** Airtable's own video thumbnail when there is one; never the trip hero. */
  posterUrl: string | null;
  title: string;
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
  whyBook: Array<{ title: string; text: string | null }>;
  teamPhotoUrl: string | null;
  gallery: ItineraryImage[];
  mapUrl: string | null;
  reassurance: Array<{ title: string; text: string }>;
  footerImages: string[];
  footerText: string | null;
  letterTemplates: Array<{ id: string; name: string; subject: string | null; body: string }>;
  /** "Why choose…" heading set on the brand; the app falls back to About & Bio when absent. */
  whyChooseHeader?: string | null;
  whyChooseSubheader?: string | null;
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
export interface ExternalImage { url: string; attribution: string | null; official: boolean; variants?: ImageVariant[] }
export interface PlaceProfile {
  itineraryItemId: string; placeId: string; name: string; address: string | null; rating: number | null; ratingCount: number;
  websiteUrl: string | null; phone: string | null; summary: string | null; mapsUrl: string | null; directionsUrl: string;
  coordinates: { latitude: number; longitude: number }; images: ExternalImage[]; aiDescription: string | null; aiPending: boolean;
  /** Up to eight short facility labels from the brochure writer (plain text, 40 characters max). Indicative only. */
  facilities?: string[];
  /** Straight-line distance from the airport of the flight that lands before this stay; always approximate. */
  airportDistance?: { airport: string; km: number } | null;
}
export interface CruiseSection { title: string; items: Array<{ name: string; text: string | null; images: string[]; videoUrl: string | null; /** `videoUrl` as a playable, privacy-friendly video, or null. */ video?: TripVideo | null }> }
export interface CruiseProfile {
  itineraryItemId: string; name: string; operator: string | null; introduction: string | null; coverImageUrl: string | null;
  profileImageUrl: string | null; facts: Array<{ label: string; value: string }>; sections: CruiseSection[];
  /** The ship's film (Widgety `video_url`), click-to-play; nothing loads until the customer taps it. */
  video?: TripVideo | null;
  voyage: { reference: string; name: string | null; description: string | null; highlights: string | null; included: string | null; images: string[]; days: CruisePort[] } | null;
}
export interface EnrichedDestinationGuide extends DestinationGuide {
  images: ExternalImage[]; mapUrl: string | null; aiPending: boolean;
  /** Generated, approximate travel facts; never visa, health or safety advice. */
  facts?: DestinationFacts | null;
  /** Typical weather in the month of travel, averaged over recent years (Open-Meteo archive). */
  climate?: DestinationClimate | null;
}
export interface DestinationFacts {
  currency: string | null; language: string | null; timeDifference: string | null;
  /** Approximate flight time from London. */
  flightTimeFromLondon: string | null; plugs: string | null; bestTime: string | null;
}
export interface DestinationClimate {
  /** "March". */
  month: string;
  highC: number; lowC: number;
  sunshineHours: number | null;
  rainyDays: number | null;
  /** How many past years the averages come from. */
  years: number;
}
export interface AgencyRating { rating: number; count: number; url: string | null }
export interface PracticalGuide { id: string; kind: 'airline' | 'airport'; name: string; logoUrl: string | null; sections: Array<{ title: string; text: string }>; pending: boolean }
export interface ExternalTripContent {
  generatedAt: string; refreshAfterSeconds: number;
  providers: { flights: ExternalProviderStatus; weather: ExternalProviderStatus; places: ExternalProviderStatus; widgety: ExternalProviderStatus; ai: ExternalProviderStatus };
  diagnostics: { cache: { entries: number; hits: number; misses: number; writes: number }; sources: Array<{ provider: string; configured: boolean; source: string }> };
  flights: LiveFlightStatus[]; weather: WeatherForecast[]; stays: PlaceProfile[]; cruises: CruiseProfile[]; destinations: EnrichedDestinationGuide[]; guides: PracticalGuide[];
  /** Every stay and port on one map (Maps Embed); null without an embed key or with fewer than two places. */
  routeMapUrl?: string | null;
  /** The agency's own Google rating, only when 4.3 or better from ten or more reviews. */
  agencyRating?: AgencyRating | null;
}

export type CustomerEngagementEvent = 'section_opened' | 'action_clicked';
export interface CustomerEngagementRequest { event: CustomerEngagementEvent; detail: string; stage?: string; occurredAt?: string; device?: string }
export interface CustomerEngagementResponse { accepted: true }

export interface TripExtra {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  supplierName: string | null;
  /** Allow-listed https affiliate link chosen by the member; null keeps the "ask your agent" action. */
  affiliateUrl?: string | null;
}

export interface QuotationState {
  status: 'available' | 'expired' | 'not_applicable';
  expiresAt: string | null;
  canAccept: boolean;
  /** @deprecated Always empty since v4: sections are offered for review, not individually confirmed. */
  requiredConfirmations: string[];
  reviewSections: QuotationReviewSection[];
  /** True once the quotation has been accepted online (the booking status may still read Quotation). */
  accepted?: boolean;
}

/** GET /trips/current/quotation-acceptance: what the acceptance form shows about the signed-in customer. */
export interface QuotationAcceptanceContext {
  /** The verified customer's email, masked (d•••a@example.com); null when it couldn't be read. */
  emailHint: string | null;
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
  /** The signer's full name. */
  name: string;
  /** The single explicit "I confirm…" agreement. */
  agreed: boolean;
  /** Review sections the customer opened: recorded for audit, never required. */
  openedSections?: QuotationReviewSectionId[];
  /**
   * Optional declared signer/receipt address ("use a different email"). It is recorded as given and receives the
   * receipt; it never changes the customer identity, selects Customer records or widens account access.
   */
  signerEmail?: string;
  /** @deprecated v3 clients: treated exactly like `signerEmail`. */
  email?: string;
  /** @deprecated v3 clients: treated exactly like `openedSections`. */
  confirmations?: string[];
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
  /** Nights (duration in days minus one is not assumed: departure to return). */
  nights?: number | null;
  /** Null when the quotation has no readable total (shown as "Price to be confirmed", never £0). */
  total: number | null;
  /** Per person: the booking's own figure, otherwise the total shared across travellers (when more than one). */
  perPerson?: number | null;
  currency: string;
  heroImageUrl: string | null;
  status: 'available' | 'expired';
  current: boolean;
}

export interface RelatedQuotationsResponse { quotations: RelatedQuotationSummary[] }
export interface OpenRelatedQuotationResponse { snapshot: TripSnapshot; session: MobileSession }

export interface CustomerPreferences {
  emailMarketing: boolean;
  smsMarketing: boolean;
  postalMarketing: boolean;
  preferredAirports: string[];
  preferredMonths: string[];
}

export interface CustomerAccountTrip {
  accountTripId: string;
  /** The public trip ID the trip would have once opened, so the app can say whether it is already saved on this device. */
  tripId: string;
  reference: string;
  name: string;
  departureDate: string | null;
  returnDate: string | null;
  status: TripStage;
  heroImageUrl: string | null;
  current: boolean;
}

export interface CustomerAccount {
  emailHint: string;
  /** Present only when the member's loyalty scheme is enabled. */
  loyalty?: CustomerLoyalty | null;
  vip?: boolean;
  preferences: CustomerPreferences;
  airportOptions: string[];
  monthOptions: string[];
  trips: CustomerAccountTrip[];
}

export type LoyaltyTransactionType = 'earn' | 'redeem' | 'adjustment' | 'expiry';
export interface LoyaltyTransaction {
  id: string;
  type: LoyaltyTransactionType;
  points: number;
  date: string | null;
  /** The trip's name, when the transaction is linked to one of this customer's bookings. */
  tripName: string | null;
  description: string | null;
}
export interface CustomerLoyalty {
  available: number | null;
  availableValue: number | null;
  currency: string;
  lifetime: number | null;
  expiresAt: string | null;
  transactions: LoyaltyTransaction[];
}

/** One traveller on the verified customer's record (Account → Traveller details). Sensitive values are masked. */
export interface TravellerProfile {
  /** Opaque, session-scoped ID (never an Airtable record ID). */
  travellerId: string;
  name: string;
  dateOfBirth: string | null;
  passport: { numberHint: string | null; nationality: string | null; issuingCountry: string | null; issueDate: string | null; expiryDate: string | null };
  drivingLicence: { numberHint: string | null; expiryDate: string | null };
  nextOfKin: { name: string | null; phone: string | null };
  airlineLoyalty: string | null;
  cruiseLoyalty: string | null;
}
export interface TravellerProfilesResponse { travellers: TravellerProfile[] }
/** The only fields a customer may change; names, dates of birth and contact details go through the agent. */
export interface TravellerProfileUpdate {
  passportNumber?: string;
  nationality?: string;
  passportIssuingCountry?: string;
  passportIssueDate?: string;
  passportExpiryDate?: string;
  drivingLicenceNumber?: string;
  drivingLicenceExpiryDate?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  airlineLoyalty?: string;
  cruiseLoyalty?: string;
}
export interface TravellerProfileUpdateResponse { saved: true; traveller: TravellerProfile }

export interface CallbackRequest { preferredTime: 'morning' | 'afternoon' | 'evening' | 'anytime'; phone?: string; note?: string }
export interface CallbackResponse { sent: true; sentAt: string }

export interface UpdateCustomerPreferencesResponse { saved: true; updatedRecords: number; preferences: CustomerPreferences }
/** Body of DELETE /v1/link-exchanges/device-trust: omit `identityKey` to forget every trusted identity in this browser. */
export interface ForgetDeviceTrustRequest { identityKey?: string }
export interface OpenCustomerAccountTripResponse { snapshot: TripSnapshot; session: MobileSession }

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
  directionsUrl?: string;
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
  whatsappUrl?: string | null;
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
  guaranteeAvailable: boolean;
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
  /** Age on the departure date (or today when unknown); primary customer only. */
  age?: number | null;
  /** Last three characters only (···876); primary customer only. */
  passportEnding?: string | null;
  /** True when the passport expires within six months after the return date (or is already expired). */
  passportWarning?: boolean;
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
  /** Normalised terminal ("T5", "2A"); explicit Airtable fields win over text parsed from notes. */
  departureTerminal?: string | null;
  arrivalTerminal?: string | null;
  /** Where the terminal came from, so live data can supplement but never silently overwrite it. */
  terminalSource?: 'booking' | 'notes' | null;
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

/** A smaller copy of an image (for `srcset`). */
export interface ImageVariant {
  url: string;
  width: number;
}

export interface ItineraryImage {
  /** The original image (used for full-screen viewing and as the fallback source). */
  url: string;
  alt: string;
  /** Intrinsic size when known, so the app can reserve space before the image loads. */
  width?: number | null;
  height?: number | null;
  /** Smaller copies, smallest first; the app picks one for the space it shows the image in. */
  variants?: ImageVariant[];
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
  /** `points`: a customer payment made with loyalty points, shown as points, never as money. */
  kind?: 'money' | 'points';
  points?: number | null;
  /** Null when Airtable has no readable amount for this payment; never shown as 0. */
  amount: number | null;
  currency: string;
  status: 'outstanding' | 'paid' | 'overdue' | 'local' | 'refund';
  dueDate: string | null;
  completedDate: string | null;
  canPay: boolean;
  actionUrl: string | null;
}

/** Lightweight payment check used while waiting for a payment to be confirmed (no full trip reload). */
export interface PaymentStatusResponse {
  tripId: string;
  checkedAt: string;
  currency: string;
  total: number | null;
  paid: number | null;
  balance: number | null;
  items: Array<Pick<PaymentItem, 'id' | 'status' | 'completedDate'>>;
}

export interface PaymentSummary {
  currency: string;
  /** Null when the booking's figure is missing or unreadable (shown as unavailable, never as 0). */
  total: number | null;
  paid: number | null;
  balance: number | null;
  items: PaymentItem[];
  totalIncludingResort: number | null;
  nextDueAmount: number | null;
  nextDueDate: string | null;
  balanceDueDate: string | null;
  alternativeCurrency: { currency: string; amount: number } | null;
  customPayments: { enabled: boolean; minimum: number; maximum: number };
  /** Per person, shown when more than one traveller: the booking's own figure or the total shared out. */
  perPerson?: number | null;
}

export interface CustomPaymentLinkRequest { amount: number }

export interface TripDocument {
  id: string;
  title: string;
  description: string;
  kind: 'confirmation' | 'invoice' | 'receipt' | 'atol' | 'front_file' | 'guarantee' | 'letter' | 'supplier';
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
  deviceTrustTokens?: string[];
}

export interface AuthorizedLinkExchange {
  status: 'authorized';
  exchangeId: string;
  expiresAt: string;
  snapshot: TripSnapshot;
  session: MobileSession;
  trustedDeviceToken?: string;
}

/** A legacy signed customer link only locates the booking; the customer continues with email verification. */
export interface InvitationRequiredLinkExchange {
  status: 'invitation_required';
  invitationToken: string;
}

export type LinkExchangeResponse = AuthorizedLinkExchange | InvitationRequiredLinkExchange;

/** Result of verifying an invitation (email code, trusted device or share link). */
export interface InvitationAuthorized {
  status: 'authorized';
  snapshot: TripSnapshot;
  session: MobileSession;
  trustedDeviceToken?: string;
}

export interface MobileSession {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  /**
   * Opaque, base-scoped label for the verified identity (Base + Customer, or Base + Booking for share links). Equal
   * keys mean the same Customer in the same base; it reveals no Airtable IDs or email. Absent on sessions saved by
   * older versions.
   */
  identityKey?: string;
}

export interface RefreshSessionRequest {
  refreshToken: string;
}


export * from './invitations.js';
export * from './responses.js';
export * from './format.js';
