import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApi } from '../api/ApiContext';
import { describeError } from '../errors';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageHeading } from '../ui/PageHeading';
import { useDocumentTitle } from '../useDocumentTitle';

export function AcceptInvitePage() {
  useDocumentTitle('Accept staff invitation');
  const [params] = useSearchParams(); const api = useApi();
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.post('/auth/accept-invite', { userId: params.get('userId'), token: params.get('token'), password }); setDone(true); }
    catch (err) { setError(describeError(err)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4"><PageHeading>Accept staff invitation</PageHeading>
    {done ? <><Alert tone="info">Your staff account is active. You may sign in now.</Alert><Link to="/login" className="font-semibold text-brand underline">Go to sign in</Link></> : <>
      <p className="av-prose">The invitation link is valid for 48 hours and may be used only once.</p>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="space-y-3" onSubmit={e => void submit(e)}><label className="block">Choose password (8 characters, including a letter and number)
        <input className="av-field min-h-11" required type="password" value={password} onChange={e => setPassword(e.target.value)} />
      </label><Button type="submit" loading={busy}>Set password and activate</Button></form>
    </>}
  </div>;
}
