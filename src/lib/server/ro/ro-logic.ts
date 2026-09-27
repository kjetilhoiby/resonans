/**
 * Ren logikk for Ro – Ekkos refleksjons- og ekvanimitetsmodus (docs/ekko-ro.md).
 *
 * Ingen DB og ingen IO her, så progresjon, valg av øvelse og sammenslåing av det
 * modellen trekker ut kan testes isolert. Prinsippet er det samme som i quizen:
 * modellen foreslår, koden bestemmer. Modellen får aldri skrive profilen direkte –
 * den leverer et forslag som `mergeReflection` klipper, dedupliserer og tar imot.
 *
 * Det viktigste skillet i profilen er HVEM som mener noe:
 *   - observation/trigger/reaction/interpretation/working: det brukeren selv sa
 *     (trukket ut av refleksjonen, i brukerens egne ord så langt det går).
 *   - user_hypothesis / assistant_hypothesis: en forklaring. Den er `proposed` til
 *     brukeren har sagt ja, og en hypotese brukeren har sagt nei til blir stående
 *     som `rejected` – så assistenten ikke foreslår den igjen neste uke.
 * Det er det som hindrer at systemet begynner å fortelle brukeren hvem brukeren er.
 */

// ── Katalogen ────────────────────────────────────────────────────────────────
// Øvelsene selv (tekstene som leses opp) bor i Ekko (`Models/RoLibrary.swift`).
// Serveren kjenner bare id-ene og hva hver øvelse øver på – det er nok til å velge.
// Legger du til en øvelse, gjør det begge steder.

export type RoStage = 'observe' | 'understand' | 'tolerate' | 'choose' | 'try';
export const RO_STAGES: RoStage[] = ['observe', 'understand', 'tolerate', 'choose', 'try'];

export const RO_STAGE_LABELS: Record<RoStage, string> = {
	observe: 'observere',
	understand: 'forstå',
	tolerate: 'tåle',
	choose: 'velge',
	try: 'prøve i livet'
};

export interface RoStructure {
	id: string;
	title: string;
	/** Hva økta faktisk øver på – brukes i prompten og vises i appen. */
	practices: string;
	/** Trinn der øvelsen passer i en temasyklus. Tom = bare for åpne økter. */
	stages: RoStage[];
	/** Kan brukes uten tema (åpen økt). */
	open: boolean;
}

export const RO_STRUCTURES: RoStructure[] = [
	{
		id: 'lande',
		title: 'Lande og se',
		practices: 'Lande i kroppen, merke tanker, skille styrbart fra ikke-styrbart, tåle én tanke, velge en kvalitet.',
		stages: [],
		open: true
	},
	{
		id: 'aktivering',
		title: 'Merk aktiveringen',
		practices: 'Kjenne hvor reaksjonen starter i kroppen, før fortellingen om den tar over.',
		stages: ['observe'],
		open: true
	},
	{
		id: 'fortolkning',
		title: 'Hva skjedde – og hva gjorde hodet av det',
		practices: 'Skille observasjon fra tolkning. Se hva hendelsen blir gjort til.',
		stages: ['understand'],
		open: false
	},
	{
		id: 'kontroll',
		title: 'Det du styrer',
		practices: 'Stoisk skille: egne handlinger, tone og oppmerksomhet mot andres reaksjoner og utfallet.',
		stages: ['understand', 'choose'],
		open: true
	},
	{
		id: 'ubehag',
		title: 'Bli i ubehaget',
		practices: 'Frivillig litt ubehag i kroppen, så en vanskelig tanke – uten å løse eller prosedere.',
		stages: ['tolerate'],
		open: true
	},
	{
		id: 'respons',
		title: 'De fem sekundene',
		practices: 'Se situasjonen for seg, finne øyeblikket før reaksjonen, velge og øve en annen respons.',
		stages: ['choose', 'try'],
		open: false
	},
	{
		id: 'omgivelser',
		title: 'Åpne sanser',
		practices: 'Oppmerksomhet ut: lyd, lys, luft, underlag. Legge merke til uten å kommentere.',
		stages: [],
		open: true
	}
];

export function structureById(id: string | null | undefined): RoStructure | null {
	return RO_STRUCTURES.find((s) => s.id === id) ?? null;
}

// ── Profilen ─────────────────────────────────────────────────────────────────

export type RoThemeStatus = 'emerging' | 'active' | 'background' | 'resolved-ish' | 'dormant';
const THEME_STATUSES: RoThemeStatus[] = ['emerging', 'active', 'background', 'resolved-ish', 'dormant'];

export interface RoTheme {
	id: string;
	label: string;
	lifeArea: string | null;
	/** Mønsteret slik det er forstått nå: trigger → tolkning → reaksjon. Kort. */
	pattern: string | null;
	/** Det brukeren øver på akkurat nå, f.eks. «merke aktiveringen før du svarer». */
	currentPractice: string | null;
	/**
	 * Siste konkrete situasjon brukeren nevnte, som frase («planen som ble endret»).
	 * Gjør at «Fortsett med temaet» kan bruke øvelser som trenger en situasjon.
	 */
	situation: string | null;
	stage: RoStage;
	sessionsAtStage: number;
	sessionsSinceReview: number;
	status: RoThemeStatus;
	lastReview: RoReview | null;
	createdAt: string;
	lastTouchedAt: string;
}

export type RoNoteKind =
	| 'observation'
	| 'trigger'
	| 'reaction'
	| 'interpretation'
	| 'working'
	| 'user_hypothesis'
	| 'assistant_hypothesis';
const NOTE_KINDS: RoNoteKind[] = [
	'observation',
	'trigger',
	'reaction',
	'interpretation',
	'working',
	'user_hypothesis',
	'assistant_hypothesis'
];

export type RoNoteStatus = 'noted' | 'proposed' | 'accepted' | 'rejected';

export interface RoNote {
	id: string;
	themeId: string | null;
	kind: RoNoteKind;
	text: string;
	status: RoNoteStatus;
	sessionId: string | null;
	createdAt: string;
}

export interface RoReview {
	before: string;
	now: string;
	tried: string;
	helped: string;
	stuck: string;
	question: string;
	createdAt: string;
}

export interface RoProfile {
	version: 1;
	themes: RoTheme[];
	notes: RoNote[];
	/** Øvelsen forrige åpne økt brukte – så to åpne økter på rad ikke blir like. */
	lastOpenStructureId: string | null;
}

export const MAX_NOTES = 80;
export const MAX_ACTIVE_THEMES = 2;
export const MAX_TEXT = 160;
export const DORMANT_AFTER_DAYS = 42;
/** Etter så mange økter på et tema foreslås en lengre gjennomgang. */
export const REVIEW_AFTER_SESSIONS = 6;
/** Minst så mange økter på et trinn før modellens «videre» tas til følge. */
export const MIN_SESSIONS_BEFORE_ADVANCE = 2;

export function emptyProfile(): RoProfile {
	return { version: 1, themes: [], notes: [], lastOpenStructureId: null };
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Klipp til én linje uten anførselstegn og markdown. `null` når ingenting er igjen. */
export function cleanText(v: unknown, max = MAX_TEXT): string | null {
	if (typeof v !== 'string') return null;
	const t = v
		.replace(/[\r\n]+/g, ' ')
		.replace(/[«»"“”*_#`]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!t) return null;
	if (t.length <= max) return t;
	const cut = t.slice(0, max);
	const lastSpace = cut.lastIndexOf(' ');
	return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

/**
 * En frase som settes inn midt i en setning i øvelsene: liten forbokstav, ingen
 * avsluttende tegnsetting. Modellen svarer ofte med en hel setning («Merk kjeven før
 * du svarer.»), og «I dag: Merk kjeven før du svarer..» er hva brukeren da hører.
 */
export function asPhrase(v: unknown, max: number): string | null {
	const t = cleanText(v, max);
	if (!t) return null;
	const trimmed = t.replace(/[.!?…:;,\s]+$/u, '');
	if (!trimmed) return null;
	// «Jeg» og egennavn beholder stor forbokstav; resten begynner midt i en setning.
	const keepCase = /^Jeg(\s|$)/u.test(trimmed) || /^[A-ZÆØÅ]{2}/u.test(trimmed);
	return keepCase ? trimmed : trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

export function slugify(label: string): string {
	const base = label
		.toLowerCase()
		.replace(/æ/g, 'ae')
		.replace(/ø/g, 'o')
		.replace(/å/g, 'a')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 40);
	return base || 'tema';
}

function normalizeForDedupe(text: string): string {
	return text.toLowerCase().replace(/[^a-zæøå0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Tolerant lesing av det som ligger i `ro_profiles.state`. Ukjent form ⇒ tom profil. */
export function parseProfile(raw: unknown): RoProfile {
	if (!isRecord(raw)) return emptyProfile();
	const themes: RoTheme[] = Array.isArray(raw.themes)
		? raw.themes.filter(isRecord).map((t) => ({
				id: String(t.id ?? ''),
				label: String(t.label ?? ''),
				lifeArea: typeof t.lifeArea === 'string' ? t.lifeArea : null,
				pattern: typeof t.pattern === 'string' ? t.pattern : null,
				currentPractice: typeof t.currentPractice === 'string' ? t.currentPractice : null,
				situation: typeof t.situation === 'string' ? t.situation : null,
				stage: RO_STAGES.includes(t.stage as RoStage) ? (t.stage as RoStage) : 'observe',
				sessionsAtStage: Number.isFinite(t.sessionsAtStage) ? Number(t.sessionsAtStage) : 0,
				sessionsSinceReview: Number.isFinite(t.sessionsSinceReview) ? Number(t.sessionsSinceReview) : 0,
				status: THEME_STATUSES.includes(t.status as RoThemeStatus) ? (t.status as RoThemeStatus) : 'emerging',
				lastReview: isRecord(t.lastReview) ? (t.lastReview as unknown as RoReview) : null,
				createdAt: String(t.createdAt ?? new Date(0).toISOString()),
				lastTouchedAt: String(t.lastTouchedAt ?? t.createdAt ?? new Date(0).toISOString())
			}))
			.filter((t) => t.id && t.label)
		: [];
	const notes: RoNote[] = Array.isArray(raw.notes)
		? raw.notes.filter(isRecord).map((n) => ({
				id: String(n.id ?? ''),
				themeId: typeof n.themeId === 'string' ? n.themeId : null,
				kind: NOTE_KINDS.includes(n.kind as RoNoteKind) ? (n.kind as RoNoteKind) : 'observation',
				text: String(n.text ?? ''),
				status: (['noted', 'proposed', 'accepted', 'rejected'] as const).includes(n.status as RoNoteStatus)
					? (n.status as RoNoteStatus)
					: 'noted',
				sessionId: typeof n.sessionId === 'string' ? n.sessionId : null,
				createdAt: String(n.createdAt ?? new Date(0).toISOString())
			}))
			.filter((n) => n.id && n.text)
		: [];
	return {
		version: 1,
		themes,
		notes,
		lastOpenStructureId: typeof raw.lastOpenStructureId === 'string' ? raw.lastOpenStructureId : null
	};
}

/**
 * Et tema ingen har rørt på seks uker er ikke aktivt lenger, uansett hva som står.
 * Livet har skiftet tema; det gamle kan komme tilbake, men skal ikke mase.
 */
export function effectiveStatus(theme: RoTheme, now: Date): RoThemeStatus {
	if (theme.status === 'resolved-ish' || theme.status === 'dormant') return theme.status;
	const age = (now.getTime() - new Date(theme.lastTouchedAt).getTime()) / 86_400_000;
	return age > DORMANT_AFTER_DAYS ? 'dormant' : theme.status;
}

/** Temaet brukeren kan fortsette med: nyligst rørt av de aktive/framvoksende. */
export function currentTheme(profile: RoProfile, now: Date): RoTheme | null {
	const live = profile.themes
		.filter((t) => {
			const s = effectiveStatus(t, now);
			return s === 'active' || s === 'emerging';
		})
		.sort((a, b) => {
			// Aktive foran framvoksende, så nyligst rørt.
			if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
			return b.lastTouchedAt.localeCompare(a.lastTouchedAt);
		});
	return live[0] ?? null;
}

// ── Valg av øvelse ───────────────────────────────────────────────────────────

/**
 * Øvelsen for et tema følger trinnet. Når flere øvelser passer trinnet, veksles det
 * på antall økter på trinnet – samme ferdighet, ny inngang. Variasjonen kommer fra
 * hva økta øver på, ikke fra hva vi ikke har sagt på en stund.
 */
export function structureForStage(stage: RoStage, sessionsAtStage: number): RoStructure {
	const candidates = RO_STRUCTURES.filter((s) => s.stages.includes(stage));
	if (candidates.length === 0) return structureById('lande')!;
	return candidates[sessionsAtStage % candidates.length];
}

/** Åpen økt: aldri samme øvelse to ganger på rad, og første økt noensinne er «Lande og se». */
export function structureForOpen(profile: RoProfile, completedSessions: number): RoStructure {
	if (completedSessions === 0) return structureById('lande')!;
	const rotation = ['lande', 'omgivelser', 'aktivering', 'kontroll', 'ubehag'];
	const lastIndex = rotation.indexOf(profile.lastOpenStructureId ?? '');
	return structureById(rotation[(lastIndex + 1) % rotation.length])!;
}

/** Spørsmålet etter løpeturen følger trinnet – det er der refleksjonen hører hjemme. */
export function closingQuestionFor(stage: RoStage | null): string {
	switch (stage) {
		case 'understand':
			return 'Var det noe du fikk litt mer avstand til?';
		case 'tolerate':
			return 'Hva skjedde med ubehaget da du lot det være?';
		case 'choose':
			return 'Hva ønsker du å gjøre annerledes når situasjonen faktisk oppstår?';
		case 'try':
			return 'Har situasjonen dukket opp siden sist? Hva gjorde du – og hva la du merke til?';
		default:
			return 'Hva la du merke til?';
	}
}

// ── Plan: det modellen fikk ut av «noe jeg grubler på» ──────────────────────

export interface RoIntakeExtraction {
	themeId: string | null;
	newThemeLabel: string | null;
	lifeArea: string | null;
	situation: string | null;
	focus: string | null;
	safety: RoSafety;
}

export type RoSafety = 'none' | 'concern' | 'crisis';

function parseSafety(v: unknown): RoSafety {
	return v === 'crisis' || v === 'concern' ? v : 'none';
}

export function parseIntakeExtraction(raw: unknown, knownThemeIds: string[]): RoIntakeExtraction {
	const r = isRecord(raw) ? raw : {};
	const themeId = typeof r.themeId === 'string' && knownThemeIds.includes(r.themeId) ? r.themeId : null;
	return {
		themeId,
		newThemeLabel: themeId ? null : cleanText(r.newThemeLabel, 50),
		lifeArea: cleanText(r.lifeArea, 30),
		// Settes inn i setninger som «Tenk kort på {situasjon}.» – kort og nøytral.
		situation: asPhrase(r.situation, 70),
		focus: asPhrase(r.focus, 90),
		safety: parseSafety(r.safety)
	};
}

/**
 * Legg til eller oppdater temaet fra en intake. Returnerer temaet økta skal bruke.
 * Et nytt tema starter som `emerging` på trinnet «observere».
 */
export function upsertThemeFromIntake(
	profile: RoProfile,
	extraction: RoIntakeExtraction,
	now: Date
): RoTheme | null {
	const iso = now.toISOString();
	if (extraction.themeId) {
		const theme = profile.themes.find((t) => t.id === extraction.themeId)!;
		if (theme.status === 'dormant' || theme.status === 'resolved-ish' || theme.status === 'background') {
			// Et gammelt tema som dukker opp igjen, begynner på nytt med å observere –
			// men beholder det som alt er lært om det.
			theme.status = 'emerging';
			theme.stage = 'observe';
			theme.sessionsAtStage = 0;
		}
		if (extraction.focus) theme.currentPractice = extraction.focus;
		if (extraction.situation) theme.situation = extraction.situation;
		theme.lastTouchedAt = iso;
		return theme;
	}
	if (!extraction.newThemeLabel) return null;
	let id = slugify(extraction.newThemeLabel);
	while (profile.themes.some((t) => t.id === id)) id = `${id}_2`;
	const theme: RoTheme = {
		id,
		label: extraction.newThemeLabel,
		lifeArea: extraction.lifeArea,
		pattern: null,
		currentPractice: extraction.focus,
		situation: extraction.situation,
		stage: 'observe',
		sessionsAtStage: 0,
		sessionsSinceReview: 0,
		status: 'emerging',
		lastReview: null,
		createdAt: iso,
		lastTouchedAt: iso
	};
	profile.themes.push(theme);
	return theme;
}

// ── Refleksjon: det modellen trakk ut etter løpeturen ────────────────────────

export interface RoProposal {
	noteId: string;
	kind: 'user_hypothesis' | 'assistant_hypothesis';
	text: string;
	question: string;
}

export interface RoReflectionExtraction {
	reply: string;
	safety: RoSafety;
	themeId: string | null;
	newThemeLabel: string | null;
	lifeArea: string | null;
	themeStatus: RoThemeStatus | null;
	pattern: string | null;
	currentPractice: string | null;
	stageSignal: 'advance' | 'hold' | 'revisit';
	observations: string[];
	triggers: string[];
	reactions: string[];
	interpretations: string[];
	working: string[];
	proposal: { kind: 'user_hypothesis' | 'assistant_hypothesis'; text: string; question: string } | null;
	otherThemes: { id: string; status: RoThemeStatus }[];
}

function stringList(v: unknown, max = 3): string[] {
	if (!Array.isArray(v)) return [];
	return v
		.map((x) => cleanText(x))
		.filter((x): x is string => !!x)
		.slice(0, max);
}

export const FALLBACK_REPLY = 'Takk. Det er notert. Ta med deg det du la merke til.';

export function parseReflectionExtraction(raw: unknown, knownThemeIds: string[]): RoReflectionExtraction {
	const r = isRecord(raw) ? raw : {};
	const themeId = typeof r.themeId === 'string' && knownThemeIds.includes(r.themeId) ? r.themeId : null;
	const p = isRecord(r.proposal) ? r.proposal : null;
	const proposalText = p ? cleanText(p.text) : null;
	const proposal =
		p && proposalText
			? {
					kind: p.kind === 'user_hypothesis' ? ('user_hypothesis' as const) : ('assistant_hypothesis' as const),
					text: proposalText,
					question: cleanText(p.question, 140) ?? 'Vil du at vi tar med den tanken til neste økt?'
				}
			: null;
	const reply = typeof r.reply === 'string' ? r.reply.replace(/[*_#`]/g, '').trim().slice(0, 600) : '';
	return {
		reply: reply || FALLBACK_REPLY,
		safety: parseSafety(r.safety),
		themeId,
		newThemeLabel: themeId ? null : cleanText(r.newThemeLabel, 50),
		lifeArea: cleanText(r.lifeArea, 30),
		themeStatus: THEME_STATUSES.includes(r.themeStatus as RoThemeStatus) ? (r.themeStatus as RoThemeStatus) : null,
		pattern: cleanText(r.pattern, 200),
		currentPractice: asPhrase(r.currentPractice, 90),
		stageSignal: r.stageSignal === 'advance' || r.stageSignal === 'revisit' ? r.stageSignal : 'hold',
		observations: stringList(r.observations),
		triggers: stringList(r.triggers, 2),
		reactions: stringList(r.reactions, 2),
		interpretations: stringList(r.interpretations, 2),
		working: stringList(r.working, 2),
		proposal,
		otherThemes: Array.isArray(r.otherThemes)
			? r.otherThemes
					.filter(isRecord)
					.filter((o) => typeof o.id === 'string' && knownThemeIds.includes(o.id))
					.filter((o) => THEME_STATUSES.includes(o.status as RoThemeStatus))
					.map((o) => ({ id: o.id as string, status: o.status as RoThemeStatus }))
			: []
	};
}

export interface MergeResult {
	theme: RoTheme | null;
	proposal: RoProposal | null;
	advanced: boolean;
}

/**
 * Ta imot det modellen trakk ut av en refleksjon. Muterer `profile`.
 *
 * Reglene som er lette å bryte:
 *  - Trinnet flyttes bare framover når modellen sier «advance» OG temaet har hatt
 *    minst to økter på trinnet. Én god økt er ikke en ferdighet.
 *  - Ved krise lagres ingenting nytt om temaet og ingen hypotese foreslås. Det
 *    viktige da er svaret, ikke profilen.
 *  - En hypotese som ligner en brukeren har avvist, foreslås ikke igjen.
 *  - Maks to aktive temaer: blir et tredje aktivt, går det eldste i bakgrunnen.
 */
export function mergeReflection(
	profile: RoProfile,
	extraction: RoReflectionExtraction,
	opts: { sessionThemeId: string | null; sessionId: string; now: Date; newId: () => string }
): MergeResult {
	if (extraction.safety === 'crisis') return { theme: null, proposal: null, advanced: false };

	const iso = opts.now.toISOString();
	let theme: RoTheme | null = null;

	const targetId = extraction.themeId ?? opts.sessionThemeId;
	if (targetId) theme = profile.themes.find((t) => t.id === targetId) ?? null;
	if (!theme && extraction.newThemeLabel) {
		theme = upsertThemeFromIntake(
			profile,
			{
				themeId: null,
				newThemeLabel: extraction.newThemeLabel,
				lifeArea: extraction.lifeArea,
				situation: null,
				focus: extraction.currentPractice,
				safety: 'none'
			},
			opts.now
		);
	}

	let advanced = false;
	if (theme) {
		theme.lastTouchedAt = iso;
		theme.sessionsSinceReview += 1;
		if (extraction.pattern) theme.pattern = extraction.pattern;
		if (extraction.currentPractice) theme.currentPractice = extraction.currentPractice;
		if (extraction.themeStatus) theme.status = extraction.themeStatus;
		else if (theme.status === 'emerging' && theme.sessionsAtStage >= 1) theme.status = 'active';

		const idx = RO_STAGES.indexOf(theme.stage);
		if (
			extraction.stageSignal === 'advance' &&
			theme.sessionsAtStage + 1 >= MIN_SESSIONS_BEFORE_ADVANCE &&
			idx < RO_STAGES.length - 1
		) {
			theme.stage = RO_STAGES[idx + 1];
			theme.sessionsAtStage = 0;
			advanced = true;
		} else if (extraction.stageSignal === 'revisit' && idx > 0) {
			theme.stage = RO_STAGES[idx - 1];
			theme.sessionsAtStage = 0;
		} else {
			theme.sessionsAtStage += 1;
		}
	}

	for (const o of extraction.otherThemes) {
		const other = profile.themes.find((t) => t.id === o.id);
		if (other && other !== theme) other.status = o.status;
	}
	enforceActiveLimit(profile, theme);

	const themeId = theme?.id ?? null;
	const add = (kind: RoNoteKind, texts: string[]) => {
		for (const text of texts) addNote(profile, { kind, text, themeId, status: 'noted', sessionId: opts.sessionId }, opts);
	};
	add('observation', extraction.observations);
	add('trigger', extraction.triggers);
	add('reaction', extraction.reactions);
	add('interpretation', extraction.interpretations);
	add('working', extraction.working);

	let proposal: RoProposal | null = null;
	if (extraction.proposal && !isRejectedBefore(profile, extraction.proposal.text)) {
		const note = addNote(
			profile,
			{
				kind: extraction.proposal.kind,
				text: extraction.proposal.text,
				themeId,
				status: 'proposed',
				sessionId: opts.sessionId
			},
			opts
		);
		if (note) {
			proposal = {
				noteId: note.id,
				kind: extraction.proposal.kind,
				text: note.text,
				question: extraction.proposal.question
			};
		}
	}

	pruneNotes(profile);
	return { theme, proposal, advanced };
}

function enforceActiveLimit(profile: RoProfile, keep: RoTheme | null) {
	const active = profile.themes
		.filter((t) => t.status === 'active')
		.sort((a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt));
	for (const t of active.slice(MAX_ACTIVE_THEMES)) {
		if (t !== keep) t.status = 'background';
	}
}

function isRejectedBefore(profile: RoProfile, text: string): boolean {
	const key = normalizeForDedupe(text);
	return profile.notes.some((n) => n.status === 'rejected' && normalizeForDedupe(n.text) === key);
}

function addNote(
	profile: RoProfile,
	note: Omit<RoNote, 'id' | 'createdAt'>,
	opts: { now: Date; newId: () => string }
): RoNote | null {
	const key = normalizeForDedupe(note.text);
	if (!key) return null;
	const existing = profile.notes.find(
		(n) => n.kind === note.kind && n.themeId === note.themeId && normalizeForDedupe(n.text) === key
	);
	if (existing) {
		// Samme ting sagt igjen er et signal, ikke støy: flytt den fram i tid.
		existing.createdAt = opts.now.toISOString();
		return existing.status === 'rejected' ? null : existing;
	}
	const created: RoNote = { ...note, id: opts.newId(), createdAt: opts.now.toISOString() };
	profile.notes.push(created);
	return created;
}

/** Hold profilen liten. Aksepterte hypoteser og det som virker kastes sist. */
export function pruneNotes(profile: RoProfile) {
	if (profile.notes.length <= MAX_NOTES) return;
	const weight = (n: RoNote) =>
		n.status === 'accepted' || n.kind === 'working' ? 2 : n.status === 'rejected' ? 1 : 0;
	const sorted = [...profile.notes].sort((a, b) => weight(a) - weight(b) || a.createdAt.localeCompare(b.createdAt));
	const drop = new Set(sorted.slice(0, profile.notes.length - MAX_NOTES).map((n) => n.id));
	profile.notes = profile.notes.filter((n) => !drop.has(n.id));
}

/** Ja eller nei til en foreslått hypotese. Returnerer false hvis den ikke finnes. */
export function answerProposal(profile: RoProfile, noteId: string, accept: boolean): boolean {
	const note = profile.notes.find((n) => n.id === noteId && n.status === 'proposed');
	if (!note) return false;
	note.status = accept ? 'accepted' : 'rejected';
	return true;
}

// ── Oversikt: observasjoner, ikke prestasjon ────────────────────────────────

export interface RoOverview {
	sessionsLast30Days: number;
	themes: { id: string; label: string; status: RoThemeStatus; stage: RoStage; stageLabel: string; currentPractice: string | null }[];
	/** Det brukeren har sagt virker, nyligst først. Ikke en score. */
	working: string[];
	acceptedHypotheses: string[];
	reviewSuggested: { themeId: string; label: string } | null;
}

export function buildOverview(profile: RoProfile, sessionsLast30Days: number, now: Date): RoOverview {
	const themes = profile.themes
		.map((t) => ({ t, status: effectiveStatus(t, now) }))
		.filter(({ status }) => status === 'active' || status === 'emerging' || status === 'background')
		.sort((a, b) => b.t.lastTouchedAt.localeCompare(a.t.lastTouchedAt))
		.map(({ t, status }) => ({
			id: t.id,
			label: t.label,
			status,
			stage: t.stage,
			stageLabel: RO_STAGE_LABELS[t.stage],
			currentPractice: t.currentPractice
		}));
	const recent = (kind: RoNoteKind, status?: RoNoteStatus) =>
		profile.notes
			.filter((n) => n.kind === kind && (!status || n.status === status))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, 3)
			.map((n) => n.text);
	const reviewTheme = profile.themes.find(
		(t) => t.sessionsSinceReview >= REVIEW_AFTER_SESSIONS && effectiveStatus(t, now) === 'active'
	);
	return {
		sessionsLast30Days,
		themes,
		working: recent('working'),
		acceptedHypotheses: [
			...profile.notes.filter((n) => n.status === 'accepted').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		]
			.slice(0, 3)
			.map((n) => n.text),
		reviewSuggested: reviewTheme ? { themeId: reviewTheme.id, label: reviewTheme.label } : null
	};
}

export function parseReview(raw: unknown, now: Date): RoReview | null {
	const r = isRecord(raw) ? raw : {};
	const field = (k: string) => cleanText(r[k], 400) ?? '';
	const review: RoReview = {
		before: field('before'),
		now: field('now'),
		tried: field('tried'),
		helped: field('helped'),
		stuck: field('stuck'),
		question: field('question'),
		createdAt: now.toISOString()
	};
	return review.before || review.now || review.helped ? review : null;
}

/** Kompakt tekst om profilen til prompten. Aldri hele notatlista. */
export function profileForPrompt(profile: RoProfile, now: Date): string {
	const lines: string[] = [];
	const themes = profile.themes.filter((t) => effectiveStatus(t, now) !== 'dormant');
	if (themes.length === 0) lines.push('Ingen temaer ennå.');
	for (const t of themes) {
		lines.push(
			`- tema id=${t.id} «${t.label}» (${effectiveStatus(t, now)}, trinn: ${RO_STAGE_LABELS[t.stage]}, ${t.sessionsAtStage} økter på trinnet)` +
				(t.pattern ? `\n  mønster: ${t.pattern}` : '') +
				(t.currentPractice ? `\n  øver på: ${t.currentPractice}` : '')
		);
		const notes = profile.notes
			.filter((n) => n.themeId === t.id)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, 10);
		for (const n of notes) lines.push(`  · ${n.kind}${n.status !== 'noted' ? ` [${n.status}]` : ''}: ${n.text}`);
	}
	const dormant = profile.themes.filter((t) => effectiveStatus(t, now) === 'dormant');
	if (dormant.length) lines.push(`Hvilende temaer: ${dormant.map((t) => `id=${t.id} «${t.label}»`).join(', ')}`);
	return lines.join('\n');
}

/**
 * Ved krise skal svaret alltid ha 113 og Mental Helse Hjelpetelefonen. Det er ikke
 * overlatt til modellen – men det modellen alt har sagt, gjentas ikke.
 */
export function withCrisisHelp(reply: string): string {
	const parts = [reply.trim()];
	if (!/\b113\b/.test(reply)) parts.push('Er det akutt, ring 113.');
	if (!reply.includes('116 123')) parts.push('Mental Helse Hjelpetelefonen er døgnåpen på 116 123.');
	return parts.filter(Boolean).join(' ');
}
