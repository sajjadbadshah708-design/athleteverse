import type { SVGProps } from 'react';

export type IconName = 'bolt' | 'arrow' | 'arrow-up' | 'chevron-right' | 'chevron-left' | 'map' | 'pin' | 'calendar' | 'clock' | 'grid' | 'ticket' | 'wallet' | 'users' | 'user' | 'shield' | 'check' | 'search' | 'settings' | 'plus' | 'logout' | 'star' | 'sparkle' | 'building' | 'info' | 'trophy' | 'trend' | 'phone' | 'menu' | 'filter' | 'mail' | 'lock' | 'close' | 'activity' | 'circle-check';

const glyph: Record<IconName, string> = {
  bolt: 'M13 2 3 14h8l-1 8 11-12h-8l1-8Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  'arrow-up': 'M7 17 17 7M7 7h10v10',
  'chevron-right': 'm9 18 6-6-6-6',
  'chevron-left': 'm15 18-6-6 6-6',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15',
  pin: 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Zm-8 0h.01',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  grid: 'M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z',
  ticket: 'M3 7a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4V7Zm9-2v14',
  wallet: 'M3 6h16a2 2 0 0 1 2 2v11H3V6Zm0 0V5a2 2 0 0 1 2-2h13M15 11h6v5h-6a2 2 0 0 1 0-5Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  shield: 'm12 22 0 0C5 19 4 14 4 9V5l8-3 8 3v4c0 5-1 10-8 13Zm-4-11 3 3 5-5',
  check: 'M20 6 9 17l-5-5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 12l-2 1 2 4 2-1 3 2 0 2h6v-2l3-2 2 1 2-4-2-1v-3l2-1-2-4-2 1-3-2V1H9v2L6 5 4 4 2 8l2 1v3Z',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  star: 'm12 2 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1 3-7Z',
  sparkle: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z',
  building: 'M4 21V5l8-3 8 3v16M2 21h20M8 9h1m6 0h1M8 13h1m6 0h1M10 21v-4h4v4',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 9v6m0-10v.01',
  trophy: 'M8 4h8v8a4 4 0 0 1-8 0V4ZM8 6H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 3v5m-5 0h10',
  trend: 'm3 17 7-7 4 4 7-7m-6 0h6v6',
  phone: 'M5 3h4l2 5-3 2a16 16 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  filter: 'M4 6h16M7 12h10m-7 6h4',
  mail: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  lock: 'M5 11h14v10H5V11Zm3 0V7a4 4 0 0 1 8 0v4m-4 4v2',
  close: 'M18 6 6 18M6 6l12 12',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  'circle-check': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-5 10 3 3 6-6',
};

export function Icon({ name, size = 20, ...props }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={glyph[name]} /></svg>;
}
