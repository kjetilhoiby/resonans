import { describe, it, expect } from 'vitest';
import { parsePctBox, pctBoxToPixelCrop } from './book-cover-crop';

describe('parsePctBox', () => {
	it('godtar en gyldig boks', () => {
		expect(parsePctBox({ x: 15, y: 18, w: 70, h: 32 })).toEqual({ x: 15, y: 18, w: 70, h: 32 });
	});

	it('avviser null, strenger og manglende felter', () => {
		expect(parsePctBox(null)).toBeNull();
		expect(parsePctBox('boks')).toBeNull();
		expect(parsePctBox({ x: 10, y: 10, w: 50 })).toBeNull();
		expect(parsePctBox({ x: '10', y: 10, w: 50, h: 50 })).toBeNull();
	});

	it('avviser verdier utenfor 0–100', () => {
		expect(parsePctBox({ x: -5, y: 10, w: 50, h: 50 })).toBeNull();
		expect(parsePctBox({ x: 10, y: 10, w: 0, h: 50 })).toBeNull();
		expect(parsePctBox({ x: 10, y: 10, w: 120, h: 50 })).toBeNull();
	});

	it('avviser boks som stikker utenfor bildet', () => {
		expect(parsePctBox({ x: 60, y: 10, w: 50, h: 50 })).toBeNull();
	});

	it('tolererer liten avrundingsslingring ved kanten', () => {
		expect(parsePctBox({ x: 50, y: 50, w: 50.3, h: 50.3 })).not.toBeNull();
	});
});

describe('pctBoxToPixelCrop', () => {
	// Typisk Fabel-skjermbilde: 1170×2532, omslag midt på skjermen
	const W = 1170;
	const H = 2532;

	it('konverterer prosent til piksler med margin', () => {
		const crop = pctBoxToPixelCrop({ x: 15, y: 18, w: 70, h: 32 }, W, H, 2);
		expect(crop).toEqual({
			x: Math.round(((15 - 2) / 100) * W),
			y: Math.round(((18 - 2) / 100) * H),
			width: Math.round(((70 + 4) / 100) * W),
			height: Math.round(((32 + 4) / 100) * H)
		});
	});

	it('klemmer margin til bildets grenser', () => {
		const crop = pctBoxToPixelCrop({ x: 0, y: 0, w: 100, h: 100 }, W, H, 2);
		expect(crop).toEqual({ x: 0, y: 0, width: W, height: H });
	});

	it('avviser usannsynlig små bokser', () => {
		expect(pctBoxToPixelCrop({ x: 40, y: 40, w: 10, h: 5 }, W, H)).toBeNull();
	});

	it('avviser ugyldige bildedimensjoner', () => {
		expect(pctBoxToPixelCrop({ x: 10, y: 10, w: 50, h: 50 }, 0, H)).toBeNull();
		expect(pctBoxToPixelCrop({ x: 10, y: 10, w: 50, h: 50 }, W, NaN)).toBeNull();
	});

	it('hele bildet som omslag gir full crop', () => {
		const crop = pctBoxToPixelCrop({ x: 0, y: 0, w: 100, h: 100 }, 800, 1200);
		expect(crop).toEqual({ x: 0, y: 0, width: 800, height: 1200 });
	});
});
