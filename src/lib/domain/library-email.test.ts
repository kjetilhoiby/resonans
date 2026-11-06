import { describe, it, expect } from 'vitest';
import { classifyLibraryEmail, loanItemText, loanKey, parseLibraryEmail } from './library-email';

const REMINDER = `Hei, Kjetil

Husk å levere tilbake dette senest 02.11.2026:
Tittel: Den usynlige gutten
Forfatter: Horner, Doogie
Strekkode: 30119117011111

Tittel: Bone. 3. Stormens øyne
Forfatter: Smith, Jeff
Strekkode: 30119117022222

Med vennlig hilsen
Deichman`;

const OVERDUE_FINAL = `Hei, Kjetil

Har du glemt noe? Du har lånt noe hos oss som du skulle ha levert.

Det vi savner er:
  Tittel: Dinotopia : landet bortenfor tiden
  Forfatter: Gurney, James
  Strekkode: 30119117035303

Du har nå fått et purregebyr på 100 kroner og er sperret for videre lån og bestillinger inntil lånene er levert og purregebyret er betalt.`;

const PICKUP = `Hei, Kjetil

Du kan nå hente:
Tittel: Bone. 1. Reisen fra Boneville
Forfatter: Smith, Jeff
Strekkode: 30119116721882

Hentebibliotek: Bøler
Hentenummer er 13. Du må hente senest 21.05.2026. Husk å registrere det du henter på utlånsautomaten før du forlater biblioteket.`;

describe('classifyLibraryEmail', () => {
	it('kjenner igjen de fire typene på emnet', () => {
		expect(classifyLibraryEmail('Påminnelse om forfall')).toBe('reminder');
		expect(classifyLibraryEmail('Purring på forfalte lån')).toBe('overdue');
		expect(classifyLibraryEmail('2. purring')).toBe('overdue_final');
		expect(classifyLibraryEmail('2. purring på forfalte lån')).toBe('overdue_final');
		expect(classifyLibraryEmail('Hentemelding fra biblioteket')).toBe('pickup');
	});

	it('avviser nyhetsbrev', () => {
		expect(classifyLibraryEmail('Bli med på Sommerles')).toBeNull();
	});
});

describe('parseLibraryEmail', () => {
	it('leser alle bøkene og fristen i en påminnelse', () => {
		const parsed = parseLibraryEmail('Påminnelse om forfall', REMINDER, '2026-10-30');
		expect(parsed).toMatchObject({ kind: 'reminder', deadline: '2026-11-02', blocked: false });
		expect(parsed?.loans).toEqual([
			{ title: 'Den usynlige gutten', author: 'Horner, Doogie', barcode: '30119117011111' },
			{ title: 'Bone. 3. Stormens øyne', author: 'Smith, Jeff', barcode: '30119117022222' }
		]);
	});

	it('leser gebyr og sperring i 2. purring', () => {
		const parsed = parseLibraryEmail('2. purring', OVERDUE_FINAL, '2026-10-28');
		expect(parsed).toMatchObject({ kind: 'overdue_final', feeNok: 100, blocked: true, deadline: null });
		expect(parsed?.loans[0]).toEqual({
			title: 'Dinotopia : landet bortenfor tiden',
			author: 'Gurney, James',
			barcode: '30119117035303'
		});
	});

	it('leser antall dager forfalt i første purring', () => {
		const body = 'Du har lånt noe hos oss som du skulle ha levert for 5 dager siden.\n\nDet vi savner er:\nTittel: X\nStrekkode: 1';
		expect(parseLibraryEmail('Purring på forfalte lån', body, '2026-10-01')?.daysOverdue).toBe(5);
	});

	it('leser filial, hentenummer og hentefrist i en hentemelding', () => {
		const parsed = parseLibraryEmail('Hentemelding fra biblioteket', PICKUP, '2026-05-12');
		expect(parsed).toMatchObject({
			kind: 'pickup',
			deadline: '2026-05-21',
			pickupBranch: 'Bøler',
			pickupNumber: '13'
		});
	});

	it('leser det gamle formatet med relativ frist', () => {
		const body = 'Hei Kjetil. Husk å levere tilbake dette innen 2 dager:\nHvit, Flemmen, Silje Hansen 30119116868912\nDa pappa viste meg universet, Bak, Ulf 30119116000000';
		const parsed = parseLibraryEmail('Påminnelse om forfall', body, '2025-06-30');
		expect(parsed?.deadline).toBe('2025-07-02');
		expect(parsed?.loans).toEqual([
			{ title: 'Hvit', author: 'Flemmen, Silje Hansen', barcode: '30119116868912' },
			{ title: 'Da pappa viste meg universet', author: 'Bak, Ulf', barcode: '30119116000000' }
		]);
	});

	it('leser gamle purringer der kommaet står rett før strekkoden', () => {
		const body = 'Hei Kjetil. Du har lån som skulle vært levert for 10 dager siden: Se, en kanin!, 30119116925042';
		expect(parseLibraryEmail('2. purring på forfalte lån', body, '2025-01-01')?.loans).toEqual([
			{ title: 'Se, en kanin!', author: null, barcode: '30119116925042' }
		]);
	});

	it('gir null for e-post som ikke er et lån', () => {
		expect(parseLibraryEmail('Utlånstoppen 2022', 'nyhetsbrev', '2022-12-01')).toBeNull();
	});
});

describe('loanKey', () => {
	it('bruker strekkoden når den finnes, ellers tittelen', () => {
		expect(loanKey({ title: 'X', author: null, barcode: '123' })).toBe('123');
		expect(loanKey({ title: '  Bone  1 ', author: null, barcode: null })).toBe('tittel:bone 1');
	});
});

describe('loanItemText', () => {
	const loan = { title: 'Bone. 1. Reisen fra Boneville', author: 'Smith, Jeff', barcode: '1' };

	it('sier hvor og hvilket nummer for en hentemelding', () => {
		const parsed = parseLibraryEmail('Hentemelding fra biblioteket', PICKUP, '2026-05-12')!;
		expect(loanItemText(loan, parsed)).toBe('Hent: Bone. 1. Reisen fra Boneville på Bøler (nr. 13)');
	});

	it('nevner gebyret i 2. purring', () => {
		const parsed = parseLibraryEmail('2. purring', OVERDUE_FINAL, '2026-10-28')!;
		expect(loanItemText(loan, parsed)).toBe('Lever (forfalt, purregebyr 100 kr): Bone. 1. Reisen fra Boneville');
	});
});
