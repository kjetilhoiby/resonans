/**
 * Hvor langt tilbake gir banken oss transaksjoner?
 *
 * Spørsmålet er ikke akademisk: svaret avgjør om
 * `canonical_bank_transactions` er data som *kan hentes inn igjen*, eller data
 * som er borte for alltid hvis vi mister den. Se
 * `docs/changelog/2026-08-21-datakartlegging-for-flytting.md`.
 *
 * Den viktige fella er at et svar kan LYVE i vår favør. Returnerer banken
 * nøyaktig 100 (eller 200, eller 500) rader, har vi antakelig truffet en
 * sidegrense — og da er den eldste datoen vi ser et **gulv**, ikke sannheten.
 * Historikken kan gå mye lenger tilbake enn målingen viser. Motsatt vei finnes
 * ingen tvil: får vi 137 rader, er det alt som fins.
 *
 * Derfor har verdikten en egen tilstand for «vi vet ikke ennå», framfor å
 * gjette. Et gjettet svar her ville blitt brukt til å bestemme om det er trygt
 * å slette noe.
 */

/** Sidestørrelser vi har sett API-er bruke. Et treff på en av dem er mistenkelig. */
const SIDEGRENSER = [100, 200, 250, 500, 1000];

/** Under dette regnes historikken som kort nok til at den ikke kan gjenskapes. */
export const KORT_HISTORIKK_DAGER = 400;

/** Over dette er historikken så dyp at «kan hentes igjen» er trygt å si. */
export const LANG_HISTORIKK_DAGER = 730;

export interface ProbeRad {
	accountKey: string;
	name?: string | null;
	count: number;
	/** Rå fra banken: kan være ISO-streng, epoch-ms eller epoch-sekunder. */
	oldestDate: unknown;
	newestDate: unknown;
	/** Fra endepunktet: count > 0 && count % 100 === 0. Vi vurderer den på nytt her. */
	likelyCapped?: boolean;
}

export type Verdikt = 'ingen-data' | 'kappet' | 'kort-historikk' | 'lang-historikk';

export interface KontoVurdering {
	accountKey: string;
	name: string | null;
	count: number;
	oldestDate: string | null;
	newestDate: string | null;
	spennDager: number | null;
	verdikt: Verdikt;
	/** Sant når antallet treffer en sidegrense, altså når eldste dato er et gulv. */
	muligKappet: boolean;
}

/**
 * Gjør bankens datoverdi om til `YYYY-MM-DD`.
 *
 * SpareBank1 sender `date` som **epoch-millisekunder**, ikke som ISO-streng —
 * `sparebank1-sync.ts` har alltid visst det (`typeof transaction.date ===
 * 'number'`), men proben antok streng og krasjet med «slice is not a
 * function» første gang den ble trykket på i produksjon.
 *
 * Vi tar imot alle tre formene framfor å stole på én, siden dette er et
 * diagnoseverktøy: det skal tåle å bli pekt på et svar vi ikke har sett før.
 */
export function normaliserDato(verdi: unknown): string | null {
	if (verdi === null || verdi === undefined) return null;

	if (verdi instanceof Date) {
		return Number.isNaN(verdi.getTime()) ? null : verdi.toISOString().slice(0, 10);
	}

	if (typeof verdi === 'number') {
		if (!Number.isFinite(verdi)) return null;
		// Under 1e11 er tallet sekunder (1e11 ms er 1973); over er det millisekunder.
		const ms = Math.abs(verdi) < 1e11 ? verdi * 1000 : verdi;
		const d = new Date(ms);
		return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
	}

	if (typeof verdi === 'string') {
		const trimmet = verdi.trim();
		if (!trimmet) return null;
		// Et tall som streng er fortsatt et tidsstempel.
		if (/^\d{9,}$/.test(trimmet)) return normaliserDato(Number(trimmet));
		const dato = trimmet.slice(0, 10);
		return /^\d{4}-\d{2}-\d{2}$/.test(dato) ? dato : null;
	}

	return null;
}

export function dagerMellom(fra: string, til: string): number | null {
	const a = Date.parse(`${fra.slice(0, 10)}T00:00:00Z`);
	const b = Date.parse(`${til.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) return null;
	return Math.round((b - a) / 86_400_000);
}

export function vurderKonto(rad: ProbeRad): KontoVurdering {
	const muligKappet = rad.count > 0 && SIDEGRENSER.includes(rad.count);
	const eldste = normaliserDato(rad.oldestDate);
	const nyeste = normaliserDato(rad.newestDate);
	const spennDager = eldste && nyeste ? dagerMellom(eldste, nyeste) : null;

	let verdikt: Verdikt;
	if (rad.count === 0) {
		verdikt = 'ingen-data';
	} else if (muligKappet) {
		// Rekkefølgen er med vilje: kappet slår ut FØR spennet vurderes. Et kappet
		// svar kan tilfeldigvis dekke tre år og likevel skjule tjue.
		verdikt = 'kappet';
	} else if (spennDager !== null && spennDager >= LANG_HISTORIKK_DAGER) {
		verdikt = 'lang-historikk';
	} else {
		verdikt = 'kort-historikk';
	}

	return {
		accountKey: rad.accountKey,
		name: rad.name ?? null,
		count: rad.count,
		oldestDate: eldste,
		newestDate: nyeste,
		spennDager,
		verdikt,
		muligKappet
	};
}

export interface Konklusjon {
	/** true = kan hentes igjen, false = kan ikke, null = uvisst (kappet svar). */
	kanHentesIgjen: boolean | null;
	eldsteDato: string | null;
	begrunnelse: string;
}

export function konkluder(vurderinger: KontoVurdering[]): Konklusjon {
	const medData = vurderinger.filter((v) => v.count > 0);
	if (medData.length === 0) {
		return {
			kanHentesIgjen: null,
			eldsteDato: null,
			begrunnelse: 'Ingen transaksjoner kom tilbake. Er kontoene tomme, eller mangler tilsagn?'
		};
	}

	const eldsteDato = medData
		.map((v) => v.oldestDate)
		.filter((d): d is string => !!d)
		.sort()[0] ?? null;

	const kappede = medData.filter((v) => v.verdikt === 'kappet');
	if (kappede.length > 0) {
		return {
			kanHentesIgjen: null,
			eldsteDato,
			begrunnelse:
				`${kappede.length} av ${medData.length} kontoer traff en sidegrense, så eldste dato ` +
				`(${eldsteDato ?? 'ukjent'}) er et gulv og ikke sannheten. Historikken kan gå lenger ` +
				'tilbake. Paginer for å få et ekte svar.'
		};
	}

	const lengste = Math.max(...medData.map((v) => v.spennDager ?? 0));
	if (lengste >= LANG_HISTORIKK_DAGER) {
		return {
			kanHentesIgjen: true,
			eldsteDato,
			begrunnelse:
				`Banken ga oss ${Math.round(lengste / 30)} måneder i ett kall, tilbake til ` +
				`${eldsteDato}. Transaksjonshistorikken kan hentes inn igjen.`
		};
	}

	return {
		kanHentesIgjen: false,
		eldsteDato,
		begrunnelse:
			`Lengste svar dekket ${lengste} dager, tilbake til ${eldsteDato}. Alt eldre finnes ` +
			'bare hos oss — canonical_bank_transactions kan ikke gjenskapes fra API-et.'
	};
}
