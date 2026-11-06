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
  capabilities: TripCapabilities;
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
}

export interface VerificationRequiredLinkExchange {
  status: 'verification_required';
  challenge: LinkExchangeChallenge;
}

export type LinkExchangeResponse = AuthorizedLinkExchange | VerificationRequiredLinkExchange;
