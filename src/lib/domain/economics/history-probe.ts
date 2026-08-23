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
	/** Datoen flere kontoer deler som eldste – fingeravtrykket til et rullerende vindu. */
	fellesGulv: string | null;
	/** Hvor langt tilbake vinduet rekker, målt fra i dag. */
	vindusDager: number | null;
	begrunnelse: string;
}

/**
 * Finner datoen minst to kontoer deler som sin eldste.
 *
 * Dette er det sterkeste signalet vi har, og det er ikke antall rader.
 * En ekte kort historikk gir ULIK startdato per konto — hver konto har sin
 * egen første transaksjon. Deler flere kontoer eksakt samme gulv, er det
 * ikke kontoene som er unge; det er banken som har et vindu.
 *
 * Målt 21. august 2026: seks kontoer startet alle på 2024-08-21, altså
 * nøyaktig to år tilbake.
 */
export function finnFellesGulv(vurderinger: KontoVurdering[]): string | null {
	const antall = new Map<string, number>();
	for (const v of vurderinger) {
		if (!v.oldestDate || v.count === 0) continue;
		antall.set(v.oldestDate, (antall.get(v.oldestDate) ?? 0) + 1);
	}
	let gulv: string | null = null;
	for (const [dato, n] of Array.from(antall.entries())) {
		if (n < 2) continue;
		if (gulv === null || dato < gulv) gulv = dato;
	}
	return gulv;
}

export function konkluder(vurderinger: KontoVurdering[], iDag?: string): Konklusjon {
	const idag = iDag ?? new Date().toISOString().slice(0, 10);
	const medData = vurderinger.filter((v) => v.count > 0);
	if (medData.length === 0) {
		return {
			kanHentesIgjen: null,
			eldsteDato: null,
			fellesGulv: null,
			vindusDager: null,
			begrunnelse: 'Ingen transaksjoner kom tilbake. Er kontoene tomme, eller mangler tilsagn?'
		};
	}

	const eldsteDato = medData
		.map((v) => v.oldestDate)
		.filter((d): d is string => !!d)
		.sort()[0] ?? null;

	const fellesGulv = finnFellesGulv(medData);
	// Vinduet måles fra I DAG, ikke fra nyeste transaksjon. En konto uten
	// bevegelse på tre uker ville ellers sett ut som et kortere vindu enn den har.
	const vindusDager = fellesGulv ? dagerMellom(fellesGulv, idag) : null;

	const kappede = medData.filter((v) => v.verdikt === 'kappet');
	if (kappede.length > 0) {
		return {
			kanHentesIgjen: null,
			eldsteDato,
			fellesGulv,
			vindusDager,
			begrunnelse:
				`${kappede.length} av ${medData.length} kontoer traff en sidegrense, så eldste dato ` +
				`(${eldsteDato ?? 'ukjent'}) er et gulv og ikke sannheten. Historikken kan gå lenger ` +
				'tilbake. Paginer for å få et ekte svar.'
		};
	}

	// Et delt gulv slår ut FØR spennet vurderes, og er hele poenget: det skiller
	// «banken har et vindu» fra «kontoene er unge». Uten det ble et 24-måneders
	// vindu kalt «kort historikk» fordi 729 dager lå én dag under terskelen.
	if (fellesGulv && vindusDager !== null) {
		const mnd = Math.round(vindusDager / 30.44);
		return {
			kanHentesIgjen: false,
			eldsteDato,
			fellesGulv,
			vindusDager,
			begrunnelse:
				`${medData.filter((v) => v.oldestDate === fellesGulv).length} kontoer starter på ` +
				`nøyaktig samme dato (${fellesGulv}). Det er ikke unge kontoer, det er et ` +
				`rullerende vindu på ${mnd} måneder. Alt eldre finnes bare hos oss — ` +
				'canonical_bank_transactions kan ikke gjenskapes fra API-et.'
		};
	}

	const lengste = Math.max(...medData.map((v) => v.spennDager ?? 0));
	if (lengste >= LANG_HISTORIKK_DAGER) {
		return {
			kanHentesIgjen: true,
			eldsteDato,
			fellesGulv,
			vindusDager,
			begrunnelse:
				`Banken ga oss ${Math.round(lengste / 30)} måneder i ett kall, tilbake til ` +
				`${eldsteDato}. Transaksjonshistorikken kan hentes inn igjen.`
		};
	}

	return {
		kanHentesIgjen: false,
		eldsteDato,
		fellesGulv,
		vindusDager,
		begrunnelse:
			`Lengste svar dekket ${lengste} dager, tilbake til ${eldsteDato}, og kontoene deler ` +
			'ingen felles startdato. Alt eldre finnes bare hos oss — ' +
			'canonical_bank_transactions kan ikke gjenskapes fra API-et.'
	};
}

export interface EksplisittSjekk {
	/** Sant når banken svarer likt enten vi spør eksplisitt eller ikke. */
	vinduetErBankens: boolean;
	eldsteVedEksplisitt: string | null;
	begrunnelse: string;
}

/**
 * Banken avviste en dato utenfor vinduet.
 *
 * Målt 22. august 2026: `fromDate=2015-01-01` ga HTTP 400. Et API som NEKTER
 * å svare på en gammel dato, framfor å returnere tom liste, har et vindu det
 * håndhever. Det er sterkere bevis enn et tomt svar, som også kunne betydd
 * «ingen transaksjoner den gangen».
 */
export function tolkAvvistDato(status: number, spurtFra: string): EksplisittSjekk {
	return {
		vinduetErBankens: true,
		eldsteVedEksplisitt: null,
		begrunnelse:
			`Banken avviste fromDate=${spurtFra} med HTTP ${status} — den nektet å svare, ` +
			'framfor å gi tom liste. Et API som håndhever datoen slik, har et vindu. ' +
			'Vinduet er bankens.'
	};
}

/**
 * Kontrollspørsmålet: gir banken mer hvis vi ber eksplisitt om en eldre dato?
 *
 * Uten dette kan vi ikke skille to helt ulike verdener:
 *
 *   «banken HAR bare 24 måneder»
 *   «banken gir 24 måneder til den som ikke spør bedre»
 *
 * Mange API-er svarer med et standardvindu når `fromDate` mangler, og
 * respekterer en eldre dato hvis den oppgis. Vår probe spurte lenge aldri
 * eksplisitt, og konklusjonen «kan ikke gjenskapes» hvilte dermed på en
 * antakelse vi ikke hadde testet. Det er en dyr antakelse: den brukes til å
 * avgjøre hva som må tas vare på.
 */
/** Dagen før en ISO-dato. Brukes til å spørre banken om nøyaktig ett døgn
 *  utenfor vinduet — det skarpeste kontrollspørsmålet vi kan stille. */
export function dagenFør(iso: string): string {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

export function vurderEksplisittFra(
	gulvUtenFilter: string | null,
	eldsteVedEksplisitt: string | null,
	spurtFra: string
): EksplisittSjekk {
	if (!eldsteVedEksplisitt) {
		return {
			vinduetErBankens: true,
			eldsteVedEksplisitt: null,
			begrunnelse:
				`Banken ga ingenting da vi ba eksplisitt om ${spurtFra}. Vinduet er bankens.`
		};
	}

	if (!gulvUtenFilter) {
		return {
			vinduetErBankens: false,
			eldsteVedEksplisitt,
			begrunnelse: `Med eksplisitt fromDate=${spurtFra} kom det data tilbake til ${eldsteVedEksplisitt}.`
		};
	}

	if (eldsteVedEksplisitt < gulvUtenFilter) {
		const dager = dagerMellom(eldsteVedEksplisitt, gulvUtenFilter);
		return {
			vinduetErBankens: false,
			eldsteVedEksplisitt,
			begrunnelse:
				`Banken ga oss ${dager} dager MER da vi ba eksplisitt om ${spurtFra}: ` +
				`tilbake til ${eldsteVedEksplisitt} mot ${gulvUtenFilter} uten filter. ` +
				'Standardvinduet var vårt problem, ikke bankens grense — og backfill bør ' +
				'alltid oppgi fromDate.'
		};
	}

	return {
		vinduetErBankens: true,
		eldsteVedEksplisitt,
		begrunnelse:
			`Banken svarte likt (${eldsteVedEksplisitt}) da vi ba eksplisitt om ${spurtFra}. ` +
			'Vinduet er bankens, ikke en bieffekt av at vi ikke spurte.'
	};
}
