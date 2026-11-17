import { useId, type SelectHTMLAttributes } from 'react';

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'name'> {
  label: string;
  name: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
  placeholder: string; // the first, empty option
  error?: string;
  hint?: string;
}

/** A native select: the phone shows its own accessible picker. Wired to its label, hint and error like TextField (USA-2, USA-3). */
export function SelectField({ label, name, value, onChange, options, placeholder, error, hint, id, ...rest }: SelectFieldProps) {
  const auto = useId();
  const selectId = id ?? `${auto}-${name}`;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={selectId} className="block text-sm font-bold text-[#30485b]">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <select
        {...rest}
        id={selectId}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className="av-field min-h-11 text-base text-ink aria-invalid:border-2 aria-invalid:border-danger"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="flex gap-2 text-sm font-medium text-danger">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
