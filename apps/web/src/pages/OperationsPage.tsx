import { useId, useState } from 'react';
import { formatAmount, STRINGS, type ManagedVenue, type VenueBooking, type VenueBookingDetail, type VenueBookingsResponse } from '@athleteverse/shared';
import { useAuth } from '../auth/AuthProvider';
import { useApi } from '../api/ApiContext';
import { useApiData } from '../api/useApiData';
import { describeError } from '../errors';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { PageHeading } from '../ui/PageHeading';
import { useDocumentTitle } from '../useDocumentTitle';

const t = STRINGS.operations;

/** FR-5.3: the booking's status history, loaded when the operator opens it (remounted after an outcome to reload). */
function BookingDetailPanel({ id, code }: { id: string; code: string }) {
  const { loaded } = useApiData<VenueBookingDetail>(`/operations/bookings/${id}`);
  return <section className="av-surface-soft space-y-3 p-4" aria-label={t.detailsTitle(code)}>
    <h3 className="text-sm font-extrabold">{t.history}</h3>
    {loaded.status === 'loading' && <p role="status" className="text-sm">{t.loadingDetails}</p>}
    {loaded.status === 'error' && <Alert tone="error">{describeError(loaded.error)}</Alert>}
    {loaded.status === 'ready' && <>
      {loaded.data.cancelReason && <p className="text-sm"><strong>Cancellation reason:</strong> {loaded.data.cancelReason}</p>}
      <ol className="space-y-2 text-sm">{loaded.data.history.map((h, i) => <li key={i} className="flex flex-wrap gap-x-2">
        <time dateTime={h.at} className="font-mono text-xs text-ink-muted">{new Date(h.at).toLocaleString()}</time>
        <span className="font-bold">{t.historyEvents[h.event]}</span>
        {h.points !== null && <span>({h.points > 0 ? `+${h.points}` : h.points} points)</span>}
        {h.amount !== null && <span>{formatAmount(h.amount)}</span>}
        <span className="text-ink-muted">— {h.by ? `${h.by.name} (${h.by.role.toLowerCase()})` : t.system}</span>
        {h.reason && h.event !== 'CREDIT' && <span className="w-full text-ink-muted">{h.reason}</span>}
      </li>)}</ol>
    </>}
  </section>;
}

/** Table 15 step 4: the operator enters the cash received; the booked price is the default. */
function PaidForm({ booking, busy, onSubmit, onCancel }: { booking: VenueBooking; busy: boolean; onSubmit: (amount: string) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(booking.totalPrice);
  const fieldId = useId();
  const valid = /^\d{1,8}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  return <form className="space-y-3 rounded-2xl border border-[#b1cacf] p-4" aria-label={t.confirmPaid}
    onSubmit={e => { e.preventDefault(); if (valid) onSubmit(amount); }}>
    <label htmlFor={fieldId} className="block text-sm font-bold">{t.amountReceived}</label>
    <input id={fieldId} className="av-field" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.trim())}
      aria-invalid={!valid} aria-describedby={`${fieldId}-hint`} />
    <p id={`${fieldId}-hint`} className="text-xs text-ink-muted">{t.amountHint}</p>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!valid || busy}>{t.savePaid}</Button><Button type="button" variant="secondary" onClick={onCancel}>{t.keep}</Button></div>
  </form>;
}

function BookingDesk({ venueId, isManager }: { venueId: string; isManager: boolean }) {
  const api = useApi();
  const [search, setSearch] = useState(''); const [date, setDate] = useState('');
  const [busy, setBusy] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [openDetail, setOpenDetail] = useState<string | null>(null); const [paying, setPaying] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const url = `/operations/venues/${venueId}/bookings?${new URLSearchParams({ ...(search && { search }), ...(date && { date }) }).toString()}`;
  const { loaded, refresh } = useApiData<VenueBookingsResponse>(url);
  async function cancelByVenue(id: string) {
    const reason = window.prompt('Reason for cancelling this booking (at least three characters):');
    if (!reason || reason.trim().length < 3) return;
    setBusy(id); setMessage(null);
    try { await api.post(`/operations/bookings/${id}/cancel`, { reason }); setMessage('Booking cancelled without player penalty.'); refresh(); }
    catch (error) { setMessage(describeError(error)); refresh(); }
    finally { setBusy(null); }
  }
  async function record(id: string, outcome: 'PAID' | 'UNPAID' | 'NO_SHOW', amount?: string) {
    if (outcome !== 'PAID' && !window.confirm(`Confirm ${outcome.replace('_', ' ').toLowerCase()} for this booking? This changes the player's credit score.`)) return;
    setBusy(id); setMessage(null);
    try {
      await api.post(`/operations/bookings/${id}/outcome`, { outcome, ...(amount && { amount }) });
      setMessage(outcome === 'PAID' && amount ? t.paidRecorded(formatAmount(amount)) : `${outcome} recorded successfully.`);
      setPaying(null); setVersion(v => v + 1); refresh();
    }
    catch (error) { setMessage(describeError(error)); refresh(); }
    finally { setBusy(null); }
  }
  const items = loaded.status === 'ready' ? loaded.data.items : [];
  return <div className="space-y-6">
    <section className="av-panel"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><span className="av-eyebrow">Booking lookup</span><h2 className="av-panel-title mt-2">Find a reservation</h2></div><span className="av-mini-pill"><Icon name="search" size={14}/> Live venue records</span></div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]">
        <label className="space-y-2 text-sm font-bold text-[#345269]">Search by code, name or phone<input className="av-field" value={search} onChange={e => setSearch(e.target.value)} placeholder="Code, customer name or phone…" /></label>
        <label className="space-y-2 text-sm font-bold text-[#345269]">Booking date (optional)<input className="av-field" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>
    </section>
    {message && <Alert tone="info">{message}</Alert>}
    {loaded.status === 'loading' && <p role="status" className="av-panel">Loading venue bookings…</p>}
    {loaded.status === 'error' && <Alert tone="error">{describeError(loaded.error)}</Alert>}
    {loaded.status === 'ready' && <><div className="grid gap-4 sm:grid-cols-3"><div className="av-metric"><p className="av-metric-label">Matching bookings</p><p className="av-metric-number">{items.length}</p></div><div className="av-metric"><p className="av-metric-label">Confirmed</p><p className="av-metric-number">{items.filter(b => b.status === 'CONFIRMED').length}</p></div><div className="av-metric"><p className="av-metric-label">Cash paid</p><p className="av-metric-number">{items.filter(b => b.paymentStatus === 'PAID').length}</p></div></div>
      <div className="av-section-header"><div><span className="av-eyebrow">Front desk queue</span><h2 className="av-section-title mt-2">Booking records</h2></div><span className="av-mini-pill">{items.length} shown</span></div>
      {items.length === 0 && <div className="av-empty"><div className="av-empty-icon"><Icon name="ticket" size={27}/></div><h3 className="font-extrabold text-ink">Nothing in this view</h3><p className="mt-2 text-sm">No matching bookings.</p></div>}
      <div className="grid gap-4 xl:grid-cols-2">{items.map(b => <article className="av-booking-card space-y-4" key={b.id}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="av-eyebrow">BOOKING {b.code}</p><h2 className="mt-2 text-xl font-extrabold">{b.player.fullName}</h2><p className="mt-1 flex items-center gap-2 text-sm text-ink-muted"><Icon name="grid" size={16}/>{b.court.name}, {b.date} {String(b.startHour).padStart(2, '0')}:00–{String(b.endHour).padStart(2, '0')}:00</p></div><span className="av-status-pill">{b.status}</span></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="av-surface-soft p-3"><p className="av-stat-label">Booking price</p><p className="mt-1 font-extrabold">{b.totalPrice}</p></div><div className="av-surface-soft p-3"><p className="av-stat-label">Credit standing</p><p className="mt-1 font-extrabold">{b.player.creditScore} <span className="text-xs font-semibold text-ink-muted">({b.player.creditTier})</span></p></div><div className="av-surface-soft col-span-2 p-3 sm:col-span-1"><p className="av-stat-label">Cash status</p><p className="mt-1 font-extrabold">{b.paymentStatus}</p></div></div>
        <p className="flex items-center gap-2 text-sm text-ink-muted"><Icon name="phone" size={16}/> {b.player.phone}</p><div className="av-divider"/>
        {isManager && b.status === 'CONFIRMED' && <Button variant="secondary" disabled={busy !== null} onClick={() => void cancelByVenue(b.id)}>Cancel booking (no penalty)</Button>}
        {/* After automatic closure only the manager may still confirm cash (Table 15); staff see no button the API would refuse. */}
        {(b.status === 'CONFIRMED' || (isManager && b.status === 'COMPLETED' && b.paymentStatus === 'PENDING')) && paying !== b.id && <div className="flex flex-wrap gap-2"><Button disabled={busy !== null} onClick={() => setPaying(b.id)}><Icon name="check" size={16}/> {t.confirmPaid}</Button>
          {b.status === 'CONFIRMED' && <><Button variant="secondary" disabled={busy !== null} onClick={() => void record(b.id, 'UNPAID')}>Record unpaid</Button><Button variant="secondary" disabled={busy !== null} onClick={() => void record(b.id, 'NO_SHOW')}>Record no-show</Button></>}
        </div>}
        {paying === b.id && <PaidForm booking={b} busy={busy !== null} onSubmit={amount => void record(b.id, 'PAID', amount)} onCancel={() => setPaying(null)} />}
        <Button variant="secondary" aria-expanded={openDetail === b.id} onClick={() => setOpenDetail(openDetail === b.id ? null : b.id)}>{openDetail === b.id ? t.hideDetails : t.details}</Button>
        {openDetail === b.id && <BookingDetailPanel key={version} id={b.id} code={b.code} />}
      </article>)}</div>
    </>}
  </div>;
}

function ManagerDesk() {
  const [selectedVenue, setSelectedVenue] = useState('');
  const { loaded } = useApiData<{ items: ManagedVenue[] }>('/manager/venues');
  const venue = selectedVenue || (loaded.status === 'ready' ? loaded.data.items[0]?.id : '');
  return <div className="space-y-5">
    {loaded.status === 'loading' && <p role="status">Loading venues…</p>}
    {loaded.status === 'error' && <Alert tone="error">{describeError(loaded.error)}</Alert>}
    {loaded.status === 'ready' && <label className="av-panel block max-w-xl space-y-2 text-sm font-bold">Venue
      <select className="av-field" value={venue ?? ''} onChange={e => setSelectedVenue(e.target.value)}>{loaded.data.items.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
    </label>}
    {venue ? <BookingDesk key={venue} venueId={venue} isManager /> : loaded.status === 'ready' && <div className="av-empty">No venue configured.</div>}
  </div>;
}

export function OperationsPage() {
  useDocumentTitle('Venue front desk');
  const { state } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  if (!user) return null;
  return <div className="space-y-7"><div className="av-section-header"><div><span className="av-eyebrow">On-site operations</span><PageHeading>Venue front desk</PageHeading><p className="av-lead">Search reservations, check match details and record payment outcomes with confidence.</p></div><span className="av-mini-pill"><Icon name="shield" size={15}/> Authorized venue access</span></div>
    <div className="av-feature-hero flex flex-wrap items-center justify-between gap-6 p-7 md:px-10 md:py-8"><div className="relative z-10"><p className="av-hero-eyebrow">MATCH DAY OPERATIONS</p><h2 className="mt-2 text-3xl font-extrabold text-white">Keep the front desk moving.</h2><p className="mt-2 text-sm text-[#d3e6e8]">Every confirmed booking and recorded cash outcome, organized as you work.</p></div><Icon name="ticket" size={65} className="relative z-10 hidden text-[#dafe80] md:block"/></div>
    {user.role === 'MANAGER' ? <ManagerDesk /> : user.staffVenueId ? <BookingDesk venueId={user.staffVenueId} isManager={false} /> : <div className="av-empty">No assigned venue available.</div>}
  </div>;
}
