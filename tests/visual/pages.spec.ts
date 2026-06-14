import { test, expect } from '@playwright/test';

test.describe('Hjem', () => {
	test('dashboard rendres uten feil', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('hjem.png', { fullPage: true });
	});
});

test.describe('Ukeplan', () => {
	test('ukeplanen rendres', async ({ page }) => {
		await page.goto('/ukeplan');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('ukeplan.png', { fullPage: true });
	});
});

test.describe('Helse-tema', () => {
	test('helsedashboard rendres', async ({ page }) => {
		await page.goto('/tema/helse');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('tema-helse.png', { fullPage: true });
	});
});

test.describe('Ferie-tema', () => {
	test('feriedashboardet rendres', async ({ page }) => {
		await page.goto('/tema/Sommerferie 2026');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('tema-ferie.png', { fullPage: true });
	});
});

test.describe('Bøker-tema', () => {
	test('bokbiblioteket rendres', async ({ page }) => {
		await page.goto('/tema/bøker');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('tema-boker.png', { fullPage: true });
	});
});

test.describe('Økonomi-tema', () => {
	test('økonomidashboard rendres', async ({ page }) => {
		await page.goto('/tema/økonomi');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('tema-okonomi.png', { fullPage: true });
	});
});

// Per-seksjon-screenshots: lokaliserte diffs + ingen terskel-maskering på lang side.
// Holdes i synk med sections-listene i src/routes/design/+page.svelte (komponenter)
// og src/routes/design/flater/+page.svelte (komposisjoner). Filnavnet er design-<id>
// uavhengig av rute, så en seksjon kan flytte rute uten å bytte baseline.
const komponentSections = [
	'prinsipper',
	'typografi',
	'blokktyper',
	'oppgaverader',
	'layout',
	'knapper',
	'ikoner',
	'ringer',
	'dashboardkort',
	'utvidbare-kort',
	'chat',
	'skjema',
	'navigasjon',
	'sheets',
	'modaler',
	'lab'
];

const flateSections = ['ukeplan', 'kavalkade', 'hjem', 'boker', 'reise'];

test.describe('Design-system', () => {
	test('komponent-seksjoner rendres', async ({ page }) => {
		await page.goto('/design');
		await page.waitForLoadState('networkidle');
		for (const id of komponentSections) {
			await expect.soft(page.locator(`#${id}`)).toHaveScreenshot(`design-${id}.png`);
		}
	});

	test('flate-seksjoner rendres', async ({ page }) => {
		await page.goto('/design/flater');
		await page.waitForLoadState('networkidle');
		for (const id of flateSections) {
			await expect.soft(page.locator(`#${id}`)).toHaveScreenshot(`design-${id}.png`);
		}
	});
});
