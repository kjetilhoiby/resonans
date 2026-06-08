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

test.describe('Økonomi-tema', () => {
	test('økonomidashboard rendres', async ({ page }) => {
		await page.goto('/tema/økonomi');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('tema-okonomi.png', { fullPage: true });
	});
});

test.describe('Design-system', () => {
	test('UI-primitiver rendres', async ({ page }) => {
		await page.goto('/design');
		await page.waitForLoadState('networkidle');
		await expect(page).toHaveScreenshot('design.png', { fullPage: true });
	});
});
