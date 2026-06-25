import { describe, it, expect } from 'vitest';
import { materialDisplayName, presetKey, derivePresets } from './catalog';
import type { Material } from './calc';

function sheet(partial: Partial<Material>): Material {
	return { id: 'x', name: '', kind: 'sheet', cuts: [], ...partial };
}
function linear(partial: Partial<Material>): Material {
	return { id: 'x', name: '', kind: 'linear', cuts: [], ...partial };
}

describe('materialDisplayName', () => {
	it('bygger platenavn fra tykkelse + tresort + behandling', () => {
		expect(
			materialDisplayName({ kind: 'sheet', thicknessMm: 15, woodType: 'Kryssfiner poppel', treatment: 'Ubehandlet' })
		).toBe('15 mm kryssfiner poppel');
	});

	it('utelater "Ubehandlet" men tar med ekte behandling', () => {
		expect(materialDisplayName({ kind: 'linear', thicknessMm: 48, crossWidthMm: 48, woodType: 'Furu', treatment: 'Trykkimpregnert' })).toBe(
			'48×48 furu trykkimpregnert'
		);
	});

	it('takler manglende mål', () => {
		expect(materialDisplayName({ kind: 'sheet', woodType: 'Gips' })).toBe('gips');
		expect(materialDisplayName({ kind: 'linear' })).toBe('');
	});
});

describe('presetKey', () => {
	it('skiller materialer på type, navn, behandling og mål', () => {
		const a = sheet({ name: '15mm kryss', thicknessMm: 15, stockWidthMm: 2440, stockHeightMm: 1220 });
		const b = sheet({ name: '15mm kryss', thicknessMm: 18, stockWidthMm: 2440, stockHeightMm: 1220 });
		expect(presetKey(a)).not.toBe(presetKey(b));
	});
	it('gir lik nøkkel for like materialer', () => {
		const a = linear({ name: '48x48 furu', thicknessMm: 48, crossWidthMm: 48, stockLengthMm: 3900 });
		const b = linear({ name: '48x48 furu', thicknessMm: 48, crossWidthMm: 48, stockLengthMm: 3900 });
		expect(presetKey(a)).toBe(presetKey(b));
	});
});

describe('derivePresets', () => {
	it('dedupliserer like materialer og hopper over navnløse', () => {
		const materials: Material[] = [
			sheet({ name: '15mm kryssfiner', thicknessMm: 15 }),
			sheet({ name: '15mm kryssfiner', thicknessMm: 15 }), // dup
			linear({ name: '', woodType: '' }), // navnløs → hoppes over
			linear({ name: '48x48 furu', thicknessMm: 48, crossWidthMm: 48 })
		];
		const presets = derivePresets(materials);
		expect(presets).toHaveLength(2);
		expect(presets.map((p) => p.name)).toEqual(['15mm kryssfiner', '48x48 furu']);
	});

	it('returnerer presets uten id og uten kapp (mal)', () => {
		const presets = derivePresets([
			sheet({ name: 'plate', thicknessMm: 12, cuts: [{ id: 'c', widthMm: 100, heightMm: 100, quantity: 2 }] })
		]);
		expect(presets[0].id).toBe('');
		expect(presets[0].cuts).toEqual([]);
		expect(presets[0].thicknessMm).toBe(12);
	});

	it('beholder materiale med kun tresort (uten navn)', () => {
		const presets = derivePresets([linear({ name: '', woodType: 'Furu' })]);
		expect(presets).toHaveLength(1);
	});
});
