/**
 * Sparekontoen som buffer: går den ned, og når kniper det?
 *
 * Bestilt av brukeren 2026-08-11, og han svarte at kontoen er en **buffer**. Det avgjør hva
 * som måles. Se `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 5.
 *
 * Fire ting følger av «buffer», og de er ikke kosmetiske:
 *
 * 1. **Et uttak er ikke et varsel. Et uttak som ikke kommer tilbake er det.** En buffer som
 *    virker svinger; den står ikke stille. Å si fra per uttak ville gjort flaten til støy.
 * 2. **Primitiven er bunnene, ikke snittet.** En fungerende buffer oscillerer rundt et
 *    stabilt gulv. En buffer som eroderes har en synkende følge av *bunnpunkter*, selv om
 *    toppene ser uendret ut fordi lønna kommer inn hver måned. Et etterslepende snitt over
 *    daglige saldoer blander toppene inn og demper nettopp signalet.
 * 3. **Enheten er måneders dekning, ikke kroner** — det er det en buffer er *til*. Dekning
 *    krever et ærlig månedsforbruk, altså at interne overføringer er ute (fase 2). Med det
 *    oppblåste tallet (132 000 kr/mnd mot reelle ~42 000) ville en sunn buffer sett ut som en
 *    tredjedel av seg selv, og et tall som er 3× feil i pessimistisk retning er verre enn
 *    ingen tall.
 * 4. **Frekvens og posisjon skiller buffer fra kassekreditt, og det er hele diagnosen.** Ett
 *    uttak til en bilreparasjon er bufferen som gjør jobben sin. Uttak hver måned rundt dag
 *    26 er et budsjett som ikke balanserer. **De to ser identiske ut i en saldokurve** — samme
 *    nedgang, samme beløp — og krever motsatt handling.
 */

// ── Terskler ────────────────────────────────────────────────────────────────

/** Færre bunnpunkter enn dette, og «trend» er en gjetning med selvtillit. */
export const MIN_TROUGH_SAMPLES = 3;

/**
 * Endring i bunnivået under dette regnes som uendret. En sparekonto får renter og
 * ører-avrunding; uten et gulv ville hver måned fått en «retning».
 */
export const TROUGH_NOISE_FLOOR_KR = 1000;

/**
 * Andel av lønnsperioden som regnes som «sent». Et uttak etter to tredjedeler av perioden
 * er et uttak fordi pengene tok slutt, ikke fordi noe skjedde.
 */
export const LATE_PERIOD_SHARE = 2 / 3;

/** Over denne andelen sene uttak, og mønsteret er kassekreditt framfor støtdemper. */
export const OVERDRAFT_LATE_SHARE = 0.5;

/** Uttak per lønnsperiode over dette regnes som løpende bruk, ikke enkelthendelser. */
export const OVERDRAFT_FREQUENCY = 0.75;

// ── Typer ───────────────────────────────────────────────────────────────────

export type BalancePoint = {
	/** YYYY-MM-DD */
	date: string;
	balance: number;
};

/** [start, end) i lønnsperiode-forstand. `end` er neste lønnsdato, eller i dag. */
export type Period = {
	start: string;
	end: string;
};

export type PeriodTrough = {
	periodStart: string;
	periodEnd: string;
	/** Laveste observerte saldo i perioden. */
	trough: number;
	troughDate: string;
	/** Saldoen ved periodens slutt — til å se om den kom tilbake. */
	end: number;
};

export type TroughTrend = {
	direction: 'eroderer' | 'stabil' | 'vokser' | 'ukjent';
	/** Endring i bunnivå per lønnsperiode, kroner. Null når `ukjent`. */
	perPeriod: number | null;
	/** Samlet endring over vinduet, kroner. Null når `ukjent`. */
	total: number | null;
	samples: number;
	/** Hvorfor svaret ble som det ble — vises på flaten framfor et bart ord. */
	reason: string;
};

export type WithdrawalEvent = {
	date: string;
	amount: number;
};

export type WithdrawalPattern = {
	verdict: 'urørt' | 'støtdemper' | 'kassekreditt' | 'blandet' | 'ukjent';
	count: number;
	/** Uttak per lønnsperiode. */
	perPeriod: number;
	medianAmount: number | null;
	largestAmount: number | null;
	/** Andel av uttakene som skjer i siste tredjedel av lønnsperioden. */
	lateShare: number;
	reason: string;
};

// ── Kontoutvalg ─────────────────────────────────────────────────────────────

/**
 * Er dette en bufferkonto?
 *
 * **Heuristikk, og flaten skal si det.** `accountType` er SB1s `description`-felt, altså
 * fritekst — ikke en enum vi kan stole på. Derfor er den lista over hvilke kontoer som ble
 * regnet med en del av svaret: tar heuristikken feil, ser brukeren det umiddelbart, og det er
 * bedre enn et konfigurasjonssteg ingen fyller ut.
 *
 * Lønnskonto og brukskonto er eksplisitt ute: de svinger med forbruket, og en «bunn» der er
 * dagen før lønn, ikke et bufferni­vå.
 */
const SAVINGS_TERMS = ['spar', 'buffer', 'bsu', 'reserve', 'oppsparing'];
/**
 * NB: «felles» hører IKKE hit. Brukeren styrer **husholdningens** økonomi, så en felles
 * sparekonto er nettopp bufferen — den er ikke en annen persons penger. Første utgave
 * ekskluderte den, og ville dermed vist «ingen bufferkonto funnet» for den kontoen det
 * faktisk gjaldt. En felles *brukskonto* fanges av `bruks`.
 */
const NOT_SAVINGS_TERMS = ['bruks', 'lønn', 'lonn', 'kreditt', 'drift'];

export function looksLikeSavingsAccount(account: {
	accountName?: string | null;
	accountType?: string | null;
}): boolean {
	const haystack = `${account.accountName ?? ''} ${account.accountType ?? ''}`.toLowerCase();
	if (NOT_SAVINGS_TERMS.some((term) => haystack.includes(term))) return false;
	return SAVINGS_TERMS.some((term) => haystack.includes(term));
}

// ── Bunnpunkter ─────────────────────────────────────────────────────────────

/**
 * Bygger lønnsperioder av en sortert liste lønnsdatoer.
 *
 * Den siste perioden løper til `today` og er derfor **ikke komplett** — bunnen der kan
 * fortsatt bli lavere. Kallere som regner trend skal droppe den; det er derfor den er sist.
 */
export function periodsFromPaydays(paydayDates: readonly string[], today: string): Period[] {
	const sorted = [...new Set(paydayDates)].filter((d) => d <= today).sort();
	if (sorted.length === 0) return [];

	const periods: Period[] = [];
	for (let i = 0; i < sorted.length; i += 1) {
		const start = sorted[i];
		const end = sorted[i + 1] ?? today;
		if (end <= start) continue;
		periods.push({ start, end });
	}
	return periods;
}

/** Laveste saldo per lønnsperiode. Perioder uten målinger droppes framfor å bli 0. */
export function troughsByPeriod(
	balances: readonly BalancePoint[],
	periods: readonly Period[]
): PeriodTrough[] {
	const troughs: PeriodTrough[] = [];

	for (const period of periods) {
		const inPeriod = balances.filter((p) => p.date >= period.start && p.date < period.end);
		if (inPeriod.length === 0) continue;

		let lowest = inPeriod[0];
		for (const point of inPeriod) {
			if (point.balance < lowest.balance) lowest = point;
		}

		const last = inPeriod.reduce((latest, point) => (point.date > latest.date ? point : latest));

		troughs.push({
			periodStart: period.start,
			periodEnd: period.end,
			trough: lowest.balance,
			troughDate: lowest.date,
			end: last.balance
		});
	}

	return troughs;
}

/**
 * Retningen i bunnivået. Minste kvadraters stigningstall over bunnpunktene.
 *
 * Regresjon framfor «siste minus første» fordi én avvikende måned ellers avgjør svaret —
 * en enkelt stor utbetaling ville lest som varig erosjon.
 */
export function troughTrend(troughs: readonly PeriodTrough[]): TroughTrend {
	const n = troughs.length;

	if (n < MIN_TROUGH_SAMPLES) {
		return {
			direction: 'ukjent',
			perPeriod: null,
			total: null,
			samples: n,
			reason: `Trenger ${MIN_TROUGH_SAMPLES} hele lønnsperioder, har ${n}.`
		};
	}

	const meanX = (n - 1) / 2;
	const meanY = troughs.reduce((sum, t) => sum + t.trough, 0) / n;

	let numerator = 0;
	let denominator = 0;
	troughs.forEach((t, i) => {
		numerator += (i - meanX) * (t.trough - meanY);
		denominator += (i - meanX) ** 2;
	});

	const perPeriod = denominator === 0 ? 0 : numerator / denominator;
	const total = perPeriod * (n - 1);

	if (Math.abs(total) < TROUGH_NOISE_FLOOR_KR) {
		return {
			direction: 'stabil',
			perPeriod,
			total,
			samples: n,
			reason: `Bunnivået har flyttet seg under ${TROUGH_NOISE_FLOOR_KR} kr over ${n} perioder — det regnes som uendret.`
		};
	}

	return {
		direction: total < 0 ? 'eroderer' : 'vokser',
		perPeriod,
		total,
		samples: n,
		reason:
			total < 0
				? `Bunnivået har falt ${Math.round(Math.abs(total))} kr over ${n} perioder.`
				: `Bunnivået har steget ${Math.round(total)} kr over ${n} perioder.`
	};
}

// ── Dekning ─────────────────────────────────────────────────────────────────

/**
 * Måneders dekning: hvor lenge bufferen holder ved dagens forbruk.
 *
 * **Returnerer null uten et forbrukstall**, framfor å dele på noe gjettet. Forbruket skal
 * komme fra en kilde der interne overføringer er ute — se modulens toppkommentar.
 */
export function runwayMonths(balance: number, monthlySpend: number | null): number | null {
	if (monthlySpend === null || !Number.isFinite(monthlySpend) || monthlySpend <= 0) return null;
	if (!Number.isFinite(balance) || balance <= 0) return 0;
	return balance / monthlySpend;
}

// ── Uttaksmønster ───────────────────────────────────────────────────────────

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function dayDiff(fromKey: string, toKey: string): number {
	const from = new Date(`${fromKey}T12:00:00Z`).getTime();
	const to = new Date(`${toKey}T12:00:00Z`).getTime();
	return Math.round((to - from) / 86400000);
}

/**
 * Skiller støtdemper fra kassekreditt.
 *
 * Dette er selve diagnosen, og den kan ikke leses av en saldokurve: ett uttak på 12 000 og
 * tolv på 1 000 gir samme nedgang. Det er **frekvensen** og **posisjonen i lønnsperioden**
 * som skiller dem — et uttak tre dager etter lønn er planlagt, et uttak på dag 26 betyr at
 * måneden ikke bar.
 */
export function describeWithdrawalPattern(
	withdrawals: readonly WithdrawalEvent[],
	periods: readonly Period[]
): WithdrawalPattern {
	if (periods.length === 0) {
		return {
			verdict: 'ukjent',
			count: withdrawals.length,
			perPeriod: 0,
			medianAmount: median(withdrawals.map((w) => w.amount)),
			largestAmount: withdrawals.length > 0 ? Math.max(...withdrawals.map((w) => w.amount)) : null,
			lateShare: 0,
			reason: 'Ingen lønnsperioder funnet, så posisjonen i måneden kan ikke måles.'
		};
	}

	const amounts = withdrawals.map((w) => w.amount);
	const perPeriod = withdrawals.length / periods.length;

	if (withdrawals.length === 0) {
		return {
			verdict: 'urørt',
			count: 0,
			perPeriod: 0,
			medianAmount: null,
			largestAmount: null,
			lateShare: 0,
			reason: `Ingen uttak i de siste ${periods.length} lønnsperiodene.`
		};
	}

	let late = 0;
	let placed = 0;
	for (const withdrawal of withdrawals) {
		const period = periods.find((p) => withdrawal.date >= p.start && withdrawal.date < p.end);
		if (!period) continue;
		const length = dayDiff(period.start, period.end);
		if (length <= 0) continue;
		placed += 1;
		if (dayDiff(period.start, withdrawal.date) / length >= LATE_PERIOD_SHARE) late += 1;
	}

	const lateShare = placed === 0 ? 0 : late / placed;

	const frequent = perPeriod >= OVERDRAFT_FREQUENCY;
	const mostlyLate = lateShare >= OVERDRAFT_LATE_SHARE;

	if (frequent && mostlyLate) {
		return {
			verdict: 'kassekreditt',
			count: withdrawals.length,
			perPeriod,
			medianAmount: median(amounts),
			largestAmount: Math.max(...amounts),
			lateShare,
			reason: `${withdrawals.length} uttak over ${periods.length} lønnsperioder, og ${Math.round(lateShare * 100)} % av dem sent i perioden. Det ser ut som at måneden ikke bærer, ikke som enkelthendelser.`
		};
	}

	if (!frequent && !mostlyLate) {
		return {
			verdict: 'støtdemper',
			count: withdrawals.length,
			perPeriod,
			medianAmount: median(amounts),
			largestAmount: Math.max(...amounts),
			lateShare,
			reason: `${withdrawals.length} uttak over ${periods.length} lønnsperioder, spredt utover måneden. Det er en buffer som gjør jobben sin.`
		};
	}

	return {
		verdict: 'blandet',
		count: withdrawals.length,
		perPeriod,
		medianAmount: median(amounts),
		largestAmount: Math.max(...amounts),
		lateShare,
		reason: frequent
			? `${withdrawals.length} uttak over ${periods.length} lønnsperioder, men ikke samlet sent i måneden.`
			: `Få uttak, men ${Math.round(lateShare * 100)} % av dem sent i perioden.`
	};
}
