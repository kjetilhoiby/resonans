/**
 * Øktkarakter: rolig, grå eller hard — og fordelingen over tid.
 *
 * ## Hvorfor ikke bare summere tid i sone
 *
 * Dette er den ene innsikten modulen finnes for, og den går mot magefølelsen:
 * **tid-i-sone finner ikke «dritten i midten».**
 *
 * `hrZoneDistribution` er andel av tid INNAD i én økt. Hver hard økt bærer
 * oppvarming, pauser mellom dragene og nedjogg i de lave sonene:
 *
 * | Økt | Z1–2 | Z3 | Z4–5 |
 * |---|---|---|---|
 * | Skikkelig intervalløkt | 75 % | 10 % | 15 % |
 * | Grå 50-minutter i moderat | 30 % | 65 % | 5 % |
 *
 * Aggregerer du minuttene over en måned, kommer begge ut som «mest rolig». Det
 * er derfor 80/20-regelen konvensjonelt telles på ØKTER, ikke på minutter: det
 * er øktens karakter som er treningsstimulusen, ikke fordelingen av minutter
 * inni den.
 *
 * Så: klassifiser hver økt først, fordel deretter.
 *
 * ## Terskelene er en proxy, og flaten skal si det
 *
 * Polarisert trening er definert av laktatterskler (under LT1 / mellom LT1 og
 * LT2 / over LT2). Vi måler ikke laktat, og HRR-sonene er ikke de samme
 * grensene. Klassifiseringen her er en tilnærming som er god nok til å skille de
 * tre karakterene fra hverandre — men den er ikke god nok til å si «du er
 * 68/22/10». Det ærlige utfallet er «grå er din største bøtte».
 */


/**
 * En økts sonefordeling, slik den ligger lagret på `canonical_workouts`.
 * Andeler av tid, summerer til ~1.
 */
export interface SessionZoneShares {
	z1?: number | null;
	z2?: number | null;
	z3?: number | null;
	z4?: number | null;
	z5?: number | null;
}

/**
 * Baselinen sonefordelingen på en økt BLE REGNET MOT.
 *
 * Ligger lagret på hver `canonical_workouts`-rad sammen med andelene, og det er
 * ikke pynt: andelene er allerede bøttet, så en rad regnet mot en annen makspuls
 * kan ikke klassifiseres på nytt uten å reanalysere sporet.
 */
export interface SessionZoneBaseline {
	basis: string;
	restHr: number;
	maxHr: number;
}

export interface SessionInput {
	date: string;
	distanceKm: number | null;
	durationSeconds: number | null;
	/** `null` når økta ikke har brukbar puls — se `classifiedShare`. */
	zones: SessionZoneShares | null;
	/** Hva andelene ble regnet mot. `null` på eldre rader uten feltet. */
	zoneBaseline?: SessionZoneBaseline | null;
}

/**
 * Hvor mye hvile- eller makspulsen får avvike fra dagens baseline før en lagret
 * sonefordeling regnes som ubrukelig.
 *
 * **To slag, og det er ikke strengt for strenghetens skyld.** Z4-grensa ligger på
 * 80 % av reserven, så fem slag feil makspuls flytter den fire slag. Det er nok
 * til å flytte en økt fra «rolig» til «hard», og det er nettopp den feilen som
 * gjorde at 72 % av nitti dagers historikk kom ut som hard 2. september 2026 —
 * et tall som ikke stemte med brukerens egne økter på puls 120–136.
 */
export const MAX_BASELINE_DRIFT_BPM = 2;

/**
 * Kan en lagret fordeling brukes mot dagens baseline?
 *
 * `basis` må være `hrr`: en fordeling regnet på ren %makspuls hører til
 * sonemodellen vi forlot, og andelene er ikke sammenlignbare med HRR-bånd.
 *
 * Uten lagret baseline svarer vi `true` — vi kan ikke vite, og å avvise all
 * historikk fra før feltet fantes ville tømt flaten. Det er en bevisst
 * innrømmelse, og `describeComposition` sier hvor mange rader den gjelder.
 */
export function isBaselineComparable(
	stored: SessionZoneBaseline | null | undefined,
	current: SessionZoneBaseline | null | undefined
): boolean {
	if (!stored || !current) return true;
	if (stored.basis !== 'hrr') return false;
	return (
		Math.abs(stored.restHr - current.restHr) <= MAX_BASELINE_DRIFT_BPM &&
		Math.abs(stored.maxHr - current.maxHr) <= MAX_BASELINE_DRIFT_BPM
	);
}

/**
 * Karakteren en økt har.
 *
 * `ukjent` er en egen verdi og ikke utelatt fra typen, fordi «vi klarte ikke å
 * klassifisere denne» er et utfall flaten MÅ kunne vise. Skjules de ukjente,
 * ser en sammensetning bygget på tre av tolv økter like autoritativ ut som en
 * bygget på alle tolv.
 */
export type SessionCharacter = 'rolig' | 'graa' | 'hard' | 'ukjent';

export const CHARACTER_LABELS: Record<SessionCharacter, string> = {
	rolig: 'Rolig',
	graa: 'Grå',
	hard: 'Hard',
	ukjent: 'Uklassifisert'
};

/**
 * Andel av tida i sone 4–5 som gjør en økt HARD.
 *
 * ## Hvorfor dette IKKE er `MAX_HARD_SHARE` fra `aerobic-efficiency.ts`
 *
 * Det var første utgave, med begrunnelsen «to terskler for hard ville drevet fra
 * hverandre». En test avslørte at det var feil, og at de to svarer på ulike
 * spørsmål.
 *
 * `MAX_HARD_SHARE` er 0,25 og brukes til å HOLDE økter UTE av EF-trenden. Der er
 * en høy terskel riktig og konservativ: å utelate for få økter fra en trend er en
 * liten feil.
 *
 * Som klassifiserer er 0,25 alt for høyt. En ekte intervalløkt ligger typisk på
 * 10–20 % av tida i sone 4–5, fordi oppvarming, pauser mellom dragene og nedjogg
 * eier klokka. Med 0,25 ble en økt med 4×4 minutter hardt stemplet **rolig** — og
 * det er den mest polariserte økta i uka.
 *
 * Åtte prosent er rundt fem minutter i en time. Under det er vi i
 * bakketopp-territorium på en ellers rolig tur.
 */
export const HARD_ZONE45_SHARE = 0.08;

/**
 * Absolutt minimum tid i sone 4–5 for at en økt skal regnes som hard.
 *
 * Andelen alene er ikke nok i begge ender: 8 % av en 20-minutters joggetur er
 * halvannet minutt, altså to bakker og en feilmåling. Kravet gjelder sammen med
 * andelen, ikke i stedet for den — en langtur på to timer med tolv minutter i
 * sone 4 består tidskravet, men 12 av 120 minutter er 10 % og da SKAL den regnes
 * som en økt med hardt innhold.
 *
 * Uten varighet på økta faller vi tilbake på andelen alene.
 */
export const MIN_HARD_SECONDS = 240;

/**
 * Over dette er økta ikke lenger ROLIG.
 *
 * Romslig med vilje: en rolig langtur krysser Z3 i hver bakke, og en rolig økt
 * som blir kalt grå på grunn av terrenget er en feil brukeren ikke kan gjøre noe
 * med. Det er den vedvarende moderate innsatsen vi er ute etter.
 */
export const EASY_MAX_ABOVE_Z2_SHARE = 0.2;

/**
 * Under dette er en økt uten Z4–5 heller ikke grå — den er bare en rolig økt med
 * litt kupert terreng. Grå krever at moderat var *hovedinnholdet*.
 */
export const GREY_MIN_Z3_SHARE = 0.35;

function share(value: number | null | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Karakteren til én økt.
 *
 * Rekkefølgen er ikke tilfeldig: **hard sjekkes først.** En intervalløkt kan ha
 * mye Z3 (dragene passerer gjennom den, og pausene ligger der), så en
 * grå-sjekk foran ville stemplet skikkelige intervalløkter som grå — altså
 * nøyaktig motsatt av det modulen skal fange.
 */
export function characterOf(
	zones: SessionZoneShares | null,
	durationSeconds?: number | null
): SessionCharacter {
	if (!zones) return 'ukjent';

	const z3 = share(zones.z3);
	const hardShare = share(zones.z4) + share(zones.z5);
	const aboveEasy = z3 + hardShare;

	const hardSecondsOk =
		typeof durationSeconds === 'number' && durationSeconds > 0
			? hardShare * durationSeconds >= MIN_HARD_SECONDS
			: true;
	if (hardShare >= HARD_ZONE45_SHARE && hardSecondsOk) return 'hard';
	if (aboveEasy <= EASY_MAX_ABOVE_Z2_SHARE) return 'rolig';
	if (z3 >= GREY_MIN_Z3_SHARE) return 'graa';
	// Mellom rolig og grå: mer moderat enn en rolig tur, men ikke nok til at
	// moderat var innholdet. Regnes som rolig — å kalle en tur grå den ikke var
	// er verre enn å la den stå, siden hele poenget er å FÅ NED grå-andelen.
	return 'rolig';
}

export interface CharacterBucket {
	character: SessionCharacter;
	sessions: number;
	km: number;
	/** Andel av de KLASSIFISERTE øktene (0–1). */
	sessionShare: number;
	/** Andel av kilometerne blant de klassifiserte øktene (0–1). */
	kmShare: number;
}

export interface CharacterComposition {
	windowDays: number;
	buckets: CharacterBucket[];
	/** Antall økter i vinduet, klassifiserte og ikke. */
	totalSessions: number;
	/** Antall som kunne klassifiseres. */
	classifiedSessions: number;
	/** Antall som mangler pulskurve i det hele tatt. */
	missingZonesSessions: number;
	/**
	 * Antall som HAR pulskurve, men som ble analysert mot en annen baseline enn
	 * dagens — og derfor ikke kan klassifiseres.
	 *
	 * Skilt fra `missingZonesSessions` fordi handlingen er en annen: dette rettes
	 * av `POST /api/sensors/workouts/reanalyze`, ikke av å bruke pulsbelte.
	 */
	staleBaselineSessions: number;
	/**
	 * Andel av øktene vi kunne klassifisere (0–1).
	 *
	 * **Flaten SKAL vise dette.** Sonefordeling krever puls per punkt; en økt fra
	 * klokka kan ha snittpuls uten kurve. Er dekningen 40 %, er sammensetningen et
	 * utvalg og ikke et faktum, og en flate som ikke sier det lyver ved
	 * utelatelse. Samme regel som `socialFilterable` i skjermtid: skill «0 vi
	 * målte» fra «0 vi ikke målte».
	 */
	coverage: number;
}

/**
 * Under denne dekningen skal flaten si at grunnlaget er tynt framfor å vise en
 * fordeling. Halvparten er valgt fordi en fordeling bygget på under halvparten
 * av øktene kan snus av de øktene som mangler.
 */
export const MIN_TRUSTWORTHY_COVERAGE = 0.5;

/** Under så mange klassifiserte økter er en fordeling ikke en fordeling. */
export const MIN_CLASSIFIED_SESSIONS = 5;

const ORDER: SessionCharacter[] = ['rolig', 'graa', 'hard'];

/**
 * Fordelingen over et vindu.
 *
 * Andelene regnes av de KLASSIFISERTE øktene, ikke av alle: en nevner som
 * inkluderer de ukjente ville fått alle tre bøttene til å krympe når dekningen
 * falt, og det leses som en endring i treningen. Dekningen rapporteres ved
 * siden av i stedet.
 */
export function composeCharacters(
	sessions: readonly SessionInput[],
	windowDays: number,
	currentBaseline?: SessionZoneBaseline | null
): CharacterComposition {
	const counts = new Map<SessionCharacter, { sessions: number; km: number }>();
	for (const c of [...ORDER, 'ukjent' as const]) counts.set(c, { sessions: 0, km: 0 });

	let missingZonesSessions = 0;
	let staleBaselineSessions = 0;

	for (const session of sessions) {
		const stale =
			session.zones !== null && !isBaselineComparable(session.zoneBaseline, currentBaseline);
		if (session.zones === null) missingZonesSessions += 1;
		if (stale) staleBaselineSessions += 1;

		// En rad regnet mot en annen makspuls er IKKE en rad vi kan klassifisere.
		// Andelene er alt bøttet av de gamle båndene; å telle dem er å telle noe
		// annet enn det etiketten sier.
		const character = stale ? 'ukjent' : characterOf(session.zones, session.durationSeconds);
		const bucket = counts.get(character)!;
		bucket.sessions += 1;
		bucket.km += session.distanceKm ?? 0;
	}

	const classifiedSessions = ORDER.reduce((sum, c) => sum + counts.get(c)!.sessions, 0);
	const classifiedKm = ORDER.reduce((sum, c) => sum + counts.get(c)!.km, 0);

	const buckets: CharacterBucket[] = ORDER.map((character) => {
		const bucket = counts.get(character)!;
		return {
			character,
			sessions: bucket.sessions,
			km: Math.round(bucket.km * 10) / 10,
			sessionShare: classifiedSessions > 0 ? bucket.sessions / classifiedSessions : 0,
			kmShare: classifiedKm > 0 ? bucket.km / classifiedKm : 0
		};
	});

	return {
		windowDays,
		buckets,
		totalSessions: sessions.length,
		classifiedSessions,
		missingZonesSessions,
		staleBaselineSessions,
		coverage: sessions.length > 0 ? classifiedSessions / sessions.length : 0
	};
}

export function bucketFor(
	composition: CharacterComposition,
	character: SessionCharacter
): CharacterBucket | null {
	return composition.buckets.find((b) => b.character === character) ?? null;
}

/** Er grunnlaget godt nok til å si noe? */
export function isCompositionTrustworthy(composition: CharacterComposition): boolean {
	return (
		composition.classifiedSessions >= MIN_CLASSIFIED_SESSIONS &&
		composition.coverage >= MIN_TRUSTWORTHY_COVERAGE
	);
}

/**
 * Andelen rolig som konvensjonelt regnes som polarisert nok.
 *
 * 80/20 er en tommelfingerregel med bred støtte, men den er ikke en grense
 * kroppen kjenner — og den telles på økter, som er hva vi gjør her.
 */
export const POLARIZED_EASY_TARGET = 0.8;

/**
 * Over dette er grå-andelen verdt å nevne.
 *
 * En femtedel av øktene i det moderate feltet er ikke et problem — noen økter
 * ER terskeløkter, og en langtur i kupert terreng kan lande der. Det er når grå
 * begynner å konkurrere med rolig at stimulusen blir utvannet i begge ender.
 */
export const GREY_CONCERN_SHARE = 0.3;

/**
 * Setningen flaten og chatten deler.
 *
 * Bor i domenelaget av samme grunn som `describeTrailingVolume`: den bærer
 * forbeholdene — at klassifiseringen er en proxy, og hvor mange økter den
 * hviler på. Fikk modellen bare tre tall, ville den funnet sine egne ord, og
 * «32 % grå» ble like gjerne «du trener feil» som «her er det noe å hente».
 */
export function describeComposition(composition: CharacterComposition): string {
	const {
		windowDays,
		classifiedSessions,
		totalSessions,
		coverage,
		missingZonesSessions,
		staleBaselineSessions
	} = composition;

	/** «1 økt» / «3 økter» — «1 økter» sto på flaten og var synlig for brukeren. */
	const sessionWord = (n: number) => (n === 1 ? 'økt' : 'økter');

	if (classifiedSessions === 0) {
		if (totalSessions === 0) return `Ingen økter siste ${windowDays} dager.`;
		if (staleBaselineSessions > 0) {
			return `${totalSessions} ${sessionWord(totalSessions)} siste ${windowDays} dager, men alle er analysert mot en annen makspuls enn den vi bruker nå. Kjør en reanalyse før sammensetningen kan leses.`;
		}
		return `${totalSessions} ${sessionWord(totalSessions)} siste ${windowDays} dager, men ingen med pulskurve — sammensetningen kan ikke regnes.`;
	}

	if (!isCompositionTrustworthy(composition)) {
		const why =
			staleBaselineSessions > missingZonesSessions
				? 'er analysert mot en annen makspuls'
				: 'mangler pulskurve';
		return `Bare ${classifiedSessions} av ${totalSessions} ${sessionWord(totalSessions)} siste ${windowDays} dager kan klassifiseres — resten ${why}. For tynt til å si noe om sammensetningen.`;
	}

	const easy = bucketFor(composition, 'rolig')!;
	const grey = bucketFor(composition, 'graa')!;
	const hard = bucketFor(composition, 'hard')!;

	const pct = (v: number) => Math.round(v * 100);
	const parts = [
		`Siste ${windowDays} dager: ${pct(easy.sessionShare)} % rolig, ${pct(grey.sessionShare)} % grå, ${pct(hard.sessionShare)} % hard — av ${classifiedSessions} ${sessionWord(classifiedSessions)}.`
	];

	if (grey.sessionShare > GREY_CONCERN_SHARE) {
		parts.push(
			`Grå-andelen er høy. Det er den som gir minst igjen: for hard til å bygge grunnmur, for lett til å flytte terskelen.`
		);
	} else if (easy.sessionShare >= POLARIZED_EASY_TARGET && hard.sessions > 0) {
		parts.push('Godt polarisert — mye rolig og noe hardt, lite i midten.');
	} else if (hard.sessions === 0) {
		parts.push('Ingen harde økter i vinduet. Rolig grunnmur uten noe å strekke seg mot.');
	}

	// De to grunnene til å utelate en økt har ulike LØSNINGER, så de sies hver for
	// seg: pulskurve krever pulsbelte, gammel baseline krever en reanalyse.
	if (missingZonesSessions > 0) {
		parts.push(
			`${missingZonesSessions} ${sessionWord(missingZonesSessions)} mangler pulskurve og er ikke med.`
		);
	}
	if (staleBaselineSessions > 0) {
		parts.push(
			`${staleBaselineSessions} ${sessionWord(staleBaselineSessions)} er analysert mot en annen makspuls og er ikke med — en reanalyse tar dem inn.`
		);
	}
	void coverage;

	return parts.join(' ');
}
