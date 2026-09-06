import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['src/__tests__/e2e/**', 'node_modules/**', 'build/**', '.claude/worktrees/**'],
    restoreMocks: true,
  },
});
