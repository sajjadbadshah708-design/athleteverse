import { ApiError, formatAmount, STRINGS, type VenueDetail } from '@athleteverse/shared';
import { Link, useParams } from 'react-router';
import { useApiData } from '../api/useApiData';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { AvailabilityGrid } from '../ui/AvailabilityGrid';
import { Button } from '../ui/Button';
import { LoadingScreen } from '../ui/LoadingScreen';
import { PageHeading } from '../ui/PageHeading';
import { Icon } from '../ui/Icon';

const t = STRINGS.venue;

/** FR-2.3: a venue with its courts, prices, hours, the cancellation and credit policy, and the availability grid. Public. */
export function VenuePage() {
  const { id = '' } = useParams();
  const { loaded, retry } = useApiData<VenueDetail>(`/venues/${id}`);
  const missing = loaded.status === 'error' && loaded.error instanceof ApiError && (loaded.error.code === 'NOT_FOUND' || loaded.error.code === 'VALIDATION_ERROR');
  useDocumentTitle(loaded.status === 'ready' ? loaded.data.name : missing ? t.notFoundTitle : STRINGS.venues.title);

  if (loaded.status === 'loading') return <LoadingScreen />;
  if (missing) {
    return (
      <>
        <PageHeading>{t.notFoundTitle}</PageHeading>
        <p className="mb-4">{t.notFoundBody}</p>
        <Link to="/venues" className="font-semibold text-brand underline">
          {t.backToList}
        </Link>
      </>
    );
  }
  if (loaded.status === 'error') {
    return (
      <div className="max-w-md space-y-4">
        <Alert tone="error">{t.loadFailed}</Alert>
        <Button type="button" variant="secondary" onClick={retry}>
          {t.retry}
        </Button>
      </div>
    );
  }

  const venue = loaded.data;
  return <div className="space-y-7">
    <nav aria-label="Breadcrumb" className="text-sm"><Link to="/venues" className="av-link"><Icon name="chevron-left" size={17}/>{t.backToList}</Link></nav>
    <section className="av-feature-hero px-7 py-9 md:px-11 md:py-12">
      <div className="relative z-10 grid gap-8 md:grid-cols-[minmax(0,1fr)_250px] md:items-center">
        <div><p className="av-hero-eyebrow mb-4"><Icon name="pin" size={15} className="mr-2 inline"/> YOUR NEXT PLAYGROUND</p><PageHeading>{venue.name}</PageHeading>
        {venue.description && <p className="av-hero-body mt-3">{venue.description}</p>}
        <div className="mt-7 flex flex-wrap gap-3"><span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white"><Icon name="map" size={17}/>{venue.cityName}</span><span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white"><Icon name="clock" size={17}/>Open daily · {t.hourRange(venue.openHour, venue.closeHour)}</span></div>
        </div>
        <div className="hidden md:block" aria-hidden="true"><div className="relative mx-auto grid h-53 w-53 rotate-[-12deg] place-items-center rounded-[35px] border-3 border-white/25 bg-white/10"><div className="absolute inset-6 rounded-[22px] border-2 border-white/20"/><Icon name="trophy" size={90} className="text-[#dafe80]"/></div></div>
      </div>
    </section>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
      <section className="av-panel" aria-label="Venue details"><span className="av-eyebrow">Location and contact</span><h2 className="av-panel-title mt-2">Everything you need to know</h2>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2"><Row term={t.address} value={`${venue.address}, ${venue.cityName}`}/><Row term={t.phone} value={<a href={`tel:${venue.contactPhone}`} className="av-link !min-h-0">{venue.contactPhone}</a>}/><Row term={t.hours} value={t.hourRange(venue.openHour, venue.closeHour)}/>{venue.peakStartHour !== null && venue.peakEndHour !== null && <Row term={t.peakHours} value={t.hourRange(venue.peakStartHour, venue.peakEndHour)}/>}</dl>
      </section>
      <div className="av-panel bg-[#f4faf7]"><span className="av-action-icon mb-4"><Icon name="shield" size={23}/></span><h2 className="text-xl font-extrabold">Book with confidence</h2><p className="mt-2 text-sm leading-6 text-[#527084]">Select an available time, review the total and confirm instantly. Cash is paid at the venue after your match.</p><a className="av-link mt-4" href="#availability-title">See available slots <Icon name="arrow" size={16}/></a></div>
    </div>
    <section aria-labelledby="courts-title" className="space-y-4"><div className="av-section-header"><div><span className="av-eyebrow">Pick your space</span><h2 id="courts-title" className="av-section-title mt-2">{t.courtsTitle}</h2></div><span className="av-mini-pill"><Icon name="grid" size={14}/>{venue.courts.length} courts</span></div>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{venue.courts.map((court, index) => <li key={court.id} className="av-court-card"><div className={`av-court-art ${index % 2 ? 'av-court-art-blue' : 'av-court-art-cyan'} min-h-28 flex items-end p-4`} aria-hidden="true"><span className="relative z-10 rounded-full bg-[#103b47ce] px-3 py-1 text-xs font-bold text-white">{court.sportName}</span></div><div className="space-y-3 p-5"><h3 className="text-xl font-extrabold">{court.name}</h3><p className="text-sm text-ink-muted">{court.sportName}</p><div className="av-divider"/><p className="text-sm font-bold text-[#135d61]">{t.regularPrice(formatAmount(court.priceRegular))}</p>{court.pricePeak && <p className="text-xs font-semibold text-ink-muted">{t.peakPrice(formatAmount(court.pricePeak))}</p>}</div></li>)}</ul>
    </section>
    <div className="av-panel"><AvailabilityGrid venue={venue}/></div>
    <section aria-labelledby="policy-title" className="av-panel"><div className="mb-5 flex items-center gap-3"><span className="av-action-icon"><Icon name="shield" size={21}/></span><div><span className="av-eyebrow">Before you book</span><h2 id="policy-title" className="av-panel-title !mb-0">{t.policyTitle}</h2></div></div><ul className="grid gap-3 md:grid-cols-2">{t.policy(venue.policy).map(line => <li key={line} className="av-surface-soft flex items-start gap-3 px-4 py-4 text-sm leading-6"><Icon name="check" size={17} className="mt-1 shrink-0 text-brand"/>{line}</li>)}</ul></section>
  </div>;
}

function Row({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[#e1eaed] bg-[#f9fbfc] p-4">
      <dt className="text-xs font-extrabold uppercase tracking-[.08em] text-[#637b8c]">{term}:</dt>
      <dd className="min-w-0 break-words font-semibold text-[#193a4b]">{value}</dd>
    </div>
  );
}
