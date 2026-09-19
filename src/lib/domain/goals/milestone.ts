/**
 * Milepæler: mål som ER nådd, og som skal farge tolkningen uten å ta over.
 *
 * ## Hvorfor forfall er hele poenget
 *
 * Et fullført mål er sant for alltid. Uten et forfall blir «siden du lyktes med å
 * skifte jobb» åpningen på hvert svar til brukeren slutter å spørre. Det er samme
 * metning `PUSH_RANK` i `weight-nugget-rules.ts` finnes for — «Laveste snittvekt vi
 * har målt» står identisk hver morgen så lenge nedgangen varer — bare verre, siden
 * en milepæl aldri slutter å være sann.
 *
 * Derfor to seksjoner med hver sin instruks: ferske milepæler er et TEMA, eldre er
 * BAKGRUNN. Bakgrunnen slettes ikke — forskjellen på å glemme og å ha lært.
 *
 * ## Hvorfor «frigjør» og «kostet» er to felt
 *
 * De svarer på ulike spørsmål, og det er det andre som pleier å mangle: en
 * oppnåelse huskes for gevinsten, og prisen forsvinner. Et jobbskifte frigjør
 * belastningen fra jobbsøkingen OG kostet spenning på jobben man forlot — og det er
 * regnskapet, ikke seieren, som sier hva som kan prioriteres nå.
 *
 * Begge er valgfrie. En milepæl uten regnskap er fortsatt en milepæl, og et tomt
 * felt er bedre enn et gjettet.
 */

/** En nådd milepæl, klar til rendring. `achievedOn` er `YYYY-MM-DD` i Oslo-dato. */
export interface Milestone {
	id: string;
	title: string;
	/** Null for mål fullført før milepælsregnskapet fantes — de er bakgrunn, aldri ferske. */
	achievedOn: string | null;
	frees?: string | null;
	cost?: string | null;
}

/** Innenfor dette vinduet er milepælen et tema, ikke bare et premiss. */
export const MILESTONE_FRESH_DAYS = 30;

/**
 * Tak på bakgrunnslista. Uten et tak vokser den med hvert år brukeren er her, og en
 * lang liste prestasjoner i prompten får modellen til å gratulere framfor å svare.
 */
export const MAX_BACKGROUND_MILESTONES = 6;

const MONTHS = [
	'januar', 'februar', 'mars', 'april', 'mai', 'juni',
	'juli', 'august', 'september', 'oktober', 'november', 'desember'
];

/** `YYYY-MM-DD` → tallene. Null for alt annet — vi gjetter aldri en dato. */
function parseIsoDay(day: string | null | undefined): { y: number; m: number; d: number } | null {
	if (!day) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
	if (!match) return null;
	const y = Number(match[1]);
	const m = Number(match[2]);
	const d = Number(match[3]);
	if (m < 1 || m > 12 || d < 1 || d > 31) return null;
	return { y, m, d };
}

/** Hele dager fra milepælen til `now`. Null når datoen mangler eller er ugyldig. */
export function daysSinceAchieved(achievedOn: string | null | undefined, now: Date): number | null {
	const parts = parseIsoDay(achievedOn);
	if (!parts) return null;
	const achieved = Date.UTC(parts.y, parts.m - 1, parts.d);
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	return Math.floor((today - achieved) / 86_400_000);
}

/**
 * Full dato for ferske milepæler, måned + år for bakgrunn.
 *
 * Grovere bakover er med vilje, samme begrunnelse som `goal-date` i
 * krydderet på veiingen: en eksakt dag på noe som skjedde i fjor er en presisjon
 * ingen trenger, og den gjør linja lengre enn innholdet.
 */
export function formatMilestoneDate(achievedOn: string | null | undefined, coarse: boolean): string {
	const parts = parseIsoDay(achievedOn);
	if (!parts) return '';
	const month = MONTHS[parts.m - 1];
	return coarse ? `${month} ${parts.y}` : `${parts.d}. ${month} ${parts.y}`;
}

/**
 * Del i ferske og bakgrunn, begge nyeste først.
 *
 * **Milepæler uten dato er ALLTID bakgrunn.** Mål fullført før dette fantes har
 * ingen `achievedOn`, og uten regelen ville hele historikken blitt annonsert som
 * fersk den dagen dette ble deployet — altså en haug «nyheter» om ting brukeren
 * gjorde for to år siden. En dato fram i tid regnes som fersk: den er en
 * skrivefeil, og å skjule den ville gjort feilen vanskeligere å finne.
 */
export function splitMilestones(
	milestones: Milestone[],
	now: Date
): { fresh: Milestone[]; background: Milestone[] } {
	const withAge = milestones.map((m) => ({ m, age: daysSinceAchieved(m.achievedOn, now) }));

	const fresh = withAge
		.filter((x) => x.age !== null && x.age <= MILESTONE_FRESH_DAYS)
		.sort((a, b) => (a.age ?? 0) - (b.age ?? 0))
		.map((x) => x.m);

	const background = withAge
		.filter((x) => x.age === null || x.age > MILESTONE_FRESH_DAYS)
		// Daterte først (nyeste først), udaterte til slutt — de kan ikke rangeres
		.sort((a, b) => {
			if (a.age === null && b.age === null) return 0;
			if (a.age === null) return 1;
			if (b.age === null) return -1;
			return a.age - b.age;
		})
		.slice(0, MAX_BACKGROUND_MILESTONES)
		.map((x) => x.m);

	return { fresh, background };
}

/** «Frigjør: … Kostet: …» — bare de halvdelene som faktisk er skrevet. */
function describeLedger(m: Milestone): string {
	const parts: string[] = [];
	if (m.frees?.trim()) parts.push(`Frigjør: ${m.frees.trim()}`);
	if (m.cost?.trim()) parts.push(`Kostet: ${m.cost.trim()}`);
	return parts.join(' ');
}

function renderLine(m: Milestone, coarse: boolean): string {
	const date = formatMilestoneDate(m.achievedOn, coarse);
	const head = date ? `${m.title} (${date})` : m.title;
	const ledger = describeLedger(m);
	return ledger ? `- ${head}. ${ledger}` : `- ${head}`;
}

/**
 * Milepælsseksjonen i retningsblokken. Tom streng uten milepæler.
 *
 * Instruksen er ikke pynt: en modell som ser en liste prestasjoner uten beskjed,
 * gratulerer. Det brukeren ba om er det motsatte — at milepælen ligger der og
 * forklarer hva som er mulig nå, uten å åpne svaret.
 */
export function buildMilestoneBlock(milestones: Milestone[], now: Date): string {
	const { fresh, background } = splitMilestones(milestones, now);
	if (fresh.length === 0 && background.length === 0) return '';

	let out = '';
	if (fresh.length > 0) {
		out += `\nNYLIG OPPNÅDD (siste ${MILESTONE_FRESH_DAYS} dager):\n`;
		out += fresh.map((m) => renderLine(m, false)).join('\n') + '\n';
	}
	if (background.length > 0) {
		out += '\nOPPNÅDD TIDLIGERE (bakgrunn):\n';
		out += background.map((m) => renderLine(m, true)).join('\n') + '\n';
	}

	out +=
		'\nMilepælene er PREMISSER for hva som er mulig nå — ikke prestasjoner å gratulere med. ' +
		'Åpne aldri et svar med en av dem. Et mål som er nådd skal heller ikke brukes som ' +
		'målestokk lenger: står det fortsatt igjen noe i visjonsprosaen over om et mål som er ' +
		'oppnådd, er prosaen utdatert, og det er verdt å si én gang. ' +
		'En bakgrunns-milepæl nevnes bare når brukeren tar den opp selv, eller når den faktisk ' +
		'forklarer noe i det du svarer på — regnskapet («frigjør»/«kostet») er det som gjør den ' +
		'relevant, ikke selve oppnåelsen.\n';

	return out;
}

// ── Lagringsformen: goals.metadata.milestone ────────────────────────────────
//
// Milepælen bor på det fullførte målet selv, ikke i en egen tabell. Samme valg som
// `visionHorizon`: `metadata` er jsonb, og en egen tabell ville krevd en ny
// skrivevei for noe som alt har en rad med tittel og eier.

export interface MilestoneRecord {
	/** Oslo-dato (`YYYY-MM-DD`) for når målet ble nådd. */
	achievedOn?: string;
	frees?: string | null;
	cost?: string | null;
}

/**
 * Tak per felt. Regnskapet legges inn i HVER chat, og to avsnitt om et mål fra i
 * fjor fortrenger det samtalen faktisk handler om. Én–to setninger er formen.
 */
export const MAX_LEDGER_CHARS = 500;

/** Les milepælen ut av et `metadata`-objekt. Null når den ikke finnes eller er ugyldig. */
export function readMilestoneRecord(metadata: unknown): MilestoneRecord | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const raw = (metadata as Record<string, unknown>).milestone;
	if (!raw || typeof raw !== 'object') return null;
	const rec = raw as Record<string, unknown>;
	const out: MilestoneRecord = {};
	if (typeof rec.achievedOn === 'string' && parseIsoDay(rec.achievedOn)) out.achievedOn = rec.achievedOn;
	if (typeof rec.frees === 'string') out.frees = rec.frees;
	if (typeof rec.cost === 'string') out.cost = rec.cost;
	return out;
}

/** Tom streng betyr «fjern», som `null` — ellers kan et felt aldri tømmes igjen. */
function normalizeLedgerField(value: string | null | undefined): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export interface MilestonePatch {
	frees?: string | null;
	cost?: string | null;
	/** Eksplisitt retting av datoen. Utelatt = behold den som står. */
	achievedOn?: string;
}

/**
 * Flett en endring inn i milepælen.
 *
 * **`achievedOn` settes ÉN gang, av den første fullføringen.** Fullfører man på nytt,
 * eller fyller ut regnskapet en uke etterpå, skal datoen stå: den sier når det
 * SKJEDDE, ikke når noen sist trykket. Samme regel som at `sensor_events.timestamp`
 * ikke flyttes ved retting. En eksplisitt `achievedOn` i patchen er noe annet — det
 * er en retting brukeren ba om — og vinner.
 */
export function mergeMilestoneRecord(
	existing: MilestoneRecord | null,
	patch: MilestonePatch,
	todayIso: string
): { ok: true; record: MilestoneRecord } | { ok: false; error: string } {
	const frees = normalizeLedgerField(patch.frees);
	const cost = normalizeLedgerField(patch.cost);

	for (const [label, value] of [['frees', frees], ['cost', cost]] as const) {
		if (typeof value === 'string' && value.length > MAX_LEDGER_CHARS) {
			return {
				ok: false,
				error: `«${label}» er ${value.length} tegn — maks ${MAX_LEDGER_CHARS}. Milepælsregnskapet leses i hver samtale, så det må være én–to setninger.`
			};
		}
	}

	if (patch.achievedOn !== undefined && !parseIsoDay(patch.achievedOn)) {
		return { ok: false, error: `«${patch.achievedOn}» er ikke en dato på formen YYYY-MM-DD.` };
	}

	const record: MilestoneRecord = {
		achievedOn: patch.achievedOn ?? existing?.achievedOn ?? todayIso
	};
	const nextFrees = frees === undefined ? (existing?.frees ?? null) : frees;
	const nextCost = cost === undefined ? (existing?.cost ?? null) : cost;
	if (nextFrees !== null) record.frees = nextFrees;
	if (nextCost !== null) record.cost = nextCost;

	return { ok: true, record };
}

/** Et fullført mål → milepælen slik retningsblokken vil ha den. */
export function milestoneFromGoal(goal: {
	id: string;
	title: string;
	metadata?: unknown;
}): Milestone {
	const record = readMilestoneRecord(goal.metadata);
	return {
		id: goal.id,
		title: goal.title,
		achievedOn: record?.achievedOn ?? null,
		frees: record?.frees ?? null,
		cost: record?.cost ?? null
	};
}
