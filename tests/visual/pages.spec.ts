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

// Helse-undertemaene. /tema/[id] slår opp på navn når segmentet ikke er en
// UUID, og kapitaliserer første bokstav — så små bokstaver i URL-en virker.
// Forutsetter at `npm run db:sync` har provisjonert temaene for testbrukeren.
test.describe('Helse-undertemaene', () => {
	const subthemes = [
		{ url: '/tema/trening', file: 'tema-trening.png' },
		{ url: '/tema/ernæring', file: 'tema-ernaring.png' },
		{ url: '/tema/egenfrekvens', file: 'tema-egenfrekvens.png' },
		{ url: '/tema/søvn', file: 'tema-sovn.png' },
		{ url: '/tema/skjermtid', file: 'tema-skjermtid.png' }
	];

	for (const { url, file } of subthemes) {
		test(`${url} rendres`, async ({ page }) => {
			await page.goto(url);
			await page.waitForLoadState('networkidle');
			await expect(page).toHaveScreenshot(file, { fullPage: true });
		});
	}
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
	'kalender',
	'livskompasset',
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

/**
 * Bottom sheets, åpnet på ekte.
 *
 * Ingen test har åpnet et ark før nå, og det er derfor
 * `ThemeMetricSettingsSheet` kunne kaste på første render uten at noe ble rødt:
 * `fields` ble bare fylt i en `$effect`, så `bind:value={f.goal}` traff
 * `undefined` i det `{#if open}` rendret. Hele flaten så frisk ut i suiten.
 *
 * `toBeVisible()` er derfor den viktigste linja her — viktigere enn
 * skjermbildet. Den ville fanget nettopp den buggen.
 */
test.describe('Bottom sheets', () => {
	test('metrikk-innstillinger åpner og rendrer', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		await page.goto('/tema/helse');
		await page.waitForLoadState('networkidle');

		await page.getByRole('button', { name: 'Terskelverdier' }).click();

		const sheet = page.getByRole('dialog', { name: 'Metrikk-innstillinger' });
		await expect(sheet).toBeVisible();
		// Feltene skal finnes ved første render, ikke først etter en effekt.
		await expect(sheet.locator('input').first()).toBeVisible();
		expect(errors, `konsollfeil ved åpning av arket: ${errors.join(' | ')}`).toHaveLength(0);

		await expect(sheet).toHaveScreenshot('sheet-metrikk-innstillinger.png');
	});
});
