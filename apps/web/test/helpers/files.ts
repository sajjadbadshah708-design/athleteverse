import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// jsdom replaces the global URL class, and Node's fs does not accept it, so paths are built from the plain string.
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Reads a file of apps/web (for example "index.html" or "src/index.css"). */
export const readWebFile = (relativePath: string): string => readFileSync(resolve(webRoot, relativePath), 'utf8');
