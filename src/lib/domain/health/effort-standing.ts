/**
 * To dommer over ei treningsuke — og de er ikke den samme.
 *
 * ## Hvorfor de er skilt
 *
 * Flaten viste dem med samme uttrykk fram til august 2026: ett gult «Hvil»-merke
 * og én statuslinje som ble overskrevet av belastningsvarselet. Da leser man
 * «513 av 235–282» som en påstand om kroppen. Det er den ikke.
 *
 * - **Budsjettet** (`describeBudgetStanding`) sier om uka følger progresjonsplanen.
 *   Over båndet betyr at du gjorde mer enn planen ba om — et regnskap, ikke en
 *   advarsel. Strava kalte den samme uka «du har trappet opp litt» mens vi sa
 *   «82 % over», og forskjellen lå i rammen, ikke i tallet.
 * - **Belastningen** (`describeAcuteChronic`) sammenligner de tre siste dagene med
 *   de siste tretti. Det er den ENESTE av de to som er formet som et
 *   restitusjonssignal, og den eneste som skal ha varselfarge.
 *
 * Ordene bor her framfor i `.svelte`-fila fordi chatten må si det samme som
 * skjermen — samme grunn som `classifyTsb` ble flyttet ut av `LoadBalanceCard`.
 *
 * Vi diagnostiserer ingenting. «Ta en rolig dag» er et råd; vi sier ikke hva som
 * skjer i kroppen, fordi vi ikke måler det.
 */

export type BudgetStanding = 'under' | 'i_band' | 'over';

export interface BudgetVerdict {
	standing: BudgetStanding;
	/** Kort merkelapp, f.eks. til et kort-hode. */
	label: string;
	/** Hel setning til flaten og chatten. */
	text: string;
}

export function describeBudgetStanding(
	spentThisWeek: number,
	bandMin: number,
	bandMax: number,
	/** Sykdom i uka: båndet er senket, og setningen må si hvorfor. */
	sick = false
): BudgetVerdict {
	if (sick) {
		// Ingen «under planen» i en sykeuke. Gulvet er null, så det finnes ikke noe
		// å ligge under — og en setning om at det er «rom igjen» ville lest som en
		// oppfordring til å trene med feber.
		if (spentThisWeek > bandMax) {
			return {
				standing: 'over',
				label: 'Over sykeukas ramme',
				text: `Du er meldt syk, og uka er over den senkede rammen (0–${bandMax}). Rammen er et budsjett, ikke en grense — men den er satt lavt med vilje.`
			};
		}
		return {
			standing: 'i_band',
			label: 'Sykeuke',
			text: `Du er meldt syk, så ukas ramme er senket til 0–${bandMax}. Ingenting kreves.`
		};
	}
	if (spentThisWeek < bandMin) {
		return {
			standing: 'under',
			label: 'Under ukas plan',
			text: `Under ukas plan (${bandMin}–${bandMax}) — det er rom igjen.`
		};
	}
	if (spentThisWeek > bandMax) {
		return {
			standing: 'over',
			label: 'Over ukas plan',
			// Setningen sier eksplisitt hva et budsjett ER, fordi tallet ellers
			// leses som en grense man har brutt.
			text: `Over ukas plan (${bandMin}–${bandMax}) — planen er et budsjett, ikke en grense.`
		};
	}
	return {
		standing: 'i_band',
		label: 'I ukas plan',
		text: `Innenfor ukas plan (${bandMin}–${bandMax}) — resten av uka er valgfri.`
	};
}

export type LoadLevel = 'rolig' | 'normal' | 'høy';

export interface LoadVerdict {
	level: LoadLevel;
	ratio: number;
	label: string;
	text: string;
}

/**
 * Under dette ligger de siste tre dagene merkbart under din egen måned.
 *
 * Ikke et varsel — bare det motsatte hjørnet av samme akse, så en rolig periode
 * kan leses like tydelig som en travel.
 */
export const QUIET_RATIO = 0.8;

/**
 * Akutt (siste 3 dager) mot kronisk (dagsnitt siste 30 × 3).
 *
 * `null` inn — under 14 dagers historikk — gir `null` ut. En ratio regnet på
 * fire dagers historikk er et tall uten innhold, og et tall uten innhold får
 * varselfarge like lett som et ekte.
 *
 * Terskelen sendes IKKE inn: den er brukerkonfigurerbar (`hvileRatioTerskel`) og
 * bor på treningsløpet, så `restRecommended` er allerede regnet mot den. Å ta
 * terskelen som argument her ville gitt flaten en andre kopi å ta feil av.
 */
export function describeAcuteChronic(
	ratio: number | null,
	restRecommended: boolean
): LoadVerdict | null {
	if (ratio === null || !Number.isFinite(ratio)) return null;
	const nb = ratio.toFixed(2).replace('.', ',');

	if (restRecommended) {
		return {
			level: 'høy',
			ratio,
			label: 'Høy belastning',
			text: `Siste 3 dager ligger ${nb}× over snittet siste 30 — ta en rolig dag.`
		};
	}
	if (ratio < QUIET_RATIO) {
		return {
			level: 'rolig',
			ratio,
			label: 'Rolig periode',
			text: `Siste 3 dager ligger ${nb}× av snittet siste 30 — godt uthvilt.`
		};
	}
	return {
		level: 'normal',
		ratio,
		label: 'Normal belastning',
		text: `Siste 3 dager ligger ${nb}× av snittet siste 30 — vanlig for deg.`
	};
}

/**
 * Hvor ankeret kom fra, med ord.
 *
 * Teksten sier antall uker fordi et glattet anker ellers ikke er til å skille fra
 * det gamle «basert på forrige uke» — og hele poenget med endringen var at én uke
 * ikke skal bestemme neste ukes mål alene.
 */
export function describeAnchor(anchor: 'snitt_uker' | 'gulv', anchorWeeks: number): string {
	if (anchor === 'gulv') return 'forsiktig oppstartsnivå';
	if (anchorWeeks <= 1) return 'basert på forrige uke';
	return `snitt av siste ${anchorWeeks} uker`;
}
