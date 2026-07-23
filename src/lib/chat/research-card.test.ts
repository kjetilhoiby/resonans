import { describe, it, expect } from 'vitest';
import { buildResearchCard, faviconUrl } from './research-card';

describe('faviconUrl', () => {
	it('bygger DuckDuckGo-ikon-URL', () => {
		expect(faviconUrl('visitnorway.no')).toBe('https://icons.duckduckgo.com/ip3/visitnorway.no.ico');
	});
});

describe('buildResearchCard', () => {
	const src = (url: string) => ({ url, source: 'visitnorway.no', snippet: 'tekst' });

	it('returnerer null uten kilder', () => {
		expect(buildResearchCard({ query: 'q', sources: [] })).toBeNull();
	});

	it('legger favicon på hver kilde', () => {
		const card = buildResearchCard({ query: 'q', sources: [src('https://visitnorway.no/a')] });
		expect(card?.sources[0].favicon).toContain('visitnorway.no');
	});

	it('filtrerer bort ikke-http-URL-er og duplikater', () => {
		const card = buildResearchCard({
			query: 'q',
			sources: [
				src('https://a.no/1'),
				src('javascript:alert(1)'),
				src('https://a.no/1') // duplikat
			]
		});
		expect(card?.sources).toHaveLength(1);
	});

	it('capper kilder til 6 og bilder til 4', () => {
		const many = Array.from({ length: 10 }, (_, i) => src(`https://a.no/${i}`));
		const imgs = Array.from({ length: 10 }, (_, i) => `https://img.no/${i}.jpg`);
		const card = buildResearchCard({ query: 'q', sources: many, images: imgs });
		expect(card?.sources).toHaveLength(6);
		expect(card?.images).toHaveLength(4);
	});

	it('slipper kun gjennom http-bilder', () => {
		const card = buildResearchCard({
			query: 'q',
			sources: [src('https://a.no/1')],
			images: ['https://img.no/ok.jpg', 'data:image/png;base64,xxx']
		});
		expect(card?.images).toEqual(['https://img.no/ok.jpg']);
	});

	it('tar med kart når oppgitt', () => {
		const card = buildResearchCard({
			query: 'q',
			sources: [src('https://a.no/1')],
			map: { lat: 56.1, lng: 12.4, label: 'Hornbæk' }
		});
		expect(card?.map?.label).toBe('Hornbæk');
	});
});
