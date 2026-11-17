import { STRINGS } from '@athleteverse/shared';
import { useState } from 'react';
import { TextField, type TextFieldProps } from './TextField';

/** A password input with a show/hide button, so people can check what they typed on a small phone keyboard. */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="min-h-11 min-w-11 rounded-md px-2 text-sm font-semibold text-brand underline"
        >
          {visible ? STRINGS.auth.password.hide : STRINGS.auth.password.show}
        </button>
      }
    />
  );
}
