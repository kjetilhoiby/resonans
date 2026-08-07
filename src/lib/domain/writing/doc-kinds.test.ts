import { describe, it, expect } from 'vitest';
import {
	countWords,
	displayTitle,
	isWritingDocKind,
	isWritingDocStatus,
	resolveDocKind,
	WRITING_DOC_KINDS,
	WRITING_DOC_KIND_DEFS
} from './doc-kinds';

describe('doc-kinds', () => {
	it('har en definisjon for hver kind — et navn uten definisjon ville gitt tom rad i lista', () => {
		for (const kind of WRITING_DOC_KINDS) {
			expect(WRITING_DOC_KIND_DEFS.some((d) => d.key === kind)).toBe(true);
		}
		expect(WRITING_DOC_KIND_DEFS).toHaveLength(WRITING_DOC_KINDS.length);
	});

	it('markerer bare manusets egne typer som ordnede', () => {
		const ordered = WRITING_DOC_KIND_DEFS.filter((d) => d.ordered).map((d) => d.key);
		expect(ordered.sort()).toEqual(['kapittel', 'scene']);
	});

	it('kjenner igjen gyldige kinds og avviser resten', () => {
		expect(isWritingDocKind('scene')).toBe(true);
		expect(isWritingDocKind('karakter')).toBe(true);
		expect(isWritingDocKind('roman')).toBe(false);
		expect(isWritingDocKind(null)).toBe(false);
		expect(isWritingDocKind(42)).toBe(false);
	});

	it('faller tilbake til notat for ukjent kind', () => {
		expect(resolveDocKind('finnes-ikke').key).toBe('notat');
		expect(resolveDocKind(null).key).toBe('notat');
		expect(resolveDocKind('dikt').key).toBe('dikt');
	});

	it('validerer status', () => {
		expect(isWritingDocStatus('utkast')).toBe(true);
		expect(isWritingDocStatus('ferdig')).toBe(true);
		expect(isWritingDocStatus('draft')).toBe(false);
	});
});

describe('displayTitle', () => {
	it('bruker tittelen når den finnes', () => {
		expect(displayTitle({ title: 'Kapittel 1', body: 'noe tekst' })).toBe('Kapittel 1');
	});

	it('faller til førstelinja når tittelen mangler — man skriver først og navngir siden', () => {
		expect(displayTitle({ title: '', body: 'Hun så ut av vinduet.\nDet regnet.' })).toBe(
			'Hun så ut av vinduet.'
		);
	});

	it('hopper over blanke linjer i starten', () => {
		expect(displayTitle({ title: null, body: '\n\n   \nFørste ekte linje' })).toBe(
			'Første ekte linje'
		);
	});

	it('korter ned lange førstelinjer', () => {
		const lang = 'a'.repeat(120);
		const result = displayTitle({ title: '', body: lang });
		expect(result).toHaveLength(60);
		expect(result.endsWith('…')).toBe(true);
	});

	it('viser typenavn når alt er tomt, så lista aldri får en rad uten tekst', () => {
		expect(displayTitle({ title: '', body: '', kind: 'dikt' })).toBe('Uten tittel (dikt)');
		expect(displayTitle({})).toBe('Uten tittel (notat)');
	});
});

describe('countWords', () => {
	it('teller ord', () => {
		expect(countWords('en to tre')).toBe(3);
	});

	it('tåler tomt og null', () => {
		expect(countWords('')).toBe(0);
		expect(countWords(null)).toBe(0);
		expect(countWords('   \n  ')).toBe(0);
	});

	it('teller sammensetning med bindestrek som ett ord', () => {
		expect(countWords('kjøkkenbenk-lampe')).toBe(1);
	});

	it('kollapser linjeskift og doble mellomrom', () => {
		expect(countWords('en\n\nto   tre\ffire')).toBe(4);
	});
});
