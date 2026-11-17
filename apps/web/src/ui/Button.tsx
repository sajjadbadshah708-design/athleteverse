import type { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}

/** At least 44 px tall (USA-2). While loading it is disabled so a double tap cannot send the form twice. */
export function Button({ loading, variant = 'primary', className = '', disabled, children, ...rest }: Props) {
  const look =
    variant === 'primary'
      ? 'bg-brand text-brand-ink hover:bg-brand-dark border-transparent shadow-[0_6px_14px_-8px_#0c5966]'
      : 'bg-paper text-brand border-[#b1cacf] hover:bg-info-soft';
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-bold transition-all duration-150 hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:w-auto ${look} ${className}`}
    >
      {children}
    </button>
  );
}
