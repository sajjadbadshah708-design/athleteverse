// FR-5.1 (MVP slice): the manager's home dashboard: today's bookings by court and the bookings that need an action.
import { useState } from 'react';
import { Link } from 'react-router';
import { STRINGS, type ManagerHome, type VenueBooking } from '@athleteverse/shared';
import { useApiData } from '../api/useApiData';
import { describeError } from '../errors';
import { Alert } from '../ui/Alert';
import { Icon } from '../ui/Icon';

const t = STRINGS.managerHome;
const time = (b: VenueBooking) => `${String(b.startHour).padStart(2, '0')}:00–${String(b.endHour).padStart(2, '0')}:00`;

function ActionList({ title, hint, items }: { title: string; hint: string; items: VenueBooking[] }) {
  if (items.length === 0) return null;
  return <section className="av-panel space-y-3" aria-label={title}>
    <h3 className="font-extrabold">{title} <span className="av-mini-pill ml-2">{items.length}</span></h3>
    <p className="text-sm text-ink-muted">{hint}</p>
    <ul className="space-y-2 text-sm">{items.map(b => <li key={b.id} className="flex flex-wrap justify-between gap-2">
      <span><span className="font-mono font-bold">{b.code}</span> · {b.player.fullName} · {b.venue.name}, {b.court.name}</span>
      <span className="text-ink-muted">{b.date} {time(b)}</span>
    </li>)}</ul>
    <Link className="av-link" to="/operations">{t.openDesk} <Icon name="arrow" size={16}/></Link>
  </section>;
}

export function ManagerToday() {
  const [venueId, setVenueId] = useState('');
  const { loaded } = useApiData<ManagerHome>(`/manager/home${venueId ? `?venueId=${venueId}` : ''}`);
  return <section className="space-y-5" aria-labelledby="manager-today">
    <div className="av-section-header"><div><span className="av-eyebrow">{loaded.status === 'ready' ? loaded.data.date : ''}</span><h2 id="manager-today" className="av-section-title mt-2">{t.title}</h2></div>
      {loaded.status === 'ready' && loaded.data.venues.length > 1 && <label className="text-sm font-bold">{t.venue}
        <select className="av-field mt-1" value={venueId} onChange={e => setVenueId(e.target.value)}>
          <option value="">{t.allVenues}</option>{loaded.data.venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select></label>}
    </div>
    {loaded.status === 'loading' && <p role="status">{t.loading}</p>}
    {loaded.status === 'error' && <Alert tone="error">{describeError(loaded.error)}</Alert>}
    {loaded.status === 'ready' && (loaded.data.venues.length === 0 ? <div className="av-empty">{t.noVenues} <Link className="av-link" to="/manager">Venue management</Link></div> : <>
      <ActionList title={t.needsOutcome} hint={t.needsOutcomeHint} items={loaded.data.needsOutcome} />
      <ActionList title={t.awaitingCash} hint={t.awaitingCashHint} items={loaded.data.awaitingCash} />
      {loaded.data.needsOutcome.length === 0 && loaded.data.awaitingCash.length === 0 && <Alert tone="info">{t.nothingToDo}</Alert>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{loaded.data.courts.map(c => <section key={c.id} className="av-surface-soft space-y-2 p-4" aria-label={`${c.venueName}, ${c.name}`}>
        <h3 className="font-extrabold">{c.name} <span className="text-xs font-semibold text-ink-muted">{c.venueName}</span></h3>
        <p className="text-xs text-ink-muted">{t.todayCount(c.bookings.length)}</p>
        {c.bookings.length === 0 ? <p className="text-sm">{t.noBookings}</p> : <ul className="space-y-1 text-sm">{c.bookings.map(b => <li key={b.id} className="flex flex-wrap justify-between gap-2">
          <span><span className="font-bold">{time(b)}</span> {b.player.fullName}</span><span className="text-xs">{b.status} · {b.paymentStatus}</span>
        </li>)}</ul>}
      </section>)}</div>
    </>)}
  </section>;
}
