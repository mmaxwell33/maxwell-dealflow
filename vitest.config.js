// Vitest config — runs only ./tests/unit/*.test.js.
// Playwright tests live under ./tests/e2e/ and are run separately
// via `npm run test:e2e`.
export default {
  test: {
    include: ['tests/unit/**/*.test.js'],
    globals: false,
    environment: 'node',
  },
};
