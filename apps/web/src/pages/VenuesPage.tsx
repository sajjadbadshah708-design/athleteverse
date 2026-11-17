import { formatAmount, PAGE_SIZE, STRINGS, VENUE_SORTS, type City, type VenueSort, type VenueSummary } from '@athleteverse/shared';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApiData } from '../api/useApiData';
import { useForm, type FieldErrors } from '../forms/useForm';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { LoadingScreen } from '../ui/LoadingScreen';
import { PageHeading } from '../ui/PageHeading';
import { Icon } from '../ui/Icon';
import { SelectField } from '../ui/SelectField';
import { TextField } from '../ui/TextField';

const t = STRINGS.venues;
const FILTER_KEYS = ['q', 'cityId', 'sportId', 'minPrice', 'maxPrice', 'sort', 'page'] as const;
type Sport = { id: number; name: string };
type ListResponse = { items: VenueSummary[]; page: number; pageSize: number; total: number };

const PRICE = /^\d{1,8}(\.\d{1,2})?$/;
const SORT_LABEL: Record<VenueSort, string> = { name: t.sortName, price: t.sortPrice };

/** The URL is the single source of truth for the search, so results can be shared, bookmarked and reached with the Back button. */
function cleanParams(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) out.set(key, value);
  }
  return out;
}

/** FR-2.1, FR-2.2: search venues by name or address, city, sport and price, sorted by name or price. Public: no sign-in needed. */
export function VenuesPage() {
  useDocumentTitle(t.title);
  const [rawParams, setSearchParams] = useSearchParams();
  const params = cleanParams(rawParams);
  const query = params.toString();
  const cities = useApiData<{ items: City[] }>('/meta/cities');
  const sports = useApiData<{ items: Sport[] }>('/meta/sports');
  const results = useApiData<ListResponse>(`/venues${query ? `?${query}` : ''}`);

  const page = Number(params.get('page') ?? 1) || 1;
  const pageLink = (target: number) => {
    const next = new URLSearchParams(params);
    if (target <= 1) next.delete('page');
    else next.set('page', String(target));
    return `?${next.toString()}`;
  };

  return (
    <div className="space-y-8">
      <section className="av-feature-hero px-7 py-9 md:px-11 md:py-12">
        <div className="relative z-10 max-w-2xl">
          <p className="av-hero-eyebrow mb-4 inline-flex items-center gap-2"><Icon name="pin" size={16}/> FIND YOUR NEXT MATCH</p>
          <PageHeading>{t.title}</PageHeading>
          <p className="av-hero-body max-w-lg">{t.intro}</p>
          <div className="mt-7 flex flex-wrap gap-3"><span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white"><Icon name="check" size={15}/> Real court availability</span><span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white"><Icon name="wallet" size={15}/> Pay at the venue</span></div>
        </div>
        <div className="pointer-events-none absolute -bottom-22 -right-9 hidden h-64 w-64 rotate-[-17deg] rounded-3xl border-[12px] border-white/9 lg:block" aria-hidden="true"><div className="absolute inset-[24%] rounded-full border-4 border-white/9"/></div>
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="av-panel lg:sticky lg:top-26">
          <div className="mb-5 flex items-center gap-3"><span className="av-action-icon"><Icon name="filter" size={21}/></span><div><p className="av-eyebrow">Make it yours</p><h2 className="mt-1 text-xl font-extrabold">Filters</h2></div></div>
          <Filters
            key={query}
            initial={params}
            cities={cities.loaded.status === 'ready' ? cities.loaded.data.items : []}
            sports={sports.loaded.status === 'ready' ? sports.loaded.data.items : []}
            onApply={(next) => setSearchParams(next)}
          />
        </aside>
        <section aria-live="polite" className="min-w-0">
          {results.loaded.status === 'loading' && <LoadingScreen />}
          {results.loaded.status === 'error' && <div className="space-y-3"><Alert tone="error">{t.loadFailed}</Alert><Button type="button" variant="secondary" onClick={results.retry}>{t.retry}</Button></div>}
          {results.loaded.status === 'ready' && <Results data={results.loaded.data} page={page} pageLink={pageLink} />}
        </section>
      </div>
    </div>
  );
}

function Filters({
  initial,
  cities,
  sports,
  onApply,
}: {
  initial: URLSearchParams;
  cities: City[];
  sports: Sport[];
  onApply: (params: URLSearchParams) => void;
}) {
  const form = useForm({
    q: initial.get('q') ?? '',
    cityId: initial.get('cityId') ?? '',
    sportId: initial.get('sportId') ?? '',
    minPrice: initial.get('minPrice') ?? '',
    maxPrice: initial.get('maxPrice') ?? '',
    sort: initial.get('sort') ?? 'name',
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const v = form.values;
    const errors: FieldErrors = {};
    for (const key of ['minPrice', 'maxPrice'] as const) {
      if (v[key].trim() && !PRICE.test(v[key].trim())) errors[key] = t.priceInvalid;
    }
    if (!errors.minPrice && !errors.maxPrice && v.minPrice.trim() && v.maxPrice.trim() && Number(v.minPrice) > Number(v.maxPrice)) {
      errors.minPrice = t.priceOrder;
    }
    if (Object.keys(errors).length) {
      form.showErrors(errors);
      return;
    }
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(v)) {
      const trimmed = value.trim();
      if (trimmed && !(key === 'sort' && trimmed === 'name')) next.set(key, trimmed); // the default sort needs no parameter
    }
    onApply(next);
  }

  return (
    <form id={form.formId} onSubmit={onSubmit} noValidate aria-label={t.filters} className="space-y-5">
      <TextField label={t.search} name="q" type="search" autoComplete="off" value={form.values.q} onChange={(x) => form.set('q', x)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField
          label={t.city}
          name="cityId"
          placeholder={t.allCities}
          options={cities.map((c) => ({ value: String(c.id), label: c.name }))}
          value={form.values.cityId}
          onChange={(x) => form.set('cityId', x)}
        />
        <SelectField
          label={t.sport}
          name="sportId"
          placeholder={t.allSports}
          options={sports.map((s) => ({ value: String(s.id), label: s.name }))}
          value={form.values.sportId}
          onChange={(x) => form.set('sportId', x)}
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm text-ink-muted">{t.priceHint}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label={t.minPrice} name="minPrice" inputMode="decimal" value={form.values.minPrice} onChange={(x) => form.set('minPrice', x)} error={form.errors.minPrice} />
          <TextField label={t.maxPrice} name="maxPrice" inputMode="decimal" value={form.values.maxPrice} onChange={(x) => form.set('maxPrice', x)} error={form.errors.maxPrice} />
        </div>
      </div>
      <SelectField
        label={t.sort}
        name="sort"
        placeholder={SORT_LABEL.name}
        options={VENUE_SORTS.filter((s) => s !== 'name').map((s) => ({ value: s, label: SORT_LABEL[s] }))}
        value={form.values.sort === 'name' ? '' : form.values.sort}
        onChange={(x) => form.set('sort', x || 'name')}
      />
      <div className="grid grid-cols-2 gap-3 sm:flex">
        <Button type="submit">{t.apply}</Button>
        <Button type="button" variant="secondary" onClick={() => onApply(new URLSearchParams())}>
          {t.clear}
        </Button>
      </div>
    </form>
  );
}

function Results({ data, page, pageLink }: { data: ListResponse; page: number; pageLink: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const art = ['av-court-art-cyan', 'av-court-art-blue', 'av-court-art-olive'];
  return <>
    <div className="av-section-header mb-6"><div><span className="av-eyebrow">Explore the spaces</span><h2 className="av-section-title mt-2">Courts worth showing up for</h2></div><p role="status" className="av-mini-pill"><Icon name="map" size={15}/>{t.found(data.total)}</p></div>
    {data.total === 0 && <div className="av-empty"><div className="av-empty-icon"><Icon name="search" size={27}/></div><h3 className="font-extrabold text-ink">No matches just yet</h3><p className="mt-2 text-sm">{t.empty}</p></div>}
    <ul className="grid gap-5 md:grid-cols-2">
      {data.items.map((venue, index) => <li key={venue.id} className="av-court-card">
        <div className={`av-court-art ${art[index % art.length]} flex items-end justify-start p-5`} aria-hidden="true"><span className="relative z-10 inline-flex items-center gap-1 rounded-full border border-white/20 bg-[#092d36b0] px-3 py-1.5 text-xs font-bold text-white"><Icon name="building" size={14}/> Sports venue</span></div>
        <div className="space-y-4 p-5">
          <div><h3 className="text-xl font-extrabold leading-snug"><Link to={`/venues/${venue.id}`} className="text-[#19354a] no-underline hover:text-brand hover:underline">{venue.name}</Link></h3><p className="mt-2 flex items-start gap-2 text-sm text-[#587084]"><Icon name="pin" size={16} className="mt-0.5 shrink-0"/>{venue.address}, {venue.cityName}</p></div>
          <div className="flex flex-wrap gap-2">{venue.sports.map(s => <span key={s.name} className="av-mini-pill">{s.name}</span>)}</div>
          <div className="av-divider"/>
          <p className="text-sm font-bold text-[#1b4555]">{t.courts(venue.courtCount)} · {t.from(formatAmount(venue.fromPrice))}</p>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-1.5 text-xs text-ink-muted"><Icon name="clock" size={15}/>{t.hours(venue.openHour, venue.closeHour)}</p><Link to={`/venues/${venue.id}`} className="av-link text-sm">View court <Icon name="arrow" size={16}/></Link></div>
        </div>
      </li>)}
    </ul>
    {pages > 1 && <nav aria-label={t.pageOf(page, pages)} className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#dce7eb] bg-white p-4">
      {page > 1 ? <Link to={pageLink(page - 1)} className="av-link"><Icon name="chevron-left" size={16}/>{t.previous}</Link> : <span/>}
      <span className="text-sm font-bold text-ink-muted">{t.pageOf(page, pages)}</span>
      {page < pages ? <Link to={pageLink(page + 1)} className="av-link">{t.next}<Icon name="chevron-right" size={16}/></Link> : <span/>}
    </nav>}
  </>;
}
