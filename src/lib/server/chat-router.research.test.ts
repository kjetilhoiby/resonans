import { describe, it, expect } from 'vitest';
import { routeChatRequest } from './chat-router';

/**
 * Meldingen som utløste hele denne gjennomgangen (august 2026). Den handler om
 * brukerens EGEN treningshistorikk, men traff «siste» i en løs nyhets-regex — og
 * siden tvang låser `tool_choice` til web_search, ble svaret seks lenker og fire
 * punktlister om vintertrening. Den skal aldri tvinge websøk igjen.
 */
const REFLEKSJON_OM_EGNE_VINTRE =
	'Det som ofte skjer er at jeg har en seig start på våren, får god progresjon fra ' +
	'juli-august og frem til september eller oktober, og deretter faller tilbake og får ' +
	'en ny seig vår året etter. Hvis jeg kunne bevart «spruten» i beina gjennom vinteren ' +
	'hadde det vært lettere å bygge videre. Hvordan ser en april der jeg har løpt minst ' +
	'et kvarter seks av sju dager siste halvår ut sammenliknet med når jeg har tre ' +
	'skiturer og ti halv-lange, trege løp i samme periode?';

describe('routeChatRequest — forceWebSearch', () => {
	it('tvinger websøk for reise/steds-spørsmål', () => {
		const d = routeChatRequest('Hva kan jeg gjøre i Hornbæk?');
		expect(d.forceWebSearch).toBe(true);
		expect(d.hints.some((h) => /web_search/.test(h))).toBe(true);
	});

	it('tvinger websøk for ferske/nyhets-spørsmål', () => {
		const d = routeChatRequest('siste nytt om renteøkningen');
		expect(d.forceWebSearch).toBe(true);
	});

	it('tvinger IKKE websøk for tidløse spørsmål', () => {
		const d = routeChatRequest('hvordan bør jeg strukturere treningsuka mi?');
		expect(d.forceWebSearch).toBe(false);
	});

	it('tvinger IKKE websøk for refleksjon over egen treningshistorikk', () => {
		const d = routeChatRequest(REFLEKSJON_OM_EGNE_VINTRE);
		expect(d.forceWebSearch).toBe(false);
	});

	it('tvinger IKKE websøk fordi et tidsord står i et dataspørsmål', () => {
		// «denne uka» og «siste» er tidsord, ikke nyhetssignaler. Brukerens egne
		// netter er også ferske data.
		expect(routeChatRequest('hvor mye har jeg sovet denne uka?').forceWebSearch).toBe(false);
		expect(routeChatRequest('hva var siste vekt jeg registrerte?').forceWebSearch).toBe(false);
		expect(routeChatRequest('hvordan har forbruket i markedet vårt utviklet seg?').forceWebSearch).toBe(false);
	});

	it('tvinger IKKE websøk på en konflikt hjemme', () => {
		// Bar «konflikt» gjorde et samlivsspørsmål til et nyhetssøk mot nrk.no/vg.no.
		const d = routeChatRequest('vi har en konflikt hjemme, hvordan tar jeg det opp med partneren min?');
		expect(d.forceWebSearch).toBe(false);
	});

	it('sier fra at egne data skal hentes når spørsmålet er personlig', () => {
		const d = routeChatRequest(REFLEKSJON_OM_EGNE_VINTRE);
		expect(d.hints.some((h) => /egne data/.test(h))).toBe(true);
	});
});

describe('routeChatRequest — helse-ruting av aktivitetsord', () => {
	it('kjenner igjen løping, ski og økter som helse', () => {
		// Uten health-blant-domenene finnes ikke query_training for modellen.
		for (const msg of [
			REFLEKSJON_OM_EGNE_VINTRE,
			'hvor mange løp har jeg hatt i april?',
			'var det mange skiturer i vinter?',
			'hvordan var pulsen på øktene mine i mars?',
			'går det an å sykle seg i form til maraton?'
		]) {
			expect(routeChatRequest(msg).domains, msg).toContain('health');
		}
	});

	it('drar IKKE helse inn på «forbruket har økt»', () => {
		// «økt» er også partisipp av «øke» — derfor står bare «økter»/«økta» i mønsteret.
		expect(routeChatRequest('forbruket har økt de siste månedene')).toMatchObject({
			domains: expect.not.arrayContaining(['health'])
		});
	});

	it('drar IKKE helse inn på et loppemarked', () => {
		expect(routeChatRequest('vi skal på loppemarked på lørdag')).toMatchObject({
			domains: expect.not.arrayContaining(['health'])
		});
	});
});
