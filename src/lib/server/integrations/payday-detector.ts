import { db } from '$lib/db';
import { canonicalBankTransactions } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { fillPaydayGaps, longestPaydayGapDays } from '$lib/domain/economics/payday-gaps';

const SALARY_KEYWORDS = ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '];
const SALARY_MIN_AMOUNT = 10_000;

export type SalaryCandidate = {
	accountId: string;
	amount: number;
	description: string;
	typeText: string;
	timestamp: Date;
};

/**
 * Treffer lønnsordene — på beskrivelsen OG `typeText`.
 *
 * `typeText` er SB1s `category`-felt («Lønn», «Nettgiro», «eFaktura», «OVERFØRSEL»), og for
 * en lønnsutbetaling er det ofte det ENESTE stedet ordet «lønn» står: `descriptionDisplay`
 * bærer arbeidsgivers navn. Samme felle som `categorizeTransaction` hadde fram til
 * migrasjon 0055 — se CLAUDE.md.
 */
function matchesSalaryKeyword(tx: SalaryCandidate): boolean {
	const text = `${tx.description ?? ''} ${tx.typeText ?? ''}`.toLowerCase();
	return SALARY_KEYWORDS.some((kw) => text.includes(kw));
}

export function toIsoDate(d: Date): string {
	return d.toISOString().split('T')[0];
}

export function monthKey(d: Date): string {
	return toIsoDate(d).slice(0, 7);
}

export function isWeekend(d: Date): boolean {
	const day = d.getUTCDay();
	return day === 0 || day === 6;
}

export function normalizeDescriptionFingerprint(description: string): string {
	const normalized = description
		.normalize('NFKC')
		.toUpperCase()
		.replace(/\d+/g, ' ')
		.replace(/[^A-ZÆØÅ\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!normalized) return 'UNKNOWN';
	const words = normalized.split(' ').filter(Boolean);
	return words.slice(0, 3).join(' ');
}

export function amountBucket(amount: number): number {
	return Math.round(amount / 500) * 500;
}

function fingerprintKey(tx: SalaryCandidate): string {
	return `${normalizeDescriptionFingerprint(tx.description)}|${amountBucket(tx.amount)}`;
}

export function median(nums: number[]): number {
	if (nums.length === 0) return 0;
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function businessDayDom(d: Date): number {
	const copy = new Date(d);
	while (isWeekend(copy)) copy.setUTCDate(copy.getUTCDate() - 1);
	return copy.getUTCDate();
}

/** Én lønnsdato per kalendermåned, valgt på score. Eksportert for test. */
export function pickBestPerMonth(candidates: SalaryCandidate[], preferredFingerprint: string | null): string[] {
	if (candidates.length === 0) return [];

	const fingerprintBaseline = preferredFingerprint
		? candidates.filter((tx) => fingerprintKey(tx) === preferredFingerprint)
		: candidates;
	const baseline = fingerprintBaseline.length > 0 ? fingerprintBaseline : candidates;

	const baselineDom = baseline.map((tx) => businessDayDom(tx.timestamp));
	const domNoLate = baselineDom.filter((d) => d <= 25);
	const referenceDom = Math.round(median(domNoLate.length > 0 ? domNoLate : baselineDom));
	const referenceAmount = median(baseline.map((tx) => tx.amount));

	const perMonth = new Map<string, SalaryCandidate>();
	for (const tx of candidates) {
		const m = monthKey(tx.timestamp);
		const day = tx.timestamp.getUTCDate();
		const fp = fingerprintKey(tx);
		let score = 0;

		if (preferredFingerprint && fp === preferredFingerprint) score += 120;
		if (!isWeekend(tx.timestamp)) score += 20;
		if (day <= 25) score += 20;
		else score -= 25;

		score += Math.max(0, 12 - Math.abs(businessDayDom(tx.timestamp) - referenceDom));
		score += Math.max(0, 10 - Math.round(Math.abs(tx.amount - referenceAmount) / 1000));

		const existing = perMonth.get(m);
		if (!existing) {
			perMonth.set(m, tx);
			(tx as SalaryCandidate & { _score?: number })._score = score;
			continue;
		}

		const existingScore = (existing as SalaryCandidate & { _score?: number })._score ?? -Infinity;
		if (
			score > existingScore ||
			(score === existingScore && tx.timestamp.getTime() < existing.timestamp.getTime())
		) {
			perMonth.set(m, tx);
			(tx as SalaryCandidate & { _score?: number })._score = score;
		}
	}

	return [...perMonth.values()].map((tx) => toIsoDate(tx.timestamp)).sort();
}

export type PaydaySourceSelection = {
	sourceAccountId: string;
	/** Kandidatene lønnsdatoene plukkes fra — ALLE inntekter på kontoen, ikke bare treffene. */
	candidates: SalaryCandidate[];
	/** Fingeravtrykket lønna kjennes igjen på, utledet av nøkkelordtreffene når de finnes. */
	preferredFingerprint: string | null;
	/** Hvordan kontoen ble valgt. Til diagnose — «hvorfor bare to lønnsdatoer». */
	source: 'keyword' | 'largest-inflow';
};

/**
 * Velger hvilken konto lønna kommer inn på, og hvilke rader lønnsdatoene skal plukkes fra.
 *
 * Ren funksjon, uten DB, fordi dette er stedet feilen satt. Se
 * `docs/changelog/2026-08-12-lonnsperioder-og-uttaksvindu.md`.
 *
 * **Nøkkelordene velger KONTOEN og FINGERAVTRYKKET, aldri kandidatsettet.** Fram til august
 * 2026 var det motsatt: traff noen rader et lønnsord, ble kandidatene *begrenset* til
 * nettopp de radene. To tilfeldige treff — en overføring med «lønn» i teksten — slo dermed
 * ut et helt år med regelmessige innskudd, og resultatet var to lønnsdatoer, altså **én**
 * hel lønnsperiode. Sparekontoflaten krever tre og var derfor stum.
 *
 * Feilen var lett å overse fordi den var inverse: den SVAKE signalveien (fallbacken, som
 * ikke fant noe nøkkelord) fikk det rike kandidatsettet — alle inntekter på kontoen — mens
 * den STERKE fikk det fattige. Nøkkelordtreff gjorde altså resultatet dårligere.
 *
 * Å utvide kandidatsettet er trygt fordi `pickBestPerMonth` gir fingeravtrykket +120 i
 * score: i måneder der lønnsraden finnes, vinner den fortsatt. Utvidelsen gir bare *dekning*
 * i månedene der ordet mangler — som er hver måned der SB1 ikke fylte `category`.
 */
export function selectPaydaySource(
	incomes: readonly SalaryCandidate[]
): PaydaySourceSelection | null {
	if (incomes.length === 0) return null;

	const keywordTxs = incomes.filter(matchesSalaryKeyword);

	// Kontoen med flest KALENDERMÅNEDER med nøkkelordtreff. Måneder og ikke rader: en konto
	// med tolv treff i én måned er ikke en lønnskonto.
	const monthsByAccount = new Map<string, Set<string>>();
	for (const tx of keywordTxs) {
		if (!tx.accountId) continue;
		const months = monthsByAccount.get(tx.accountId) ?? new Set<string>();
		months.add(monthKey(tx.timestamp));
		monthsByAccount.set(tx.accountId, months);
	}

	let sourceAccountId: string | null = null;
	let source: 'keyword' | 'largest-inflow' = 'keyword';

	if (monthsByAccount.size > 0) {
		sourceAccountId = [...monthsByAccount.entries()].sort((a, b) => b[1].size - a[1].size)[0][0];
	} else {
		// Ingen nøkkelord noe sted: kontoen som vinner flest måneder på største innskudd.
		source = 'largest-inflow';
		const monthBest = new Map<string, { accountId: string; amount: number }>();
		for (const tx of incomes) {
			const month = monthKey(tx.timestamp);
			const current = monthBest.get(month);
			if (!current || tx.amount > current.amount) {
				monthBest.set(month, { accountId: tx.accountId, amount: tx.amount });
			}
		}
		if (monthBest.size < 2) return null;

		const wins = new Map<string, number>();
		for (const best of monthBest.values()) {
			wins.set(best.accountId, (wins.get(best.accountId) ?? 0) + 1);
		}
		sourceAccountId = [...wins.entries()].sort((a, b) => b[1] - a[1])[0][0];
	}

	if (!sourceAccountId) return null;

	const candidates = incomes.filter((tx) => tx.accountId === sourceAccountId);
	if (candidates.length < 2) return null;

	// Fingeravtrykket utledes av nøkkelordtreffene på kontoen når de finnes. Uten den
	// innsnevringen ville et hyppigere innskudd — en fast intern overføring — kunne bli
	// «lønna», og da flytter alle lønnsdatoene seg.
	const fingerprintBasis = keywordTxs.filter((tx) => tx.accountId === sourceAccountId);
	const preferredFingerprint = mostStableFingerprint(
		fingerprintBasis.length > 0 ? fingerprintBasis : candidates
	);

	return { sourceAccountId, candidates, preferredFingerprint, source };
}

/** Fingeravtrykket som opptrer i flest kalendermåneder. */
function mostStableFingerprint(txs: readonly SalaryCandidate[]): string | null {
	const months = new Map<string, Set<string>>();
	for (const tx of txs) {
		const key = fingerprintKey(tx);
		const set = months.get(key) ?? new Set<string>();
		set.add(monthKey(tx.timestamp));
		months.set(key, set);
	}
	if (months.size === 0) return null;
	return [...months.entries()].sort((a, b) => b[1].size - a[1].size)[0][0];
}

export type GlobalPayday = {
	paydayDates: string[];           // YYYY-MM-DD, sorted
	detectedPaydayDom: number;       // typical day-of-month
	sourceAccountId: string | null;  // which account the salary was found on
	/**
	 * Hvordan kontoen ble funnet, og hvor mange inntekter den ble valgt blant.
	 *
	 * Til diagnose på flatene. Sparekontoflaten var stum med «trenger 3 hele lønnsperioder,
	 * har 1» og ingen vei videre — antallet lønnsdatoer er det som avgjør, og uten det tallet
	 * kan ingen se om det er dataene eller detektoren som mangler.
	 */
	source: 'keyword' | 'largest-inflow';
	/** Antall inntektsrader på kildekontoen som lønnsdatoene ble plukket fra. */
	candidateCount: number;
	/**
	 * Lønnsdatoer som er SLUTTET fordi måneden manglet en rad, ikke observert.
	 *
	 * Mars 2026 manglet i prod, og februar→april ble da én «lønnsperiode» på 58 dager som
	 * gjorde snittkurven på Økonomi-oversikten ubrukelig. Lønna kom (den faste overføringen
	 * på 12 500 står 24. mars på en annen konto); raden nådde aldri canonical.
	 *
	 * Merkes fordi en antatt dato som ser observert ut er verre enn et hull: da kan ingen
	 * etterprøve tallene den bærer.
	 */
	inferredPaydayDates: string[];
	/**
	 * Bare de OBSERVERTE datoene, altså de som har en rad bak seg.
	 *
	 * **Arbeidsdelingen er: statistikk fra observasjoner, periodegrenser fra den utfylte
	 * serien.** Et lønnsvarsel skal aldri fyre på en antatt dato, og en lønnsprofil skal ikke
	 * regne beløpsstatistikk på datoer uten beløp. `paydayDates` er for å dele tid i perioder;
	 * denne er for å si noe om lønna selv.
	 */
	observedPaydayDates: string[];
	/** Måneder som ble hoppet over fordi hullet var for langt å anta. `YYYY-MM`. */
	skippedPaydayMonths: string[];
	/**
	 * Største avstand mellom to påfølgende lønnsdatoer, etter utfylling.
	 *
	 * Mye over ~40 dager betyr at et hull står igjen — bevisst, fordi det var for langt å
	 * anta. Rapporteres så en flate kan si det framfor at tallene bare ser rare ut.
	 */
	longestPeriodDays: number;
};

/**
 * Detects payday dates by scanning transactions across ALL accounts for the
 * given user. The account with the clearest salary signal is used as source.
 * Returns null if no salary pattern can be detected.
 */
export async function detectGlobalPayday(userId: string): Promise<GlobalPayday | null> {
	// Fetch all income-sized transactions from all accounts
	const transactions = await db
		.select({
			accountId: canonicalBankTransactions.accountId,
			amount: canonicalBankTransactions.amount,
			description: sql<string>`COALESCE(${canonicalBankTransactions.descriptionDisplay}, ${canonicalBankTransactions.merchantKey}, '')`,
			// **`typeText` MÅ leses.** Feltet bor på canonical siden migrasjon 0055 og er SB1s
			// `category` — for en lønnsutbetaling er det ofte det eneste stedet ordet «lønn»
			// står, siden beskrivelsen bærer arbeidsgivers navn. Her sto det hardkodet `''`,
			// altså samme døde sti `categorizeTransaction` hadde: nøkkelordsøket lette i et
			// felt som alltid var tomt.
			typeText: sql<string>`COALESCE(${canonicalBankTransactions.typeText}, '')`,
			timestamp: sql<string>`${canonicalBankTransactions.canonicalDate}::text`
		})
		.from(canonicalBankTransactions)
		.where(
			and(
				eq(canonicalBankTransactions.userId, userId),
				eq(canonicalBankTransactions.isActive, true),
				sql`${canonicalBankTransactions.amount} >= ${SALARY_MIN_AMOUNT}`
			)
		)
		.orderBy(asc(canonicalBankTransactions.canonicalDate));

	const normalizedTransactions: SalaryCandidate[] = transactions.map((tx) => {
		const timestamp = new Date(`${tx.timestamp.slice(0, 10)}T12:00:00Z`);
		return {
			accountId: tx.accountId,
			amount: Number(tx.amount) || 0,
			description: tx.description ?? '',
			typeText: tx.typeText ?? '',
			timestamp
		};
	});

	if (normalizedTransactions.length === 0) return null;

	// Kontovalg, kandidatsett og fingeravtrykk bor rent i `selectPaydaySource` — der er de
	// testbare, og der satt feilen som ga én lønnsperiode.
	const selection = selectPaydaySource(normalizedTransactions);
	if (!selection) return null;

	const observedPaydays = pickBestPerMonth(selection.candidates, selection.preferredFingerprint);
	if (observedPaydays.length < 2) return null;

	// **Hull fylles med den antatte lønnsdagen.** `pickBestPerMonth` gir én dato per
	// KALENDERMÅNED, så en måned uten kandidatrad gir ingen dato — og da blir to måneder én
	// periode. Alternativet til å slutte er ikke «ingen påstand», men påstanden «58 dager var
	// én lønnsperiode», som er konkret og gal. Se
	// `docs/changelog/2026-08-18-manglende-lonnsdato.md`.
	const series = fillPaydayGaps(observedPaydays);
	const paydayDates = series.dates;

	// Robust median av virkedagsnormaliserte datoer, mot drift.
	//
	// **Regnes på de OBSERVERTE datoene, ikke på den utfylte serien.** De antatte datoene er
	// plassert PÅ lønnsdagen, så å ta dem med ville latt en slutning bekrefte seg selv. Her
	// endrer det ingenting (medianen av en median er den samme), men det er en sirkel som blir
	// reell så snart plasseringen endres.
	const doms = observedPaydays.map((d) => businessDayDom(new Date(`${d}T12:00:00Z`)));
	const domNoLate = doms.filter((d) => d <= 25);
	const detectedPaydayDom = Math.round(median(domNoLate.length > 0 ? domNoLate : doms));

	return {
		paydayDates,
		detectedPaydayDom,
		sourceAccountId: selection.sourceAccountId,
		source: selection.source,
		candidateCount: selection.candidates.length,
		inferredPaydayDates: series.inferred,
		observedPaydayDates: series.observed,
		skippedPaydayMonths: series.skippedMonths,
		longestPeriodDays: longestPaydayGapDays(paydayDates)
	};
}
