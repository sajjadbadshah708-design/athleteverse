export const VENUE_ID = '5b0e1d2c-7a3f-4c1e-9d55-0a1b2c3d4e5f';
export const COURT_A = '11111111-1111-4111-8111-111111111111';
export const COURT_B = '22222222-2222-4222-8222-222222222222';

export const policy = {
  advanceDays: 14,
  minLeadMinutes: 30,
  maxSlots: 3,
  freeCancelHours: 6,
  lastMinuteHours: 1,
  penaltyLate: 10,
  penaltyLastMinute: 20,
  noShowWaitMinutes: 15,
  penaltyNoShow: 30,
  penaltyUnpaid: 50,
};

export const venueDetail = (overrides: object = {}) => ({
  id: VENUE_ID,
  name: 'Arena One',
  description: 'A friendly indoor hall.',
  address: '1 Main St',
  cityId: 1,
  cityName: 'Alpha City',
  contactPhone: '920000000100',
  openHour: 8,
  closeHour: 23,
  peakStartHour: 18,
  peakEndHour: 23,
  courts: [
    { id: COURT_A, name: 'Court A', sportId: 1, sportName: 'Futsal', priceRegular: '1200.00', pricePeak: '1500.50' },
    { id: COURT_B, name: 'Court B', sportId: 2, sportName: 'Badminton', priceRegular: '10.00', pricePeak: null },
  ],
  policy,
  timeZone: 'UTC',
  bookingWindow: { today: '2030-01-15', lastDate: '2030-01-29' },
  ...overrides,
});

type State = 'AVAILABLE' | 'BOOKED' | 'BLOCKED' | 'PAST';
const slot = (date: string, hour: number, state: State, price = '20.00') => ({
  startHour: hour,
  endHour: hour + 1,
  startsAt: `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`,
  endsAt: `${date}T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  state,
  price,
});

/** One court with one slot in each state, plus a second court. */
export const availability = (date = '2030-01-15', overrides: object = {}) => ({
  date,
  timeZone: 'UTC',
  courts: [
    {
      courtId: COURT_A,
      name: 'Court A',
      sportId: 1,
      sportName: 'Futsal',
      slots: [slot(date, 8, 'PAST'), slot(date, 9, 'BOOKED'), slot(date, 10, 'BLOCKED'), slot(date, 11, 'AVAILABLE', '1200.00')],
    },
    { courtId: COURT_B, name: 'Court B', sportId: 2, sportName: 'Badminton', slots: [slot(date, 8, 'AVAILABLE', '10.00')] },
  ],
  ...overrides,
});

export const summary = (n: number, overrides: object = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `Venue ${n}`,
  address: `${n} Street`,
  cityId: 1,
  cityName: 'Alpha City',
  openHour: 8,
  closeHour: 23,
  sports: [{ id: 1, name: 'Futsal' }],
  courtCount: 2,
  fromPrice: '1200.00',
  ...overrides,
});

export const CITIES = { items: [{ id: 1, name: 'Alpha City' }, { id: 2, name: 'Beta City' }] };
export const SPORTS = { items: [{ id: 1, name: 'Badminton' }, { id: 2, name: 'Futsal' }] };

/** Court A has free hours 9 to 13 (13:00 is a peak hour at 30), 14:00 is taken; Court B has free hours 9 to 11. */
export const bookableAvailability = (date = '2030-01-15') => {
  const slotAt = (hour: number, state: State, price: string) => slot(date, hour, state, price);
  return {
    date,
    timeZone: 'UTC',
    courts: [
      {
        courtId: COURT_A,
        name: 'Court A',
        sportId: 1,
        sportName: 'Futsal',
        slots: [slotAt(9, 'AVAILABLE', '20.00'), slotAt(10, 'AVAILABLE', '20.00'), slotAt(11, 'AVAILABLE', '20.00'), slotAt(12, 'AVAILABLE', '20.00'), slotAt(13, 'AVAILABLE', '30.00'), slotAt(14, 'BOOKED', '30.00')],
      },
      {
        courtId: COURT_B,
        name: 'Court B',
        sportId: 2,
        sportName: 'Badminton',
        slots: [slotAt(9, 'AVAILABLE', '10.00'), slotAt(10, 'AVAILABLE', '10.00'), slotAt(11, 'AVAILABLE', '10.00')],
      },
    ],
  };
};

export const bookingResponse = (overrides: object = {}) => ({
  id: '99999999-9999-4999-8999-999999999999',
  code: 'K7M2QX9P',
  status: 'CONFIRMED',
  paymentStatus: 'PENDING',
  startsAt: '2030-01-15T12:00:00.000Z',
  endsAt: '2030-01-15T14:00:00.000Z',
  date: '2030-01-15',
  startHour: 12,
  endHour: 14,
  hours: 2,
  totalPrice: '50.00',
  court: { id: COURT_A, name: 'Court A', sportName: 'Futsal' },
  venue: { id: VENUE_ID, name: 'Arena One', address: '1 Main St', cityName: 'Alpha City', contactPhone: '920000000100' },
  createdAt: '2030-01-15T09:00:00.000Z',
  ...overrides,
});
