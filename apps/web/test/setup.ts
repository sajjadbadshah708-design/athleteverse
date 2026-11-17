import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The whole suite runs files in parallel, and some tests type a hundred characters under fake timers. The default 1 s wait of
// findBy/waitFor was a source of rare timing failures on a busy machine; the test timeout itself (15 s) still bounds a real hang.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => cleanup());
