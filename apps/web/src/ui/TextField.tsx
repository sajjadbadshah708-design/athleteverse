import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'name'> {
  label: string;
  name: string;
  value: string;
  onChange(value: string): void;
  error?: string;
  hint?: string;
  trailing?: ReactNode; // for example the show/hide button of a password field
}

/** A label, an optional hint, the input and its error, wired together for screen readers (USA-2, USA-3). */
export function TextField({ label, name, value, onChange, error, hint, trailing, id, className = '', ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? `${auto}-${name}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-bold text-[#30485b]">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <div className="relative">
        <input
          {...rest}
          id={inputId}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          className={`av-field min-h-11 text-base text-ink aria-invalid:border-2 aria-invalid:border-danger ${trailing ? 'pr-28' : ''} ${className}`}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error && (
        <p id={errorId} className="flex gap-2 text-sm font-medium text-danger">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
