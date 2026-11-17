import { dateOfBirthProblem, PROFILE_MESSAGES, profileRequestSchema, STRINGS, type City, type ProfileResponse } from '@athleteverse/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/ApiContext';
import { useAuth } from '../auth/AuthProvider';
import { describeError } from '../errors';
import { errorsFromApi, errorsFromZod, useForm, type FieldErrors } from '../forms/useForm';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { LoadingScreen } from '../ui/LoadingScreen';
import { PageHeading } from '../ui/PageHeading';
import { Icon } from '../ui/Icon';
import { SelectField } from '../ui/SelectField';
import { TextField } from '../ui/TextField';

const t = STRINGS.profile;

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; cities: City[]; profile: ProfileResponse };

/** FR-1.14, FR-1.15: the narrowed profile of M2. The server decides; the checks here only give instant feedback. */
export function ProfilePage() {
  useDocumentTitle(t.title);
  const api = useApi();
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get<{ items: City[] }>('/meta/cities'), api.get<ProfileResponse>('/me/profile')])
      .then(([cities, profile]) => !cancelled && setLoaded({ status: 'ready', cities: cities.items, profile }))
      .catch(() => !cancelled && setLoaded({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  return (
    <>
      <div className="av-section-header"><div><span className="av-eyebrow">Your player identity</span><PageHeading>{t.title}</PageHeading><p className="av-lead">Keep your details current and make it easier to get to your next game.</p></div><span className="av-action-icon !h-14 !w-14"><Icon name="user" size={28}/></span></div>
      {loaded.status === 'loading' && <LoadingScreen />}
      {loaded.status === 'error' && (
        <div className="space-y-4">
          <Alert tone="error">{t.loadFailed}</Alert>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setLoaded({ status: 'loading' });
              setAttempt((a) => a + 1);
            }}
          >
            {t.retry}
          </Button>
        </div>
      )}
      {loaded.status === 'ready' && <ProfileForm cities={loaded.cities} profile={loaded.profile} />}
    </>
  );
}

function ProfileForm({ cities, profile }: { cities: City[]; profile: ProfileResponse }) {
  const api = useApi();
  const navigate = useNavigate();
  const { state, refreshUser } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const form = useForm({ cityId: profile.cityId?.toString() ?? '', area: profile.area ?? '', dateOfBirth: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const today = new Date().toLocaleDateString('en-CA'); // the browser's own day: instant feedback only, the server judges

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    const askForDate = !profile.dateOfBirthProvided; // once saved the date is locked and never shown
    const parsed = profileRequestSchema.safeParse({
      cityId: form.values.cityId === '' ? Number.NaN : Number(form.values.cityId),
      area: form.values.area,
      ...(askForDate && form.values.dateOfBirth ? { dateOfBirth: form.values.dateOfBirth } : {}),
    });
    const errors: FieldErrors = parsed.success ? {} : errorsFromZod(parsed.error);
    if (askForDate && !errors.dateOfBirth) {
      const message = form.values.dateOfBirth ? dateOfBirthProblem(form.values.dateOfBirth, today) : PROFILE_MESSAGES.dateRequired;
      if (message) errors.dateOfBirth = message;
    }
    if (Object.keys(errors).length || !parsed.success) {
      form.showErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await api.patch('/me/profile', parsed.data);
      await refreshUser(); // the home page and the booking gate read profileComplete
      navigate('/home', { state: { profileSaved: true } });
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
      {!profile.complete && <p className="mb-5 text-base">{t.intro}</p>}
      {user && (
        <section aria-labelledby="your-details" className="av-panel mb-6">
          <h2 id="your-details" className="text-base font-bold">
            {t.yourDetails}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">{t.yourDetailsNote}</p>
          <dl className="space-y-1 text-base">
            {[
              [t.name, user.fullName],
              [t.email, user.email],
              [t.phone, user.phone],
            ].map(([term, value]) => (
              <div key={term} className="flex flex-wrap gap-x-2">
                <dt className="font-semibold">{term}:</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <form id={form.formId} onSubmit={onSubmit} noValidate className="av-panel space-y-5">
        {problem && <Alert tone="error">{problem}</Alert>}
        <SelectField
          label={t.city}
          name="cityId"
          placeholder={t.cityPlaceholder}
          options={cities.map((c) => ({ value: String(c.id), label: c.name }))}
          value={form.values.cityId}
          onChange={(v) => form.set('cityId', v)}
          error={form.errors.cityId}
        />
        <TextField
          label={t.area}
          hint={t.areaHint}
          name="area"
          autoComplete="address-level3"
          value={form.values.area}
          onChange={(v) => form.set('area', v)}
          error={form.errors.area}
        />
        {profile.dateOfBirthProvided ? (
          <p className="text-sm text-ink-muted">{t.dateOfBirthSaved}</p>
        ) : (
          <TextField
            label={t.dateOfBirth}
            hint={t.dateOfBirthHint}
            name="dateOfBirth"
            type="date"
            autoComplete="bday"
            max={today}
            value={form.values.dateOfBirth}
            onChange={(v) => form.set('dateOfBirth', v)}
            error={form.errors.dateOfBirth}
          />
        )}
        <Button type="submit" loading={submitting}>
          {t.submit}
        </Button>
      </form>
    </>
  );
}
