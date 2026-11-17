import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { managerRegisterSchema } from '@athleteverse/shared';
import { useApi } from '../api/ApiContext';
import { describeError } from '../errors';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageHeading } from '../ui/PageHeading';
import { useDocumentTitle } from '../useDocumentTitle';

const inputClass = 'av-field min-h-11';
export function ManagerRegisterPage() {
  useDocumentTitle('Register an arena');
  const api = useApi(); const navigate = useNavigate();
  const [values, setValues] = useState({ fullName: '', email: '', phone: '', password: '', businessName: '', nationalIdNo: '', businessAddress: '', acceptTerms: false, confirmAge16: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    const parsed = managerRegisterSchema.safeParse(values);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Please check the form'); return; }
    setBusy(true);
    try { await api.post('/auth/register-manager', parsed.data); navigate(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`); }
    catch (err) { setError(describeError(err)); }
    finally { setBusy(false); }
  }
  const textFields = [
    ['fullName', 'Full name'], ['email', 'Email address'], ['phone', 'Phone number'], ['password', 'Password'],
    ['businessName', 'Business name'], ['nationalIdNo', 'National ID number'], ['businessAddress', 'Business address'],
  ] as const;
  return <div className="space-y-4"><PageHeading>Register an Arena Manager account</PageHeading>
    <p className="av-prose">After email verification, your application requires Super Admin approval before you can create venues.</p>
    {error && <Alert tone="error">{error}</Alert>}
    <form className="space-y-4" onSubmit={e => void submit(e)} noValidate>
      {textFields.map(([key, label]) => <label key={key} className="block space-y-2 text-sm font-bold text-[#345269]">{label}
        <input className={inputClass} required type={key === 'password' ? 'password' : key === 'email' ? 'email' : 'text'} value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })}/>
      </label>)}
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={values.acceptTerms} onChange={e => setValues({ ...values, acceptTerms: e.target.checked })}/>I accept the Terms of Service.</label>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={values.confirmAge16} onChange={e => setValues({ ...values, confirmAge16: e.target.checked })}/>I confirm I am at least 16 years old.</label>
      <Button type="submit" loading={busy}>Register manager account</Button>
    </form>
    <Link className="font-semibold text-brand underline" to="/login">Already registered? Sign in</Link>
  </div>;
}
