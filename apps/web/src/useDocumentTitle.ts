import { STRINGS } from '@athleteverse/shared';
import { useEffect } from 'react';

/** Every screen gets its own tab title (WCAG 2.4.2). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${STRINGS.app.name}`;
  }, [title]);
}
