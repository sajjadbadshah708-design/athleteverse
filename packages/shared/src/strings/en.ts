// One shared strings file so web and app use identical labels (USA-4, USA-5, FR-5.17).
// Status labels are text, never colour alone (FR-2.5, USA-2).
import type { BookingStatus, PaymentStatus, Role, SlotState, Tier, UserStatus } from '../enums';
import type { ErrorCode } from '../errors';
import type { Policy } from '../schemas/venues';
import { formatHour } from '../format';

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Payment pending',
  PAID: 'Paid',
  UNPAID: 'Unpaid',
};

export const SLOT_STATE_LABEL: Record<SlotState, string> = {
  AVAILABLE: 'Available',
  BOOKED: 'Booked',
  BLOCKED: 'Blocked',
  PAST: 'Past',
};

export const TIER_LABEL: Record<Tier, string> = {
  GOOD: 'Good standing',
  CAUTION: 'Caution',
  RESTRICTED: 'Restricted',
  BLOCKED: 'Blocked',
};

export const PAY_CASH_NOTE = 'Pay cash at the venue after the match'; // FR-2.15, Table 15 step 1

export const ROLE_LABEL: Record<Role, string> = {
  PLAYER: 'Player',
  MANAGER: 'Arena Manager',
  STAFF: 'Arena Staff',
  ADMIN: 'Super Admin',
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  UNVERIFIED: 'E-mail not verified',
  PENDING_APPROVAL: 'Waiting for approval',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  REJECTED: 'Rejected',
};

/**
 * One plain-language message and next step for every error code the API can return (USA-3). The type makes the compiler
 * demand a message when a new code is added. Field-level problems use the messages of the Zod schemas instead.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Some details need fixing. Check the fields marked below.',
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
  INVALID_CREDENTIALS: 'The e-mail or password is not correct. Check them and try again.',
  FORBIDDEN: 'You do not have access to this. If you think this is a mistake, sign in with the right account.',
  EMAIL_NOT_VERIFIED: 'Your e-mail address is not verified yet. Enter the code we sent you.',
  ACCOUNT_SUSPENDED: 'This account has been suspended. Contact the venue or the platform owner for help.',
  OTP_INVALID: 'That code is not correct. Check the e-mail and try again.',
  OTP_EXPIRED: 'This code has expired or was used up. Ask for a new code.',
  NOT_FOUND: 'We could not find that. Go back and try again.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Please wait before trying again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  PROFILE_INCOMPLETE: 'Complete your profile first.',
  SLOT_TAKEN: 'Someone just booked that slot. Pick another time.',
  TIER_LIMIT: 'Your credit score does not allow another booking right now.',
  BOOKING_OVERLAP: 'You already have a booking at this time. Choose another hour.',
  BOOKING_STARTED: 'This booking has already started.',
  TOO_EARLY: 'It is too early to record this yet.',
  ALREADY_RECORDED: 'This was already recorded.',
  PENALTY_CHANGED: 'The penalty changed while you were looking. Check the new amount and confirm again.',
  CREDIT_ALREADY_APPLIED: 'This credit change was already applied.',
  CONFLICT: 'This clashes with something that already exists. Check your details.',
  INTERNAL: 'Something went wrong on our side. Please try again in a moment.',
};

export const STRINGS = {
  app: { name: 'AthleteVerse', tagline: 'Book indoor courts. Build teams. Play.' },
  nav: { skip: 'Skip to content', home: 'Home', venues: 'Venues', profile: 'Profile', signIn: 'Sign in', register: 'Create account', signOut: 'Sign out', main: 'Main navigation' },
  banner: { startingUp: 'The server is starting up. Free hosting can take about a minute, so please wait…' },
  network: { unreachable: 'We could not reach the server. Check your connection and try again.' },
  auth: {
    password: { show: 'Show password', hide: 'Hide password' },
    login: {
      title: 'Sign in',
      email: 'E-mail',
      password: 'Password',
      submit: 'Sign in',
      noAccount: 'New to AthleteVerse?',
      registerLink: 'Create an account',
      notices: { expired: 'Your session ended. Please sign in again.', suspended: 'Your account has been suspended. Contact the venue or the platform owner for help.' } as Record<'expired' | 'suspended', string>,
      lockedUntil: (time: string) => `Too many failed attempts. You can try again at ${time}.`,
      tryAgainIn: (seconds: number) => `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
    },
    register: {
      title: 'Create your account',
      fullName: 'Full name',
      email: 'E-mail',
      emailHint: 'We send a verification code here. It is never shown to other users.',
      phone: 'Phone number',
      phoneHint: 'Digits only, 9 to 15. Venues you book with can see it.',
      password: 'Password',
      passwordHint: 'At least 8 characters, with a letter and a digit.',
      acceptTerms: 'I accept the Terms of Service and the Privacy Policy',
      confirmAge16: 'I am at least 16 years old',
      submit: 'Create account',
      haveAccount: 'Already have an account?',
      signInLink: 'Sign in',
    },
    verify: {
      title: 'Check your e-mail',
      intro: (email: string) => `We sent a 6-digit code to ${email}. It works for 10 minutes.`,
      email: 'E-mail',
      code: 'Verification code',
      submit: 'Verify and continue',
      attemptsLeft: (n: number) => `That code is not correct. ${n} ${n === 1 ? 'try' : 'tries'} left.`,
      resend: 'Send a new code',
      resendIn: (seconds: number) => `You can ask for a new code in ${seconds} second${seconds === 1 ? '' : 's'}.`,
      resent: 'If that e-mail is waiting for verification, a new code is on its way.',
      wrongPlace: 'Wrong e-mail? Create the account again',
    },
  },
  home: {
    title: (name: string) => `Welcome, ${name}`,
    signedInAs: (role: string) => `You are signed in as ${role}.`,
    pending: 'Your arena manager account is waiting for approval by the platform owner. You will get an e-mail when it is decided.',
    rejected: 'Your arena manager application was not approved. Contact the platform owner for the reason.',
    profileIncomplete: 'Your profile is not complete yet. You will need it to book a court.',
    completeProfile: 'Complete your profile',
    findCourt: 'Find a court',
    profileSaved: 'Your profile is saved.',
    comingSoon: 'More features arrive in the next releases.',
  },
  venues: {
    title: 'Find a court',
    intro: 'Browse indoor venues, see which hours are free and what they cost. You do not need an account to look.',
    filters: 'Search and filters',
    search: 'Venue name or address',
    city: 'City',
    allCities: 'All cities',
    sport: 'Sport',
    allSports: 'All sports',
    minPrice: 'Lowest price per hour',
    maxPrice: 'Highest price per hour',
    priceHint: 'The regular price of one hour on a court.',
    priceInvalid: 'Enter a number such as 20 or 12.50, or leave this empty.',
    priceOrder: 'The lowest price cannot be higher than the highest price.',
    sort: 'Sort by',
    sortName: 'Name',
    sortPrice: 'Price, lowest first',
    apply: 'Show venues',
    clear: 'Clear filters',
    found: (n: number) => `${n} ${n === 1 ? 'venue' : 'venues'} found`,
    empty: 'No venues match your search. Try fewer filters or another city.',
    from: (price: string) => `From ${price} per hour`,
    courts: (n: number) => `${n} ${n === 1 ? 'court' : 'courts'}`,
    hours: (open: number, close: number) => `Open ${formatHour(open)} to ${formatHour(close)}`,
    pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
    previous: 'Previous page',
    next: 'Next page',
    loadFailed: 'We could not load the venues. Check your connection and try again.',
    retry: 'Try again',
  },
  venue: {
    notFoundTitle: 'Venue not found',
    notFoundBody: 'This venue does not exist or is not open for booking.',
    backToList: 'Back to all venues',
    loadFailed: 'We could not load this venue. Check your connection and try again.',
    retry: 'Try again',
    details: 'Details',
    address: 'Address',
    phone: 'Phone',
    hours: 'Opening hours',
    peakHours: 'Peak hours',
    hourRange: (from: number, to: number) => `${formatHour(from)} to ${formatHour(to)}`,
    courtsTitle: 'Courts',
    regularPrice: (price: string) => `${price} per hour`,
    peakPrice: (price: string) => `${price} per hour at peak times`,
    policyTitle: 'Booking, cancellation and credit rules',
    policy: (p: Policy): string[] => {
      const hours = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`;
      return [
        PAY_CASH_NOTE + '. Nothing is paid online.',
        `You can book up to ${p.advanceDays} days ahead, up to ${hours(p.maxSlots)} in a row, and no later than ${p.minLeadMinutes} minutes before the start.`,
        `Cancel more than ${hours(p.freeCancelHours)} before the start: free.`,
        `Cancel between ${hours(p.lastMinuteHours)} and ${hours(p.freeCancelHours)} before the start: ${p.penaltyLate} credit points are deducted.`,
        `Cancel less than ${hours(p.lastMinuteHours)} before the start: ${p.penaltyLastMinute} credit points are deducted.`,
        `Not arriving within ${p.noShowWaitMinutes} minutes of the start: ${p.penaltyNoShow} credit points are deducted. Playing without paying: ${p.penaltyUnpaid}.`,
      ];
    },
    availability: {
      title: 'Availability',
      date: 'Date',
      previousDay: 'Previous day',
      nextDay: 'Next day',
      noCourts: 'This venue has no courts open for booking yet.',
      noSlots: 'There are no hours on this day.',
      pastNote: (minutes: number) => `Hours that start in less than ${minutes} minutes can no longer be booked and show as Past.`,
      refreshNote: 'This list updates by itself every 15 seconds while you look at it.',
      loadFailed: 'We could not load the availability. Check your connection and try again.',
      outOfRange: 'Choose a date from today up to the last day shown.',
      retry: 'Try again',
    },
    booking: {
      needAccount: 'To book an hour you need a player account.',
      needProfile: 'Complete your profile to book an hour.',
      playersOnly: 'Only player accounts can book courts.',
      hint: (max: number) => `Tap an available hour to start a booking. Tap the hours next to it to book up to ${max} in a row.`,
      selected: 'Selected',
      summaryRegion: 'Your selection',
      summary: (court: string, from: string, to: string, hours: number, total: string) =>
        `${court}: ${from} to ${to}, ${hours} ${hours === 1 ? 'hour' : 'hours'}, total ${total}`,
      review: 'Review booking',
      clear: 'Clear selection',
      selectionLost: 'An hour you chose was just booked by someone else. Choose again.',
      reviewTitle: 'Review your booking',
      venue: 'Venue',
      court: 'Court',
      date: 'Date',
      time: 'Time',
      total: 'Total price',
      confirm: 'Confirm booking',
      back: 'Back to the hours',
      rules: 'Cancellation and credit rules',
      doneTitle: 'Booking confirmed',
      code: 'Booking code',
      showCode: 'Show this code at the venue.',
      emailSent: 'We also sent the details to your e-mail address.',
      another: 'Book another hour',
      tierLimit: (tier: string, limit: number) =>
        limit === 0
          ? 'Your credit score is too low to make bookings right now.'
          : `Your credit score (${tier}) allows ${limit} upcoming ${limit === 1 ? 'booking' : 'bookings'}. Cancel one, or wait until one has been played.`,
      alternatives: 'These hours are still free:',
      alternative: (court: string, from: string, to: string, price: string) => `${court}, ${from} to ${to}, total ${price}`,
      chooseOther: 'Choose another hour',
      completeProfile: 'Complete your profile',
    },
  },
  profile: {
    title: 'Your profile',
    intro: 'We need a few details before you can book a court.',
    yourDetails: 'Your details',
    yourDetailsNote: 'These come from your account. Other players never see your e-mail address.',
    name: 'Name',
    email: 'E-mail',
    phone: 'Phone number',
    city: 'City',
    cityPlaceholder: 'Choose your city',
    area: 'Area or neighbourhood',
    areaHint: 'Optional. Helps teammates find you.',
    dateOfBirth: 'Date of birth',
    dateOfBirthHint: `Only used to check that you are at least 16. It is never shown to anyone, including you.`,
    dateOfBirthSaved: 'Date of birth: saved. It is never shown.',
    submit: 'Save profile',
    loadFailed: 'We could not load the profile form. Check your connection and try again.',
    retry: 'Try again',
  },
  forbidden: { title: 'No access', body: 'Your account cannot open this page.', back: 'Go to your home page' },
  notFound: { title: 'Page not found', body: 'The page you are looking for does not exist.', back: 'Go to the home page' },
  loading: 'Loading…',
} as const;
