/** Every stage a trip can be in, in lifecycle order. */
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
