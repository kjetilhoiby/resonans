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
	oldestDate: string | null;
	newestDate: string | null;
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

export function dagerMellom(fra: string, til: string): number | null {
	const a = Date.parse(`${fra.slice(0, 10)}T00:00:00Z`);
	const b = Date.parse(`${til.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) return null;
	return Math.round((b - a) / 86_400_000);
}

export function vurderKonto(rad: ProbeRad): KontoVurdering {
	const muligKappet = rad.count > 0 && SIDEGRENSER.includes(rad.count);
	const spennDager =
		rad.oldestDate && rad.newestDate ? dagerMellom(rad.oldestDate, rad.newestDate) : null;

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
		oldestDate: rad.oldestDate,
		newestDate: rad.newestDate,
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
