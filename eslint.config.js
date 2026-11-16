import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  { files: ['**/*.js'], languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } } },
];
