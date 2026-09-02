import { describe, it, expect } from 'vitest';
import {
	describeAcuteChronic,
	describeAnchor,
	describeBudgetStanding,
	QUIET_RATIO
} from './effort-standing';

describe('describeBudgetStanding', () => {
	it('kaller en uke over båndet «over ukas plan», ikke et varsel', () => {
		const verdict = describeBudgetStanding(513, 235, 282);
		expect(verdict.standing).toBe('over');
		// Det konkrete tilfellet fra 9. august 2026. Setningen må si hva et
		// budsjett ER, ellers leses tallet som en grense man har brutt.
		expect(verdict.text).toContain('budsjett, ikke en grense');
		expect(verdict.text).not.toMatch(/hvil|belastning|rolig dag/i);
	});

	it('skiller under, i band og over', () => {
		expect(describeBudgetStanding(100, 200, 240).standing).toBe('under');
		expect(describeBudgetStanding(220, 200, 240).standing).toBe('i_band');
		expect(describeBudgetStanding(300, 200, 240).standing).toBe('over');
	});

	it('regner grensene som inkluderende — nøyaktig på bandMax er i band', () => {
		expect(describeBudgetStanding(200, 200, 240).standing).toBe('i_band');
		expect(describeBudgetStanding(240, 200, 240).standing).toBe('i_band');
	});
});

describe('describeAcuteChronic', () => {
	it('er det eneste som sier «ta en rolig dag»', () => {
		const verdict = describeAcuteChronic(1.62, true)!;
		expect(verdict.level).toBe('høy');
		expect(verdict.text).toContain('rolig dag');
		expect(verdict.text).toContain('1,62');
	});

	it('leser en rolig periode like tydelig som en travel', () => {
		// En motor som bare sier fra når du har gjort for mye, er stum i alle ukene
		// du er uthvilt — og da er tausheten ikke til å skille fra «vet ikke».
		const verdict = describeAcuteChronic(QUIET_RATIO - 0.1, false)!;
		expect(verdict.level).toBe('rolig');
	});

	it('sier ingenting uten nok historikk', () => {
		expect(describeAcuteChronic(null, false)).toBeNull();
	});

	it('bruker restRecommended framfor en egen terskel', () => {
		// Terskelen er brukerkonfigurerbar og bor på treningsløpet. En kopi her
		// ville gitt flaten en andre terskel å ta feil av.
		expect(describeAcuteChronic(1.2, true)!.level).toBe('høy');
		expect(describeAcuteChronic(1.9, false)!.level).toBe('normal');
	});
});

describe('describeAnchor', () => {
	it('sier hvor mange uker snittet bygger på', () => {
		expect(describeAnchor('snitt_uker', 4)).toBe('snitt av siste 4 uker');
	});

	it('sier «forrige uke» når det bare finnes én', () => {
		expect(describeAnchor('snitt_uker', 1)).toBe('basert på forrige uke');
	});

	it('kaller gulvet et oppstartsnivå, ikke et snitt', () => {
		expect(describeAnchor('gulv', 0)).toBe('forsiktig oppstartsnivå');
	});
});

describe('describeBudgetStanding — sykeuke', () => {
	it('sier at rammen er senket, og krever ingenting', () => {
		const v = describeBudgetStanding(0, 0, 84, true);
		expect(v.standing).toBe('i_band');
		expect(v.label).toBe('Sykeuke');
		expect(v.text).toContain('Ingenting kreves');
	});

	it('finnes ingen «under planen» når gulvet er null', () => {
		// Uten sykeflagget ville 0 av 235–282 vært «under ukas plan — det er rom
		// igjen», altså en oppfordring til å trene med feber.
		expect(describeBudgetStanding(0, 235, 282).standing).toBe('under');
		expect(describeBudgetStanding(0, 0, 84, true).standing).toBe('i_band');
	});

	it('over den senkede rammen sies fortsatt som et budsjett, ikke et varsel', () => {
		const v = describeBudgetStanding(200, 0, 84, true);
		expect(v.standing).toBe('over');
		expect(v.text).toContain('ikke en grense');
	});
});
