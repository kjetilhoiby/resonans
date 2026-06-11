import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/visual',
	outputDir: 'tests/visual/test-results',
	snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
	timeout: 60_000,
	expect: {
		toHaveScreenshot: {
			maxDiffPixelRatio: 0.002,
		},
	},
	use: {
		baseURL: 'http://localhost:5174',
		extraHTTPHeaders: {
			'x-resonans-user-id': '8e8b4aae-14f4-4e79-8fc3-ec5f37b0579d',
		},
	},
	webServer: {
		command: 'npm run dev',
		// Readiness-sjekk mot /design (public path) — rot-siden krever DB og gir 500 i miljøer uten
		url: 'http://localhost:5174/design',
		reuseExistingServer: true,
		timeout: 30_000,
	},
	projects: [
		{
			name: 'mobile',
			use: { viewport: { width: 390, height: 844 } },
		},
	],
});
