import { describe, it, expect } from 'vitest';
import { parseChecklist, toggleChecklistItem, unusedIdeas } from './checklist';

describe('parseChecklist', () => {
	it('finner avkryssede og ikke-avkryssede punkter', () => {
		const body = `Spenning gjennom forsinket avsløring.

- [ ] Lukt som varsel om at broren har vært der
- [x] La leseren se nøkkelen før Ida gjør det
- [ ] Utsett navnet hans til kapittel 3`;

		const result = parseChecklist(body);
		expect(result.total).toBe(3);
		expect(result.done).toBe(1);
		expect(result.ratio).toBeCloseTo(1 / 3);
		expect(result.items[0].text).toBe('Lukt som varsel om at broren har vært der');
		expect(result.items[1].checked).toBe(true);
	});

	it('godtar både * og - som punktmerke', () => {
		expect(parseChecklist('* [ ] en\n- [ ] to').total).toBe(2);
	});

	it('godtar stor X — markdown-editorer er uenige', () => {
		expect(parseChecklist('- [X] brukt').done).toBe(1);
	});

	it('tåler innrykk', () => {
		expect(parseChecklist('    - [x] nestet').done).toBe(1);
	});

	it('hopper over bokser uten tekst — en halvskrevet linje er ikke en idé', () => {
		expect(parseChecklist('- [ ] \n- [ ] ekte').total).toBe(1);
	});

	it('ignorerer vanlig prosa og lister uten boks', () => {
		const body = 'Dette er refleksjon.\n- vanlig punkt\n\nMer prosa.';
		expect(parseChecklist(body).total).toBe(0);
	});

	it('gir ratio null når det ikke finnes noen liste', () => {
		expect(parseChecklist('bare tekst').ratio).toBeNull();
	});

	it('tåler tomt og null', () => {
		expect(parseChecklist('').total).toBe(0);
		expect(parseChecklist(null).total).toBe(0);
		expect(parseChecklist(undefined).ratio).toBeNull();
	});

	it('husker linjenummeret, så en hake kan skrives tilbake', () => {
		const body = 'intro\n\n- [ ] først\n- [ ] andre';
		expect(parseChecklist(body).items.map((i) => i.line)).toEqual([2, 3]);
	});
});

describe('unusedIdeas', () => {
	it('returnerer bare det som ikke er brukt', () => {
		const body = '- [x] brukt\n- [ ] ubrukt\n- [ ] også ubrukt';
		expect(unusedIdeas(body)).toEqual(['ubrukt', 'også ubrukt']);
	});

	it('er tom når alt er brukt', () => {
		expect(unusedIdeas('- [x] alt')).toEqual([]);
	});
});

describe('toggleChecklistItem', () => {
	const body = 'intro\n- [ ] først\n- [x] andre';

	it('krysser av', () => {
		expect(toggleChecklistItem(body, 1, true)).toBe('intro\n- [x] først\n- [x] andre');
	});

	it('fjerner hake', () => {
		expect(toggleChecklistItem(body, 2, false)).toBe('intro\n- [ ] først\n- [ ] andre');
	});

	it('rører ikke andre linjer', () => {
		const result = toggleChecklistItem(body, 1, true);
		expect(result.split('\n')[0]).toBe('intro');
		expect(result.split('\n')[2]).toBe('- [x] andre');
	});

	it('er en no-op på linje uten avkryssingsboks', () => {
		expect(toggleChecklistItem(body, 0, true)).toBe(body);
	});

	it('er en no-op utenfor teksten', () => {
		expect(toggleChecklistItem(body, 99, true)).toBe(body);
		expect(toggleChecklistItem(body, -1, true)).toBe(body);
	});

	it('bevarer teksten etter boksen ordrett', () => {
		const med = '- [ ] Bruk lukt — som i kapittel [2]';
		expect(toggleChecklistItem(med, 0, true)).toBe('- [x] Bruk lukt — som i kapittel [2]');
	});
});
