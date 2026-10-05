import { describe, it, expect } from 'vitest';
import {
	captureDisplayText,
	captureItemKind,
	CAPTURE_INSTRUCTION,
	fitCaptureItems,
	MAX_CAPTURE_ITEMS,
	pickCaptureAttachments,
	captureImageUrls,
	showFloatingCapture
} from './capture';

describe('captureItemKind', () => {
	it('kjenner igjen bilder på type og på filnavn — iOS sender HEIC uten type av og til', () => {
		expect(captureItemKind({ type: 'image/png', name: 'a.png' })).toBe('image');
		expect(captureItemKind({ type: '', name: 'IMG_0001.HEIC' })).toBe('image');
		expect(captureItemKind({ type: 'application/pdf', name: 'billett.pdf' })).toBe('document');
		expect(captureItemKind({ type: 'video/mp4', name: 'tur.mp4' })).toBe('video');
		expect(captureItemKind({ type: 'application/zip', name: 'x.zip' })).toBe('other');
	});
});

describe('fitCaptureItems', () => {
	it('tar imot opp til taket og teller resten, i stedet for å kappe stille', () => {
		expect(fitCaptureItems(4, ['a', 'b', 'c', 'd'])).toEqual({ accepted: ['a', 'b'], rejected: 2 });
		expect(fitCaptureItems(MAX_CAPTURE_ITEMS, ['a'])).toEqual({ accepted: [], rejected: 1 });
		expect(fitCaptureItems(0, ['a'])).toEqual({ accepted: ['a'], rejected: 0 });
	});
});

describe('captureDisplayText', () => {
	it('bruker brukerens egen tekst når den finnes', () => {
		expect(captureDisplayText('  Sprang meg en tur ', ['image', 'image'])).toBe('Sprang meg en tur');
	});

	it('sier hva som ble lagt inn når teksten mangler', () => {
		expect(captureDisplayText('', ['image'])).toBe('📷 Bilde');
		expect(captureDisplayText('', ['image', 'image', 'image'])).toBe('📷 3 bilder');
		expect(captureDisplayText('', ['image', 'document'])).toBe('📷 Bilde · 📄 Fil');
	});
});

describe('CAPTURE_INSTRUCTION', () => {
	it('ber om ETT spørsmål framfor en gjettet registrering, og har ingen backticks', () => {
		expect(CAPTURE_INSTRUCTION).toContain('ETT spørsmål');
		expect(CAPTURE_INSTRUCTION).toContain('registrer det én gang');
		expect(CAPTURE_INSTRUCTION).not.toContain('`');
	});
});

describe('showFloatingCapture', () => {
	it('vises på sider uten eget chatfelt', () => {
		for (const path of ['/ukeplan', '/helse/sykdom/abc', '/arrangementer', '/settings/sources', '/plan/mal']) {
			expect(showFloatingCapture(path), path).toBe(true);
		}
	});

	it('vises ikke der et chatfelt alt ligger nederst, eller på hjemskjermen som har sin egen knapp', () => {
		for (const path of ['/', '/samtaler', '/tema/helse', '/aktivitet/123', '/economics/lonnsmaned', '/skriv']) {
			expect(showFloatingCapture(path), path).toBe(false);
		}
	});

	it('vises ikke i galleriet, innloggingen eller på delte lenker', () => {
		for (const path of ['/design', '/design-exploration', '/signin', '/share/abc', '/auth/callback']) {
			expect(showFloatingCapture(path), path).toBe(false);
		}
	});

	it('lar et prefiks bare treffe hele segmenter', () => {
		expect(showFloatingCapture('/skrivebord')).toBe(true);
		expect(showFloatingCapture('/samtalerom')).toBe(true);
	});
});

describe('pickCaptureAttachments', () => {
	type A = { url: string; kind: string };
	const isA = (v: unknown): v is A => !!v && typeof (v as A).url === 'string' && typeof (v as A).kind === 'string';
	const img = (n: number): A => ({ url: `https://res.cloudinary.com/x/${n}.jpg`, kind: 'image' });

	it('slår sammen det ene vedlegget og lista, uten duplikater', () => {
		expect(pickCaptureAttachments(img(1), [img(1), img(2)], isA)).toEqual([img(1), img(2)]);
	});

	it('avviser ugyldige rader og adresser som ikke er http(s)', () => {
		expect(pickCaptureAttachments(null, [{ url: 'javascript:alert(1)', kind: 'image' }, 'tull', img(3)], isA)).toEqual([img(3)]);
	});

	it('kapper ved taket', () => {
		const many = Array.from({ length: MAX_CAPTURE_ITEMS + 3 }, (_, i) => img(i));
		expect(pickCaptureAttachments(null, many, isA)).toHaveLength(MAX_CAPTURE_ITEMS);
	});

	it('tåler at lista mangler', () => {
		expect(pickCaptureAttachments(img(1), undefined, isA)).toEqual([img(1)]);
		expect(pickCaptureAttachments(null, 'tull', isA)).toEqual([]);
	});
});

describe('captureImageUrls', () => {
	it('gir bildene bare når det er flere, siden ett bilde alt står i imageUrl', () => {
		const a = { kind: 'image', url: 'https://x/1.jpg' };
		const b = { kind: 'image', url: 'https://x/2.jpg' };
		const pdf = { kind: 'document', url: 'https://x/a.pdf' };
		expect(captureImageUrls([a, pdf, b])).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
		expect(captureImageUrls([a, pdf])).toBeNull();
		expect(captureImageUrls(undefined)).toBeNull();
		expect(captureImageUrls([null, 'tull'])).toBeNull();
	});
});
