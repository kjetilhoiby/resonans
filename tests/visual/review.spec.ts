import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualReview } from './visual-review';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselineDir = path.join(__dirname, '__screenshots__', 'mobile', 'review');
const changeDescription = process.env.VISUAL_REVIEW_CONTEXT || '';

const PAGES = [
	{ name: 'hjem', url: '/' },
	{ name: 'ukeplan', url: '/ukeplan' },
	{ name: 'tema-helse', url: '/tema/helse' },
	{ name: 'tema-okonomi', url: '/tema/økonomi' },
	{ name: 'design', url: '/design' },
];

for (const { name, url } of PAGES) {
	test(`visuell review: ${name}`, async ({ page }) => {
		await page.goto(url);
		await page.waitForLoadState('networkidle');

		const result = await visualReview(page, name, baselineDir, { changeDescription });

		const icon = result.verdict === 'identisk' ? '✓' :
			result.verdict === 'oppdater' ? '↻' :
			result.verdict === 'ny-baseline' ? '★' :
			result.verdict === 'regresjon' ? '✗' : '?';

		console.log(`[visual-review] ${icon} ${name}: ${result.verdict} (${(result.pixelDiffRatio * 100).toFixed(2)}% diff)`);
		if (result.details) console.log(`  → ${result.details}`);
		if (result.baselineUpdated) console.log(`  → Baseline oppdatert automatisk.`);

		expect(
			result.verdict !== 'regresjon',
			`REGRESJON på ${name}: ${result.details}`
		).toBe(true);
	});
}
