import { registerRequestSchema, STRINGS } from '@athleteverse/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../errors';
import { errorsFromApi, errorsFromZod, useForm } from '../forms/useForm';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { CheckboxField } from '../ui/CheckboxField';
import { PageHeading } from '../ui/PageHeading';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';

const t = STRINGS.auth.register;

interface RegisterValues extends Record<string, string | boolean> {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  acceptTerms: boolean;
  confirmAge16: boolean;
}
const EMPTY: RegisterValues = { fullName: '', email: '', phone: '', password: '', acceptTerms: false, confirmAge16: false };

/** FR-1.1, FR-1.2, FR-1.4. Players register here; managers register on a separate form in T18. */
export function RegisterPage() {
  useDocumentTitle(t.title);
  const { register } = useAuth();
  const navigate = useNavigate();
  const form = useForm<RegisterValues>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const parsed = registerRequestSchema.safeParse(form.values);
    if (!parsed.success) {
      form.showErrors(errorsFromZod(parsed.error));
      return;
    }
    setSubmitting(true);
    try {
      await register(parsed.data);
      navigate(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`, { state: { fresh: true } });
    } catch (error) {
      const fieldErrors = errorsFromApi(error);
      if (fieldErrors) form.showErrors(fieldErrors);
      else setProblem(describeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeading>{t.title}</PageHeading>
      <form id={form.formId} onSubmit={onSubmit} noValidate className="space-y-5">
        {problem && <Alert tone="error">{problem}</Alert>}
        <TextField
          label={t.fullName}
          name="fullName"
          autoComplete="name"
          value={form.values.fullName}
          onChange={(v) => form.set('fullName', v)}
          error={form.errors.fullName}
        />
        <TextField
          label={t.email}
          hint={t.emailHint}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={form.values.email}
          onChange={(v) => form.set('email', v)}
          error={form.errors.email}
        />
        <TextField
          label={t.phone}
          hint={t.phoneHint}
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={form.values.phone}
          onChange={(v) => form.set('phone', v)}
          error={form.errors.phone}
        />
        <PasswordField
          label={t.password}
          hint={t.passwordHint}
          name="password"
          autoComplete="new-password"
          value={form.values.password}
          onChange={(v) => form.set('password', v)}
          error={form.errors.password}
        />
        <CheckboxField label={t.acceptTerms} name="acceptTerms" checked={form.values.acceptTerms} onChange={(c) => form.set('acceptTerms', c)} error={form.errors.acceptTerms} />
        <CheckboxField label={t.confirmAge16} name="confirmAge16" checked={form.values.confirmAge16} onChange={(c) => form.set('confirmAge16', c)} error={form.errors.confirmAge16} />
        <Button type="submit" loading={submitting}>
          {t.submit}
        </Button>
      </form>
      <p className="mt-6 text-base">
        {t.haveAccount}{' '}
        <Link to="/login" className="font-semibold text-brand underline">
          {t.signInLink}
        </Link>
      </p>
    </>
  );
}
