/**
 * Hva et ÅPENT bruksstatistikk-API får si.
 *
 * ## Hvorfor dette finnes
 *
 * `/api/diagnostikk/bruk` er uautentisert med vilje: en Claude-økt uten
 * legitimasjon skal kunne lese bruksmønsteret (hvilke flater brukes, når,
 * hvor lenge, hva trykkes det på) som grunnlag for en UX-redesign. Prisen er
 * den samme som for `/api/diagnostikk`: ALT som slipper ut herfra er offentlig
 * for alltid. Utvelgelsen bor derfor her, ren og testet — samme begrunnelse
 * som `diagnostics.ts` og `public-paths.ts`.
 *
 * ## Regelen: hvitelist, aldri svartelist
 *
 * Hver utgående verdi bygges felt for felt i et NYTT objekt. Ingen spread,
 * ingen `delete`. Det gjelder også verdiene INNI feltene:
 *
 * - **Stier** går ut på rutemønsternivå (`/tema/[id]`), aldri rå. Et segment
 *   som ikke er et kjent statisk rutesegment blir `[param]` — også et
 *   temanavn i adressen (`/tema/helse`). Spørrestreng og hash kastes.
 * - **Temaer** brytes ned på dashboardTYPE (`training`, `sleep`, …, `none`),
 *   et lukket vokabular utledet av navnet på serveren. Navnet og id-en går
 *   aldri ut.
 * - **Klikk-etiketter** er det farligste feltet, fordi de SER ut som
 *   utviklernavn: `usage-logger.ts` faller tilbake på knappetekst og
 *   aria-label, og en knappetekst kan være en oppgavetittel. Bare etiketter
 *   med `data-track`-formen (`område:handling`) og en liten fast liste
 *   generiske knappeord slipper ut. Alt annet telles i ÉN `anonymous`-bøtte.
 * - **Ingen userId, ingen metadata, ingen fritekst.** `userCount` er et tall.
 *
 * ## Hva som er bevisst MED
 *
 * Tidsmønsteret (per dag, time og ukedag) er selve formålet, og det er også
 * et bruksmønster som sier når eieren er våken. Det er et valg eieren har
 * tatt; det står i `note` i svaret så ingen leser det som et uhell.
 */

import type { DashboardKind } from './theme-dashboard-registry';

// ---------------------------------------------------------------------------
// Vindu
// ---------------------------------------------------------------------------

export const DEFAULT_USAGE_DAYS = 30;
/**
 * Taket finnes av to grunner: spørringene er aggregater over hele tabellen
 * uten brukerfilter (indeksen er på `user_id, created_at`), og et åpent
 * endepunkt uten grense er en gratis dump av alt som noen gang er logget.
 */
export const MAX_USAGE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageWindow {
	days: number;
	fromMs: number;
	toMs: number;
	/** `true` når det som ble bedt om ble kappet — sies i svaret, ikke skjult. */
	clamped: boolean;
}

/** Ugyldig verdi faller til defaulten framfor 400 — samme valg som `resolveDiagnosticsWindow`. */
export function resolveUsageWindow(daysParam: string | null | undefined, now: Date = new Date()): UsageWindow {
	const requested = Number.parseInt(daysParam ?? '', 10);
	const valid = Number.isFinite(requested) && requested > 0;
	const days = valid ? Math.min(requested, MAX_USAGE_DAYS) : DEFAULT_USAGE_DAYS;
	return {
		days,
		fromMs: now.getTime() - days * DAY_MS,
		toMs: now.getTime(),
		clamped: valid && requested > MAX_USAGE_DAYS
	};
}

// ---------------------------------------------------------------------------
// Stier → rutemønster
// ---------------------------------------------------------------------------

/**
 * Alle sideruter (`+page.svelte`) i `src/routes`, slik SvelteKit navngir dem.
 *
 * En sjekket-inn liste framfor en `import.meta.glob` over rutene: globben
 * ville dratt hver side inn i endepunktets modulgraf. `usage-public.test.ts`
 * går filsystemet og feiler når lista og rutene spriker — feilmeldingen sier
 * hva som skal legges til eller fjernes. Mangler en rute her, er konsekvensen
 * TRYGG: besøkene kollapses til `[param]`-segmenter, ingenting lekker.
 */
export const PAGE_ROUTE_PATTERNS: readonly string[] = [
	'/',
	'/aktivitet/[id]',
	'/animation-exploration',
	'/apparat/[navn]',
	'/arrangementer',
	'/auth',
	'/brev',
	'/design',
	'/design-exploration',
	'/design/flater',
	'/design/kavalkade-fest',
	'/design/kavalkade-show',
	'/design/moodboard',
	'/economics/[accountId]/[tab]',
	'/economics/[accountId]/salary-month',
	'/economics/lonnsmaned',
	'/funn',
	'/handleliste',
	'/helse/sykdom/[id=uuid]',
	'/jobb',
	'/kavalkade',
	'/kavalkade/show',
	'/live/[token]',
	'/maanedsplan',
	'/notater',
	'/partner-invite/[token]',
	'/plan/drommer',
	'/plan/mal',
	'/plan/oppgaver',
	'/plan/rutiner',
	'/prosjekt/[id]',
	'/prosjekter',
	'/samtaler',
	'/sensor/[type]',
	'/settings',
	'/settings/classification',
	'/settings/classification/merchants',
	'/settings/classification/rules',
	'/settings/classification/transaction-rules',
	'/settings/external-apps',
	'/settings/jobs',
	'/settings/notifications',
	'/settings/profile',
	'/settings/sharing',
	'/settings/skjulte-okter',
	'/settings/snoozes',
	'/settings/sources',
	'/settings/themes',
	'/settings/tracking',
	'/share/[token]',
	'/skjermtid',
	'/skriv',
	'/skriv/[id=uuid]',
	'/spill',
	'/tema/[id]',
	'/tema/[id]/kapplister/skriv-ut',
	'/trening',
	'/treningsprogram',
	'/treningsprogram/[id]',
	'/treningsprogram/ny',
	'/ukeplan',
	'/workouts'
];

/** Det et ukjent segment erstattes med. */
export const PARAM_SEGMENT = '[param]';
/** En sti dypere enn dette er ikke en side, og dybden selv er nok informasjon. */
const MAX_FALLBACK_SEGMENTS = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CompiledSegment =
	| { kind: 'static'; value: string }
	| { kind: 'param'; name: string; matcher: string | null };

interface CompiledRoute {
	pattern: string;
	/** Mønsteret slik det går ut: matchere fjernet (`[id=uuid]` → `[id]`). */
	publicPattern: string;
	segments: CompiledSegment[];
}

function splitSegments(path: string): string[] {
	return path.split('/').filter((s) => s.length > 0);
}

function compileRoute(pattern: string): CompiledRoute {
	const segments: CompiledSegment[] = splitSegments(pattern).map((seg) => {
		const param = /^\[([^\]=]+)(?:=([^\]]+))?\]$/.exec(seg);
		if (param) return { kind: 'param', name: param[1], matcher: param[2] ?? null };
		return { kind: 'static', value: seg };
	});
	const publicPattern =
		'/' +
		segments.map((s) => (s.kind === 'static' ? s.value : `[${s.name}]`)).join('/');
	return { pattern, publicPattern: publicPattern === '/' ? '/' : publicPattern, segments };
}

const COMPILED_ROUTES: CompiledRoute[] = PAGE_ROUTE_PATTERNS.map(compileRoute);

/** Statiske segmenter fra rutene — de eneste segmentene som kan gå ut uendret. */
const KNOWN_STATIC_SEGMENTS: ReadonlySet<string> = new Set(
	COMPILED_ROUTES.flatMap((r) =>
		r.segments.filter((s): s is { kind: 'static'; value: string } => s.kind === 'static').map((s) => s.value)
	)
);

function matcherAccepts(matcher: string | null, segment: string): boolean {
	if (matcher === null) return true;
	if (matcher === 'uuid') return UUID_RE.test(segment);
	// Ukjent matcher: ikke gjett. Ruta matcher ikke, og fallbacken kollapser.
	return false;
}

/** Rang per segment: statisk slår matcher slår fri parameter (SvelteKits rekkefølge). */
function routeRank(route: CompiledRoute): number[] {
	return route.segments.map((s) => (s.kind === 'static' ? 2 : s.matcher ? 1 : 0));
}

function compareRank(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? -1) - (b[i] ?? -1);
		if (diff !== 0) return diff;
	}
	return 0;
}

/** Stripper spørrestreng og hash, og gir segmentene. */
function cleanSegments(rawPath: string): string[] {
	const withoutQuery = rawPath.split('?')[0].split('#')[0];
	return splitSegments(withoutQuery);
}

/**
 * En rå sti, redusert til et offentlig rutemønster.
 *
 * Treffer stien en kjent side, er svaret sidens mønster. Ellers beholdes
 * bare segmenter som finnes som statiske rutesegmenter, og resten blir
 * `[param]` — så en ukjent sti kan aldri bære et navn, et token eller en id ut.
 */
export function toPublicPathPattern(rawPath: string | null | undefined): string {
	if (!rawPath) return '/';
	const segments = cleanSegments(rawPath);

	let best: CompiledRoute | null = null;
	for (const route of COMPILED_ROUTES) {
		if (route.segments.length !== segments.length) continue;
		const ok = route.segments.every((s, i) =>
			s.kind === 'static' ? s.value === segments[i] : matcherAccepts(s.matcher, segments[i])
		);
		if (!ok) continue;
		if (!best || compareRank(routeRank(route), routeRank(best)) > 0) best = route;
	}
	if (best) return best.publicPattern;

	if (segments.length === 0) return '/';
	const collapsed = segments
		.slice(0, MAX_FALLBACK_SEGMENTS)
		.map((s) => (KNOWN_STATIC_SEGMENTS.has(s) ? s : PARAM_SEGMENT));
	return '/' + collapsed.join('/') + (segments.length > MAX_FALLBACK_SEGMENTS ? '/…' : '');
}

/**
 * Temasegmentet i en `/tema/<segment>…`-sti, for oppslag PÅ SERVEREN.
 *
 * Returnerer det rå segmentet (en uuid, eller et navn som `/tema/helse`).
 * Det går aldri ut — serveren slår det opp og gir tilbake bare dashboardtypen.
 * Uuid-er gis i små bokstaver så oppslaget ikke avhenger av skrivemåte.
 */
export function themeSegmentOf(rawPath: string | null | undefined): string | null {
	if (!rawPath) return null;
	const segments = cleanSegments(rawPath);
	if (segments[0] !== 'tema' || !segments[1]) return null;
	const segment = segments[1];
	if (UUID_RE.test(segment)) return segment.toLowerCase();
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

/** Sideruta `/tema/[id]` slår opp et navn med stor forbokstav — se `+page.server.ts`. */
export function themeNameFromSlug(slug: string): string {
	return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function isUuid(value: string): boolean {
	return UUID_RE.test(value);
}

// ---------------------------------------------------------------------------
// Temaer → dashboardtype
// ---------------------------------------------------------------------------

/**
 * Hvitelista over typer. Et `Record` over unionen, så TypeScript feiler her
 * når en ny `DashboardKind` legges til — framfor at den stille blir `ukjent`.
 */
const DASHBOARD_KINDS: Record<DashboardKind, true> = {
	health: true,
	training: true,
	sleep: true,
	screentime: true,
	nutrition: true,
	weight: true,
	economics: true,
	food: true,
	family: true,
	travel: true,
	ferie: true,
	books: true,
	film: true,
	egenfrekvens: true,
	home: true,
	vehicle: true,
	writing: true
};

/**
 * `none` = temaet finnes, men har ingen dashboardtype.
 * `ukjent` = temaet ble ikke funnet (slettet, eller et navn som ga 404).
 */
export type PublicThemeKind = DashboardKind | 'none' | 'ukjent';

/** Validerer en type mot hvitelista. Alt annet blir `ukjent`. */
export function toPublicThemeKind(kind: string | null | undefined): PublicThemeKind {
	if (kind === 'none') return 'none';
	if (kind && Object.prototype.hasOwnProperty.call(DASHBOARD_KINDS, kind)) return kind as DashboardKind;
	return 'ukjent';
}

// ---------------------------------------------------------------------------
// Klikk-etiketter
// ---------------------------------------------------------------------------

/** Formen `data-track` skal ha ifølge CLAUDE.md: `område:handling`, kebab-case. */
const DATA_TRACK_RE = /^[a-z0-9æøå-]+:[a-z0-9æøå-]+$/;
const MAX_LABEL_LENGTH = 80;

/**
 * Generiske knappeord. En knappetekst som ER ett av disse kan ikke være
 * brukerinnhold i noen meningsfull forstand, og de sier mye om hvor folk
 * lagrer, avbryter og lukker. Sammenlignes uten hensyn til store/små
 * bokstaver; går ut i formen her.
 */
export const GENERIC_BUTTON_LABELS: readonly string[] = [
	'Lagre',
	'Avbryt',
	'Lukk',
	'Slett',
	'Legg til',
	'Send',
	'Tilbake',
	'Neste',
	'Forrige',
	'Ferdig',
	'OK',
	'Rediger',
	'Opprett',
	'Meny',
	'Vis mer',
	'Vis mindre',
	'Vis alle',
	'Del',
	'Last opp',
	'Stopp',
	'Prøv igjen',
	'Bekreft',
	'Fortsett',
	'Hopp over',
	'Søk',
	'Oppdater',
	'Angre',
	'Kopier',
	'Ja',
	'Nei'
];

const GENERIC_BY_KEY = new Map(GENERIC_BUTTON_LABELS.map((l) => [l.toLocaleLowerCase('nb'), l]));

/**
 * En rå etikett, eller `null` når den skal i den anonyme bøtta.
 *
 * NB: `null` er standarden. En etikett må BEVISE at den er et utviklernavn
 * (data-track-formen) eller et generisk ord — det holder ikke at den ser
 * harmløs ut, for knappeteksten «Ring tannlegen» ser også harmløs ut.
 */
export function toPublicInteractionLabel(label: string | null | undefined): string | null {
	if (typeof label !== 'string') return null;
	const trimmed = label.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_LABEL_LENGTH) return null;
	if (DATA_TRACK_RE.test(trimmed)) return trimmed;
	return GENERIC_BY_KEY.get(trimmed.replace(/\s+/g, ' ').toLocaleLowerCase('nb')) ?? null;
}

/** Taggene klikk-loggeren kan skrive (`closest(...)`-selektoren). Lukket vokabular. */
const INTERACTION_TAGS = new Set(['button', 'a', 'input', 'label', 'summary']);

export function toPublicTag(tag: string | null | undefined): string {
	return tag && INTERACTION_TAGS.has(tag) ? tag : 'annet';
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type PublicChatSource = 'web' | 'ekko' | 'annet';

export function toPublicChatSource(source: string | null | undefined): PublicChatSource {
	return source === 'web' || source === 'ekko' ? source : 'annet';
}

/**
 * Hvilken slags tråd en melding ble skrevet i. `dagbok` er den kanoniske
 * hjem-tråden (`metadata.canonical`), `tema` en temachat, `annen` resten
 * (fri samtale, økt-chat, flyt …).
 */
export type PublicConversationKind = 'dagbok' | 'tema' | 'annen';

export function toPublicConversationKind(input: { canonical: boolean; themeId: string | null }): PublicConversationKind {
	if (input.canonical) return 'dagbok';
	if (input.themeId) return 'tema';
	return 'annen';
}

// ---------------------------------------------------------------------------
// Inndata (grupperte rader fra SQL) og utdata
// ---------------------------------------------------------------------------

/** Én (Oslo-dag, Oslo-time) med tellinger. */
export interface UsageDayHourRow {
	day: string;
	hour: number;
	events: number;
	pageViews: number;
	attentionMs: number;
	appResumes: number;
	interactions: number;
}

export interface UsageSessionRow {
	day: string;
	sessions: number;
}

/** Én (rå sti uten spørrestreng, Oslo-dag). Stien forlater aldri denne modulen rå. */
export interface UsagePathDayRow {
	path: string;
	day: string;
	pageViews: number;
	attentionMs: number;
}

/** Én (rå sti, rå etikett, tagg) med antall. Etiketten forlater aldri modulen rå. */
export interface UsageInteractionRow {
	path: string;
	label: string | null;
	tag: string | null;
	count: number;
}

/** Én (Oslo-dag, kilde, tema, kanonisk) med brukermeldinger og distinkte tråder. */
export interface ChatDayRow {
	day: string;
	source: string | null;
	themeId: string | null;
	canonical: boolean;
	userMessages: number;
	conversations: number;
}

export interface PublicUsageInput {
	window: UsageWindow;
	userCount: number;
	dayHourRows: UsageDayHourRow[];
	sessionRows: UsageSessionRow[];
	pathDayRows: UsagePathDayRow[];
	interactionRows: UsageInteractionRow[];
	chatRows: ChatDayRow[];
	chatUserCount: number;
	/**
	 * Temasegment (uuid i små bokstaver, eller navn fra `/tema/helse`) og
	 * tema-id-er fra samtaler → dashboardtype. Bygget av serveren. Mangler
	 * nøkkelen, er temaet ukjent.
	 */
	themeKinds: ReadonlyMap<string, string>;
	truncated: { paths: boolean; interactions: boolean; chat: boolean };
}

export interface PublicUsageDay {
	date: string;
	weekday: string;
	pageViews: number;
	attentionMinutes: number;
	sessions: number;
	appResumes: number;
	interactions: number;
}

export interface PublicUsageHour {
	hour: number;
	pageViews: number;
	attentionMinutes: number;
}

export interface PublicUsageWeekday {
	weekday: string;
	isoWeekday: number;
	daysInWindow: number;
	activeDays: number;
	pageViews: number;
	attentionMinutes: number;
	sessions: number;
}

export interface PublicUsagePath {
	pattern: string;
	views: number;
	attentionMinutes: number;
	distinctDays: number;
}

export interface PublicThemeKindUsage {
	kind: PublicThemeKind;
	views: number;
	attentionMinutes: number;
	distinctDays: number;
}

export interface PublicInteraction {
	label: string;
	count: number;
}

export interface PublicPathInteractions {
	pattern: string;
	total: number;
	anonymous: number;
	top: PublicInteraction[];
}

export interface PublicChatDay {
	date: string;
	userMessages: number;
	conversations: number;
}

export interface PublicChatBreakdown<K extends string> {
	key: K;
	userMessages: number;
	/**
	 * Tråd-dager: distinkte tråder per dag, summert over vinduet. En tråd som
	 * ble skrevet i på tre dager teller tre. (Distinkte tråder over hele
	 * vinduet ville krevd en egen spørring, og spørsmålet er «hvor ofte».)
	 */
	conversationDays: number;
}

export interface PublicChatUsage {
	userCount: number;
	userMessages: number;
	activeDays: number;
	byDay: PublicChatDay[];
	bySource: PublicChatBreakdown<PublicChatSource>[];
	byConversationKind: PublicChatBreakdown<PublicConversationKind>[];
	byThemeKind: PublicChatBreakdown<PublicThemeKind>[];
}

export interface PublicUsage {
	window: { days: number; from: string; to: string; clamped: boolean; timeZone: 'Europe/Oslo' };
	userCount: number;
	activeDays: number;
	sessions: number;
	pageViews: number;
	appResumes: number;
	totalAttentionMinutes: number;
	byDay: PublicUsageDay[];
	byHour: PublicUsageHour[];
	byWeekday: PublicUsageWeekday[];
	byPath: PublicUsagePath[];
	themeKinds: PublicThemeKindUsage[];
	interactions: {
		total: number;
		anonymous: number;
		anonymousByTag: Array<{ tag: string; count: number }>;
		top: PublicInteraction[];
		byPath: PublicPathInteractions[];
	};
	chat: PublicChatUsage;
	truncated: { paths: boolean; interactions: boolean; chat: boolean };
	note: string;
}

export const TOP_INTERACTIONS_LIMIT = 40;
export const TOP_INTERACTIONS_PER_PATH = 10;

const WEEKDAYS = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'] as const;

export const USAGE_NOTE =
	'Aggregater over ALLE brukere (userCount sier hvor mange), i Oslo-tid. ' +
	'Stier er rutemønstre: ukjente segmenter er [param], spørrestreng er fjernet, og ' +
	'temaer er brutt ned på dashboardtype — aldri navn eller id. Klikk-etiketter vises bare ' +
	'når de har data-track-formen (område:handling) eller er et generisk knappeord; alt annet ' +
	'(knappetekst kan være en oppgavetittel) telles som anonymous. Økter: ny økt etter 30 min ' +
	'uten hendelser, per bruker, talt på startdagen. Oppmerksomhet er aktiv, synlig tid og ' +
	'stemples når siden forlates, så time-fordelingen av den er omtrentlig. Chat er bare antall ' +
	'brukermeldinger og distinkte tråder — aldri innhold. Ikke med: userId, metadata, fritekst, ' +
	'rå stier. Tidsmønsteret er med fordi det er formålet; det sier også når brukeren er aktiv.';

function minutes(ms: number): number {
	return Math.round((ms / 60_000) * 10) / 10;
}

function osloDayKey(ms: number): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date(ms));
}

/** ISO-ukedag (1 = mandag) for en `YYYY-MM-DD`. Datoen alene, uten klokke. */
function isoWeekday(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return dow === 0 ? 7 : dow;
}

function addDay(day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Alle Oslo-dager i vinduet, så en dag uten bruk står som 0 framfor å mangle. */
export function daysInWindow(window: UsageWindow): string[] {
	const first = osloDayKey(window.fromMs);
	const last = osloDayKey(window.toMs);
	const out: string[] = [];
	for (let day = first; day <= last && out.length <= MAX_USAGE_DAYS + 2; day = addDay(day)) out.push(day);
	return out;
}

function themeKindFor(map: ReadonlyMap<string, string>, key: string | null): PublicThemeKind {
	if (!key) return 'ukjent';
	return toPublicThemeKind(map.get(key));
}

function sortedBreakdown<K extends string>(acc: Map<K, { m: number; c: number }>): PublicChatBreakdown<K>[] {
	return [...acc.entries()]
		.map(([key, v]) => ({ key, userMessages: v.m, conversationDays: v.c }))
		.sort((a, b) => b.userMessages - a.userMessages || a.key.localeCompare(b.key));
}

/**
 * Hele svaret, bygget av grupperte rader.
 *
 * NB: hvert utgående objekt bygges felt for felt. Rå stier, rå etiketter og
 * tema-id-er brukes som NØKLER i mellomregningen og forlater aldri funksjonen.
 */
export function buildPublicUsage(input: PublicUsageInput): PublicUsage {
	const allDays = daysInWindow(input.window);

	// --- Per dag og time --------------------------------------------------
	const dayAcc = new Map<
		string,
		{ events: number; pageViews: number; attentionMs: number; appResumes: number; interactions: number; sessions: number }
	>();
	const hourAcc = Array.from({ length: 24 }, () => ({ pageViews: 0, attentionMs: 0 }));
	const dayEntry = (day: string) => {
		let e = dayAcc.get(day);
		if (!e) {
			e = { events: 0, pageViews: 0, attentionMs: 0, appResumes: 0, interactions: 0, sessions: 0 };
			dayAcc.set(day, e);
		}
		return e;
	};

	for (const row of input.dayHourRows) {
		const e = dayEntry(row.day);
		e.events += row.events;
		e.pageViews += row.pageViews;
		e.attentionMs += row.attentionMs;
		e.appResumes += row.appResumes;
		e.interactions += row.interactions;
		const hour = Number.isInteger(row.hour) && row.hour >= 0 && row.hour < 24 ? row.hour : null;
		if (hour !== null) {
			hourAcc[hour].pageViews += row.pageViews;
			hourAcc[hour].attentionMs += row.attentionMs;
		}
	}
	for (const row of input.sessionRows) dayEntry(row.day).sessions += row.sessions;

	const dayKeys = new Set(allDays);
	for (const day of dayAcc.keys()) dayKeys.add(day);
	const orderedDays = [...dayKeys].sort();

	const byDay: PublicUsageDay[] = orderedDays.map((date) => {
		const e = dayAcc.get(date);
		return {
			date,
			weekday: WEEKDAYS[isoWeekday(date) - 1],
			pageViews: e?.pageViews ?? 0,
			attentionMinutes: minutes(e?.attentionMs ?? 0),
			sessions: e?.sessions ?? 0,
			appResumes: e?.appResumes ?? 0,
			interactions: e?.interactions ?? 0
		};
	});

	const byHour: PublicUsageHour[] = hourAcc.map((h, hour) => ({
		hour,
		pageViews: h.pageViews,
		attentionMinutes: minutes(h.attentionMs)
	}));

	const weekdayAcc = WEEKDAYS.map(() => ({ days: 0, active: 0, pageViews: 0, attentionMs: 0, sessions: 0 }));
	for (const date of orderedDays) {
		const w = weekdayAcc[isoWeekday(date) - 1];
		const e = dayAcc.get(date);
		w.days++;
		if (e && e.events > 0) w.active++;
		w.pageViews += e?.pageViews ?? 0;
		w.attentionMs += e?.attentionMs ?? 0;
		w.sessions += e?.sessions ?? 0;
	}
	const byWeekday: PublicUsageWeekday[] = weekdayAcc.map((w, i) => ({
		weekday: WEEKDAYS[i],
		isoWeekday: i + 1,
		daysInWindow: w.days,
		activeDays: w.active,
		pageViews: w.pageViews,
		attentionMinutes: minutes(w.attentionMs),
		sessions: w.sessions
	}));

	let totalAttentionMs = 0;
	let pageViews = 0;
	let appResumes = 0;
	let sessions = 0;
	let activeDays = 0;
	let interactionsTotal = 0;
	for (const e of dayAcc.values()) {
		totalAttentionMs += e.attentionMs;
		pageViews += e.pageViews;
		appResumes += e.appResumes;
		sessions += e.sessions;
		interactionsTotal += e.interactions;
		if (e.events > 0) activeDays++;
	}

	// --- Per rutemønster og per tematype ----------------------------------
	const pathAcc = new Map<string, { views: number; attentionMs: number; days: Set<string> }>();
	const kindAcc = new Map<PublicThemeKind, { views: number; attentionMs: number; days: Set<string> }>();
	for (const row of input.pathDayRows) {
		const pattern = toPublicPathPattern(row.path);
		const p = pathAcc.get(pattern) ?? { views: 0, attentionMs: 0, days: new Set<string>() };
		p.views += row.pageViews;
		p.attentionMs += row.attentionMs;
		if (row.pageViews > 0 || row.attentionMs > 0) p.days.add(row.day);
		pathAcc.set(pattern, p);

		if (pattern === '/tema/[id]' || pattern.startsWith('/tema/[id]/')) {
			const kind = themeKindFor(input.themeKinds, themeSegmentOf(row.path));
			const k = kindAcc.get(kind) ?? { views: 0, attentionMs: 0, days: new Set<string>() };
			k.views += row.pageViews;
			k.attentionMs += row.attentionMs;
			if (row.pageViews > 0 || row.attentionMs > 0) k.days.add(row.day);
			kindAcc.set(kind, k);
		}
	}

	const byPath: PublicUsagePath[] = [...pathAcc.entries()]
		.map(([pattern, p]) => ({
			pattern,
			views: p.views,
			attentionMinutes: minutes(p.attentionMs),
			distinctDays: p.days.size
		}))
		.sort((a, b) => b.attentionMinutes - a.attentionMinutes || b.views - a.views || a.pattern.localeCompare(b.pattern));

	const themeKinds: PublicThemeKindUsage[] = [...kindAcc.entries()]
		.map(([kind, k]) => ({
			kind,
			views: k.views,
			attentionMinutes: minutes(k.attentionMs),
			distinctDays: k.days.size
		}))
		.sort((a, b) => b.attentionMinutes - a.attentionMinutes || b.views - a.views || a.kind.localeCompare(b.kind));

	// --- Klikk ------------------------------------------------------------
	const labelAcc = new Map<string, number>();
	const tagAcc = new Map<string, number>();
	const perPath = new Map<string, { total: number; anonymous: number; labels: Map<string, number> }>();
	let anonymous = 0;
	let fetchedInteractions = 0;
	for (const row of input.interactionRows) {
		const count = Math.max(0, Math.round(row.count));
		fetchedInteractions += count;
		const pattern = toPublicPathPattern(row.path);
		const p = perPath.get(pattern) ?? { total: 0, anonymous: 0, labels: new Map<string, number>() };
		p.total += count;
		const label = toPublicInteractionLabel(row.label);
		if (label === null) {
			anonymous += count;
			p.anonymous += count;
			const tag = toPublicTag(row.tag);
			tagAcc.set(tag, (tagAcc.get(tag) ?? 0) + count);
		} else {
			labelAcc.set(label, (labelAcc.get(label) ?? 0) + count);
			p.labels.set(label, (p.labels.get(label) ?? 0) + count);
		}
		perPath.set(pattern, p);
	}
	const byCount = (a: PublicInteraction, b: PublicInteraction) => b.count - a.count || a.label.localeCompare(b.label);
	const toList = (m: Map<string, number>, limit: number): PublicInteraction[] =>
		[...m.entries()].map(([label, count]) => ({ label, count })).sort(byCount).slice(0, limit);

	const interactions = {
		// Totalen fra dag/time-radene er hele sannheten; de grupperte klikkradene kan være kappet.
		total: Math.max(interactionsTotal, fetchedInteractions),
		anonymous,
		anonymousByTag: [...tagAcc.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
		top: toList(labelAcc, TOP_INTERACTIONS_LIMIT),
		byPath: [...perPath.entries()]
			.map(([pattern, p]) => ({
				pattern,
				total: p.total,
				anonymous: p.anonymous,
				top: toList(p.labels, TOP_INTERACTIONS_PER_PATH)
			}))
			.sort((a, b) => b.total - a.total || a.pattern.localeCompare(b.pattern))
	};

	// --- Chat -------------------------------------------------------------
	const chatDayAcc = new Map<string, { m: number; c: number }>();
	const sourceAcc = new Map<PublicChatSource, { m: number; c: number }>();
	const convKindAcc = new Map<PublicConversationKind, { m: number; c: number }>();
	const chatThemeAcc = new Map<PublicThemeKind, { m: number; c: number }>();
	let chatMessages = 0;
	const bump = <K>(m: Map<K, { m: number; c: number }>, key: K, row: ChatDayRow) => {
		const e = m.get(key) ?? { m: 0, c: 0 };
		e.m += row.userMessages;
		// En tråd har én kilde, ett tema og én kanonisk-verdi, så distinkte tråder
		// per gruppe kan summeres uten dobbelttelling innen samme dag. Over flere
		// dager telles en tråd én gang per dag den ble skrevet i.
		e.c += row.conversations;
		m.set(key, e);
	};
	for (const row of input.chatRows) {
		chatMessages += row.userMessages;
		bump(chatDayAcc, row.day, row);
		bump(sourceAcc, toPublicChatSource(row.source), row);
		bump(convKindAcc, toPublicConversationKind(row), row);
		if (row.themeId) bump(chatThemeAcc, themeKindFor(input.themeKinds, row.themeId.toLowerCase()), row);
	}
	const chatDayKeys = new Set(allDays);
	for (const day of chatDayAcc.keys()) chatDayKeys.add(day);
	const chat: PublicChatUsage = {
		userCount: input.chatUserCount,
		userMessages: chatMessages,
		activeDays: [...chatDayAcc.values()].filter((e) => e.m > 0).length,
		byDay: [...chatDayKeys].sort().map((date) => ({
			date,
			userMessages: chatDayAcc.get(date)?.m ?? 0,
			conversations: chatDayAcc.get(date)?.c ?? 0
		})),
		bySource: sortedBreakdown(sourceAcc),
		byConversationKind: sortedBreakdown(convKindAcc),
		byThemeKind: sortedBreakdown(chatThemeAcc)
	};

	return {
		window: {
			days: input.window.days,
			from: new Date(input.window.fromMs).toISOString(),
			to: new Date(input.window.toMs).toISOString(),
			clamped: input.window.clamped,
			timeZone: 'Europe/Oslo'
		},
		userCount: input.userCount,
		activeDays,
		sessions,
		pageViews,
		appResumes,
		totalAttentionMinutes: minutes(totalAttentionMs),
		byDay,
		byHour,
		byWeekday,
		byPath,
		themeKinds,
		interactions,
		chat,
		truncated: {
			paths: input.truncated.paths,
			interactions: input.truncated.interactions,
			chat: input.truncated.chat
		},
		note: USAGE_NOTE
	};
}
