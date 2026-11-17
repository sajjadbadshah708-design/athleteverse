import {
  ApiError,
  ERROR_MESSAGES,
  formatAmount,
  formatDateLong,
  formatHour,
  PAY_CASH_NOTE,
  STRINGS,
  sumAmounts,
  TIER_LABEL,
  type Alternative,
  type Booking,
  type Slot,
  type TierLimitDetails,
  type VenueDetail,
} from '@athleteverse/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../api/ApiContext';
import { describeError } from '../errors';
import { errorsFromApi } from '../forms/useForm';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

const t = STRINGS.venue.booking;

export interface ReviewCourt {
  id: string;
  name: string;
  sportName: string;
}

type Failure = { kind: 'taken'; alternatives: Alternative[] } | { kind: 'profile' } | { kind: 'message'; text: string };

/** Turns what the API answered into what the player should read (USA-3). Never shows codes or server text. */
function toFailure(error: unknown): { failure: Failure; gridIsStale: boolean } {
  if (error instanceof ApiError) {
    const details = error.details as { alternatives?: Alternative[] } | undefined;
    switch (error.code) {
      case 'SLOT_TAKEN':
        return { failure: { kind: 'taken', alternatives: details?.alternatives ?? [] }, gridIsStale: true };
      case 'PROFILE_INCOMPLETE':
        return { failure: { kind: 'profile' }, gridIsStale: false };
      case 'TIER_LIMIT': {
        const tier = error.details as TierLimitDetails;
        return { failure: { kind: 'message', text: t.tierLimit(TIER_LABEL[tier.tier], tier.limit) }, gridIsStale: false };
      }
      case 'VALIDATION_ERROR': {
        const message = Object.values(errorsFromApi(error) ?? {})[0];
        return { failure: { kind: 'message', text: message ?? describeError(error) }, gridIsStale: true };
      }
      case 'BOOKING_OVERLAP':
        return { failure: { kind: 'message', text: describeError(error) }, gridIsStale: true };
    }
  }
  return { failure: { kind: 'message', text: describeError(error) }, gridIsStale: false };
}

/** Step 2 of 3: the player sees exactly what they are about to book, then confirms (FR-2.7, FR-2.15, USA-1). */
export function BookingReview({
  venue,
  court,
  date,
  slots,
  onBack,
  onPickAlternative,
  onBooked,
  onStale,
}: {
  venue: VenueDetail;
  court: ReviewCourt;
  date: string;
  slots: Slot[];
  onBack(): void;
  onPickAlternative(alternative: Alternative): void;
  onBooked(booking: Booking): void;
  onStale(): void;
}) {
  const api = useApi();
  const heading = useRef<HTMLHeadingElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  useEffect(() => {
    heading.current?.focus(); // a new step: say so to screen readers (WCAG 2.4.3)
  }, []);

  const total = sumAmounts(slots.map((s) => s.price));
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;

  async function confirm() {
    if (submitting) return; // one tap, one booking
    setFailure(null);
    setSubmitting(true);
    try {
      onBooked(await api.post<Booking>('/bookings', { courtId: court.id, startsAt: first.startsAt, slots: slots.length }));
    } catch (error) {
      const { failure: next, gridIsStale } = toFailure(error);
      setFailure(next);
      if (gridIsStale) onStale();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="review-title" className="av-panel max-w-2xl space-y-5">
      <h2 id="review-title" ref={heading} tabIndex={-1} className="text-2xl font-extrabold outline-none">
        {t.reviewTitle}
      </h2>
      <dl className="grid gap-3 rounded-2xl border border-[#deeaec] bg-[#f8fbfc] p-5">
        <Row term={t.venue} value={venue.name} />
        <Row term={t.court} value={`${court.name} (${court.sportName})`} />
        <Row term={t.date} value={formatDateLong(date)} />
        <Row term={t.time} value={`${formatHour(first.startHour)} to ${formatHour(last.endHour)}`} />
        <Row term={t.total} value={<strong>{formatAmount(total)}</strong>} />
      </dl>
      <p className="rounded-xl bg-[#e8f7ef] p-4 font-semibold text-[#176247]">{PAY_CASH_NOTE}</p>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline">{t.rules}</summary>
        <ul className="list-disc space-y-1 pl-5 pt-2">
          {STRINGS.venue.policy(venue.policy)
            .slice(1)
            .map((line) => (
              <li key={line}>{line}</li>
            ))}
        </ul>
      </details>

      {failure?.kind === 'message' && <Alert tone="error">{failure.text}</Alert>}
      {failure?.kind === 'profile' && (
        <Alert tone="error">
          {t.needProfile}{' '}
          <Link to="/profile" className="font-semibold underline">
            {t.completeProfile}
          </Link>
        </Alert>
      )}
      {failure?.kind === 'taken' && (
        <div className="space-y-3">
          <Alert tone="error">{ERROR_MESSAGES.SLOT_TAKEN}</Alert>
          {failure.alternatives.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold">{t.alternatives}</p>
              <ul className="space-y-2">
                {failure.alternatives.map((alt) => (
                  <li key={`${alt.courtId}-${alt.startsAt}`}>
                    <Button type="button" variant="secondary" onClick={() => onPickAlternative(alt)}>
                      {t.alternative(alt.courtName, formatHour(alt.startHour), formatHour(alt.endHour), formatAmount(alt.price))}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:flex">
        {failure?.kind !== 'taken' && (
          <Button type="button" onClick={confirm} loading={submitting}>
            {t.confirm}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onBack}>
          {failure?.kind === 'taken' ? t.chooseOther : t.back}
        </Button>
      </div>
    </section>
  );
}

function Row({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="font-semibold">{term}:</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
