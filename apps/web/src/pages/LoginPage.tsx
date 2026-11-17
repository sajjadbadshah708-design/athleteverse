import { ApiError, ERROR_MESSAGES, loginRequestSchema, STRINGS } from '@athleteverse/shared';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { safeRedirect } from '../auth/guards';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../errors';
import { errorsFromZod, useForm } from '../forms/useForm';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageHeading } from '../ui/PageHeading';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';

const t = STRINGS.auth.login;

/** FR-1.7, FR-1.8. Every failure is explained in plain language, next to the field where possible (USA-3). */
export function LoginPage() {
  useDocumentTitle(t.title);
  const { signIn, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm({ email: '', password: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const parsed = loginRequestSchema.safeParse(form.values);
    if (!parsed.success) {
      form.showErrors(errorsFromZod(parsed.error));
      return;
    }
    setSubmitting(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
      navigate(safeRedirect((location.state as { from?: string } | null)?.from), { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED') {
        navigate(`/verify-email?email=${encodeURIComponent(parsed.data.email)}`, { state: { notice: ERROR_MESSAGES.EMAIL_NOT_VERIFIED } });
        return;
      }
      setProblem(describeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeading>{t.title}</PageHeading>
      <form id={form.formId} onSubmit={onSubmit} noValidate className="space-y-5">
        {notice && <Alert tone="warning">{t.notices[notice]}</Alert>}
        {problem && <Alert tone="error">{problem}</Alert>}
        <TextField
          label={t.email}
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
        <PasswordField
          label={t.password}
          name="password"
          autoComplete="current-password"
          value={form.values.password}
          onChange={(v) => form.set('password', v)}
          error={form.errors.password}
        />
        <Button type="submit" loading={submitting}>
          {t.submit}
        </Button>
      </form>
      <p className="mt-6 text-base">
        {t.noAccount}{' '}
        <Link to="/register" className="font-semibold text-brand underline">
          {t.registerLink}
        </Link>
      </p>
    </>
  );
}
