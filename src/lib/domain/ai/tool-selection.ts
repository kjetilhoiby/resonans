/**
 * Hvilke verktøy hovedchatten sender med. Se
 * `docs/changelog/2026-10-05-coachen-smart-og-rask.md`, fase 6.
 *
 * ## Hvorfor
 *
 * Målt oktober 2026: 67 verktøy og ~89 000 tegn som JSON, omtrent to
 * tredjedeler av en prompt på 34 000 tokens — i HVERT kall, og med 20 % fra
 * OpenAIs cache. De fleste meldinger bruker null eller ett verktøy.
 *
 * ## Hvorfor ikke bare rutingen
 *
 * Regex-rutingen er ikke god nok til å være en PORT. Prøvd på 24 setninger
 * slik brukeren skriver dem, rutet omtrent halvparten feil eller til
 * `general`: «Sprang meg en tur», «har jeg trent for mye?», «hvordan er
 * formen nå?», «og i fjor?». Så lenge alle verktøyene fulgte med, kostet en
 * bom bare konteksten; som port koster den verktøyet. Derfor er utvalget en
 * UNION av fire signaler, og ingen av dem alene:
 *
 * 1. rutingens domener og ferdigheter,
 * 2. temaet samtalen ligger på (som `shouldBuildHealthContext`),
 * 3. verktøy brukt nylig i tråden — oppfølgere som «og i fjor?» har ingen
 *    domeneord, men de har en forrige melding,
 * 4. et vedlagt bilde.
 *
 * Bommer alle fire, kan modellen kalle `load_tools` selv (`LOAD_TOOLS_NAME`).
 * Og utvalget går i SKYGGE først: alle verktøyene sendes, og vi måler om de
 * verktøyene modellen faktisk valgte ville vært med (`evaluateToolSelection`).
 * Kuttet skrus på med `CHAT_TOOL_SELECTION=on` når bom-andelen er kjent.
 */

import type { DashboardKind } from '$lib/domain/theme-dashboard-registry';

export const TOOL_GROUPS = [
	'kjerne',
	'helse',
	'mat',
	'okonomi',
	'familie',
	'selv',
	'hjem',
	'jobb',
	'planlegging',
	'tema',
	'widget',
	'bilde'
] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

/**
 * Hvert verktøy i hovedchatten og gruppene det hører til. En test leser
 * chat-ruta og krever at lista og ruta har nøyaktig de samme navnene: et nytt
 * verktøy uten gruppe ville stille forsvunnet fra modellen den dagen kuttet
 * skrus på.
 *
 * `kjerne` følger alltid med. Den er det en dagboksmelding, et løst spørsmål
 * eller en planleggingsmelding trenger — og målene, fordi et mål kan handle om
 * hva som helst.
 */
export const TOOL_GROUP_MAP: Record<string, readonly ToolGroup[]> = {
	// Kjerne
	web_search: ['kjerne'],
	create_memory: ['kjerne'],
	create_task: ['kjerne'],
	check_similar_tasks: ['kjerne'],
	manage_day_tasks: ['kjerne'],
	add_to_week_plan: ['kjerne'],
	plan_day: ['kjerne'],
	get_active_checklists: ['kjerne'],
	create_checklist: ['kjerne'],
	add_checklist_items: ['kjerne'],
	manage_theme: ['kjerne'],
	weather_forecast: ['kjerne'],
	query_reflections: ['kjerne'],
	record_tracking_event: ['kjerne'],
	create_goal: ['kjerne'],
	update_goal: ['kjerne'],
	check_similar_goals: ['kjerne'],
	search_metrics: ['kjerne'],
	// Helse
	query_training: ['helse'],
	query_weight: ['helse'],
	query_sleep: ['helse'],
	query_sensor_data: ['helse'],
	manage_weight_measurement: ['helse'],
	manage_training_program: ['helse'],
	log_activity: ['helse'],
	log_nap: ['helse'],
	log_sleep_disturbance: ['helse'],
	manage_streak: ['helse', 'planlegging'],
	record_screen_time: ['helse', 'bilde'],
	// Helse og mat: ernæring hører til begge (sult-ordene ruter til begge)
	query_nutrition: ['helse', 'mat'],
	log_nutrition: ['helse', 'mat'],
	log_hunger: ['helse', 'mat'],
	manage_nutrition_targets: ['helse', 'mat'],
	analyze_meal_image: ['mat', 'bilde'],
	// Mat
	query_food: ['mat'],
	find_recipes: ['mat'],
	manage_recipe: ['mat'],
	manage_meal_plan: ['mat'],
	manage_pantry: ['mat'],
	manage_food_settings: ['mat'],
	manage_lunchbox: ['mat'],
	generate_shopping_list: ['mat'],
	// Økonomi
	query_economics: ['okonomi'],
	// Familie
	query_family: ['familie'],
	manage_person: ['familie'],
	manage_relation: ['familie'],
	log_parent_time: ['familie'],
	// Selv
	query_egenfrekvens: ['selv'],
	// Hjem
	query_home: ['hjem'],
	manage_home_routine: ['hjem'],
	log_chore: ['hjem'],
	query_tesla_vehicle: ['hjem'],
	manage_procedure: ['hjem', 'planlegging'],
	// Jobb og prosjekter
	query_projects: ['jobb'],
	manage_project: ['jobb'],
	manage_project_tasks: ['jobb'],
	manage_project_contacts: ['jobb'],
	link_to_project: ['jobb'],
	query_writing: ['jobb', 'tema'],
	// Planlegging
	manage_routine: ['planlegging'],
	// Tema (bøker, film)
	book_research: ['tema'],
	film_research: ['tema'],
	// Widgets
	create_widget: ['widget'],
	propose_widget: ['widget'],
	update_widget: ['widget'],
	get_widgets: ['widget'],
	// Bilde
	annotate_photo_composition: ['bilde']
};

/** Sikkerhetsnettet: modellen kan be om flere grupper. ASCII — OpenAI tar ikke «ø» i navn. */
export const LOAD_TOOLS_NAME = 'load_tools';

/** Rutingens domener → grupper. `general` gir bare kjernen. */
const DOMAIN_GROUPS: Record<string, readonly ToolGroup[]> = {
	health: ['helse'],
	food: ['mat'],
	economics: ['okonomi'],
	family: ['familie'],
	self: ['selv'],
	home: ['hjem'],
	jobb: ['jobb'],
	planning: ['planlegging'],
	themes: ['tema']
};

/** Rutingens ferdigheter → grupper. */
const SKILL_GROUPS: Record<string, readonly ToolGroup[]> = {
	widget_creation: ['widget'],
	person_management: ['familie'],
	procedure_management: ['planlegging'],
	checklist_planning: ['planlegging']
};

/** Temaets dashboardtype → grupper. Samme signal som helse-briefingens gate. */
const THEME_KIND_GROUPS: Record<DashboardKind, readonly ToolGroup[]> = {
	health: ['helse'],
	training: ['helse'],
	sleep: ['helse'],
	screentime: ['helse'],
	weight: ['helse'],
	nutrition: ['helse', 'mat'],
	food: ['mat'],
	economics: ['okonomi'],
	family: ['familie'],
	travel: ['familie'],
	ferie: ['familie'],
	egenfrekvens: ['selv'],
	home: ['hjem'],
	vehicle: ['hjem'],
	writing: ['jobb', 'tema'],
	books: ['tema'],
	film: ['tema']
};

export interface ToolSelectionInput {
	routedDomains: readonly string[];
	routedSkills: readonly string[];
	themeKind: DashboardKind | null;
	/** Verktøy kalt i trådens siste meldinger. */
	recentToolNames: readonly string[];
	/**
	 * Domenene de forrige svarene ble rutet til. Dekker tråder fra før
	 * `toolsCalled` ble lagret, og oppfølgere der forrige svar ikke kalte noe.
	 */
	recentDomains: readonly string[];
	hasImage: boolean;
}

export interface ToolSelection {
	groups: ToolGroup[];
	/** Hvilke signaler som ga hvilke grupper — for målingen. */
	sources: { routing: ToolGroup[]; theme: ToolGroup[]; recent: ToolGroup[]; image: ToolGroup[] };
}

export function selectToolGroups(input: ToolSelectionInput): ToolSelection {
	const routing = new Set<ToolGroup>();
	for (const d of input.routedDomains) for (const g of DOMAIN_GROUPS[d] ?? []) routing.add(g);
	for (const s of input.routedSkills) for (const g of SKILL_GROUPS[s] ?? []) routing.add(g);

	const theme = new Set<ToolGroup>(input.themeKind ? THEME_KIND_GROUPS[input.themeKind] ?? [] : []);

	const recent = new Set<ToolGroup>();
	for (const name of input.recentToolNames) {
		for (const g of TOOL_GROUP_MAP[name] ?? []) if (g !== 'kjerne') recent.add(g);
	}
	for (const d of input.recentDomains) for (const g of DOMAIN_GROUPS[d] ?? []) recent.add(g);

	const image = new Set<ToolGroup>(input.hasImage ? ['bilde'] : []);

	const all = new Set<ToolGroup>(['kjerne', ...routing, ...theme, ...recent, ...image]);
	return {
		groups: TOOL_GROUPS.filter((g) => all.has(g)),
		sources: {
			routing: [...routing],
			theme: [...theme],
			recent: [...recent],
			image: [...image]
		}
	};
}

/** Verktøynavnene i et utvalg av grupper. Ukjente navn (ikke i kartet) følger ALLTID med. */
export function toolNamesForGroups(allToolNames: readonly string[], groups: readonly ToolGroup[]): Set<string> {
	const wanted = new Set(groups);
	return new Set(
		allToolNames.filter((name) => {
			const own = TOOL_GROUP_MAP[name];
			// Et verktøy uten gruppe holdes inne framfor å forsvinne stille.
			// Testen fanger det; dette er sikringen i drift.
			if (!own) return true;
			return own.some((g) => wanted.has(g));
		})
	);
}

/** Hvor mange av trådens forrige svar som teller som «nylig». */
export const RECENT_ASSISTANT_TURNS = 2;

/**
 * Trådens signal: verktøyene og domenene i de siste svarene. Leser bare
 * metadata vi selv har skrevet (`toolsCalled`, `routingDecision.domains`), og
 * bare navn som finnes i kartene — alt annet ignoreres.
 */
export function recentThreadSignals(
	history: ReadonlyArray<{ role: string; metadata?: unknown }>
): { toolNames: string[]; domains: string[] } {
	const toolNames = new Set<string>();
	const domains = new Set<string>();
	const assistants = history.filter((m) => m.role === 'assistant').slice(-RECENT_ASSISTANT_TURNS);
	for (const m of assistants) {
		const meta = (m.metadata ?? null) as Record<string, unknown> | null;
		if (!meta || typeof meta !== 'object') continue;
		const called = meta.toolsCalled;
		if (Array.isArray(called)) {
			for (const n of called) if (typeof n === 'string' && n in TOOL_GROUP_MAP) toolNames.add(n);
		}
		const routing = meta.routingDecision as { domains?: unknown } | null | undefined;
		if (routing && Array.isArray(routing.domains)) {
			for (const d of routing.domains) if (typeof d === 'string' && d in DOMAIN_GROUPS) domains.add(d);
		}
	}
	return { toolNames: [...toolNames], domains: [...domains] };
}

export function parseToolGroups(raw: unknown): ToolGroup[] {
	if (!Array.isArray(raw)) return [];
	return TOOL_GROUPS.filter((g) => raw.includes(g) && g !== 'kjerne');
}

/**
 * Hvordan utvalget gikk for én melding. `missed` er verktøy modellen KALTE
 * som ikke var med i utvalget — i skyggemodus ville de manglet; med kuttet på
 * måtte modellen hente dem med `load_tools`.
 */
export interface ToolSelectionOutcome {
	groups: ToolGroup[];
	selectedTools: number;
	totalTools: number;
	called: string[];
	missed: string[];
}

export function evaluateToolSelection(
	selected: ReadonlySet<string>,
	calledToolNames: readonly string[]
): Pick<ToolSelectionOutcome, 'called' | 'missed'> {
	const called = [...new Set(calledToolNames.filter((n) => n !== LOAD_TOOLS_NAME))];
	return { called, missed: called.filter((n) => !selected.has(n)) };
}

export const TOOL_SELECTION_MODES = ['shadow', 'on', 'off'] as const;
export type ToolSelectionMode = (typeof TOOL_SELECTION_MODES)[number];

/** Default `shadow`: mål før vi kutter. */
export function resolveToolSelectionMode(raw: string | null | undefined): ToolSelectionMode {
	const value = raw?.trim().toLowerCase();
	return (TOOL_SELECTION_MODES as readonly string[]).includes(value ?? '')
		? (value as ToolSelectionMode)
		: 'shadow';
}

/** Gruppene `load_tools` tar imot, uten `kjerne` (den er alltid med). */
export const LOADABLE_GROUPS = TOOL_GROUPS.filter((g) => g !== 'kjerne');

/** Beskrivelsen modellen ser — kort, fordi den står i hvert kall. */
export const LOAD_TOOLS_DESCRIPTION =
	'Hent flere verktøy når du trenger et som ikke står i lista. Grupper: ' +
	'helse (trening, vekt, søvn, puls, skjermtid, ernæring), mat (oppskrifter, ukemeny, lager, handleliste), ' +
	'okonomi (forbruk, konto, sparing), familie (personer, relasjoner, foreldretid), selv (egenfrekvens, humør), ' +
	'hjem (hus, rutiner, gjøremål, bil), jobb (prosjekter, skriving), planlegging (rutiner, streaks, fremgangsmåter), ' +
	'tema (bøker, film), widget (widgets på hjemskjermen), bilde (bildeanalyse). ' +
	'Kall dette FØR du svarer at du ikke kan noe, eller gjetter et tall du kunne slått opp.';
