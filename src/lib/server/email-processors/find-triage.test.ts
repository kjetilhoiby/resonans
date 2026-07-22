import { describe, it, expect } from 'vitest';
import {
	buildTriageContent,
	parseTriageResult,
	extractHint,
	isWalledMediaUrl
} from './find-triage';
import type { InboundEmailPayload } from './shared';
import type { LinkPreview } from '$lib/server/web/og-tags';

const payload: InboundEmailPayload = {
	UserEmail: 'meg@example.com',
	From: 'meg@example.com',
	Subject: 'Reel',
	TextBody: 'Sjekk https://instagram.com/reel/x — ingredienser i caption',
	Label: 'Resonans/Funn'
};

const preview: LinkPreview = {
	url: 'https://instagram.com/reel/x',
	title: 'Kokk på Instagram: rask tomatsuppe',
	description: '4 tomater, 1 løk, hvitløk, basilikum',
	image: 'https://cdn/x.jpg',
	siteName: 'Instagram'
};

describe('buildTriageContent', () => {
	it('inkluderer emne, lenke-metadata og e-posttekst', () => {
		const content = buildTriageContent(payload, preview);
		expect(content).toContain('Emne: Reel');
		expect(content).toContain('Kilde: Instagram');
		expect(content).toContain('Lenke-tittel: Kokk på Instagram: rask tomatsuppe');
		expect(content).toContain('Lenke-beskrivelse: 4 tomater');
		expect(content).toContain('E-posttekst:');
	});

	it('takler manglende preview', () => {
		const content = buildTriageContent(payload, null);
		expect(content).toContain('Emne: Reel');
		expect(content).not.toContain('Kilde:');
	});

	it('løfter hintet øverst når det er satt', () => {
		const content = buildTriageContent(payload, preview, 'underskap til seng');
		expect(content).toContain('BRUKERENS HINT (vekt tungt): underskap til seng');
	});
});

describe('extractHint', () => {
	it('plukker ut «Hint: …» fra e-postteksten', () => {
		expect(extractHint({ ...payload, TextBody: 'https://x\nHint: trearbeid' })).toBe('trearbeid');
	});

	it('takler «Hint - …» og store bokstaver', () => {
		expect(extractHint({ ...payload, TextBody: 'HINT - underskap til seng' })).toBe(
			'underskap til seng'
		);
	});

	it('returnerer null uten hint-linje', () => {
		expect(extractHint({ ...payload, TextBody: 'bare en lenke https://x' })).toBeNull();
	});
});

describe('isWalledMediaUrl', () => {
	it('kjenner igjen IG/YT-lenker', () => {
		expect(isWalledMediaUrl('https://www.instagram.com/reel/x')).toBe(true);
		expect(isWalledMediaUrl('https://youtube.com/shorts/x')).toBe(true);
		expect(isWalledMediaUrl('https://youtu.be/x')).toBe(true);
	});

	it('behandler blogg/nettbutikk som fetchbar', () => {
		expect(isWalledMediaUrl('https://trinesmatblogg.no/oppskrift')).toBe(false);
		expect(isWalledMediaUrl(null)).toBe(false);
	});
});

describe('parseTriageResult', () => {
	it('tolker gyldig JSON', () => {
		const r = parseTriageResult(
			JSON.stringify({
				title: 'Tomatsuppe',
				summary: 'Rask suppe.',
				theme: 'food',
				kind: 'Oppskrift',
				isRecipe: true
			})
		);
		expect(r.title).toBe('Tomatsuppe');
		expect(r.theme).toBe('food');
		expect(r.kind).toBe('oppskrift'); // normalisert til lowercase
		expect(r.isRecipe).toBe(true);
	});

	it('klemmer ukjent tema til «annet»', () => {
		expect(parseTriageResult('{"theme":"vitenskap"}').theme).toBe('annet');
		expect(parseTriageResult('{}').theme).toBe('annet');
	});

	it('takler ugyldig JSON uten å kaste', () => {
		const r = parseTriageResult('ikke json');
		expect(r.theme).toBe('annet');
		expect(r.isRecipe).toBe(false);
		expect(r.title).toBe('');
	});

	it('coercer isRecipe fra streng «true»', () => {
		expect(parseTriageResult('{"isRecipe":"true"}').isRecipe).toBe(true);
		expect(parseTriageResult('{"isRecipe":false}').isRecipe).toBe(false);
	});
});
