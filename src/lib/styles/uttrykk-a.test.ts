import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Uttrykk A sine variabler er CSS, men to ting ved dem er påstander som kan
 * sjekkes: at de to natt-blokkene er like (CSS kan ikke dele en blokk mellom
 * en media query og en vanlig regel), og at teksten er lesbar mot bakgrunnen
 * i begge fargetemaer.
 */

const css = readFileSync(resolve(__dirname, 'uttrykk-a.css'), 'utf8');

function blockAfter(selectorStart: string): string {
	const at = css.indexOf(selectorStart);
	if (at < 0) throw new Error(`Fant ikke ${selectorStart}`);
	const open = css.indexOf('{', at);
	const close = css.indexOf('}', open);
	return css.slice(open + 1, close);
}

function declarations(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const match of block.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
		out[match[1]] = match[2].trim();
	}
	return out;
}

const krem = declarations(blockAfter("[data-uttrykk='a'] {"));
const nattValgt = declarations(blockAfter("html[data-fargetema='mork'] [data-uttrykk='a']"));
const nattSystem = declarations(
	blockAfter("html:not([data-fargetema='lys']):not([data-fargetema='mork']) [data-uttrykk='a']")
);
const natt = { ...krem, ...nattValgt };

function resolveColor(tokens: Record<string, string>, name: string): string {
	let value = tokens[name];
	for (let i = 0; i < 5 && value?.startsWith('var('); i++) {
		value = tokens[value.slice(4, -1).trim()];
	}
	if (!value || !value.startsWith('#')) throw new Error(`${name} er ikke en hex-farge: ${value}`);
	return value;
}

function luminance(hex: string): number {
	const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(full.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('uttrykk A', () => {
	it('natt valgt og natt fulgt etter telefonen er samme palett', () => {
		expect(nattSystem).toEqual(nattValgt);
	});

	it('natt overstyrer bare variabler krem også har', () => {
		for (const name of Object.keys(nattValgt)) expect(krem, name).toHaveProperty(name);
	});

	for (const [navn, tokens] of [
		['krem', krem],
		['natt', natt]
	] as const) {
		describe(navn, () => {
			const bakgrunner = ['--bg-primary', '--bg-card'];

			it('brødtekst og sekundærtekst holder 4,5:1 mot bakgrunn og kort', () => {
				for (const tekst of ['--text-primary', '--text-secondary', '--text-tertiary', '--accent-primary']) {
					for (const bg of bakgrunner) {
						const ratio = contrast(resolveColor(tokens, tekst), resolveColor(tokens, bg));
						expect(ratio, `${tekst} mot ${bg}`).toBeGreaterThanOrEqual(4.5);
					}
				}
			});

			it('dempet tekst holder 3:1, som stor eller ikke-vesentlig tekst', () => {
				for (const bg of bakgrunner) {
					const ratio = contrast(resolveColor(tokens, '--text-muted'), resolveColor(tokens, bg));
					expect(ratio, `--text-muted mot ${bg}`).toBeGreaterThanOrEqual(3);
				}
			});

			it('tekst oppå accent er lesbar', () => {
				const ratio = contrast(resolveColor(tokens, '--accent-contrast'), resolveColor(tokens, '--accent-primary'));
				expect(ratio).toBeGreaterThanOrEqual(4.5);
			});

			it('statusfargene er lesbare mot bakgrunnen', () => {
				for (const status of ['--success-text', '--warning-text', '--error-text']) {
					const ratio = contrast(resolveColor(tokens, status), resolveColor(tokens, '--bg-primary'));
					expect(ratio, status).toBeGreaterThanOrEqual(4.5);
				}
			});
		});
	}
});
