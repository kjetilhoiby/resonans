import { describe, it, expect } from 'vitest';
import { normalizeReplyOptions, MAX_REPLY_LEN } from './message-reply-intent';

describe('normalizeReplyOptions', () => {
	it('beholder nøyaktig to gyldige svar', () => {
		expect(normalizeReplyOptions({ replies: ['Ja, jeg henter', 'Nei, går ikke'] })).toEqual([
			'Ja, jeg henter',
			'Nei, går ikke'
		]);
	});

	it('trimmer hvert svar', () => {
		expect(normalizeReplyOptions({ replies: ['  Ja takk!  ', '  Nei takk  '] })).toEqual([
			'Ja takk!',
			'Nei takk'
		]);
	});

	it('kapper for lange svar til MAX_REPLY_LEN', () => {
		const long = 'a'.repeat(MAX_REPLY_LEN + 20);
		const [first] = normalizeReplyOptions({ replies: [long, 'Nei'] });
		expect(first.length).toBe(MAX_REPLY_LEN);
	});

	it('returnerer tom liste når needsReply er false', () => {
		expect(normalizeReplyOptions({ needsReply: false, replies: ['Ja', 'Nei'] })).toEqual([]);
	});

	it('returnerer tom liste ved kun ett gyldig svar', () => {
		expect(normalizeReplyOptions({ replies: ['Ja'] })).toEqual([]);
		expect(normalizeReplyOptions({ replies: ['Ja', '   '] })).toEqual([]);
	});

	it('returnerer tom liste ved mer enn to svar', () => {
		expect(normalizeReplyOptions({ replies: ['Ja', 'Nei', 'Kanskje'] })).toEqual([]);
	});

	it('fjerner duplikater (case-insensitivt) før telling', () => {
		// To «ja»-varianter kollapser til ett unikt → ingen binær motsetning.
		expect(normalizeReplyOptions({ replies: ['Ja', 'ja'] })).toEqual([]);
	});

	it('hopper over ikke-streng-elementer', () => {
		expect(normalizeReplyOptions({ replies: [42, 'Ja', null, 'Nei'] })).toEqual(['Ja', 'Nei']);
	});

	it('tåler manglende/ugyldig input', () => {
		expect(normalizeReplyOptions({})).toEqual([]);
		expect(normalizeReplyOptions(null)).toEqual([]);
		expect(normalizeReplyOptions({ replies: 'ikke en liste' })).toEqual([]);
	});
});
