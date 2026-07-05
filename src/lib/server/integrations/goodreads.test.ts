import { describe, it, expect } from 'vitest';
import { cleanMarkdownSnippet, extractTopReviews } from './goodreads';

describe('cleanMarkdownSnippet', () => {
	it('gjør lenker om til ren tekst', () => {
		expect(cleanMarkdownSnippet('Se [Birger Emanuelsen](https://www.goodreads.com/author/show/6485430) her')).toBe(
			'Se Birger Emanuelsen her'
		);
	});

	it('fjerner overskriftstegn, utheving og bilder', () => {
		expect(cleanMarkdownSnippet('### **Viktig** _tekst_ ![omslag](https://img.example/x.jpg) `kode`')).toBe(
			'Viktig tekst kode'
		);
	});

	it('fjerner rå URL-er og normaliserer whitespace', () => {
		expect(cleanMarkdownSnippet('Les   mer på https://www.goodreads.com/book/show/123 i dag')).toBe(
			'Les mer på i dag'
		);
	});
});

describe('extractTopReviews', () => {
	const blurb =
		'Før de forsvinner er en velinformert dokumentarbok om ansvaret foreldre har for å forberede barna sine på verden, og hvordan de kan gå fram for å gjøre det.';

	it('beholder lange avsnitt som ren tekst', () => {
		const reviews = extractTopReviews(blurb);
		expect(reviews).toHaveLength(1);
		expect(reviews[0].quote).toBe(blurb);
	});

	it('dropper sidetittel med Jump to ratings-lenke', () => {
		const pageTitle =
			'Før de forsvinner - et forsøk på å forstå hva barn er by Birger Emanuelsen | Goodreads [Jump to ratings and reviews](#ReviewsSection)';
		const reviews = extractTopReviews(`${pageTitle}\n\n${blurb}`);
		expect(reviews).toHaveLength(1);
		expect(reviews[0].quote).toBe(blurb);
	});

	it('dropper markdown-overskrifter selv når de er lange nok', () => {
		const heading =
			'### [Birger Emanuelsen](https://www.goodreads.com/author/show/6485430.Birger_Emanuelsen) er en norsk forfatter som skriver om familie og oppvekst';
		const reviews = extractTopReviews(`${heading}\n\n${blurb}`);
		expect(reviews).toHaveLength(1);
		expect(reviews[0].quote).toBe(blurb);
	});

	it('renser markdown-lenker inne i omtaler', () => {
		const withLink = `Dette er en lang og gjennomtenkt omtale av boka som lenker til [forfatteren](https://goodreads.com/author/1) og sier mye fint om språket i boka.`;
		const reviews = extractTopReviews(withLink);
		expect(reviews).toHaveLength(1);
		expect(reviews[0].quote).not.toContain('](');
		expect(reviews[0].quote).toContain('lenker til forfatteren og sier');
	});

	it('dedupliserer avsnitt med lik start og stopper på 5', () => {
		const many = Array.from({ length: 8 }, (_, i) => `${blurb} Variant nummer ${i}.`).join('\n\n');
		const reviews = extractTopReviews(`${many}\n\n${blurb}`);
		expect(reviews).toHaveLength(1); // lik start → deduplisert
	});

	it('filtrerer boilerplate som Community Reviews og Displaying', () => {
		const junk = [
			'Community Reviews and ratings from readers all over the world who have read this book recently',
			'Displaying 1 - 10 of 103 reviews from the community, sorted by most recent activity this week'
		].join('\n\n');
		expect(extractTopReviews(junk)).toHaveLength(0);
	});
});
