import { describe, it, expect } from 'vitest';
import {
	candidateUserEmails,
	extractAddresses,
	hasWorkoutAttachments,
	isSettled,
	describeInboundHealth,
	matchesPattern,
	matchesSender,
	parseInboundPayload,
	ruleMatches
} from './inbound';
import { buildAppsScript } from './apps-script-template';

const rule = (p: Partial<{ labelPattern: string; senderPattern: string; subjectPattern: string }>) => ({
	labelPattern: p.labelPattern ?? null,
	senderPattern: p.senderPattern ?? null,
	subjectPattern: p.subjectPattern ?? null
});

describe('extractAddresses', () => {
	it('henter adressen ut av et navn med vinkelparentes', () => {
		expect(extractAddresses('Oda <hei@oda.com>')).toEqual(['hei@oda.com']);
	});

	it('henter alle adressene i et felt med flere mottakere', () => {
		expect(extractAddresses('"Kjetil" <Kjetil@hoi.by>, workout@hoi.by')).toEqual([
			'kjetil@hoi.by',
			'workout@hoi.by'
		]);
	});

	it('gir tom liste for tomt felt', () => {
		expect(extractAddresses('')).toEqual([]);
		expect(extractAddresses(undefined)).toEqual([]);
	});
});

describe('candidateUserEmails', () => {
	it('setter kontoen scriptet kjører som foran mottakerfeltet', () => {
		const payload = parseInboundPayload({ userEmail: 'kjetil@hoi.by', to: 'workout@hoi.by' });
		expect(candidateUserEmails(payload)).toEqual(['kjetil@hoi.by', 'workout@hoi.by']);
	});

	it('faller tilbake på to når script v1 ikke sendte userEmail', () => {
		const payload = parseInboundPayload({ to: 'Kjetil <kjetil@hoi.by>' });
		expect(candidateUserEmails(payload)).toEqual(['kjetil@hoi.by']);
	});
});

describe('matchesPattern', () => {
	it('tolker * først og sist', () => {
		expect(matchesPattern('noreply@spond.com', '*@spond.com')).toBe(true);
		expect(matchesPattern('noreply@spond.com', 'noreply*')).toBe(true);
		expect(matchesPattern('Ordrebekreftelse 123', '*bekreft*')).toBe(true);
	});

	it('uten * er det lik eller inneholder, som før', () => {
		expect(matchesPattern('resonans/oda', 'Resonans/Oda')).toBe(true);
		expect(matchesPattern('Oda: Kvittering 996810', 'Kvittering')).toBe(true);
		expect(matchesPattern('Oda: Ordre', 'Kvittering')).toBe(false);
	});

	it('et tomt mønster treffer alt', () => {
		expect(matchesPattern('hva som helst', '  ')).toBe(true);
	});
});

describe('matchesSender', () => {
	it('*@oda.com treffer et From-felt med navn foran (feilet før)', () => {
		expect(matchesPattern('Oda <hei@oda.com>', '*@oda.com')).toBe(false);
		expect(matchesSender('Oda <hei@oda.com>', '*@oda.com')).toBe(true);
	});

	it('treffer fortsatt på navnet i From-feltet', () => {
		expect(matchesSender('Deichman <no-reply@deichman.no>', 'Deichman')).toBe(true);
	});

	it('treffer ikke en annen avsender', () => {
		expect(matchesSender('Oda <hei@oda.com>', '*@deichman.no')).toBe(false);
	});
});

describe('ruleMatches', () => {
	const oda = { label: 'Resonans/Oda', from: 'Oda <hei@oda.com>', subject: 'Oda: Kvittering 996810' };

	it('krever minst ett mønster', () => {
		expect(ruleMatches(rule({}), oda)).toBe(false);
	});

	it('krever at alle mønstrene som er satt treffer', () => {
		expect(ruleMatches(rule({ labelPattern: 'Resonans/Oda', senderPattern: '*@oda.com' }), oda)).toBe(true);
		expect(ruleMatches(rule({ labelPattern: 'Resonans/Oda', subjectPattern: 'Ordre' }), oda)).toBe(false);
	});

	it('et labelmønster treffer ikke en e-post uten label', () => {
		expect(ruleMatches(rule({ labelPattern: 'Resonans/Oda' }), { ...oda, label: '' })).toBe(false);
	});
});

describe('parseInboundPayload', () => {
	it('leser script v2 sin form', () => {
		const payload = parseInboundPayload({
			scriptVersion: 2,
			userEmail: 'kjetil@hoi.by',
			gmailMessageId: 'm1',
			gmailThreadId: 't1',
			internalDate: 1793970000000,
			from: 'Oda <hei@oda.com>',
			to: 'kjetil@hoi.by',
			subject: 'Kvittering',
			bodyText: 'tekst',
			htmlBody: '<p>tekst</p>',
			label: 'Resonans/Oda',
			attachments: [
				{ name: 'tur.gpx', contentType: 'application/gpx+xml', base64: 'PGdweC8+', size: 6 },
				{ name: '', base64: 'x' }
			],
			skippedAttachments: ['stor.pdf']
		});
		expect(payload).toMatchObject({
			ScriptVersion: 2,
			UserEmail: 'kjetil@hoi.by',
			GmailMessageId: 'm1',
			GmailThreadId: 't1',
			GmailDate: '1793970000000',
			HtmlBody: '<p>tekst</p>',
			Label: 'Resonans/Oda',
			SkippedAttachments: ['stor.pdf']
		});
		expect(payload.Attachments).toEqual([
			{ Name: 'tur.gpx', Content: 'PGdweC8+', ContentType: 'application/gpx+xml', ContentLength: 6 }
		]);
		expect(hasWorkoutAttachments(payload)).toBe(true);
	});

	it('leser fortsatt den gamle PascalCase-formen', () => {
		const payload = parseInboundPayload({ UserEmail: 'a@b.no', From: 'x@y.no', Label: 'Resonans/X' });
		expect(payload.UserEmail).toBe('a@b.no');
		expect(payload.From).toBe('x@y.no');
		expect(payload.ScriptVersion).toBeUndefined();
	});

	it('godtar ikke tall eller objekter som tekstfelt', () => {
		const payload = parseInboundPayload({ from: 42, subject: { a: 1 } });
		expect(payload.From).toBe('');
		expect(payload.Subject).toBeUndefined();
	});
});

describe('isSettled', () => {
	it('bare processed og no_match er ferdige', () => {
		expect(isSettled('processed')).toBe(true);
		expect(isSettled('no_match')).toBe(true);
		expect(isSettled('failed')).toBe(false);
		expect(isSettled(undefined)).toBe(false);
	});
});

describe('buildAppsScript', () => {
	const source = buildAppsScript({ endpoint: 'https://resonans.apps.hoi.by/api/email/inbound', token: 'hemmelig' });

	it('legger hemmeligheten i en header, aldri i URL-en', () => {
		expect(source).toContain("Authorization: 'Bearer ' + TOKEN");
		expect(source).not.toContain('token=');
	});

	it('sjekker serveren før noe sendes', () => {
		const sync = source.slice(source.indexOf('function syncResonans'), source.indexOf('function verifyServer_'));
		expect(sync.indexOf('verifyServer_()')).toBeGreaterThan(-1);
		expect(sync.indexOf('verifyServer_()')).toBeLessThan(sync.indexOf('postMessage_('));
	});

	it('er gyldig JavaScript', () => {
		expect(() => new Function(source)).not.toThrow();
	});
});

describe('describeInboundHealth', () => {
	const now = new Date('2026-11-06T13:00:00Z');
	const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

	it('advarer når ingenting er mottatt', () => {
		expect(describeInboundHealth({ lastReceivedAt: null, lastScriptVersion: null, now }).tone).toBe('warn');
	});

	it('sier fra om et script uten versjon (v1)', () => {
		const health = describeInboundHealth({ lastReceivedAt: daysAgo(0), lastScriptVersion: null, now });
		expect(health).toMatchObject({ tone: 'warn', outdatedScript: true });
		expect(health.text).toContain('script v1');
	});

	it('er ok med nytt script og fersk e-post', () => {
		expect(describeInboundHealth({ lastReceivedAt: daysAgo(1), lastScriptVersion: 2, now })).toEqual({
			tone: 'ok',
			text: 'Siste e-post kom i går (script v2).',
			outdatedScript: false
		});
	});

	it('advarer først etter 30 dager uten e-post', () => {
		expect(describeInboundHealth({ lastReceivedAt: daysAgo(20), lastScriptVersion: 2, now }).tone).toBe('ok');
		expect(describeInboundHealth({ lastReceivedAt: daysAgo(31), lastScriptVersion: 2, now }).tone).toBe('warn');
	});
});
