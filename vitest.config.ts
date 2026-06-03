import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		// $lib/db krever DATABASE_URL ved import (neon-klienten lages lazy, så en
		// dummy-verdi er nok – ingen reell tilkobling skjer i enhetstestene).
		env: {
			DATABASE_URL: 'postgres://test:test@localhost:5432/test',
			OPENAI_API_KEY: 'test-key',
			AUTH_SECRET: 'test-secret'
		}
	},
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			'$env/dynamic/private': fileURLToPath(new URL('./src/test/env-dynamic-private.ts', import.meta.url))
		}
	}
});
