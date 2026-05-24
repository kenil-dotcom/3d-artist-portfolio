import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest configuration.
 *
 * - `tests/pbt` is the home for property-based tests (run via `npm run test:pbt`).
 * - `tests/unit` is the home for example-based unit tests.
 * - Component tests live next to their components (`*.test.tsx`) and use jsdom.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.{test,spec}.{ts,tsx}',
      'app/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'lib/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', 'dist', 'coverage', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['app/**', 'components/**', 'lib/**'],
      exclude: ['**/*.d.ts', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@': rootDir,
      '@/app': path.join(rootDir, 'app'),
      '@/components': path.join(rootDir, 'components'),
      '@/lib': path.join(rootDir, 'lib'),
      '@/tests': path.join(rootDir, 'tests'),
    },
  },
});
