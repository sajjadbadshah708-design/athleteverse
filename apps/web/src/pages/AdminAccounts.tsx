// FR-1.20 / FR-5.10 (MVP slice): the Super Admin's read-only account list with search, role and status filters (20 per page).
import { useId, useState } from 'react';
import { ROLE_LABEL, ROLES, STRINGS, USER_STATUS_LABEL, USER_STATUSES, type AccountsPage, type Role, type UserStatus } from '@athleteverse/shared';
import { useApiData } from '../api/useApiData';
import { describeError } from '../errors';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

const t = STRINGS.adminAccounts;
const paging = STRINGS.venues;

export function AdminAccounts() {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const ids = { q: useId(), role: useId(), status: useId() };
  const params = new URLSearchParams({ ...(q && { q }), ...(role && { role }), ...(status && { status }), ...(page > 1 && { page: String(page) }) }).toString();
  const { loaded, retry } = useApiData<AccountsPage>(`/admin/accounts${params ? `?${params}` : ''}`);
  const pages = loaded.status === 'ready' ? Math.max(1, Math.ceil(loaded.data.total / loaded.data.pageSize)) : 1;

  return <section className="space-y-5" aria-labelledby="admin-accounts">
    <div className="av-section-header"><div><span className="av-eyebrow">Platform accounts</span><h2 id="admin-accounts" className="av-section-title mt-2">{t.title}</h2></div>
      {loaded.status === 'ready' && <span className="av-mini-pill">{t.total(loaded.data.total)}</span>}</div>
    <form role="search" className="av-panel grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] md:items-end"
      onSubmit={e => { e.preventDefault(); setQ(draft.trim()); setPage(1); }}>
      <div className="space-y-2 text-sm font-bold"><label htmlFor={ids.q}>{t.search}</label><input id={ids.q} className="av-field" value={draft} maxLength={80} onChange={e => setDraft(e.target.value)} /></div>
      <div className="space-y-2 text-sm font-bold"><label htmlFor={ids.role}>{t.role}</label>
        <select id={ids.role} className="av-field" value={role} onChange={e => { setRole(e.target.value as Role | ''); setPage(1); }}>
          <option value="">{t.any}</option>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
      <div className="space-y-2 text-sm font-bold"><label htmlFor={ids.status}>{t.status}</label>
        <select id={ids.status} className="av-field" value={status} onChange={e => { setStatus(e.target.value as UserStatus | ''); setPage(1); }}>
          <option value="">{t.any}</option>{USER_STATUSES.map(s => <option key={s} value={s}>{USER_STATUS_LABEL[s]}</option>)}</select></div>
      <Button type="submit">Search</Button>
    </form>
    {loaded.status === 'loading' && <p role="status">{t.loading}</p>}
    {loaded.status === 'error' && <><Alert tone="error">{describeError(loaded.error)}</Alert><Button variant="secondary" onClick={retry}>Retry</Button></>}
    {loaded.status === 'ready' && (loaded.data.items.length === 0 ? <div className="av-empty">{t.empty}</div> : <>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
        <thead><tr className="text-xs uppercase text-ink-muted">{Object.values(t.columns).map(c => <th key={c} scope="col" className="p-2">{c}</th>)}</tr></thead>
        <tbody>{loaded.data.items.map(a => <tr key={a.id} className="border-t border-[#dbe6e8]">
          <td className="p-2 font-bold">{a.fullName}{a.isOwner && <span className="av-mini-pill ml-2">{t.owner}</span>}</td>
          <td className="p-2"><span className="block break-all">{a.email}</span><span className="text-ink-muted">{a.phone}</span></td>
          <td className="p-2">{ROLE_LABEL[a.role]}</td>
          <td className="p-2">{USER_STATUS_LABEL[a.status]}</td>
          <td className="p-2">{a.creditScore !== null ? a.creditScore : a.venueName ?? '—'}</td>
          <td className="p-2"><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleDateString()}</time></td>
        </tr>)}</tbody>
      </table></div>
      {pages > 1 && <nav className="flex flex-wrap items-center gap-3" aria-label="Account pages">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{paging.previous}</Button>
        <span className="text-sm">{paging.pageOf(page, pages)}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{paging.next}</Button>
      </nav>}
    </>)}
  </section>;
}
