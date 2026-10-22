import { defineConfig } from 'vitest/config';

// served from https://chanwunkong.github.io/grid-icon/
export default defineConfig({
  base: '/grid-icon/',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
