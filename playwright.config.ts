import { defineConfig } from '@playwright/test';

// Fixture credentials live in .env locally and in secrets on CI. Loading here
// keeps `npm run test:e2e` working without a shell wrapper; suites that need
// credentials skip loudly when they are absent.
try {
	process.loadEnvFile('.env');
} catch {
	// No .env: the two-user suite reports the missing variables and skips.
}

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',

	// Deterministic ordering and no silent retries: a flaky parity test is a
	// finding, not something to paper over.
	fullyParallel: false,
	retries: 0,
	forbidOnly: !!process.env.CI,

	reporter: process.env.CI ? [['github'], ['list']] : [['list']],

	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure'
	},

	// Tests run against the *production* server, not `vite preview`.
	//
	// This is not interchangeable. `vite preview` serves static files without
	// ETag or Last-Modified, so every conditional-request assertion silently
	// passes as a 200 and the caching contract in the parity baseline would go
	// untested. adapter-node's own server sets both and answers 304, which is
	// what Render actually runs. Steps 11, 12, 26 and 28 all depend on testing
	// the real thing.
	webServer: {
		command: 'npm run build && node build/index.js',
		port: 4173,
		env: { PORT: '4173' },
		reuseExistingServer: !process.env.CI
	}
});
