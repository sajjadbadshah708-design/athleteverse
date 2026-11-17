import { Outlet, useLocation } from 'react-router';
import { Icon } from './Icon';

/** Account pages keep native accessible form behavior, presented in a premium auth frame. */
export function Narrow() {
  const path = useLocation().pathname;
  const accountPage = ['/login', '/register', '/register-manager', '/admin-login', '/accept-invite', '/verify-email'].includes(path);
  if (!accountPage) return <div className="w-full"><Outlet /></div>;
  return <div className="mx-auto max-w-5xl py-3 md:py-9">
    <div className="av-auth-wrap">
      <div className="av-auth-main"><div className="mb-8 inline-flex items-center gap-2 rounded-full bg-[#e8f5f2] px-3 py-1.5 text-xs font-extrabold tracking-wide text-[#125c61]"><Icon name="shield" size={15}/> SECURE ACCESS</div><Outlet /></div>
      <aside className="av-auth-aside" aria-label="About AthleteVerse">
        <div className="relative z-10"><div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#dafe80]"><Icon name="sparkle" size={15}/> AthleteVerse community</div><h2 className="mt-7 max-w-sm text-4xl font-extrabold leading-[1.1] tracking-[-.06em]">Your next great game starts here.</h2><p className="mt-5 max-w-xs text-sm leading-7 text-[#d6e9e8]">One place to find the right court, manage your bookings, and make match day effortless.</p></div>
        <div className="relative z-10 mt-20"><div className="av-auth-number">01<span className="text-[#b4d8d6]">/</span>03</div><p className="mt-3 text-sm font-bold text-white">Discover your court</p><div className="mt-4 flex items-center gap-1.5"><span className="h-1.5 w-9 rounded-full bg-[#dafe80]"/><span className="h-1.5 w-4 rounded-full bg-[#ffffff5a]"/><span className="h-1.5 w-4 rounded-full bg-[#ffffff5a]"/></div><p className="mt-9 border-t border-white/20 pt-5 text-xs text-[#c4d7d9]">Built for players, venues, and the people behind every match.</p></div>
      </aside>
    </div>
  </div>;
}
