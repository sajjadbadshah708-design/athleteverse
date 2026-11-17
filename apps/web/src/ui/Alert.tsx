import type { ReactNode } from 'react';

const TONES = {
  error: { box: 'border-danger bg-danger-soft text-danger', role: 'alert', icon: '⚠' },
  info: { box: 'border-brand bg-info-soft text-ink', role: 'status', icon: 'ℹ' },
  warning: { box: 'border-warn bg-warn-soft text-warn', role: 'status', icon: '⚠' },
} as const;

/** Never colour alone (USA-2): every tone also has an icon and a border, and errors are announced to screen readers. */
export function Alert({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <div role={t.role} className={`flex gap-3 rounded-2xl border p-4 shadow-sm text-sm font-medium ${t.box}`}>
      <span aria-hidden="true">{t.icon}</span>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
