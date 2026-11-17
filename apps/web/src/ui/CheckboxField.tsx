import { useId } from 'react';

export function CheckboxField({
  label,
  name,
  checked,
  onChange,
  error,
}: {
  label: string;
  name: string;
  checked: boolean;
  onChange(checked: boolean): void;
  error?: string;
}) {
  const auto = useId();
  const id = `${auto}-${name}`;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="space-y-1">
      <div className="flex min-h-11 items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="mt-1 size-6 shrink-0 accent-brand"
        />
        <label htmlFor={id} className="pt-1 text-base">
          {label}
        </label>
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
