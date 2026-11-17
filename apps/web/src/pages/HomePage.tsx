import { ROLE_LABEL, STRINGS } from '@athleteverse/shared';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useDocumentTitle } from '../useDocumentTitle';
import { Alert } from '../ui/Alert';
import { Icon, type IconName } from '../ui/Icon';
import { PageHeading } from '../ui/PageHeading';
import { ManagerStatusNotice } from './ManagerStatusNotice';

const t = STRINGS.home;
type Shortcut = { to: string; title: string; description: string; icon: IconName; tag: string };

/** Personalized landing space; all permissions still live in the API. */
export function HomePage() {
  const { state } = useAuth();
  const justSaved = (useLocation().state as { profileSaved?: boolean } | null)?.profileSaved === true;
  const user = state.status === 'authenticated' ? state.user : null;
  useDocumentTitle(user ? STRINGS.nav.home : STRINGS.loading);
  if (!user) return null;

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? user.fullName;
  const playerLinks: Shortcut[] = [
    { to: '/venues', title: 'Explore venues', description: 'Find your next court by sport, location and price.', icon: 'map', tag: 'DISCOVER' },
    { to: '/bookings', title: 'My Bookings', description: 'Keep every match time and booking code close.', icon: 'calendar', tag: 'YOUR SCHEDULE' },
    { to: '/credit', title: 'My Credit History', description: 'See your standing, credit changes and rewards.', icon: 'activity', tag: 'YOUR STANDING' },
    { to: '/profile', title: 'Player profile', description: 'Keep your player details accurate and up to date.', icon: 'user', tag: 'YOUR ACCOUNT' },
  ];
  const managerLinks: Shortcut[] = user.status === 'ACTIVE' ? [
    { to: '/manager', title: 'Venue management', description: 'Configure venues, courts, pricing and your team.', icon: 'building', tag: 'OPERATIONS' },
    { to: '/operations', title: 'Front desk', description: 'Find bookings and record match-day cash outcomes.', icon: 'ticket', tag: 'MATCH DAY' },
  ] : [];
  const staffLinks: Shortcut[] = [{ to: '/operations', title: "Today's front desk", description: 'Open assigned venue bookings and record outcomes.', icon: 'ticket', tag: 'FRONT DESK' }];
  const adminLinks: Shortcut[] = [{ to: '/admin', title: 'Manager approvals', description: 'Review applications and record decisions with reasons.', icon: 'shield', tag: 'PLATFORM' }];
  const shortcuts = user.role === 'PLAYER' ? playerLinks : user.role === 'MANAGER' ? managerLinks : user.role === 'STAFF' ? staffLinks : adminLinks;

  return <div className="space-y-8">
    <section className="av-feature-hero px-7 py-9 md:px-12 md:py-13">
      <div className="relative z-10 flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
        <div className="max-w-2xl">
          <p className="av-hero-eyebrow mb-5 inline-flex items-center gap-2"><Icon name="sparkle" size={16}/> YOUR ATHLETEVERSE WORKSPACE</p>
          <PageHeading>{t.title(user.fullName)}</PageHeading>
          <p className="-mt-1 text-base font-semibold text-[#dafe80]">{t.signedInAs(ROLE_LABEL[user.role])}</p>
          <p className="av-hero-body mt-4">{user.role === 'PLAYER' ? 'Ready for the next match? Find a venue, reserve a court, and keep your game day on track.' : user.role === 'MANAGER' ? 'Everything you need to keep your venue moving, organized in one place.' : user.role === 'STAFF' ? 'Your front-desk workspace for bookings, cash records, and match-day operations.' : 'A clear overview of the decisions that keep the platform safe and running smoothly.'}</p>
          {shortcuts.length > 0 && <Link className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#dafe80] px-5 text-sm font-extrabold text-[#16383a] transition hover:bg-white" to={shortcuts[0]!.to}>{user.role === 'PLAYER' ? t.findCourt : shortcuts[0]!.title}<Icon name="arrow" size={18}/></Link>}
        </div>
        <div className="relative hidden shrink-0 md:block" aria-hidden="true">
          <div className="relative grid h-52 w-52 place-items-center rounded-full border border-white/25 bg-white/8 shadow-[inset_0_0_0_25px_#ffffff06] lg:h-62 lg:w-62"><div className="absolute inset-7 rounded-full border border-dashed border-white/30"/><Icon name={user.role === 'PLAYER' ? 'trophy' : user.role === 'ADMIN' ? 'shield' : 'building'} size={100} className="text-[#dafe80]"/></div>
        </div>
      </div>
    </section>

    {user.role === 'MANAGER' && <ManagerStatusNotice />}
    {user.role !== 'MANAGER' && user.status === 'PENDING_APPROVAL' && <Alert tone="warning">{t.pending}</Alert>}
    {user.role !== 'MANAGER' && user.status === 'REJECTED' && <Alert tone="error">{t.rejected}</Alert>}
    {justSaved && <Alert tone="info">{t.profileSaved}</Alert>}
    {user.role === 'PLAYER' && user.profileComplete === false && <Alert tone="info">{t.profileIncomplete}{' '}<Link to="/profile" className="font-semibold underline">{t.completeProfile}</Link></Alert>}

    <section>
      <div className="av-section-header"><div><span className="av-eyebrow">Quick access</span><h2 className="av-section-title mt-2">Pick up where you left off, {firstName}</h2></div><span className="av-mini-pill"><Icon name="shield" size={15}/> Role-based access</span></div>
      {shortcuts.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {shortcuts.map(item => <Link className="av-action-card group" key={item.to} to={item.to}><div className="flex items-start justify-between"><span className="av-action-icon"><Icon name={item.icon} size={23}/></span><Icon name="arrow-up" size={18} className="text-[#7c98a3] transition group-hover:-translate-y-1 group-hover:translate-x-1"/></div><div><span className="mb-2 block text-[.67rem] font-extrabold tracking-[.11em] text-[#5f798b]">{item.tag}</span><h3 className="text-lg font-extrabold text-[#152e42]">{item.title}</h3><p className="mt-2 text-sm leading-6 text-[#597084]">{item.description}</p></div></Link>)}
      </div> : <div className="av-empty"><div className="av-empty-icon"><Icon name="clock" size={28}/></div><h3 className="font-bold text-ink">Your workspace is pending approval</h3><p className="mt-2 text-sm">Once your manager account is approved, your venue tools will appear here.</p></div>}
    </section>
    <section className="av-surface flex flex-wrap items-center justify-between gap-6 px-7 py-6"><div className="flex max-w-xl items-start gap-4"><div className="av-action-icon shrink-0"><Icon name="info" size={23}/></div><div><h2 className="font-extrabold text-[#173043]">A smoother way to match day</h2><p className="mt-1 text-sm leading-6 text-ink-muted">Your availability, bookings and venue operations stay synced to the same AthleteVerse platform.</p></div></div><Link to="/venues" className="av-link">Browse available venues <Icon name="arrow" size={17}/></Link></section>
  </div>;
}
