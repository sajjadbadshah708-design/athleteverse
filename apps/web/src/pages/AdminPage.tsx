import { useState } from 'react';
import { type ManagerStatus } from '@athleteverse/shared';
import { useApi } from '../api/ApiContext';
import { useApiData } from '../api/useApiData';
import { describeError } from '../errors';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { PageHeading } from '../ui/PageHeading';
import { AdminAccounts } from './AdminAccounts';

export function AdminPage() {
  useDocumentTitle('Super Admin');
  const api = useApi();
  const { loaded, refresh, retry } = useApiData<{ items: ManagerStatus[] }>('/admin/managers');
  const [reasons, setReasons] = useState<Record<string, string>>({}); const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    if (!reasons[id]?.trim() || reasons[id]!.trim().length < 3) { setMessage('Enter a reason of at least three characters.'); return; }
    setBusy(id); setMessage(null);
    try { await api.post(`/admin/managers/${id}/decision`, { decision, reason: reasons[id] }); setMessage(`Manager ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`); refresh(); }
    catch (err) { setMessage(describeError(err)); refresh(); }
    finally { setBusy(null); }
  }
  const items = loaded.status === 'ready' ? loaded.data.items : [];
  const pending = items.filter(m => m.status === 'PENDING_APPROVAL').length;
  return <div className="space-y-7">
    <div className="av-section-header"><div><span className="av-eyebrow">Platform governance</span><PageHeading>Super Admin — Manager approvals</PageHeading><p className="av-lead">Review venue partners, verify their business information and document each decision.</p></div><span className="av-mini-pill"><Icon name="shield" size={15}/> Protected administration</span></div>
    <div className="av-feature-hero p-7 md:p-10"><div className="relative z-10 flex flex-wrap items-center justify-between gap-6"><div><p className="av-hero-eyebrow">MANAGER APPLICATIONS</p><h2 className="mt-2 text-3xl font-extrabold text-white">Review with confidence.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[#d8e9e8]">Every decision requires a reason and is saved to the audit log. The owner account cannot be suspended or demoted.</p></div><span className="flex h-22 w-22 items-center justify-center rounded-3xl border border-white/20 bg-white/10 text-[#dafe80]"><Icon name="shield" size={48}/></span></div></div>
    {loaded.status === 'ready' && <div className="grid gap-4 sm:grid-cols-3"><div className="av-metric"><p className="av-metric-label">Applications</p><p className="av-metric-number">{items.length}</p></div><div className="av-metric"><p className="av-metric-label">Pending review</p><p className="av-metric-number">{pending}</p></div><div className="av-metric"><p className="av-metric-label">Decisions recorded</p><p className="av-metric-number">{items.filter(m => m.status === 'ACTIVE' || m.status === 'REJECTED').length}</p></div></div>}
    {message && <Alert tone="info">{message}</Alert>}
    {loaded.status === 'loading' && <p role="status" className="av-panel">Loading applications…</p>}
    {loaded.status === 'error' && <><Alert tone="error">{describeError(loaded.error)}</Alert><Button variant="secondary" onClick={retry}>Retry</Button></>}
    {loaded.status === 'ready' && <section><div className="av-section-header"><div><span className="av-eyebrow">Applications inbox</span><h2 className="av-section-title mt-2">Arena manager requests</h2></div><span className="av-mini-pill">{items.length} applicants</span></div>
      {items.length === 0 && <div className="av-empty"><span className="av-empty-icon"><Icon name="check" size={29}/></span><h3 className="font-extrabold text-ink">All clear</h3><p className="mt-2 text-sm">No manager applications found.</p></div>}
      <div className="grid gap-5 xl:grid-cols-2">{items.map(m => <article key={m.id} className="av-panel space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><span className="av-action-icon !h-12 !w-12"><Icon name="building" size={24}/></span><div><h3 className="text-xl font-extrabold">{m.fullName} — {m.businessName}</h3><p className="mt-1 text-xs text-ink-muted">Business manager application</p></div></div><span className="av-status-pill">{m.status.replaceAll('_',' ').toLowerCase()}</span></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div className="av-surface-soft p-3"><dt className="av-stat-label">Email</dt><dd className="mt-1 break-all font-semibold">{m.email}</dd></div><div className="av-surface-soft p-3"><dt className="av-stat-label">Status</dt><dd className="mt-1 font-semibold">{m.status}</dd></div><div className="av-surface-soft p-3 sm:col-span-2"><dt className="av-stat-label">Business address</dt><dd className="mt-1 font-semibold">{m.businessAddress}</dd></div></dl>
        {m.rejectionReason && <Alert tone="warning"><strong>Previous rejection:</strong> {m.rejectionReason}</Alert>}
        {m.status === 'PENDING_APPROVAL' && <><div className="av-divider"/><label className="block space-y-2 text-sm font-bold">Decision reason<textarea className="av-field min-h-26" maxLength={500} value={reasons[m.id] ?? ''} onChange={e => setReasons({ ...reasons, [m.id]: e.target.value })} placeholder="Document why you are approving or rejecting this application…" /></label><div className="flex flex-wrap gap-3"><Button disabled={busy !== null} onClick={() => void decide(m.id, 'APPROVE')}><Icon name="check" size={17}/>Approve</Button><Button variant="secondary" disabled={busy !== null} onClick={() => void decide(m.id, 'REJECT')}>Reject</Button></div></>}
      </article>)}</div>
    </section>}
    <AdminAccounts />
  </div>;
}
