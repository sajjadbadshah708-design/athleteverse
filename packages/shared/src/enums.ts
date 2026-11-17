// Single source of truth for enumerated values used by the API, web and app (SRS Table 31).
// The Prisma enums in apps/api/prisma/schema.prisma must match these: apps/api/test/enums.test.ts enforces it.

export const ROLES = ['PLAYER', 'MANAGER', 'STAFF', 'ADMIN'] as const;
export const USER_STATUSES = ['UNVERIFIED', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
export const BOOKING_STATUSES = ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'UNPAID'] as const;
export const CREDIT_EVENT_TYPES = [
  'LATE_CANCEL',
  'LASTMIN_CANCEL',
  'NO_SHOW',
  'UNPAID',
  'FORFEIT',
  'RECOVERY',
  'REVERSAL',
  'ADMIN_ADJUST',
  'AUTO_RESTORE',
] as const;
export const VENUE_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export const COURT_STATUSES = ['ACTIVE', 'UNDER_MAINTENANCE', 'INACTIVE'] as const;
export const BLOCK_REASONS = ['MANAGER', 'TOURNAMENT'] as const;
export const CLIENTS = ['WEB', 'ANDROID', 'IOS'] as const;
export const TOKEN_PURPOSES = ['EMAIL_VERIFY', 'LOGIN_OTP', 'STAFF_INVITE', 'PASSWORD_RESET'] as const;
export const DISPUTE_STATUSES = ['OPEN', 'ACCEPTED', 'REJECTED', 'ESCALATED'] as const; // values proposed in Phase 2 (D15)

export type Role = (typeof ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type CreditEventType = (typeof CREDIT_EVENT_TYPES)[number];
export type VenueStatus = (typeof VENUE_STATUSES)[number];
export type CourtStatus = (typeof COURT_STATUSES)[number];
export type BlockReason = (typeof BLOCK_REASONS)[number];
export type Client = (typeof CLIENTS)[number];
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** Keys are the Prisma enum names. Used by the schema-parity test. */
export const ENUMS = {
  Role: ROLES,
  UserStatus: USER_STATUSES,
  BookingStatus: BOOKING_STATUSES,
  PaymentStatus: PAYMENT_STATUSES,
  CreditEventType: CREDIT_EVENT_TYPES,
  VenueStatus: VENUE_STATUSES,
  CourtStatus: COURT_STATUSES,
  BlockReason: BLOCK_REASONS,
  Client: CLIENTS,
  TokenPurpose: TOKEN_PURPOSES,
  DisputeStatus: DISPUTE_STATUSES,
} as const;

// Derived values that are not stored as database enums.
export const TIERS = ['GOOD', 'CAUTION', 'RESTRICTED', 'BLOCKED'] as const; // Figure 7
export const SLOT_STATES = ['AVAILABLE', 'BOOKED', 'BLOCKED', 'PAST'] as const; // FR-2.5
export type Tier = (typeof TIERS)[number];
export type SlotState = (typeof SLOT_STATES)[number];
