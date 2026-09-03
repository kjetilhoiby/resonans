import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error – postgres-js eksporterer ikke sine interne typer; hentet på
// filsti med vilje (se testen nederst for hvorfor den er verdt prisen).
import { arraySerializer } from '../../../node_modules/postgres/src/types.js';
import { toPgArrayLiteral } from './pg-array';

describe('toPgArrayLiteral', () => {
	it('bygger et vanlig array-literal', () => {
		expect(toPgArrayLiteral(['a', 'b'])).toBe('{"a","b"}');
	});

	it('gir tomt literal for tom liste', () => {
		// UNNEST('{}'::text[]) gir null rader, som er riktig no-op.
		expect(toPgArrayLiteral([])).toBe('{}');
	});

	it('siterer tall — Postgres tolker dem fortsatt som tall', () => {
		expect(toPgArrayLiteral([1, 2.5, -3])).toBe('{"1","2.5","-3"}');
	});

	it('skriver null usitert', () => {
		// `"NULL"` ville vært strengen NULL, ikke fravær av verdi.
		expect(toPgArrayLiteral([null, 'a', undefined])).toBe('{NULL,"a",NULL}');
	});

	it('deler ikke elementet på komma', () => {
		// Dette er den ekte feilen fra bankbeskrivelser: uten sitering ble
		// «KIWI 123, OSLO» til to elementer, og radene forskjøv seg mot hverandre.
		expect(toPgArrayLiteral(['KIWI 123, OSLO'])).toBe('{"KIWI 123, OSLO"}');
	});

	it('escaper anførselstegn', () => {
		expect(toPgArrayLiteral(['si "hei"'])).toBe('{"si \\"hei\\""}');
	});

	it('escaper backslash før anførselstegn', () => {
		// Rekkefølgen er lastbærende: escapes backslash sist, dobbeltescapes
		// backslashen den nettopp la inn foran anførselstegnet.
		expect(toPgArrayLiteral(['c:\\sti'])).toBe('{"c:\\\\sti"}');
		expect(toPgArrayLiteral(['\\"'])).toBe('{"\\\\\\""}');
	});

	it('beholder tomme strenger som tomme, ikke som null', () => {
		expect(toPgArrayLiteral([''])).toBe('{""}');
	});

	it('rører ikke krøllparenteser inni et element', () => {
		expect(toPgArrayLiteral(['{a}'])).toBe('{"{a}"}');
	});

	it('bevarer rekkefølge og lengde — UNNEST stiller kolonnene opp mot hverandre', () => {
		// Faller ett element ut av én kolonne, forskyves ALLE radene fra det
		// punktet. Lengden er derfor en del av kontrakten, ikke en detalj — og
		// elementet med komma i seg er nettopp det som før delte seg i to.
		expect(toPgArrayLiteral(['a', null, '', 'd, e'])).toBe('{"a",NULL,"","d, e"}');
	});

	/**
	 * Escapingen pinnes mot postgres-js sin EGEN `arraySerializer` — den som
	 * virker i dag for korrekt typede arrays. Vi skriver literalen selv fordi
	 * driveren ikke får sjansen til å bruke den (`inferType` gir en Array
	 * skalar-OID-en til første element), men reglene skal være de samme.
	 *
	 * Importen går på filsti fordi pakken ikke eksporterer modulen. Ryker den
	 * ved en oppgradering av postgres-js, er det riktig tidspunkt å se på
	 * escapingen på nytt — ikke støy.
	 */
	it('escaper identisk med driverens egen arraySerializer', () => {
		const identity = (x: unknown) => String(x);
		const options = { transform: { column: {} } };
		const cases = [
			['KIWI 123, OSLO'],
			['si "hei"'],
			['c:\\sti'],
			[''],
			['NULL'],
			['{krøll}'],
			['Lønn Amedia AS'],
			['a', 'b'],
			[]
		];
		for (const input of cases) {
			expect(toPgArrayLiteral(input)).toBe(
				(arraySerializer as (...a: unknown[]) => string)(input, identity, options, 1009)
			);
		}
	});

	it('skriver null som NULL der driveren skriver null — begge er SQL NULL', () => {
		// `array_in` i Postgres leser usitert NULL case-uavhengig. Vi velger
		// versalene fordi de er den formen dokumentasjonen bruker.
		expect(toPgArrayLiteral([null])).toBe('{NULL}');
	});
});
