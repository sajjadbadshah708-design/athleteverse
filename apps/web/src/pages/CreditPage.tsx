import { type CreditSummary } from '@athleteverse/shared';
import { useApiData } from '../api/useApiData';
import { describeError } from '../errors';
import { PageHeading } from '../ui/PageHeading';
import { Alert } from '../ui/Alert';
import { useDocumentTitle } from '../useDocumentTitle';
import { Icon } from '../ui/Icon';

export function CreditPage() {
  useDocumentTitle('My Credit');
  const { loaded } = useApiData<CreditSummary>('/me/credit');
  return <section className="space-y-7">
    <div><span className="av-eyebrow">Player reputation</span><PageHeading>My Credit</PageHeading><p className="av-lead">Good sportsmanship earns trust. Your credit history shows how each completed match, payment or cancellation affects your standing.</p></div>
    {loaded.status === 'loading' && <p role="status">Loading credit information…</p>}
    {loaded.status === 'error' && <Alert tone="error">{describeError(loaded.error)}</Alert>}
    {loaded.status === 'ready' && <>
      <div className="av-feature-hero grid gap-8 p-7 md:grid-cols-[minmax(0,1fr)_175px] md:items-center md:p-10">
        <div className="relative z-10"><p className="av-hero-eyebrow">YOUR CURRENT STANDING</p><div className="mt-4 flex items-end gap-2"><span className="text-6xl font-black tracking-[-.075em] text-white">{loaded.data.score}</span><span className="mb-2 text-2xl font-semibold text-[#c1d9db]">/ 100</span></div><p className="mt-4 text-base text-[#d9eded]">Current tier: <strong className="text-[#dafe80]">{loaded.data.tier}</strong></p><div className="mt-6 h-2.5 max-w-xl rounded-full bg-white/20"><div className="h-2.5 rounded-full bg-[#dafe80]" style={{width:`${Math.max(0,Math.min(100,loaded.data.score))}%`}}/></div><p className="mt-3 text-xs text-[#c7dadd]">Scores stay between 0 and 100.</p></div>
        <div className="relative z-10 hidden justify-center md:flex" aria-hidden="true"><div className="grid h-40 w-40 place-items-center rounded-full border-[12px] border-[#dafe80] bg-white/10"><Icon name="shield" size={68} className="text-[#dafe80]"/></div></div>
      </div>
      <section className="av-panel"><div className="av-section-header"><div><span className="av-eyebrow">Account activity</span><h2 className="av-section-title mt-2">Credit history</h2></div><span className="av-mini-pill"><Icon name="activity" size={15}/>{loaded.data.events.length} events</span></div>
        {loaded.data.events.length === 0 && <div className="av-empty"><div className="av-empty-icon"><Icon name="activity" size={24}/></div><p>No credit events recorded.</p></div>}
        <ul className="space-y-3">{loaded.data.events.map(e => <li className="av-list-item flex flex-wrap items-start justify-between gap-4" key={e.id}><div className="flex items-start gap-3"><span className="av-action-icon !h-10 !w-10"><Icon name={e.points >= 0 ? 'trend' : 'activity'} size={19}/></span><div><p className="font-extrabold">{e.type.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-ink-muted">{new Date(e.createdAt).toLocaleString()}</p>{e.bookingId && <p className="mt-2 text-xs text-ink-muted">Booking ID: {e.bookingId}</p>}</div></div><div className="text-right"><p className={`text-lg font-extrabold ${e.points >= 0 ? 'text-[#126847]' : 'text-[#ab2633]'}`}>{e.points > 0 ? '+' : ''}{e.points} points</p><p className="text-xs font-medium text-ink-muted">Balance: {e.scoreAfter}</p></div></li>)}</ul>
      </section>
    </>}
  </section>;
}
