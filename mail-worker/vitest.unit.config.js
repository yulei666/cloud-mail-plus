import { defineConfig } from 'vitest/config';

// Pure-function unit tests that need no Workers runtime.
export default defineConfig({
	resolve: {
		alias: {
			'cloudflare:email': new URL('./test/helpers/mock-cloudflare-email.js', import.meta.url).pathname,
		},
	},
	test: {
		environment: 'node',
		include: [
			'test/unit/**/*.spec.js',
			'test/utils/**/*.test.js',
			'test/template/**/*.test.js',
			'test/service/**/*.test.js',
			'test/init/**/*.test.js',
			'test/agent-config.test.js',
		],
	},
});
