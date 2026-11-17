import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/prisma/migrations/**', '**/.vite/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // All "what time is it" goes through the injected Clock so tests can control time (cancellation windows, auto-close).
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/lib/clock.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'Use the injected Clock: deps.clock.now()' },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: 'Use the injected Clock: deps.clock.now()' },
      ],
    },
  },
  {
    // The web app runs in a browser and uses React: hooks must follow the rules of hooks (SRS MNT-1 lint on every push).
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
