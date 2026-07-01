// jest.config.js
// Lightweight unit-test setup for the PURE logic (ranking, distance, stats
// merge, spot-of-the-day, display helpers). These functions import only types,
// so we use ts-jest in a plain node env — no React Native / Expo runtime needed,
// which keeps the suite fast and decoupled from native mocks.
//
// Run: npm test   ·   watch: npm run test:watch

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
  clearMocks: true,
};
