import { formatAmount, formatDateLong, formatHour, PAY_CASH_NOTE, STRINGS, type Booking } from '@athleteverse/shared';
import { useEffect, useRef } from 'react';
import { Button } from '../ui/Button';

const t = STRINGS.venue.booking;

/** Step 3 of 3: the booking exists. The code is what the player shows at the front desk (FR-2.8). */
export function BookingConfirmed({ booking, onAnother }: { booking: Booking; onAnother(): void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section aria-labelledby="done-title" className="av-panel max-w-2xl space-y-5 !border-[#81caa7] !bg-[#f3fcf7] p-7">
      <h2 id="done-title" ref={heading} tabIndex={-1} className="text-2xl font-extrabold outline-none">
        <span aria-hidden="true">✓ </span>
        {t.doneTitle}
      </h2>
      <div>
        <p className="text-sm font-semibold">{t.code}</p>
        <p className="inline-block rounded-2xl border border-[#a2d1b7] bg-white px-5 py-4 font-mono text-3xl font-extrabold tracking-widest text-[#145847]" data-testid="booking-code">
          {booking.code}
        </p>
        <p className="text-sm">{t.showCode}</p>
      </div>
      <dl className="space-y-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">{t.venue}:</dt>
          <dd>
            {booking.venue.name}, {booking.venue.address}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">{t.court}:</dt>
          <dd>
            {booking.court.name} ({booking.court.sportName})
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">{t.date}:</dt>
          <dd>{formatDateLong(booking.date)}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">{t.time}:</dt>
          <dd>
            {formatHour(booking.startHour)} to {formatHour(booking.endHour)}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-semibold">{t.total}:</dt>
          <dd>
            <strong>{formatAmount(booking.totalPrice)}</strong>
          </dd>
        </div>
      </dl>
      <p className="font-semibold">{PAY_CASH_NOTE}</p>
      <p>{t.emailSent}</p>
      <Button type="button" onClick={onAnother}>
        {t.another}
      </Button>
    </section>
  );
}
