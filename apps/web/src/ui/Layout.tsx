import { STRINGS } from '@athleteverse/shared';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Icon, type IconName } from './Icon';
import { StartingUpBanner } from './StartingUpBanner';

type NavItem = { to: string; label: string; icon: IconName };

/** Responsive shared shell. Navigation affects presentation only; API enforces all permissions. */
export function Layout() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const user = state.status === 'authenticated' ? state.user : null;
  const nav: NavItem[] = [{ to: '/venues', label: STRINGS.nav.venues, icon: 'map' }];
  if (user) {
    nav.unshift({ to: '/home', label: STRINGS.nav.home, icon: 'grid' });
    if (user.role === 'PLAYER') nav.push(
      { to: '/bookings', label: 'My Bookings', icon: 'calendar' },
      { to: '/credit', label: 'Credit', icon: 'activity' },
      { to: '/profile', label: STRINGS.nav.profile, icon: 'user' },
    );
    if (user.role === 'MANAGER' && user.status === 'ACTIVE') nav.push(
      { to: '/manager', label: 'Manage', icon: 'settings' },
      { to: '/operations', label: 'Front desk', icon: 'ticket' },
    );
    if (user.role === 'STAFF') nav.push({ to: '/operations', label: 'Front desk', icon: 'ticket' });
    if (user.role === 'ADMIN') nav.push({ to: '/admin', label: 'Approvals', icon: 'shield' });
  }
  return <div className="av-shell flex min-h-dvh flex-col">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:shadow-xl">{STRINGS.nav.skip}</a>
    <header className="av-header">
      <div className="av-header-inner">
        <Link to={user ? '/home' : '/venues'} className="flex min-h-11 items-center gap-3 no-underline" aria-label={`${STRINGS.app.name} home`}>
          <span className="av-mark"><Icon name="bolt" size={25}/></span>
          <span className="av-wordmark">Athlete<span>Verse.</span></span>
        </Link>
        {/* Below 760 px the nav takes its own full-width row (index.css); basis-full is needed because flex-1 sets a 0 basis. */}
        <nav aria-label={STRINGS.nav.main} className="av-nav-scroll flex flex-1 items-center gap-1 max-[760px]:basis-full md:ml-5">
          {nav.map(item => <NavLink end={item.to !== '/venues'} key={item.to} to={item.to} className="av-navlink min-h-11"><Icon name={item.icon} size={17}/>{item.label}</NavLink>)}
        </nav>
        {user ? <div className="av-userchip">
          <div className="av-avatar" aria-hidden="true">{user.fullName.trim().slice(0, 1).toUpperCase()}</div>
          <div className="hidden min-w-0 xl:block">
            <p className="max-w-40 truncate text-sm font-bold leading-tight">{user.fullName}</p>
            <p className="text-xs font-medium text-ink-muted">{user.role === 'ADMIN' ? 'Platform admin' : user.role === 'MANAGER' ? 'Arena manager' : user.role === 'STAFF' ? 'Venue staff' : 'Player'}</p>
          </div>
          <button type="button" className="av-navlink min-h-11 !px-2" title={STRINGS.nav.signOut} onClick={() => { void signOut().then(() => navigate('/login', { replace: true })); }}><Icon name="logout" size={19}/><span className="sr-only">{STRINGS.nav.signOut}</span></button>
        </div> : <div className="flex items-center gap-1 sm:gap-2">
          <Link to="/admin-login" className="av-navlink min-h-11 hidden lg:inline-flex">Admin sign in</Link>
          <Link to="/login" className="av-navlink min-h-11">{STRINGS.nav.signIn}</Link>
          <Link to="/register" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-dark">{STRINGS.nav.register}<Icon name="arrow" size={16}/></Link>
        </div>}
      </div>
    </header>
    <StartingUpBanner />
    <main id="main" tabIndex={-1} className="av-page flex-1 outline-none"><Outlet /></main>
    <footer className="av-footer"><div className="av-footer-inner"><span className="inline-flex items-center gap-2"><span className="av-mark !h-7 !w-7 !rounded-lg"><Icon name="bolt" size={15}/></span><strong>AthleteVerse</strong><span className="hidden sm:inline">· Your game, made simple.</span></span><span>Discover. Book. Play. &nbsp;·&nbsp; Built for your next match</span></div></footer>
  </div>;
}
