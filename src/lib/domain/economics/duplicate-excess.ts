/**
 * Overskuddet fra duplikatgrupper — den uavhengige kontrollen av saldotallene.
 *
 * ## Spørsmålet dette svarer på
 *
 * «Kan vi stole på saldotallene, eller må kontoutskriftene hentes på nytt?»
 *
 * Avstemmingen mot saldo fant 301 007 kr i avvik. Men et avvik har to mulige forklaringer, og de
 * krever motsatt handling:
 *
 * 1. **Transaksjonene er duplisert.** Saldoen er sann, og duplikatene skal ryddes.
 * 2. **Saldotallene er gale eller mangelfulle.** Da er avviket støy, og en dedup styrt av saldoen
 *    ville slettet ekte transaksjoner.
 *
 * Å velge fra magefølelsen her ville vært den niende gjetningen i dette domenet.
 *
 * ## Testen
 *
 * Duplikatoverskuddet regnes **helt uavhengig av saldoen**: grupper radene på (konto, dato,
 * beløp, fortegn), og for hver gruppe med `n` rader er overskuddet `(n − 1) × beløp`. Det er
 * hva vi ville telt for mye hvis gruppen er én transaksjon skrevet `n` ganger.
 *
 * **Stemmer overskuddet med saldoavviket, er saldoen vindisert.** To beregninger som ikke deler
 * en eneste inngang kan ikke bli enige ved uhell: den ene leser saldosnapshots, den andre teller
 * rader per dato og beløp. Enighet betyr at duplikatene forklarer avviket, og at saldoen måler
 * riktig.
 *
 * Er de UENIGE, er saldoen ikke til å stole på som orakel, og svaret på brukerens spørsmål er ja
 * — hent utskriftene.
 *
 * ## Hva funksjonen ikke påstår
 *
 * En gruppe med `n ≥ 2` er **ikke bevis** for duplisering. To trikkebilletter à 41 kr samme dag
 * er en helt gyldig gruppe. Funksjonen sier bare hvor mye overtelling gruppene *kan* forklare;
 * det er sammenligningen med saldoen som avgjør om de faktisk gjør det.
 *
 * Se `docs/changelog/2026-08-18-avstemming-mot-saldo.md`.
 */

export type ExcessTx = {
	/** YYYY-MM-DD */
	date: string;
	/** Negativ = ut av kontoen. */
	amount: number;
};

export type DuplicateGroup = {
	date: string;
	/** Beløpet med fortegn, slik radene har det. */
	amount: number;
	count: number;
	/** `(count − 1) × amount`, med fortegn. Det vi ville telt for mye. */
	excess: number;
};

/**
 * Grupper med mer enn én rad på samme dato, beløp og fortegn.
 *
 * Fortegnet er en del av nøkkelen: et uttak på 500 og et innskudd på 500 samme dag er en
 * overføring mellom egne kontoer, ikke to versjoner av det samme.
 */
export function duplicateGroups(txs: readonly ExcessTx[]): DuplicateGroup[] {
	const groups = new Map<string, { date: string; amount: number; count: number }>();
	for (const tx of txs) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) continue;
		if (!Number.isFinite(tx.amount) || tx.amount === 0) continue;
		// Ørebeløp i nøkkelen: 1 703,50 og 1 703,49 er IKKE samme transaksjon, og en avrunding
		// hit ville slått sammen en valutadrift som hører til en annen motor.
		const key = `${tx.date}|${tx.amount.toFixed(2)}`;
		const existing = groups.get(key);
		if (existing) existing.count += 1;
		else groups.set(key, { date: tx.date, amount: tx.amount, count: 1 });
	}

	return [...groups.values()]
		.filter((g) => g.count > 1)
		.map((g) => ({ ...g, excess: round2((g.count - 1) * g.amount) }))
		.sort((a, b) => Math.abs(b.excess) - Math.abs(a.excess));
}

/**
 * Summen av overskudd i `(fromDate, toDate]`.
 *
 * Samme vindusregel som avstemmingen bruker — startdagen ekskludert, sluttdagen inkludert —
 * ellers sammenligner man to ulike perioder og får et avvik som ikke betyr noe.
 */
export function excessInRange(
	groups: readonly DuplicateGroup[],
	fromDate: string,
	toDate: string
): number {
	return round2(
		groups
			.filter((g) => g.date > fromDate && g.date <= toDate)
			.reduce((sum, g) => sum + g.excess, 0)
	);
}

/**
 * Hvor godt duplikatoverskuddet forklarer saldoavviket, 0–1.
 *
 * 1 er perfekt enighet. **Under `AGREEMENT_TRUSTWORTHY` er saldoen ikke et orakel**, og en dedup
 * styrt av den ville slettet noe annet enn duplikater.
 *
 * Returnerer null når avviket er ~0: da er det ingenting å forklare, og et forholdstall ville
 * dividert på støy og gitt et vilkårlig svar som ser presist ut.
 */
export function agreementRatio(diff: number, excess: number): number | null {
	if (Math.abs(diff) < 1) return null;
	// Motsatt fortegn betyr at de to beregningene peker i hver sin retning — altså ingen
	// forklaring i det hele tatt, ikke en dårlig én.
	if (Math.sign(diff) !== Math.sign(excess)) return 0;
	const ratio = Math.abs(excess) / Math.abs(diff);
	// Over 1 forklarer overskuddet MER enn avviket. Det er også et dårlig tegn — da ville en
	// dedup gått for langt — så avstanden fra 1 er det som teller, i begge retninger.
	return Math.round(Math.min(ratio, 1 / ratio) * 1000) / 1000;
}

/** Under dette kan saldoen ikke brukes som orakel for en dedup. */
export const AGREEMENT_TRUSTWORTHY = 0.9;

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
