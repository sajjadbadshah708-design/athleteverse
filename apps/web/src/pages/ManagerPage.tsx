import { useState, type FormEvent } from 'react';
import { type City, type ManagedVenue, type StaffMember, type Sport } from '@athleteverse/shared';
import { useApi } from '../api/ApiContext';
import { useApiData } from '../api/useApiData';
import { describeError } from '../errors';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageHeading } from '../ui/PageHeading';
import { Icon } from '../ui/Icon';

const field = 'av-field';

export function ManagerPage() {
  useDocumentTitle('Manager dashboard');
  const api = useApi();
  const venues = useApiData<{ items: ManagedVenue[] }>('/manager/venues');
  const cities = useApiData<{ items: City[] }>('/meta/cities');
  const sports = useApiData<{ items: Sport[] }>('/meta/sports');
  const [venueId, setVenueId] = useState('');
  const activeVenue = venueId || (venues.loaded.status === 'ready' ? venues.loaded.data.items[0]?.id : '') || '';
  const staff = useApiData<{ items: StaffMember[] }>(activeVenue ? `/manager/venues/${activeVenue}/staff` : '/manager/venues');
  const [section, setSection] = useState<'venue' | 'court' | 'staff'>('venue');
  const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [venue, setVenue] = useState({ name: '', address: '', cityId: '', phone: '', openHour: '8', closeHour: '22', description: '' });
  const [court, setCourt] = useState({ name: '', sportId: '', priceRegular: '', pricePeak: '' });
  const [person, setPerson] = useState({ fullName: '', email: '', phone: '' });

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage(null);
    try {
      if (section === 'venue') {
        await api.post('/manager/venues', { ...venue, cityId: Number(venue.cityId), openHour: Number(venue.openHour), closeHour: Number(venue.closeHour) });
        venues.refresh(); setMessage('Venue created. Add a court before it can accept bookings.');
        setVenue({ ...venue, name: '', address: '' });
      } else if (section === 'court') {
        if (!activeVenue) throw new Error('Create or select a venue first');
        await api.post(`/manager/venues/${activeVenue}/courts`, { ...court, sportId: Number(court.sportId), pricePeak: court.pricePeak || null });
        setMessage('Court added.'); setCourt({ ...court, name: '' });
      } else {
        if (!activeVenue) throw new Error('Create or select a venue first');
        await api.post(`/manager/venues/${activeVenue}/staff`, person);
        staff.refresh(); setMessage('Staff invitation sent. The link expires in 48 hours.');
        setPerson({ fullName: '', email: '', phone: '' });
      }
    } catch (error) { setMessage(describeError(error)); }
    finally { setBusy(false); }
  }
  async function toggleStaff(s: StaffMember) {
    setBusy(true); setMessage(null);
    try { await api.post(`/manager/staff/${s.id}/disable`, { disabled: !s.disabled }); staff.refresh(); setMessage('Staff status updated.'); }
    catch (error) { setMessage(describeError(error)); }
    finally { setBusy(false); }
  }

  return <div className="space-y-7">
    <div className="av-section-header"><div><span className="av-eyebrow">Control center</span><PageHeading>Manager dashboard</PageHeading><p className="av-lead">Create and operate only your approved venues. Each manager may have at most three venues, with ten courts and five staff each.</p></div><span className="av-mini-pill"><Icon name="shield" size={15}/> Manager workspace</span></div>
    <div className="av-feature-hero px-7 py-8 md:px-9"><div className="relative z-10 flex flex-wrap items-center justify-between gap-5"><div><p className="av-hero-eyebrow">YOUR ARENA PORTFOLIO</p><h2 className="mt-2 text-3xl font-extrabold text-white">Every venue, in your corner.</h2><p className="mt-2 max-w-md text-sm leading-6 text-[#d2e4e6]">Control courts, prices and front-desk access from a single, organized workspace.</p></div><span className="grid h-20 w-20 place-items-center rounded-3xl border border-white/20 bg-white/10 text-[#dafe80]"><Icon name="building" size={43}/></span></div></div>
    <div className="grid gap-4 sm:grid-cols-3"><div className="av-metric"><span className="av-action-icon !h-9 !w-9"><Icon name="building" size={19}/></span><p className="av-metric-number">{venues.loaded.status === 'ready' ? venues.loaded.data.items.length : '—'} <span className="text-sm font-semibold text-[#738997]">/ 3</span></p><p className="av-metric-label">Managed venues</p></div><div className="av-metric"><span className="av-action-icon !h-9 !w-9"><Icon name="users" size={19}/></span><p className="av-metric-number">{activeVenue && staff.loaded.status === 'ready' ? staff.loaded.data.items.length : '—'} <span className="text-sm font-semibold text-[#738997]">/ 5</span></p><p className="av-metric-label">Venue staff</p></div><div className="av-metric"><span className="av-action-icon !h-9 !w-9"><Icon name="shield" size={19}/></span><p className="av-metric-number">Active</p><p className="av-metric-label">Manager tools</p></div></div>
    {message && <Alert tone="info">{message}</Alert>}
    {venues.loaded.status === 'error' && <Alert tone="error">{describeError(venues.loaded.error)}</Alert>}
    {venues.loaded.status === 'ready' && <label className="av-panel block space-y-2 text-sm font-bold">Active venue
      <select className={field} value={activeVenue} onChange={e => setVenueId(e.target.value)}>
        {venues.loaded.data.items.length === 0 && <option value="">No venues yet</option>}
        {venues.loaded.data.items.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    </label>}
    <div role="group" aria-label="Manager tasks" className="av-tabs">
      {([['venue', 'Add venue'], ['court', 'Add court'], ['staff', 'Invite staff']] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={section === k} className="av-tab" onClick={() => { setSection(k); setMessage(null); }}>{label}</button>)}
    </div>
    <form onSubmit={e => void submit(e)} className="av-panel space-y-5">
      <h2 className="av-panel-title">{section === 'venue' ? 'New venue' : section === 'court' ? 'New court' : 'Staff invitation'}</h2>
      {section === 'venue' && <>
        <label className="block">Venue name<input required className={field} value={venue.name} onChange={e => setVenue({ ...venue, name: e.target.value })}/></label>
        <label className="block">Description (optional)<input className={field} value={venue.description} onChange={e => setVenue({ ...venue, description: e.target.value })}/></label>
        <label className="block">Address<input required className={field} value={venue.address} onChange={e => setVenue({ ...venue, address: e.target.value })}/></label>
        <label className="block">City<select required className={field} value={venue.cityId} onChange={e => setVenue({ ...venue, cityId: e.target.value })}><option value="">Choose city</option>{cities.loaded.status === 'ready' && cities.loaded.data.items.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
        <label className="block">Venue contact phone<input required className={field} value={venue.phone} onChange={e => setVenue({ ...venue, phone: e.target.value })}/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block">Open hour (0–23)<input type="number" min="0" max="23" required className={field} value={venue.openHour} onChange={e => setVenue({ ...venue, openHour: e.target.value })}/></label><label className="block">Close hour (1–24)<input type="number" min="1" max="24" required className={field} value={venue.closeHour} onChange={e => setVenue({ ...venue, closeHour: e.target.value })}/></label></div>
      </>}
      {section === 'court' && <>
        <label className="block">Court name<input required className={field} value={court.name} onChange={e => setCourt({ ...court, name: e.target.value })}/></label>
        <label className="block">Sport<select required className={field} value={court.sportId} onChange={e => setCourt({ ...court, sportId: e.target.value })}><option value="">Choose sport</option>{sports.loaded.status === 'ready' && sports.loaded.data.items.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block">Regular price per hour<input required type="number" min="0.01" step="0.01" className={field} value={court.priceRegular} onChange={e => setCourt({ ...court, priceRegular: e.target.value })}/></label>
        <label className="block">Peak price (optional)<input type="number" min="0.01" step="0.01" className={field} value={court.pricePeak} onChange={e => setCourt({ ...court, pricePeak: e.target.value })}/></label>
      </>}
      {section === 'staff' && <>
        <label className="block">Full name<input required className={field} value={person.fullName} onChange={e => setPerson({ ...person, fullName: e.target.value })}/></label>
        <label className="block">Email<input required type="email" className={field} value={person.email} onChange={e => setPerson({ ...person, email: e.target.value })}/></label>
        <label className="block">Phone<input required className={field} value={person.phone} onChange={e => setPerson({ ...person, phone: e.target.value })}/></label>
      </>}
      <Button type="submit" loading={busy} disabled={section !== 'venue' && !activeVenue}>{section === 'venue' ? 'Create venue' : section === 'court' ? 'Create court' : 'Send invitation'}</Button>
    </form>
    {activeVenue && staff.loaded.status === 'ready' && <section className="av-panel space-y-4"><h2 className="av-panel-title">Venue staff</h2>
      {staff.loaded.data.items.length === 0 && <p>No invited staff.</p>}
      {staff.loaded.data.items.map(s => <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2ebed] bg-[#f9fbfc] p-4" key={s.id}>
        <div><strong>{s.fullName}</strong><p>{s.email} | {s.disabled ? 'Disabled' : s.status}</p></div>
        <Button variant="secondary" disabled={busy} onClick={() => void toggleStaff(s)}>{s.disabled ? 'Enable' : 'Disable'}</Button>
      </div>)}
    </section>}
  </div>;
}
