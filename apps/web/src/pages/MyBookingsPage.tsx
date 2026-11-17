import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { formatAmount, type MyBookingsResponse, type CancellationPreview, type BookingReceipt } from '@athleteverse/shared';
import { useApi } from '../api/ApiContext';
import { useApiData } from '../api/useApiData';
import { describeError } from '../errors';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageHeading } from '../ui/PageHeading';
import { Icon } from '../ui/Icon';

export function MyBookingsPage() {
  useDocumentTitle('My Bookings');
  const api = useApi();
  const { loaded, refresh, retry } = useApiData<MyBookingsResponse>('/me/bookings');
  const [tab, setTab] = useState<'Upcoming' | 'Past' | 'Cancelled'>('Upcoming');
  const [preview, setPreview] = useState<{ id: string; data: CancellationPreview } | null>(null);
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Track the clock outside render. Refresh while this screen is mounted so
  // bookings move automatically from Upcoming to Past as time passes.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const initialTimer = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 30_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  async function prepareCancel(id: string) {
    setMessage(null); setBusy(true);
    try { setPreview({ id, data: await api.get<CancellationPreview>(`/me/bookings/${id}/cancellation`) }); }
    catch (e) { setMessage(describeError(e)); }
    finally { setBusy(false); }
  }
  async function viewReceipt(id: string) {
    setReceipt(null); setBusy(true); setMessage(null);
    try { setReceipt(await api.get<BookingReceipt>(`/me/bookings/${id}/receipt`)); }
    catch (e) { setMessage(describeError(e)); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!preview) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api.post<{ penalty: number }> (`/me/bookings/${preview.id}/cancel`);
      setPreview(null); setMessage(`Booking cancelled. Credit change: ${result.penalty} points.`);
      refresh();
    } catch (e) { setPreview(null); setMessage(describeError(e)); refresh(); }
    finally { setBusy(false); }
  }

  const bookings = useMemo(() => loaded.status !== 'ready' || now === null ? [] : loaded.data.items.filter(b => {
    if (tab === 'Cancelled') return b.status === 'CANCELLED';
    if (tab === 'Upcoming') return b.status === 'CONFIRMED' && Date.parse(b.startsAt) > now;
    return b.status !== 'CANCELLED' && !(b.status === 'CONFIRMED' && Date.parse(b.startsAt) > now);
  }), [loaded, tab, now]);

  return <div className="space-y-7">
    <div className="av-section-header"><div><span className="av-eyebrow">Your reservations</span><PageHeading>My Bookings</PageHeading><p className="av-lead">All times are shown for the venue. Payment is cash after the match.</p></div><Link className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white no-underline hover:bg-brand-dark" to="/venues"><Icon name="plus" size={17}/> Find a court</Link></div>
    <section className="av-surface flex flex-wrap items-center justify-between gap-4 p-5 md:p-6"><div className="flex items-center gap-3"><span className="av-action-icon"><Icon name="calendar" size={23}/></span><div><p className="text-sm font-bold">Your match calendar</p><p className="text-xs text-ink-muted">Bookings, payments and cancellations in one place</p></div></div><div className="av-tabs" role="group" aria-label="Booking category">{(['Upcoming', 'Past', 'Cancelled'] as const).map(t => <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setTab(t); setPreview(null); }} className="av-tab">{t}</button>)}</div></section>
    {message && <Alert tone="info">{message}</Alert>}
    {loaded.status === 'error' && <><Alert tone="error">{describeError(loaded.error)}</Alert><Button variant="secondary" onClick={retry}>Retry</Button></>}
    {loaded.status === 'loading' && <p role="status">Loading bookings…</p>}
    {loaded.status === 'ready' && now === null && <p role="status">Loading bookings…</p>}
    {loaded.status === 'ready' && now !== null && bookings.length === 0 && <div className="av-empty"><div className="av-empty-icon"><Icon name="calendar" size={27}/></div><h2 className="text-lg font-extrabold text-ink">Nothing scheduled here</h2><p className="mt-2 text-sm">No {tab.toLowerCase()} bookings.</p><Link className="av-link mt-4" to="/venues">Browse available courts <Icon name="arrow" size={16}/></Link></div>}
    <div className="grid gap-5 lg:grid-cols-2">{bookings.map(b => <article key={b.id} className="av-booking-card space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="av-eyebrow mb-2">YOUR BOOKING</span><h2 className="text-xl font-extrabold">{b.venue.name} — {b.court.name}</h2></div><span className="av-status-pill"><Icon name="circle-check" size={14}/>{b.status.replaceAll('_', ' ').toLowerCase()}</span></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="av-surface-soft p-4"><p className="av-stat-label">Booking code</p><p className="mt-2 font-mono text-lg font-extrabold tracking-[.09em] text-[#0e5660]">{b.code}</p></div><div className="av-surface-soft p-4"><p className="av-stat-label">Total price</p><p className="mt-2 text-lg font-extrabold">{formatAmount(b.totalPrice)}</p></div></div>
      <div className="space-y-2 text-sm text-[#526b7b]"><p className="flex items-center gap-2"><Icon name="calendar" size={17}/><strong>Date:</strong> {b.date}, {String(b.startHour).padStart(2, '0')}:00–{String(b.endHour).padStart(2, '0')}:00</p><p className="flex items-center gap-2"><Icon name="wallet" size={17}/><strong>Booking:</strong> {b.status} <span className="text-[#9aabb3]">|</span> <strong>Payment:</strong> {b.paymentStatus}</p></div>
      <div className="av-divider"/>
      <div className="flex flex-wrap gap-3">{b.paymentStatus === 'PAID' && <Button variant="secondary" disabled={busy} onClick={() => void viewReceipt(b.id)}>View cash receipt</Button>}{tab === 'Upcoming' && <Button disabled={busy} variant="secondary" onClick={() => void prepareCancel(b.id)}>Review cancellation penalty</Button>}</div>
      {preview?.id === b.id && <div className="space-y-3 rounded-2xl border border-[#eedda9] bg-[#fff9e9] p-4" role="region" aria-label="Cancellation confirmation"><p className="text-sm"><strong>Penalty:</strong> {preview.data.penalty} credit points ({preview.data.band.replace('_', ' ').toLowerCase()}). The server recalculates the penalty at confirmation.</p>{preview.data.band === 'STARTED' ? <Alert tone="error">Booking has already started.</Alert> : <Button disabled={busy} onClick={() => void cancel()}>Confirm cancellation</Button>}<Button variant="secondary" disabled={busy} onClick={() => setPreview(null)}>Keep booking</Button></div>}
    </article>)}</div>
    {receipt && <section className="av-panel max-w-xl space-y-3" aria-label="Cash receipt"><span className="av-eyebrow">PAYMENT CONFIRMATION</span><h2 className="text-xl font-extrabold">Cash receipt — {receipt.code}</h2><p>{receipt.venueName} / {receipt.courtName}</p><p className="font-bold">Paid amount: {receipt.amountReceived}</p><p className="text-sm text-ink-muted">Recorded: {new Date(receipt.paidAt).toLocaleString()}</p><Button variant="secondary" onClick={() => setReceipt(null)}>Close receipt</Button></section>}
  </div>;
}
