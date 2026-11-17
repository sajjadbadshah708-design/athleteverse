import {
  addDays,
  formatAmount,
  formatDateLong,
  formatHour,
  SLOT_STATE_LABEL,
  STRINGS,
  sumAmounts,
  type Alternative,
  type Availability,
  type Booking,
  type Slot,
  type SlotState,
  type VenueDetail,
} from '@athleteverse/shared';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useApiData } from '../api/useApiData';
import { useAuth } from '../auth/AuthProvider';
import { BookingConfirmed } from '../booking/BookingConfirmed';
import { BookingReview, type ReviewCourt } from '../booking/BookingReview';
import { alternativeToSelection, nextSelection, selectedSlots, type Selection } from '../booking/selection';
import { useVisibleInterval } from '../useVisibleInterval';
import { Alert } from './Alert';
import { Button } from './Button';
import { LoadingScreen } from './LoadingScreen';
import { TextField } from './TextField';

const t = STRINGS.venue.availability;
const b = STRINGS.venue.booking;
const REFRESH_MS = 15_000; // FR-2.6

// Every state has a text label AND an icon: colour is never the only signal (SRS FR-2.5, USA-2).
const SLOT_LOOK: Record<SlotState, { box: string; icon: string }> = {
  AVAILABLE: { box: 'border-[#6cae96] bg-ok-soft text-ink', icon: '✓' },
  BOOKED: { box: 'border-[#b8c9d0] bg-wash text-ink-muted', icon: '✕' },
  BLOCKED: { box: 'border-[#b8c9d0] bg-wash text-ink-muted', icon: '⊘' },
  PAST: { box: 'border-[#c3d3d9] bg-paper text-ink-muted', icon: '–' },
};
const SELECTED_LOOK = { box: 'border-brand bg-[#dbf4ee] text-ink ring-2 ring-[#b0ded1]', icon: '●' };

type View = { kind: 'hours' } | { kind: 'review'; court: ReviewCourt; slots: Slot[] } | { kind: 'done'; booking: Booking };

/** FR-2.5, FR-2.6, FR-2.7: the hourly slots of every court for one date, and the booking of one to three consecutive hours. */
export function AvailabilityGrid({ venue }: { venue: VenueDetail }) {
  const { today, lastDate } = venue.bookingWindow;
  const [date, setDate] = useState(today);
  const [view, setView] = useState<View>({ kind: 'hours' });
  const [selection, setSelection] = useState<Selection | null>(null);
  const { loaded, retry, refresh } = useApiData<Availability>(`/venues/${venue.id}/availability?date=${date}`);
  useVisibleInterval(refresh, REFRESH_MS); // only while the page is visible (PERF-5)

  const { state } = useAuth();
  const location = useLocation();
  const viewer = state.status === 'authenticated' ? state.user : null;
  const canBook = viewer?.role === 'PLAYER' && viewer.status === 'ACTIVE' && viewer.profileComplete === true;

  const choose = (next: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(next) && next >= today && next <= lastDate) {
      setDate(next);
      setSelection(null);
    }
  };

  // The chosen hours, if they are all still free. When the 15-second refresh shows one was taken, the selection quietly lapses.
  const courts = loaded.status === 'ready' ? loaded.data.courts : [];
  const chosenCourt = courts.find((c) => c.courtId === selection?.courtId);
  const chosen = selection && chosenCourt ? selectedSlots(selection, chosenCourt.slots) : null;
  const selectionLost = selection !== null && loaded.status === 'ready' && chosen === null;

  const pickAlternative = (alternative: Alternative) => {
    setSelection(alternativeToSelection(alternative));
    setView({ kind: 'hours' });
  };

  if (view.kind === 'done') {
    return (
      <BookingConfirmed
        booking={view.booking}
        onAnother={() => {
          setSelection(null);
          setView({ kind: 'hours' });
          refresh();
        }}
      />
    );
  }

  if (view.kind === 'review') {
    return (
      <BookingReview
        venue={venue}
        court={view.court}
        date={date}
        slots={view.slots}
        onBack={() => {
          setView({ kind: 'hours' });
          refresh();
        }}
        onPickAlternative={pickAlternative}
        onBooked={(booking) => {
          setSelection(null);
          setView({ kind: 'done', booking });
          refresh();
        }}
        onStale={refresh}
      />
    );
  }

  return (
    <section aria-labelledby="availability-title" className="space-y-6">
      <div><p className="av-eyebrow mb-2">Select your match time</p><h2 id="availability-title" className="text-2xl font-extrabold">
        {t.title}
      </h2><p className="mt-2 text-sm text-ink-muted">Choose a day, then select consecutive time slots on your preferred court.</p></div>

      <div className="av-surface-soft space-y-4 p-5">
        <TextField label={t.date} name="date" type="date" min={today} max={lastDate} value={date} onChange={choose} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={date <= today} onClick={() => choose(addDays(date, -1))}>
            {t.previousDay}
          </Button>
          <Button type="button" variant="secondary" disabled={date >= lastDate} onClick={() => choose(addDays(date, 1))}>
            {t.nextDay}
          </Button>
        </div>
        <p className="font-semibold">{formatDateLong(date)}</p>
      </div>

      {state.status === 'anonymous' && (
        <Alert tone="info">
          {b.needAccount}{' '}
          <Link to="/login" state={{ from: location.pathname + location.search }} className="font-semibold underline">
            {STRINGS.nav.signIn}
          </Link>{' '}
          ·{' '}
          <Link to="/register" className="font-semibold underline">
            {STRINGS.nav.register}
          </Link>
        </Alert>
      )}
      {viewer?.role === 'PLAYER' && viewer.profileComplete === false && (
        <Alert tone="info">
          {b.needProfile}{' '}
          <Link to="/profile" className="font-semibold underline">
            {b.completeProfile}
          </Link>
        </Alert>
      )}
      {viewer && viewer.role !== 'PLAYER' && <Alert tone="info">{b.playersOnly}</Alert>}
      {canBook && <p className="text-sm text-ink-muted">{b.hint(venue.policy.maxSlots)}</p>}
      {selectionLost && <Alert tone="warning">{b.selectionLost}</Alert>}

      {loaded.status === 'loading' && <LoadingScreen />}
      {loaded.status === 'error' && (
        <div className="space-y-3">
          <Alert tone="error">{t.loadFailed}</Alert>
          <Button type="button" variant="secondary" onClick={retry}>
            {t.retry}
          </Button>
        </div>
      )}
      {loaded.status === 'ready' && (
        <>
          {courts.length === 0 && <p>{t.noCourts}</p>}
          {courts.map((court) => (
            <section key={court.courtId} aria-labelledby={`court-${court.courtId}`} className="av-surface-soft space-y-4 p-5">
              <h3 id={`court-${court.courtId}`} className="text-lg font-bold">
                {court.name} <span className="text-base font-normal text-ink-muted">({court.sportName})</span>
              </h3>
              {court.slots.length === 0 && <p>{t.noSlots}</p>}
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {court.slots.map((slot) => (
                  <SlotItem
                    key={slot.startsAt}
                    slot={slot}
                    interactive={canBook}
                    selected={chosen !== null && chosenCourt?.courtId === court.courtId && chosen.some((s) => s.startsAt === slot.startsAt)}
                    onTap={() => setSelection(nextSelection(chosen ? selection : null, court.courtId, court.slots, slot, venue.policy.maxSlots))}
                  />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-sm text-ink-muted">{t.pastNote(venue.policy.minLeadMinutes)}</p>
          <p className="text-sm text-ink-muted">{t.refreshNote}</p>

          {chosen && chosenCourt && (
            <div role="region" aria-label={b.summaryRegion} className="sticky bottom-3 z-10 rounded-2xl border-2 border-brand bg-white p-5 shadow-[0_18px_45px_-12px_#113c4770]">
              <p role="status" className="font-semibold">
                {b.summary(
                  chosenCourt.name,
                  formatHour(chosen[0]!.startHour),
                  formatHour(chosen[chosen.length - 1]!.endHour),
                  chosen.length,
                  formatAmount(sumAmounts(chosen.map((s) => s.price))),
                )}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:flex">
                <Button
                  type="button"
                  onClick={() => setView({ kind: 'review', court: { id: chosenCourt.courtId, name: chosenCourt.name, sportName: chosenCourt.sportName }, slots: chosen })}
                >
                  {b.review}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setSelection(null)}>
                  {b.clear}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SlotItem({ slot, interactive, selected, onTap }: { slot: Slot; interactive: boolean; selected: boolean; onTap(): void }) {
  const look = selected ? SELECTED_LOOK : SLOT_LOOK[slot.state];
  const content = (
    <>
      <div className="font-semibold">
        {formatHour(slot.startHour)} – {formatHour(slot.endHour)}
      </div>
      <div className="text-sm">
        <span aria-hidden="true">{look.icon} </span>
        {selected ? b.selected : SLOT_STATE_LABEL[slot.state]}
      </div>
      {slot.state === 'AVAILABLE' && <div className="text-sm">{formatAmount(slot.price)}</div>}
    </>
  );
  if (interactive && slot.state === 'AVAILABLE') {
    return (
      <li>
        <button type="button" aria-pressed={selected} onClick={onTap} className={`min-h-11 w-full rounded-xl border p-3 text-left transition-all hover:-translate-y-px hover:shadow-md ${look.box}` }>
          {content}
        </button>
      </li>
    );
  }
  return <li className={`rounded-xl border p-3 ${look.box}`}>{content}</li>;
}
