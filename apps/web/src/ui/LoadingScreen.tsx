import { STRINGS } from '@athleteverse/shared';

export function LoadingScreen() {
  return <div role="status" className="av-panel flex items-center gap-4 py-9"><span className="h-9 w-9 shrink-0 animate-spin rounded-full border-[3px] border-[#d8e7e8] border-t-brand" aria-hidden="true"/><div><p className="font-bold text-ink">{STRINGS.loading}</p><p className="text-xs text-ink-muted">Getting everything ready for you…</p></div></div>;
}
