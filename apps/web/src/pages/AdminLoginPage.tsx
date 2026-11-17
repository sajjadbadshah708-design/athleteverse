import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/ApiContext';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../errors';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageHeading } from '../ui/PageHeading';
import { useDocumentTitle } from '../useDocumentTitle';

const field = 'av-field min-h-11';
export function AdminLoginPage() {
  useDocumentTitle('Super Admin sign in');
  const api = useApi(); const navigate = useNavigate(); const { refreshUser } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [step, setStep] = useState<1 | 2>(1); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (step === 1) { await api.post('/auth/admin/request-otp', { email, password }); setStep(2); }
      else { await api.post('/auth/admin/verify-otp', { email, password, code }); await refreshUser(); navigate('/admin', { replace: true }); }
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4"><PageHeading>Super Admin sign in</PageHeading>
    <p className="av-prose">This account requires an email OTP after the password. Sessions end after 15 minutes of inactivity.</p>
    {error && <Alert tone="error">{error}</Alert>}
    <form className="space-y-4" onSubmit={e => void submit(e)}>
      <label className="block space-y-2 text-sm font-bold text-[#345269]">Email<input className={field} type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block space-y-2 text-sm font-bold text-[#345269]">Password<input className={field} type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {step === 2 && <label className="block space-y-2 text-sm font-bold text-[#345269]">Six-digit email code<input className={field} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={e => setCode(e.target.value)} /></label>}
      <Button type="submit" loading={busy}>{step === 1 ? 'Send verification code' : 'Verify and sign in'}</Button>
    </form>
  </div>;
}
