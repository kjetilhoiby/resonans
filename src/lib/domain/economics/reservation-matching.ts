/**
 * Parring av foreldreløs reservasjon mot bokført rad.
 *
 * SB1 leverer samme kjøp flere ganger: først som reservasjon (PENDING), så som bokført
 * (BOOKED). Bøttenøkkelen i canonical inneholder både dato og `merchant_key`, og **begge
 * flytter seg mellom versjonene** — datoen med −2 til +7 dager, beskrivelsen når et
 * valutaprefiks faller bort («SEK ICA NARA HAGA» → «ICA NARA HAGA»). De to versjonene havner
 * derfor i ulike bøtter, upserten finner ingen konflikt, og beløpet telles to ganger.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 *
 * **Én-til-én, og det er ikke en detalj.** Første utgave av målingen var en LATERAL join som
 * ga hver reservasjon sin nærmeste bokførte rad uten å reservere den: tre PENDING på 255 kr
 * på samme konto kunne alle peke på det SAMME bokførte kjøpet, og tallet ble tre ganger for
 * stort. Det er nøyaktig samme feil som overføringstellingen hadde (950 050 kr «overføringer»
 * mot 936 489 kr totalt forbruk), og den ble gjentatt fordi SQL-joinen ser uskyldig ut.
 * Derfor bor matchingen her, rent og testet, framfor i en spørring.
 *
 * **Aldri slett, bare deaktiver.** Konsumenten skal sette `is_active = false` på
 * reservasjonen. Å telle for mye er trygt å rette; å fjerne noe brukeren faktisk gjorde er
 * det ikke — samme regel som for treningsøkter.
 *
 * **To ting holdes helt utenfor**, og begge ble oppdaget av tørrkjøringen i prod:
 *
 * 1. **Rader med ukjent status.** `bookingStatusRank` gir 0 for manglende status, og en
 *    utledning `booked = rank >= topRank` gjorde «vi vet ikke» til «ubokført reservasjon».
 * 2. **Interne overføringer.** De går i runde beløp som gjentas, og to separate overføringer
 *    på 2 500 kr innen tre dager ville blitt paret som reservasjon + bokført.
 *
 * Lisensen for å matche på beløp uten beskrivelse kom fra multiplisitetsmålingen — gjentatte
 * KJØP innenfor ett API-svar. Den gjelder ikke overføringer, og å anvende den der var å bruke
 * et tall målt på én populasjon som garanti for en annen.
 */

/** Standardvindu for datodrift mellom reservasjon og bokføring. */
export const DEFAULT_MAX_DELTA_DAYS = 3;

/** En bøtte i canonical-forstand: én rad, med statusen den nådde. */
export type ReservationCandidate = {
	/** Stabil id, brukes bare til å peke tilbake på raden. */
	id: string;
	accountId: string;
	/** YYYY-MM-DD */
	date: string;
	/** Negativ = ut av kontoen. Sammenlignes EKSAKT. */
	amount: number;
	merchantKey: string;
	/**
	 * Bokføringsstatusen, **tri-tilstand og ikke en boolean**.
	 *
	 * `unknown` deltar ikke i matchingen i det hele tatt — verken som reservasjon eller som
	 * motpart. Første utgave hadde `booked: boolean` utledet av `statusRank >= topRank`, og
	 * siden `bookingStatusRank` gir **0 for manglende status**, ble «vi vet ikke» behandlet som
	 * «ubokført reservasjon». I prod ga det par som «7 600 kr inn / 0 dager» og
	 * «2 500 kr ut ×2, 2 500 kr inn ×2» — runde beløp som er gjentatte overføringer, ikke to
	 * versjoner av ett kjøp.
	 *
	 * Det er samme felle som `startWorkout.type` hadde: en stille default som gjetter en
	 * KONKRET verdi er verre enn et avslag. Typen nekter nå å representere feilen.
	 */
	status: 'pending' | 'booked' | 'unknown';
	/**
	 * Sann når raden har en motpost på en annen egen konto samme dag.
	 *
	 * Interne overføringer holdes **utenfor matchingen**. De går i runde beløp som gjentas —
	 * 2 500, 4 000, 7 600 — og to separate overføringer på samme beløp innen tre dager ville
	 * blitt slått sammen til «reservasjon + bokført». Multiplisitetsmålingen som lisensierte
	 * beløpsmatching gjaldt gjentatte KJØP innenfor ett API-svar, altså en annen populasjon;
	 * den sier ingenting om hvor ofte man flytter 2 500 kr.
	 */
	internalTransfer?: boolean;
};

export type ReservationMatch = {
	/** Reservasjonen som skal deaktiveres. */
	reservationId: string;
	/** Den bokførte raden som beholdes. */
	bookedId: string;
	accountId: string;
	/** Alltid positivt — kronene som telles to ganger i dag. Se `direction` for fortegnet. */
	amount: number;
	/**
	 * `out` = penger ut (forbruk), `in` = penger inn (lønn, innskudd, overføring).
	 *
	 * **Må bæres, ikke utledes av kalleren.** `amount` er absoluttverdi, og en summering over
	 * alle par blander da et dobbelttalt lønnsinnskudd inn i «dobbelttalt forbruk». Det skjedde
	 * i prod: tallet gikk fra 154 703 til 258 117 kr da matchingen ble flyttet ut av SQL, fordi
	 * den gamle spørringen hadde `CASE WHEN s.amount < 0` og den nye ikke hadde noe tilsvarende.
	 * En reservasjon PÅ et innskudd er like duplisert og skal like fullt deaktiveres — den er
	 * bare ikke forbruk.
	 */
	direction: 'out' | 'in';
	/** Bokført dato minus reservasjonsdato. Kan være negativ. */
	deltaDays: number;
	/** Sann når beskrivelsen endret seg — usynlig for en match som krever samme nøkkel. */
	merchantKeyChanged: boolean;
};

export type ReservationMatchResult = {
	matches: ReservationMatch[];
	/** Reservasjoner uten en ledig bokført motpart. Restposten, og den skal rapporteres. */
	unmatched: ReservationCandidate[];
};

function dayDiff(fromKey: string, toKey: string): number {
	const from = new Date(`${fromKey}T12:00:00Z`).getTime();
	const to = new Date(`${toKey}T12:00:00Z`).getTime();
	return Math.round((to - from) / 86400000);
}

/** Øre, for at 0.1 + 0.2 ikke skal gjøre to like beløp ulike. */
function toCents(amount: number): number {
	return Math.round(amount * 100);
}

/**
 * Parrer hver foreldreløse reservasjon med høyst én bokført rad.
 *
 * Beløpet må stemme **eksakt** — målingen viste 33 av 35 par med 0 % avvik, så det finnes
 * ingen grunn til en toleranse, og en toleranse ville åpnet for å slå sammen ulike kjøp.
 *
 * `merchant_key` inngår **ikke** som krav, bare som preferanse. Det er hele forskjellen fra
 * den forrige målingen: 110 av 271 par hadde endret beskrivelse, og de var per konstruksjon
 * usynlige. Det er forsvarlig fordi ekte gjentatte kjøp er målt til 2 av 1 136 bøtter, og
 * fordi to reelle kjøp gir to BOOKED — ikke én PENDING og én BOOKED.
 *
 * Rekkefølgen er deterministisk, ellers er totalen ikke reproduserbar mellom to kjøringer.
 */
export function matchReservationsToBooked(
	candidates: readonly ReservationCandidate[],
	options: { maxDeltaDays?: number } = {}
): ReservationMatchResult {
	const maxDeltaDays = options.maxDeltaDays ?? DEFAULT_MAX_DELTA_DAYS;

	const reservations = candidates
		.filter((c) => c.status === 'pending' && !c.internalTransfer)
		.slice()
		.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));

	// Bokførte rader gruppert på (konto, beløp i øre). Nøkkelen er eksakt beløp, så oppslaget
	// er billig og kan ikke matche på tvers av beløp ved et uhell.
	const bookedByKey = new Map<string, ReservationCandidate[]>();
	for (const candidate of candidates) {
		if (candidate.status !== 'booked' || candidate.internalTransfer) continue;
		const key = `${candidate.accountId}:${toCents(candidate.amount)}`;
		const bucket = bookedByKey.get(key);
		if (bucket) bucket.push(candidate);
		else bookedByKey.set(key, [candidate]);
	}
	for (const bucket of bookedByKey.values()) {
		bucket.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
	}

	const matches: ReservationMatch[] = [];
	const unmatched: ReservationCandidate[] = [];

	for (const reservation of reservations) {
		const key = `${reservation.accountId}:${toCents(reservation.amount)}`;
		const bucket = bookedByKey.get(key);
		if (!bucket || bucket.length === 0) {
			unmatched.push(reservation);
			continue;
		}

		// Nærmeste dato innenfor vinduet, med samme beskrivelse som tiebreak. Preferansen —
		// ikke kravet — gjør at et par med uendret nøkkel velges framfor et like nært med
		// endret, når begge er ledige.
		let bestIndex = -1;
		let bestScore = Number.POSITIVE_INFINITY;
		for (let i = 0; i < bucket.length; i += 1) {
			const delta = dayDiff(reservation.date, bucket[i].date);
			if (Math.abs(delta) > maxDeltaDays) continue;
			const sameKey = bucket[i].merchantKey === reservation.merchantKey;
			const score = Math.abs(delta) * 2 + (sameKey ? 0 : 1);
			if (score < bestScore) {
				bestScore = score;
				bestIndex = i;
			}
		}

		if (bestIndex === -1) {
			unmatched.push(reservation);
			continue;
		}

		// **Fjernes fra puljen.** Det er dette som gjør matchingen én-til-én, og som gjør at
		// tre reservasjoner på samme beløp ikke kan peke på samme bokførte kjøp.
		const [booked] = bucket.splice(bestIndex, 1);

		matches.push({
			reservationId: reservation.id,
			bookedId: booked.id,
			accountId: reservation.accountId,
			amount: Math.abs(reservation.amount),
			direction: reservation.amount < 0 ? 'out' : 'in',
			deltaDays: dayDiff(reservation.date, booked.date),
			merchantKeyChanged: booked.merchantKey !== reservation.merchantKey
		});
	}

	return { matches, unmatched };
}

/**
 * Kroner som telles to ganger i dag, delt på retning.
 *
 * **Delt, ikke summert.** `spend` er det fixen fjerner fra forbruket; `income` er det den
 * fjerner fra inntekten. Ett samletall ville blandet dem, og siden et dobbelttalt lønnsinnskudd
 * er stort i forhold til et dagligvarekjøp, ville forbrukstallet blitt dominert av noe som
 * ikke er forbruk. Andelen «av alt forbruk» kan bare regnes mot `spend`.
 */
export function doubleCountedTotals(matches: readonly ReservationMatch[]): {
	spend: number;
	income: number;
} {
	let spend = 0;
	let income = 0;
	for (const match of matches) {
		if (match.direction === 'out') spend += match.amount;
		else income += match.amount;
	}
	return { spend, income };
}
