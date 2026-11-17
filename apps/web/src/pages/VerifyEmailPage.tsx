import { ApiError, emailSchema, otpCodeSchema, STRINGS } from '@athleteverse/shared';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../errors';
import { useCooldown } from '../forms/useCooldown';
import { errorsFromZod, useForm } from '../forms/useForm';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PageHeading } from '../ui/PageHeading';
import { TextField } from '../ui/TextField';

const t = STRINGS.auth.verify;
const RESEND_AFTER_SECONDS = 60; // FR-1.3
const schema = z.object({ email: emailSchema, code: otpCodeSchema });

/** FR-1.3: 6-digit code, 5 attempts, a new code at most once a minute. Success signs the player in. */
export function VerifyEmailPage() {
  useDocumentTitle(t.title);
  const { verifyEmail, resendCode } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const arrival = useLocation().state as { notice?: string; fresh?: boolean } | null;
  const emailFromLink = params.get('email') ?? '';

  const form = useForm({ email: emailFromLink, code: '' });
  const cooldown = useCooldown(arrival?.fresh ? RESEND_AFTER_SECONDS : 0); // right after registering a code was just sent
  const [problem, setProblem] = useState<string | null>(arrival?.notice ?? null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    setInfo(null);
    const parsed = schema.safeParse(form.values);
    if (!parsed.success) {
      form.showErrors(errorsFromZod(parsed.error));
      return;
    }
    setSubmitting(true);
    try {
      await verifyEmail(parsed.data.email, parsed.data.code);
      navigate('/home', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'OTP_INVALID') {
        const left = (error.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
        form.showErrors({ code: typeof left === 'number' ? t.attemptsLeft(left) : describeError(error) });
      } else {
        setProblem(describeError(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    setProblem(null);
    const email = emailSchema.safeParse(form.values.email);
    if (!email.success) {
      form.showErrors(errorsFromZod(z.object({ email: emailSchema }).safeParse(form.values).error!));
      return;
    }
    setResending(true);
    try {
      await resendCode(email.data);
      setInfo(t.resent);
      cooldown.restart(RESEND_AFTER_SECONDS);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <PageHeading>{t.title}</PageHeading>
      {emailFromLink && <p className="mb-5 text-base">{t.intro(emailFromLink)}</p>}
      <form id={form.formId} onSubmit={onSubmit} noValidate className="space-y-5">
        {problem && <Alert tone="error">{problem}</Alert>}
        {info && <Alert tone="info">{info}</Alert>}
        {!emailFromLink && (
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
        )}
        <TextField
          label={t.code}
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={form.values.code}
          onChange={(v) => form.set('code', v.replace(/\D/g, ''))}
          error={form.errors.code}
          className="text-center text-xl tracking-widest"
        />
        <Button type="submit" loading={submitting}>
          {t.submit}
        </Button>
      </form>

      <div className="mt-6 space-y-2">
        <Button type="button" variant="secondary" onClick={onResend} loading={resending} disabled={cooldown.seconds > 0}>
          {t.resend}
        </Button>
        {cooldown.seconds > 0 && (
          <p role="status" className="text-sm text-ink-muted">
            {t.resendIn(cooldown.seconds)}
          </p>
        )}
      </div>
      <p className="mt-6 text-base">
        <Link to="/register" className="font-semibold text-brand underline">
          {t.wrongPlace}
        </Link>
      </p>
    </>
  );
}
