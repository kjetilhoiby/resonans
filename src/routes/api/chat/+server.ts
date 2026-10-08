import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildModularSystemPrompt } from '$lib/server/prompts';
import { createChatPerf, formatChatPerfLine } from '$lib/server/chat-perf';
import { recordChatPerf } from '$lib/server/chat-perf-store';
import { openai } from '$lib/server/openai';
import { getUserActiveGoalsAndTasks, findSimilarGoals, findSimilarTasks } from '$lib/server/goals';
import { getOrCreateConversation, createConversation, addMessage, getConversationHistory, getConversationByIdForUser } from '$lib/server/conversations';
import { recordTrackingEvent } from '$lib/server/tracking-series';
import { ContextService } from '$lib/server/services/context-service';
import { upsertPlanArtifactField } from '$lib/server/plan-artifacts';
import {
	buildHealthChatContext,
	shouldBuildHealthContext
} from '$lib/server/health/health-chat-context';
import { getHealthThemeIds } from '$lib/server/themes';
import { buildPersonContext, buildFamilyOverview } from '$lib/server/person-context';
import { stripToolLeakage } from '$lib/server/chat-sanitize';
import { buildDayContextBlock } from '$lib/server/day-location-context';
import { buildTripContext } from '$lib/server/ferie-context';
import { executeBookResearch } from '$lib/ai/tools/book-research';
import { executeFilmResearch } from '$lib/ai/tools/film-research';
import { runWebResearch } from '$lib/server/web/web-research';
import { resolveResearchScope, type ThemeResearchDomains } from '$lib/server/web/research-domains';
import { saveThemeResearch, getThemeResearchDomains } from '$lib/server/services/theme-research-service';
import { buildResearchCard, type ResearchCard, type ResearchCardMap } from '$lib/chat/research-card';
import { geocodePlace } from '$lib/utils/geocode';
import { createGoalTool } from '$lib/ai/tools/create-goal';
import { createTaskTool } from '$lib/ai/tools/create-task';
import { updateGoalTool } from '$lib/ai/tools/update-goal';
import { logActivityTool } from '$lib/ai/tools/log-activity';
import { logNapTool } from '$lib/ai/tools/log-nap';
import { logSleepDisturbanceTool } from '$lib/ai/tools/log-sleep-disturbance';
import { logChoreTool } from '$lib/ai/tools/log-chore';
import { logParentTimeTool } from '$lib/ai/tools/log-parent-time';
import { createMemoryTool } from '$lib/ai/tools/create-memory';
import { queryEconomicsTool } from '$lib/ai/tools/query-economics';
import { queryReflectionsTool } from '$lib/ai/tools/query-reflections';
import { queryWritingTool } from '$lib/ai/tools/query-writing';
import { queryTrainingTool } from '$lib/ai/tools/query-training';
import { queryWeightTool } from '$lib/ai/tools/query-weight';
import { queryMovementTool } from '$lib/ai/tools/query-movement';
import { manageWeightMeasurementTool } from '$lib/ai/tools/manage-weight-measurement';
import { querySleepTool } from '$lib/ai/tools/query-sleep';
import { queryEgenfrekvensTool } from '$lib/ai/tools/query-egenfrekvens';
import { queryFoodTool } from '$lib/ai/tools/query-food';
import { manageRecipeTool } from '$lib/ai/tools/manage-recipe';
import { queryFamilyTool } from '$lib/ai/tools/query-family';
import { managePersonTool } from '$lib/ai/tools/manage-person';
import { manageRelationTool } from '$lib/ai/tools/manage-relation';
import { manageMealPlanTool } from '$lib/ai/tools/manage-meal-plan';
import { managePantryTool } from '$lib/ai/tools/manage-pantry';
import { manageLunchboxTool } from '$lib/ai/tools/manage-lunchbox';
import { findRecipesTool } from '$lib/ai/tools/find-recipes';
import { manageFoodSettingsTool } from '$lib/ai/tools/manage-food-settings';
import { generateShoppingListTool } from '$lib/ai/tools/generate-shopping-list';
import { analyzeMealImageTool } from '$lib/ai/tools/analyze-meal-image';
import { logNutritionTool } from '$lib/ai/tools/log-nutrition';
import { queryNutritionTool } from '$lib/ai/tools/query-nutrition';
import { manageNutritionTargetsTool } from '$lib/ai/tools/manage-nutrition-targets';
import { logHungerTool } from '$lib/ai/tools/log-hunger';
import {
	createUserWidget,
	findSimilarWidget,
	listWidgetsForChat,
	updateUserWidget
} from '$lib/skills/widget-creation/service';
import { executeSearchMetrics } from '$lib/ai/tools/search-metrics';
import { getMetricByKey } from '$lib/server/services/metric-definition-service';
import { aggregateSingleMetric } from '$lib/server/integrations/aggregation';
import { runInBackground } from '$lib/server/run-in-background';
import { buildChecklistItemFields } from '$lib/server/checklist-item-builder';
import { afterMealItemWritten } from '$lib/server/services/meal-plan-sync';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { syncStaysForDate } from '$lib/server/stays';
import {
	markWidgetFlowCreated,
	type WidgetCreationFlow
} from '$lib/flows/widget-creation/flow';
import { routeChatRequest, aiRouteChatRequest } from '$lib/server/chat-router';
import { db } from '$lib/db';
import { checklists, checklistItems, themes, users } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ChatAnswerSample, ChatPerfSample, PromptPart, ToolSelectionSample } from '$lib/domain/chat-perf-stats';
import {
	createChatCompletionWithFallback,
	type ChatStreamHooks
} from '$lib/server/chat-completion';
import { env } from '$env/dynamic/private';
import {
	evaluateToolSelection,
	LOAD_TOOLS_DESCRIPTION,
	LOAD_TOOLS_NAME,
	LOADABLE_GROUPS,
	parseToolGroups,
	recentThreadSignals,
	resolveToolSelectionMode,
	selectToolGroups,
	toolNamesForGroups,
	type ToolGroup
} from '$lib/domain/ai/tool-selection';
import { assembleSystemPrompt } from '$lib/domain/ai/chat-system-prompt';
import { CHAT_TOOLS as tools } from '$lib/server/chat/tools';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { CAPTURE_INSTRUCTION, captureDisplayText, pickCaptureAttachments } from '$lib/domain/capture';
import {
	chooseChatModel,
	completionSizing,
	isLegacyChatModelMode,
	isReasoningChatModel,
	resolveReasoningEffort,
	resolveVerbosity
} from '$lib/domain/ai/chat-model';

type AttachmentKind = 'image' | 'audio' | 'document' | 'other';

interface AttachmentPayload {
	url: string;
	kind: AttachmentKind;
	name?: string;
	mimeType?: string;
	note?: string;
	publicId?: string;
	source?: 'camera' | 'file' | 'voice' | 'sheet';
	sizeBytes?: number;
	contentText?: string;
	extractionKind?: string;
}

function isAttachmentPayload(value: unknown): value is AttachmentPayload {
	if (!value || typeof value !== 'object') return false;

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.url === 'string' &&
		(candidate.kind === 'image' || candidate.kind === 'audio' || candidate.kind === 'document' || candidate.kind === 'other')
	);
}

function describeAttachment(attachment: AttachmentPayload): string {
	const lines = [
		`Vedleggstype: ${attachment.kind}`,
		attachment.name ? `Filnavn: ${attachment.name}` : null,
		attachment.mimeType ? `Mime-type: ${attachment.mimeType}` : null,
		attachment.source ? `Kilde: ${attachment.source}` : null,
		attachment.note ? `Brukernotat: ${attachment.note}` : null,
		attachment.extractionKind ? `Innholdskilde: ${attachment.extractionKind}` : null,
		attachment.contentText ? `Ekstrahert innhold:\n${attachment.contentText}` : null,
		attachment.url ? `Vedleggs-URL: ${attachment.url}` : null
	].filter(Boolean);

	return lines.join('\n');
}

// Kontekst-flyt-hint: i en etablert samtale er ikke en kald, kontekstløs triage
// nyttig. I stedet ber vi modellen tolke vedlegget i lys av samtalen og — når det
// faktisk passer — foreslå konkrete neste steg via verktøyene/flytene den har
// (widget, måling/tracking, plan/oppgave, tema/prosjekt). Dette er «triage med
// kontekst», men der flyt-maskineriet faktisk bor: på selve chatturen.
const ATTACHMENT_FLOW_HINT =
	'\n\n[System: Tolk vedlegget i lys av samtalen så langt — ikke som en isolert fil. ' +
	'Hvis innholdet naturlig peker mot et konkret neste steg (f.eks. opprette/oppdatere en widget, ' +
	'registrere en måling, lage en plan eller oppgave, eller knytte til et tema/prosjekt), så foreslå det ' +
	'kort og tilby å sette det i gang med verktøyene dine. Hold deg til det som faktisk passer — ikke finn på handlinger.]';

function buildUserMessageForModel(message: string, attachment: AttachmentPayload | null): string {
	if (!attachment) {
		return message;
	}

	return `${message}\n\n--- VEDLEGG ---\n${describeAttachment(attachment)}\n--- SLUTT PÅ VEDLEGG ---${ATTACHMENT_FLOW_HINT}`;
}

/**
 * Flere vedlegg i én melding (Én inngang). Ett vedlegg gir nøyaktig samme tekst
 * som før, så de eksisterende flytene ikke merker noe.
 */
function buildUserMessageForModelMany(message: string, attachments: AttachmentPayload[]): string {
	if (attachments.length <= 1) return buildUserMessageForModel(message, attachments[0] ?? null);
	const blocks = attachments
		.map((a, i) => `--- VEDLEGG ${i + 1} AV ${attachments.length} ---\n${describeAttachment(a)}`)
		.join('\n\n');
	return `${message}\n\n${blocks}\n--- SLUTT PÅ VEDLEGGENE ---${ATTACHMENT_FLOW_HINT}`;
}

/** Vedleggene en lagret melding bærer: lista fra Én inngang, ellers det ene. */
function attachmentsFromMetadata(metadata: unknown): AttachmentPayload[] {
	const meta = (metadata ?? null) as { attachment?: unknown; attachments?: unknown } | null;
	if (!meta) return [];
	const list = Array.isArray(meta.attachments) ? meta.attachments.filter(isAttachmentPayload) : [];
	if (list.length > 0) return list;
	return isAttachmentPayload(meta.attachment) ? [meta.attachment] : [];
}

function getDefaultAttachmentLabel(attachment: AttachmentPayload | null): string {
	if (!attachment) return 'Vedlegg';
	if (attachment.kind === 'image') return '📷 [Bilde]';
	if (attachment.kind === 'audio') return `🎙️ ${attachment.name || 'Lydfil'}`;
	if (attachment.kind === 'document') return `📄 ${attachment.name || 'Dokument'}`;
	return `📎 ${attachment.name || 'Vedlegg'}`;
}

async function executeWebSearch(
	query: string,
	opts: { themeDomains?: ThemeResearchDomains | null; deep?: boolean } = {}
) {
	// Tavily-basert research: søk → ekstraher sideinnhold → oppsummer med kilder.
	// Kildevalg (kuraterte + per-tema domener), topic/tidsvindu og evt. dyp modus
	// utledes fra spørsmålet via resolveResearchScope.
	const scope = resolveResearchScope(query, opts.themeDomains ?? null);
	const { findings, sources, images } = await runWebResearch(query, {
		includeDomains: scope.includeDomains,
		excludeDomains: scope.excludeDomains,
		topic: scope.tavilyTopic,
		days: scope.days,
		deep: opts.deep,
		deepTopic: scope.topic,
		// Bilder bare for steds-treff, av samme grunn som kartet (se changelog
		// 2026-07-23): et bilde av et sted viser noe. På et kunnskaps- eller
		// helsespørsmål er Tavilys bildestripe sjangerfoto — tre sjablongbilder av
		// løpere over et svar om brukerens egne vintre — og pynt gjør et tynt svar
		// tynnere, ikke rikere.
		includeImages: scope.topic === 'travel'
	});

	if (sources.length === 0) {
		return {
			success: false,
			query,
			findings: '',
			sources: [],
			images: [],
			topic: scope.topic,
			message: `Ingen brukbare treff for "${query}". (Mangler evt. TAVILY_API_KEY.)`
		};
	}

	return {
		success: true,
		query,
		findings,
		sources,
		images,
		topic: scope.topic,
		message: `Fant og oppsummerte ${sources.length} kilder for "${query}".`
	};
}

/**
 * Kart-koordinat for et reise-tema til kilde-kortet. Bruker lagrede koordinater
 * fra tripProfile når de finnes; ellers geokodes destinasjonen (best-effort).
 * Returnerer null hvis temaet ikke er et reise-tema / mangler destinasjon.
 */
async function resolveThemeMap(themeId: string, userId: string): Promise<ResearchCardMap | null> {
	const { themes } = await import('$lib/db/schema');
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId)),
		columns: { tripProfile: true }
	});
	const tp = theme?.tripProfile;
	if (!tp?.destination) return null;
	const label = tp.country ? `${tp.destination}, ${tp.country}` : tp.destination;

	if (typeof tp.lat === 'number' && typeof tp.lng === 'number') {
		return { lat: tp.lat, lng: tp.lng, label };
	}

	const geo = await geocodePlace(label).catch(() => null);
	if (geo) return { lat: geo.lat, lng: geo.lon, label };
	return null;
}

/** Verktøylistas lengde som JSON, regnet én gang — lista er en modulkonstant. */
let toolsJsonCharsCache: number | null = null;
function toolsJsonChars(): number {
	toolsJsonCharsCache ??= JSON.stringify(tools).length;
	return toolsJsonCharsCache;
}

/** Alle verktøynavnene, i lista sin rekkefølge. Kartet i `tool-selection.ts` må dekke dem. */
const ALL_TOOL_NAMES: string[] = tools.map((t) => t.function.name);

/**
 * Sikkerhetsnettet når verktøyutvalget er skrudd på (`CHAT_TOOL_SELECTION=on`):
 * modellen ber om en gruppe, og den følger med fra neste runde. Står ikke i
 * `tools`, fordi den bare gir mening når lista er kuttet.
 */
const loadToolsDefinition = {
	type: 'function' as const,
	function: {
		name: LOAD_TOOLS_NAME,
		description: LOAD_TOOLS_DESCRIPTION,
		parameters: {
			type: 'object',
			properties: {
				groups: {
					type: 'array',
					items: { type: 'string', enum: [...LOADABLE_GROUPS] },
					description: 'Gruppene du trenger.'
				}
			},
			required: ['groups']
		}
	}
};

export class _ChatRequestError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export interface _ChatProgressEvent {
	stage: string;
	message: string;
	detail?: Record<string, unknown>;
}

export interface _RunChatRequestParams {
	body: {
		message?: string;
		imageUrl?: string;
		conversationId?: string;
		attachment?: unknown;
		/** Flere vedlegg i én melding (Én inngang). Kommer i tillegg til `attachment`. */
		attachments?: unknown[];
		/** Meldingen kom gjennom Én inngang: coachen skal finne ut hva det er og lagre det. */
		capture?: boolean;
		forceNewConversation?: boolean;
		/** Tittel for samtalen når forceNewConversation oppretter den (f.eks. flytens navn). */
		conversationTitle?: string;
	};
	userId: string;
	requestUrl: string;
	requestFetch: typeof fetch;
	onProgress?: (event: _ChatProgressEvent) => void | Promise<void>;
	systemPromptPrefix?: string;
	preferredModel?: string;
}

function getToolProgressMessage(toolName: string) {
	const labels: Record<string, string> = {
		check_similar_goals: 'Sjekker lignende mål...',
		check_similar_tasks: 'Sjekker lignende oppgaver...',
		create_goal: 'Oppretter mål...',
		update_goal: 'Oppdaterer målet...',
		create_task: 'Oppretter oppgave...',
		log_activity: 'Registrerer aktivitet...',
		create_memory: 'Lagrer hukommelse...',
		manage_theme: 'Oppdaterer tema...',
		query_sensor_data: 'Henter sensordata...',
		query_training: 'Leser treningsbelastning...',
		query_weight: 'Leser vekttrend...',
		query_movement: 'Leser bevegelsene dine...',
		manage_weight_measurement: 'Slår opp vektmålinger...',
		query_sleep: 'Leser søvndata...',
		query_egenfrekvens: 'Leser innsjekk...',
		query_tesla_vehicle: 'Sjekker bilen...',
		query_economics: 'Henter økonomidata...',
		query_reflections: 'Leser refleksjoner...',
		query_writing: 'Leser skriveprosjektet...',
		query_food: 'Henter mat-data...',
		manage_procedure: 'Lagrer fremgangsmåte...',
		manage_recipe: 'Oppdaterer oppskrift...',
		manage_meal_plan: 'Oppdaterer ukemeny...',
		manage_pantry: 'Oppdaterer pantry...',
		manage_lunchbox: 'Ordner matpakker...',
		find_recipes: 'Leter etter oppskrifter...',
		manage_food_settings: 'Oppdaterer matinnstillinger...',
		generate_shopping_list: 'Lager handleliste...',
		analyze_meal_image: 'Analyserer matbilde...',
		record_tracking_event: 'Registrerer tracking-hendelse...',
		web_search: 'Søker på nettet...',
		book_research: 'Leser kilder om boken...',
		film_research: 'Leser kilder om filmen...',
		weather_forecast: 'Henter værdata...',
		annotate_photo_composition: 'Analyserer bilde...',
		propose_widget: 'Lager widget-forslag...',
		create_widget: 'Oppretter widget...',
		get_widgets: 'Henter widgets...',
		update_widget: 'Oppdaterer widget...',
		create_checklist: 'Oppretter sjekkliste...',
		get_active_checklists: 'Henter sjekklister...',
		add_checklist_items: 'Legger til sjekklistepunkter...',
		manage_day_tasks: 'Legger i dagslisten...',
		plan_day: 'Lagrer dagsplan...'
	};

	return labels[toolName] ?? `Kjører verktøy: ${toolName}...`;
}

async function emitProgress(
	onProgress: _RunChatRequestParams['onProgress'],
	stage: string,
	message: string,
	detail?: Record<string, unknown>
) {
	await onProgress?.({ stage, message, detail });
}

function inferStartYearFromText(input: string): string | null {
	const matches = input.match(/\b(19|20)\d{2}\b/g);
	if (!matches || matches.length === 0) return null;

	const years = matches
		.map((token) => Number.parseInt(token, 10))
		.filter((year) => Number.isFinite(year) && year >= 1900 && year <= 2100);

	if (years.length === 0) return null;
	return String(Math.min(...years));
}

/**
 * Plukk ut et døgnvindu fra naturlig tekst, f.eks. «mellom kl. 16 og 20»,
 * «kl 16-20», «mellom 16 og 20». Brukes til å injisere fromHour/toHour i
 * query_sensor_data slik at skjermtid-vindu-spørsmål alltid får vindu-data.
 */
function inferHourWindowFromText(input: string): { fromHour: number; toHour: number } | null {
	const text = input.toLowerCase();
	const m =
		text.match(/mellom\s*(?:kl\.?)?\s*(\d{1,2})(?::\d{2})?\s*(?:og|til|og kl\.?|-|–|—)\s*(?:kl\.?)?\s*(\d{1,2})(?::\d{2})?/) ||
		text.match(/\bkl\.?\s*(\d{1,2})(?::\d{2})?\s*(?:og|til|-|–|—)\s*(?:kl\.?)?\s*(\d{1,2})/);
	if (!m) return null;
	const from = Number.parseInt(m[1], 10);
	const to = Number.parseInt(m[2], 10);
	if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
	if (from < 0 || from > 23 || to < 1 || to > 24 || from >= to) return null;
	return { fromHour: from, toHour: to };
}

function inferEconomicsArgsFromText(input: string): {
	payPeriod?: 'current';
	month?: string;
	dateRange?: { start: string; end: string };
	filterCategory?: string;
} {
	const normalized = input.toLowerCase();
	let filterCategory: string | undefined;

	if (/dagligvare|dagligvarer|matbutikk/.test(normalized)) {
		filterCategory = 'dagligvarer';
	} else if (/restaurant|kafe|kafé|matkostnad/.test(normalized)) {
		filterCategory = 'kafe_og_restaurant';
	} else if (/transport|drivstoff|bompeng|parkering|kollektiv|taxi/.test(normalized)) {
		filterCategory = 'bil_og_transport';
	}

	if (
		normalized.includes('lønnsmåned') ||
		normalized.includes('siden lønn') ||
		normalized.includes('siste lønn') ||
		normalized.includes('hittil denne måneden')
	) {
		return { payPeriod: 'current', filterCategory };
	}

	const monthMatch = input.match(/\b(19|20)\d{2}-(0[1-9]|1[0-2])\b/);
	if (monthMatch) {
		return { month: monthMatch[0], filterCategory };
	}

	const yearMatch = input.match(/\b(19|20)\d{2}\b/);
	if (yearMatch && /(fra|siden)/i.test(normalized)) {
		const startYear = yearMatch[0];
		const today = new Date().toISOString().slice(0, 10);
		return { dateRange: { start: `${startYear}-01-01`, end: today }, filterCategory };
	}

	return filterCategory ? { filterCategory } : {};
}

export async function _runChatRequest({ body, userId, requestUrl, requestFetch, onProgress, systemPromptPrefix, preferredModel }: _RunChatRequestParams) {
	/**
	 * Målingen skrives ÉN gang, når svaret er ferdig — eller når meldingen
	 * feiler. Fram til oktober 2026 ble den skrevet ved første modellkall, så
	 * selve svaret (modelltid, hvilken modell, reserve) ble aldri målt.
	 */
	let pendingPerf: ChatPerfSample | null = null;
	const flushPerf = (answer: ChatAnswerSample | null) => {
		if (!pendingPerf) return;
		runInBackground(recordChatPerf({ ...pendingPerf, answer }));
		pendingPerf = null;
	};
	try {
		await emitProgress(onProgress, 'validating', 'Validerer forespørsel...');

		const { message, imageUrl, conversationId: requestedConversationId } = body;
		const attachment = isAttachmentPayload(body.attachment) ? body.attachment : null;
		// Én inngang kan sende flere vedlegg. `attachment` er fortsatt det første, så
		// alt som leste ett vedlegg før leser det samme nå.
		const allAttachments = pickCaptureAttachments(attachment, body.attachments, isAttachmentPayload);
		const primaryAttachment = allAttachments[0] ?? null;
		const isCapture = body.capture === true;
		const userProfile = await db.query.users.findFirst({
			columns: { timezone: true },
			where: eq(users.id, userId)
		});
		const userTimezone = userProfile?.timezone ?? 'Europe/Oslo';
		// Alle bildene i meldingen, første først. Med ett bilde er dette nøyaktig den
		// gamle regelen: `imageUrl`, ellers vedlegget når det er et bilde.
		const imageUrls = [
			...new Set([
				...(typeof imageUrl === 'string' && imageUrl.length > 0 ? [imageUrl] : []),
				...allAttachments.filter((a) => a.kind === 'image').map((a) => a.url)
			])
		];
		const effectiveImageUrl: string | undefined = imageUrls[0];

		if ((!message || typeof message !== 'string') && !effectiveImageUrl && allAttachments.length === 0) {
			throw new _ChatRequestError('Invalid message', 400);
		}

		// TEMA + BOK ROUTING: Kjør parallelt for rask respons
		let resolvedConversationId = requestedConversationId;
		let themeRoutingDecision = null;

		// Fetch recent books for routing — skip when already in a specialized context (e.g. book chat)
		const isSpecializedContext = Boolean(systemPromptPrefix);
		let recentBooks: { id: string; title: string; author: string | null; themeId: string; themeName: string | null }[] = [];
		if (!isSpecializedContext) {
			const { books: booksSchema } = await import('$lib/db/schema');
			const { themes: themesSchema } = await import('$lib/db/schema');
			const { desc } = await import('drizzle-orm');
			recentBooks = await db
				.select({
					id: booksSchema.id,
					title: booksSchema.title,
					author: booksSchema.author,
					themeId: booksSchema.themeId,
					themeName: themesSchema.name
				})
				.from(booksSchema)
				.leftJoin(themesSchema, eq(booksSchema.themeId, themesSchema.id))
				.where(eq(booksSchema.userId, userId))
				.orderBy(desc(booksSchema.updatedAt))
				.limit(5);
		}

		let recentFilms: { id: string; title: string; director: string | null; year: number | null; themeId: string; themeName: string | null }[] = [];
		if (!isSpecializedContext) {
			const { films: filmsSchema } = await import('$lib/db/schema');
			const { themes: themesSchema } = await import('$lib/db/schema');
			const { desc } = await import('drizzle-orm');
			recentFilms = await db
				.select({
					id: filmsSchema.id,
					title: filmsSchema.title,
					director: filmsSchema.director,
					year: filmsSchema.year,
					themeId: filmsSchema.themeId,
					themeName: themesSchema.name
				})
				.from(filmsSchema)
				.leftJoin(themesSchema, eq(filmsSchema.themeId, themesSchema.id))
				.where(eq(filmsSchema.userId, userId))
				.orderBy(desc(filmsSchema.updatedAt))
				.limit(5);
		}

		// AI routing — must happen before conversation creation to allow early-exit without orphaned data
		const latestUserInput = typeof message === 'string' && message.trim().length > 0
			? message
			: (primaryAttachment?.note || primaryAttachment?.contentText || '');
		// Modellvalg og ruting styres av miljøet, så eksperimentet kan skrus
		// tilbake i Coolify uten deploy. Se `$lib/domain/ai/chat-model.ts`.
		const configuredChatModel = env.CHAT_DEFAULT_MODEL;
		const legacyChatModels = isLegacyChatModelMode(configuredChatModel);
		const reasoningEffort = resolveReasoningEffort(env.CHAT_REASONING_EFFORT);
		const verbosity = resolveVerbosity(env.CHAT_VERBOSITY);
		/**
		 * AI-ruteren er AV som standard. Den var et eget `gpt-4o-mini`-kall FØR
		 * konteksten bygges, og den tyngste fasen i [chat-perf]: median 1,3 s av
		 * 1,65 s fram til første modellkall (oktober 2026). Den valgte modus,
		 * domener og modellforslag; med en sterk standardmodell som alltid får
		 * verktøyene, velger modellen selv. Regex-rutingen beholdes for
		 * kontekstmodulene. Bok-/filmnavigeringen («Åpner «Stoner»…» framfor et
		 * svar) fantes bare i AI-ruteren og forsvinner med den.
		 * `CHAT_AI_ROUTER=true` slår den på igjen.
		 */
		const useAiRouter = env.CHAT_AI_ROUTER === 'true';
		// Fasemåling fram til første modellkall — én [chat-perf]-linje per melding.
		const chatPerf = createChatPerf();
		const answerTrack = {
			model: null as string | null,
			firstTokenMs: null as number | null,
			toolRounds: 0,
			fallback: false,
			streamed: false,
			rejection: null as string | null,
			modelMs: 0,
			promptTokens: null as number | null,
			completionTokens: null as number | null,
			reasoningTokens: null as number | null,
			promptTokensTotal: null as number | null,
			cachedTokens: null as number | null,
			promptParts: null as PromptPart[] | null,
			toolSelection: null as ToolSelectionSample | null
		};
		/** Tid og tokens for ett modellkall, lagt til svarmålingen. */
		const trackModelCall = (startedAtMs: number, usage: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number } } | undefined | null) => {
			answerTrack.modelMs += chatPerf.wallMs() - startedAtMs;
			if (!usage) return;
			if (typeof usage.prompt_tokens === 'number') {
				answerTrack.promptTokens = Math.max(answerTrack.promptTokens ?? 0, usage.prompt_tokens);
				answerTrack.promptTokensTotal = (answerTrack.promptTokensTotal ?? 0) + usage.prompt_tokens;
			}
			const cached = usage.prompt_tokens_details?.cached_tokens;
			if (typeof cached === 'number') {
				answerTrack.cachedTokens = (answerTrack.cachedTokens ?? 0) + cached;
			}
			if (typeof usage.completion_tokens === 'number') {
				answerTrack.completionTokens = (answerTrack.completionTokens ?? 0) + usage.completion_tokens;
			}
			const reasoning = usage.completion_tokens_details?.reasoning_tokens;
			if (typeof reasoning === 'number') {
				answerTrack.reasoningTokens = (answerTrack.reasoningTokens ?? 0) + reasoning;
			}
		};
		// Strømmes bare når noen lytter (SSE-proxyen). `POST /api/chat` svarer
		// med JSON og får ingenting ut av ord som kommer underveis.
		const streamHooks: ChatStreamHooks | null = onProgress
			? {
				onDelta: (token) => {
					if (answerTrack.firstTokenMs === null) answerTrack.firstTokenMs = chatPerf.wallMs();
					answerTrack.streamed = true;
					void emitProgress(onProgress, 'token', '', { token });
				},
				onReset: () => {
					void emitProgress(onProgress, 'stream_reset', '');
				}
			}
			: null;
		const modelHooks = {
			onFallback: () => {
				answerTrack.fallback = true;
			},
			onRejection: (reason: string) => {
				answerTrack.rejection = reason;
			}
		};
		const routingDecision = await chatPerf.timed('ruting', async () =>
			useAiRouter
				? aiRouteChatRequest(latestUserInput, isSpecializedContext ? {} : { recentBooks, recentFilms })
				: routeChatRequest(latestUserInput)
		);

		// Book routing: navigate without creating a conversation or saving a message
		if (!isSpecializedContext && routingDecision.routedBook) {
			const { bookId, bookTitle, themeId } = routingDecision.routedBook;
			await emitProgress(onProgress, 'book_routed', `Melding koblet til bok: ${bookTitle}`, {
				bookId,
				bookTitle,
				themeId
			});
			return {
				message: `Åpner «${bookTitle}»…`,
				conversationId: null,
				bookRouted: true,
				book: { id: bookId, title: bookTitle, themeId }
			};
		}

		// Film routing: navigate without creating a conversation or saving a message
		if (!isSpecializedContext && routingDecision.routedFilm) {
			const { filmId, filmTitle, themeId } = routingDecision.routedFilm;
			await emitProgress(onProgress, 'film_routed', `Melding koblet til film: ${filmTitle}`, {
				filmId,
				filmTitle,
				themeId
			});
			return {
				message: `Åpner «${filmTitle}»…`,
				conversationId: null,
				filmRouted: true,
				film: { id: filmId, title: filmTitle, themeId }
			};
		}

		if (message && typeof message === 'string') {
			// forceNewConversation (flyt-samtaler) skal ikke tema-kapres av første melding
			if (!resolvedConversationId && !body.forceNewConversation) {
				// New conversation: run theme detection
				const { detectThemeForMessage } = await import('$lib/server/themes');
				themeRoutingDecision = await detectThemeForMessage(message, userId);

				// Tema-routing
				if (
					themeRoutingDecision.confidence === 'high' ||
					themeRoutingDecision.confidence === 'medium'
				) {
					resolvedConversationId = themeRoutingDecision.conversationId ?? undefined;
					await emitProgress(onProgress, 'theme_routed', `Melding automatisk koblet til tema: ${themeRoutingDecision.themeName}`, {
						themeId: themeRoutingDecision.themeId,
						themeName: themeRoutingDecision.themeName,
						confidence: themeRoutingDecision.confidence
					});
				} else if (themeRoutingDecision.confidence === 'low') {
					await emitProgress(onProgress, 'theme_suggested', `Foreslår tema: ${themeRoutingDecision.themeName}`, {
						themeId: themeRoutingDecision.themeId,
						themeName: themeRoutingDecision.themeName,
						confidence: themeRoutingDecision.confidence,
						reasoning: themeRoutingDecision.reasoning
					});
				}
			}
		}

		// Bruk oppgitt/detektert conversationId eller hent/opprett standard.
		// forceNewConversation=true brukes av flyt-sheets for å garantere en fersk samtale.
		const conversation =
			resolvedConversationId && typeof resolvedConversationId === 'string'
				? ((await getConversationByIdForUser(resolvedConversationId, userId)) ??
					(await getOrCreateConversation(userId)))
				: body.forceNewConversation
					? await createConversation(userId, 'web', body.conversationTitle)
					: await getOrCreateConversation(userId);

		await emitProgress(onProgress, 'conversation_ready', 'Samtalen er klar.', {
			conversationId: conversation.id
		});

		// Lagre brukerens melding med imageUrl hvis present
		const savedUserMessage = await chatPerf.timed('lagre-melding', () =>
			addMessage({
				conversationId: conversation.id,
				role: 'user',
				content:
					message ||
					(allAttachments.length > 1
						? captureDisplayText('', allAttachments.map((a) => (a.kind === 'image' ? 'image' : 'document')))
						: getDefaultAttachmentLabel(primaryAttachment)),
				imageUrl: effectiveImageUrl,
				metadata:
					allAttachments.length > 0 || isCapture
						? {
								...(primaryAttachment ? { attachment: primaryAttachment } : {}),
								...(allAttachments.length > 1 ? { attachments: allAttachments } : {}),
								...(isCapture ? { capture: true } : {})
							}
						: undefined
			})
		);

		await emitProgress(onProgress, 'message_saved', 'Meldingen er lagret.');

		// Hent samtale-historikk (siste 5 meldinger for umiddelbar kontekst)
		const [history, conversationThemeName] = await chatPerf.timed('historikk', () =>
			Promise.all([
				getConversationHistory(conversation.id, 5),
				// Temaet samtalen ligger på er ett av signalene verktøyutvalget leser.
				conversation.themeId
					? db
							.select({ name: themes.name })
							.from(themes)
							.where(and(eq(themes.id, conversation.themeId), eq(themes.userId, userId)))
							.limit(1)
							.then((rows) => rows[0]?.name ?? null)
					: Promise.resolve(null)
			])
		);

		// Fallback til siste opplastede bilde i samtalen. Gjør at bilde-baserte verktøy
		// (f.eks. record_screen_time) virker selv om brukeren laster opp bildet i én melding
		// og ber om å registrere det i en senere melding ("registrer den") uten å laste opp på nytt.
		const lastConversationImageUrl: string | null =
			effectiveImageUrl ||
			[...history]
				.reverse()
				.map((m) => (m as { imageUrl?: string | null }).imageUrl)
				.find((url): url is string => typeof url === 'string' && url.length > 0) ||
			null;

		// Dagens dato — hoistet foran parallellbatchen: ferieblokka trenger `today`.
		const today = new Date();
		const dateContext = `\n--- DAGENS DATO ---\nDagens dato er: ${today.toLocaleDateString('nb-NO', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			weekday: 'long'
		})} (${today.toISOString().split('T')[0]})\n--- SLUTT PÅ DATO ---\n\n`;

		/**
		 * Kontekstblokkene er uavhengige av hverandre — alle avhenger bare av
		 * userId/conversation/routing — og hentes PARALLELT. Fram til september
		 * 2026 lå de som ti sekvensielle await på rad, et serverless-formet
		 * mønster der batchen kostet SUMMEN av rundturene; nå koster den den
		 * tyngste blokka. Se [chat-perf]-linja i loggen for hva hver fase koster.
		 *
		 * Feilhåndteringen per blokk er uendret: best-effort-blokkene fanger selv
		 * og koster sin seksjon, aldri svaret; minne og mål var harde
		 * avhengigheter før parallelliseringen og er det fortsatt.
		 */
		const [
			memoryContext,
			personContext,
			activeGoals,
			checklistContext,
			contactsContext,
			procedureContext,
			dayContext,
			ferieContext,
			healthContext
		] = await Promise.all([
			// Memory context (viktig informasjon om brukeren) — med themeId slik at
			// fil-innhold for aktivt tema vises i konteksten
			chatPerf.timed('minne', () =>
				ContextService.buildForChat({ userId, themeId: conversation.themeId ?? null })
			),
			chatPerf.timed('person', async () => {
				// Person-scopet samtale får dedikert person-kontekst; ellers en kompakt
				// familieoversikt slik at modellen kjenner personene (og «minstemann»/
				// «mellomste») uten å narrere et oppslag.
				if (conversation.personId) {
					try {
						return await buildPersonContext(userId, conversation.personId);
					} catch (err) {
						console.warn('buildPersonContext failed:', err);
						return '';
					}
				}
				try {
					return await buildFamilyOverview(userId);
				} catch (err) {
					console.warn('buildFamilyOverview failed:', err);
					return '';
				}
			}),
			// Brukerens aktive mål og oppgaver (tekstblokka bygges synkront etter batchen)
			chatPerf.timed('mål', () => getUserActiveGoalsAndTasks(userId)),
			// Prosjektoppgaver-kontekst (hjem-prosjekt-undertema): gir AI-en lista MED id-er, så
			// manage_project_tasks kan referere itemId/parentId/blockedBy presist.
			chatPerf.timed('prosjektoppgaver', async () => {
				let checklistContext = '';
				if (!conversation.themeId) return checklistContext;
				try {
				const taskRows = await db
					.select()
					.from(checklistItems)
					.where(eq(checklistItems.themeId, conversation.themeId));
				if (taskRows.length > 0) {
					taskRows.sort((a, b) => a.sortOrder - b.sortOrder);
					const byParent = (pid: string | null) =>
						taskRows.filter((t) => (t.parentId ?? null) === pid);
					const fmt = (t: (typeof taskRows)[number], indent: string) => {
						const m = (t.metadata ?? {}) as Record<string, unknown>;
						const extra: string[] = [];
						if (m.shopping) extra.push(`kjøp${m.store ? ` på ${m.store}` : ''}`);
						if (t.dueDate) extra.push(`frist ${t.dueDate}`);
						if (typeof t.estimateMinutes === 'number') extra.push(`estimat ${t.estimateMinutes}min`);
						if (Array.isArray(m.blockedBy) && m.blockedBy.length)
							extra.push(`avventer ${(m.blockedBy as string[]).join(',')}`);
						let line = `${indent}[${t.checked ? 'x' : ' '}] "${t.text}" (id: ${t.id})`;
						if (extra.length) line += ` — ${extra.join(', ')}`;
						return line;
					};
					checklistContext = `\n\n--- PROSJEKTOPPGAVER (themeId: ${conversation.themeId}) ---\nBruk verktøyet manage_project_tasks med denne themeId-en for å legge til / endre / krysse av / slette oppgaver. itemId, parentId og blockedBy refererer id-ene under.\n`;
					for (const top of byParent(null)) {
						checklistContext += fmt(top, '') + '\n';
						for (const child of byParent(top.id)) checklistContext += fmt(child, '  ') + '\n';
					}
					checklistContext += '--- SLUTT PROSJEKTOPPGAVER ---\n';
				}
				} catch (err) {
					console.warn('[chat] kunne ikke laste prosjektoppgaver:', err);
				}
				return checklistContext;
			}),
			// Prosjektkontakter-kontekst (kommunikasjons-/arrangement-prosjekt): gir AI-en kontaktlista
			// MED id-er, så manage_project_contacts kan referere contactId presist og formulere oppfølging.
			chatPerf.timed('kontakter', async () => {
				let contactsContext = '';
				if (!conversation.themeId) return contactsContext;
				try {
				const { projectContacts } = await import('$lib/db/schema');
				const contactRows = await db
					.select()
					.from(projectContacts)
					.where(eq(projectContacts.themeId, conversation.themeId));
				if (contactRows.length > 0) {
					contactRows.sort((a, b) => a.sortOrder - b.sortOrder);
					contactsContext = `\n\n--- PROSJEKTKONTAKTER (themeId: ${conversation.themeId}) ---\nBruk verktøyet manage_project_contacts med denne themeId-en for å legge til / endre / slette kontakter og sette oppfølgingsdato. contactId refererer id-ene under. status: todo|venter|ferdig.\n`;
					for (const c of contactRows) {
						const bits = [`"${c.name}"`];
						if (c.role) bits.push(`(${c.role})`);
						bits.push(`status ${c.status}`);
						if (c.phone) bits.push(`tlf ${c.phone}`);
						if (c.email) bits.push(`epost ${c.email}`);
						if (c.followUpAt) bits.push(`oppfølging ${c.followUpAt}`);
						contactsContext += `- ${bits.join(', ')} (id: ${c.id})\n`;
					}
					contactsContext += '--- SLUTT PROSJEKTKONTAKTER ---\n';
				}
				} catch (err) {
					console.warn('[chat] kunne ikke laste prosjektkontakter:', err);
				}
				return contactsContext;
			}),
			// Koblet fremgangsmåte på samtalen
			chatPerf.timed('fremgangsmåte', async () => {
				let procedureContext = '';
				try {
			const { procedures, procedureSteps } = await import('$lib/db/schema');
			const { isNull } = await import('drizzle-orm');
			const linkedProcedure = await db.query.procedures.findFirst({
				where: and(eq(procedures.conversationId, conversation.id), isNull(procedures.archivedAt)),
				with: { steps: { orderBy: (s: any, { asc }: any) => [asc(s.sortOrder)] } }
			});
			if (linkedProcedure) {
				procedureContext = `\n\n--- KOBLET FREMGANGSMÅTE ---\nDenne samtalen har en lagret fremgangsmåte: "${linkedProcedure.title}" (v${linkedProcedure.version})\n`;
				if (linkedProcedure.summary) {
					procedureContext += `Sammendrag: ${linkedProcedure.summary.slice(0, 500)}\n`;
				}
				if (linkedProcedure.steps.length > 0) {
					procedureContext += `Trinn:\n${linkedProcedure.steps.map((s: any, i: number) => `  ${i + 1}. ${s.text}`).join('\n')}\n`;
				}
				procedureContext += `\nHvis samtalen avdekker forbedringer eller nye trinn, foreslå oppdatering med manage_procedure(action='update', id='${linkedProcedure.id}').\n--- SLUTT PÅ FREMGANGSMÅTE ---\n`;
			}
				} catch (err) {
					console.warn('Failed to load procedure context:', err);
				}
				return procedureContext;
			}),
			// Dagens sted/reise (Fase B) — injiseres som stedstilpasset kontekst.
			chatPerf.timed('dagskontekst', async () => {
				try {
					return await buildDayContextBlock(userId, userTimezone);
				} catch (err) {
					console.warn('buildDayContextBlock failed:', err);
					return '';
				}
			}),
			// Ferie-/reise-kontekst: pågående ferie + reiser (med deltakere, sted, datoer),
			// slik at chatten vet hvor brukeren er og hvem som er med.
			chatPerf.timed('ferie', async () => {
				try {
					const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone }).format(today);
					return await buildTripContext(userId, todayIso);
				} catch (err) {
					console.warn('buildTripContext failed:', err);
					return '';
				}
			}),
			/**
			 * Helse-briefingen: hvor brukeren står, lagt i konteksten før de spør.
			 *
			 * Verktøyene løste «modellen har ikke tallene». De løste ikke «modellen vet
			 * ikke at den burde hente dem»: en reflekterende melding ser ikke ut som et
			 * oppslag, så ingen `query_*` blir valgt, og svaret blir generelle råd. Her
			 * ligger nå-tilstanden i konteksten uansett — vektperioden med tempo, ukas
			 * belastning mot båndet, sammensetningen av økter, streaks og mål.
			 *
			 * Gatet på `shouldBuildHealthContext`, altså helse-rutet melding ELLER en
			 * samtale som ligger på et helse-tema. Den andre halvdelen er den viktige:
			 * «hva tenker du om dette?» midt i en tråd på Trening er et helsespørsmål
			 * ingen av ordene avslører.
			 */
			chatPerf.timed('helse', async () => {
				try {
					// Temalista slås bare opp når gaten KAN slå til. Uten denne sjekken koster
					// hver melding i appen to spørringer for et svar som er nei — en samtale
					// uten tema og uten helseord kan ikke passere uansett hva lista sier.
					const mayApply =
						routingDecision.domains.includes('health') || Boolean(conversation.themeId);
					const healthThemeIds = mayApply ? await getHealthThemeIds(userId) : [];
					if (
						mayApply &&
						shouldBuildHealthContext({
							domains: routingDecision.domains,
							conversationThemeId: conversation.themeId ?? null,
							healthThemeIds
						})
					) {
						return await buildHealthChatContext(userId, healthThemeIds);
					}
					return '';
				} catch (err) {
					// Best-effort som dayContext/ferieContext: en briefing som feiler skal ikke
					// velte svaret. Da mangler tallene, og det er verre — men et 500 er verst.
					console.warn('buildHealthChatContext failed:', err);
					return '';
				}
			})
		]);

		// Målingen som avgjør neste ytelsesgrep: wall er tiden brukeren ventet på
		// konteksten, sum er samlet DB-arbeid. Se chat-perf.ts for lesenøkkelen.
		//
		// Logges OG lagres. Logglinja er primærkilden for én melding;
		// `chat_perf_samples` bærer fordelingen over mange, som er det «hva er
		// verdt å cache» faktisk besvares av — og som ikke forsvinner ved
		// restart. Lagringen feiler stille og ventes ikke på.
		const perfSample = { wallMs: chatPerf.wallMs(), phases: chatPerf.phases };
		console.log(formatChatPerfLine(perfSample));
		pendingPerf = perfSample;

		// Bygg kontekst-melding med aktive mål
		let goalsContext = '\n\n--- BRUKERENS AKTIVE MÅL OG OPPGAVER ---\n';
		if (activeGoals.length === 0) {
			goalsContext += 'Brukeren har ingen aktive mål ennå.\n';
		} else {
			for (const goal of activeGoals) {
				const categoryName = Array.isArray(goal.category)
					? goal.category[0]?.name
					: goal.category?.name;
				goalsContext += `\nMÅL: "${goal.title}" (ID: ${goal.id})\n`;
				goalsContext += `Kategori: ${categoryName || 'Ingen'}\n`;
				goalsContext += `Status: ${goal.status}\n`;
				if (goal.tasks.length > 0) {
					goalsContext += `Oppgaver:\n`;
					for (const task of goal.tasks) {
						goalsContext += `  - "${task.title}" (ID: ${task.id})\n`;
						if (task.targetValue) {
							goalsContext += `    Mål: ${task.targetValue} ${task.unit || ''}\n`;
						}
						if (task.frequency) {
							goalsContext += `    Frekvens: ${task.frequency}\n`;
						}
					}
				} else {
					goalsContext += `(Ingen oppgaver ennå)\n`;
				}
			}
		}
		goalsContext += '--- SLUTT PÅ MÅL OG OPPGAVER ---\n\n';

		// Bygg source context fra samtale-metadata (kilde-oppgave/sjekkliste)
		let sourceContextPrompt = '';
		const convMeta = (conversation as any).metadata as { sourceTaskId?: string; sourceChecklistId?: string; sourceItemId?: string; sourceItemText?: string } | null;
		if (convMeta && (convMeta.sourceTaskId || convMeta.sourceChecklistId || convMeta.sourceItemId)) {
			sourceContextPrompt = '\n\n--- KILDE-OPPGAVE ---\n';
			sourceContextPrompt += 'Denne samtalen ble startet fra en spesifikk oppgave. ';
			if (convMeta.sourceItemText) {
				sourceContextPrompt += `Oppgaven er: "${convMeta.sourceItemText}". `;
			}
			if (convMeta.sourceChecklistId) {
				sourceContextPrompt += `Sjekkliste-ID: ${convMeta.sourceChecklistId}. `;
			}
			if (convMeta.sourceItemId) {
				sourceContextPrompt += `Punkt-ID: ${convMeta.sourceItemId}. `;
			}
			if (convMeta.sourceTaskId) {
				sourceContextPrompt += `Oppgave-ID: ${convMeta.sourceTaskId}. `;
			}
			sourceContextPrompt += '\nHvis du oppretter deloppgaver (breakdown), legg dem som barn under dette punktet. ';
			sourceContextPrompt += 'Hvis du foreslår å lagre en fremgangsmåte (manage_procedure), sett conversationId til denne samtalens ID.\n';
			sourceContextPrompt += '--- SLUTT PÅ KILDE-OPPGAVE ---\n';
		}


		// Bygg meldingshistorikk for OpenAI
		const systemMessage = assembleSystemPrompt({
			prefix: systemPromptPrefix,
			base: buildModularSystemPrompt(routingDecision),
			memory: memoryContext,
			persons: personContext,
			goals: goalsContext,
			checklists: checklistContext,
			contacts: contactsContext,
			procedures: procedureContext,
			source: sourceContextPrompt,
			date: dateContext,
			day: dayContext,
			ferie: ferieContext,
			health: healthContext
		});

		await emitProgress(onProgress, 'routing_complete', 'Forespørselen er analysert.', {
			domains: routingDecision.domains,
			skills: routingDecision.skills,
			mode: routingDecision.mode
		});

		const messages: ChatCompletionMessageParam[] = [
			{ role: 'system', content: systemMessage.content }
		];

		// Promptens anatomi: lengden på hver blokk, aldri innholdet. Svaret på
		// «hva er de 34 000 tokenene» (fase 5 i changelogen).
		const historyChars = history
			.filter((m) => m.id !== savedUserMessage.id && (m.role === 'user' || m.role === 'assistant'))
			.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
		answerTrack.promptParts = [
			...systemMessage.parts,
			{ name: 'historikk', chars: historyChars },
			{ name: 'melding', chars: latestUserInput.length }
		];

		// Legg til historikk (unntatt den siste brukermeldingen som allerede er der)
		for (const msg of history) {
			if (msg.id === savedUserMessage.id) {
				continue;
			}

			if (msg.role === 'user' || msg.role === 'assistant') {
				messages.push({
					role: msg.role,
					content: msg.role === 'user'
						? buildUserMessageForModelMany(msg.content, attachmentsFromMetadata(msg.metadata))
						: msg.content
				});
			}
		}

		// Legg til siste melding - støtt både tekst og vedlegg
		// Én inngang: instruksen følger meldingen, ikke systemprompten — den gjelder
		// bare denne fangsten, og en tråd kan blande fangster og vanlig prat.
		const captureInstruction = isCapture ? `\n\n${CAPTURE_INSTRUCTION}` : '';
		if (effectiveImageUrl) {
			// Bruk Vision API format — ett bilde-element per bilde.
			messages.push({
				role: 'user',
				content: [
					...imageUrls.map((url) => ({
						type: 'image_url' as const,
						image_url: { url }
					})),
					{
						type: 'text',
						text:
							buildUserMessageForModelMany(
								typeof message === 'string' && message.trim().length > 0
									? message
									: imageUrls.length > 1
										? 'Hva ser du på disse bildene, og hva bør vi gjøre videre?'
										: 'Hva ser du på dette bildet, og hva bør vi gjøre videre?',
								allAttachments
							) +
							'\n\n[System: Hvis bildet er et iOS Skjermtid-skjermbilde (uke- eller dagsbilde), KALL verktøyet record_screen_time for å tolke og lagre det — ikke bare beskriv bildet. Bekreft kort hva som ble lagret etterpå.]' +
							captureInstruction
					}
				]
			});
		} else {
			const screenTimeFollowupHint =
				lastConversationImageUrl &&
				/skjermtid|screen ?time|scroll|registrer|lagre|lagr|legg inn/i.test(
					typeof message === 'string' ? message : ''
				)
					? '\n\n[System: Det finnes et nylig opplastet bilde i samtalen. Hvis brukeren vil registrere/lagre skjermtid, KALL record_screen_time (det henter bildet automatisk) i stedet for å be om opplasting på nytt.]'
					: '';
			messages.push({
				role: 'user',
				content:
					buildUserMessageForModelMany(
						typeof message === 'string' ? message : getDefaultAttachmentLabel(primaryAttachment),
						allAttachments
					) + screenTimeFollowupHint + captureInstruction
			});
		}

		await emitProgress(onProgress, 'context_ready', 'Kontekst og historikk er lastet.', {
			historyCount: history.length
		});
		// Determine conversation mode: skip tools for conversational/literary contexts,
		// use stronger model when routing suggests it or user has picked one.
		const aiSuggestsConversation = routingDecision.mode === 'conversation';
		const isHighCapabilityModel = preferredModel ? isReasoningChatModel(preferredModel) : false;
		const isConversationalMode = Boolean(systemPromptPrefix) || aiSuggestsConversation || isHighCapabilityModel;

		/**
		 * REFLEKSJON ER IKKE DET SAMME SOM Å VÆRE UTEN DATA.
		 *
		 * `isConversationalMode` styrte fram til august 2026 både modellvalg, token-tak
		 * OG om verktøy ble sendt i det hele tatt. Konsekvensen var at idet brukeren gikk
		 * fra å spørre («hvor mange økter har jeg hatt?») til å tenke høyt («hvordan ser
		 * en april etter en vinter der jeg løp seks av sju dager ut?»), ruta AI-ruteren
		 * meldingen til `conversation` — og da mistet coachen tilgangen til brukerens egne
		 * tall. Det er i refleksjonen de betyr mest; uten dem er det bare generelle råd
		 * igjen. Brukeren kalte det «venterommet hos legen», og det var presist.
		 *
		 * Nå går bare de virkelig spesialiserte flatene uten verktøy — bok, film og flyt,
		 * altså de som sender sitt eget systemprompt. Ellers følger verktøyene med, med
		 * `tool_choice: 'auto'`: modellen KAN la dem være, men den kan velge dem.
		 */
		const hasDataDomain = routingDecision.domains.some((d) =>
			['health', 'economics', 'food', 'family', 'self', 'home', 'jobb', 'planning', 'themes'].includes(d)
		);
		// Med en sterk standardmodell skjules verktøyene bare for de spesialiserte
		// flatene: modellen velger selv om den trenger dem (`tool_choice: 'auto'`).
		// Regex-rutingen gir `conversation` for alt den ikke kjenner igjen, og den
		// gamle regelen ville da tatt fra coachen både tallene og websøket.
		const skipTools = legacyChatModels
			? isSpecializedContext || (isConversationalMode && !hasDataDomain)
			: isSpecializedContext;
		/**
		 * Verktøyutvalget (`$lib/domain/ai/tool-selection.ts`): en union av
		 * rutingen, temaet, trådens forrige svar og bildet. I skyggemodus
		 * (standard) sendes ALLE verktøyene som før, og vi måler bare om de
		 * modellen kalte ville vært med. Med `on` sendes utvalget pluss
		 * `load_tools`. Legacy-modus rører vi ikke.
		 */
		const toolSelectionMode = resolveToolSelectionMode(env.CHAT_TOOL_SELECTION);
		const threadSignals = recentThreadSignals(history);
		const toolSelection = selectToolGroups({
			routedDomains: routingDecision.domains,
			routedSkills: routingDecision.skills,
			themeKind: resolveThemeDashboardKind(conversationThemeName),
			recentToolNames: threadSignals.toolNames,
			recentDomains: threadSignals.domains,
			hasImage: Boolean(lastConversationImageUrl),
			capture: isCapture
		});
		const selectedToolNames = toolNamesForGroups(ALL_TOOL_NAMES, toolSelection.groups);
		const cutTools = toolSelectionMode === 'on' && !legacyChatModels && !skipTools;
		const activeToolNames = new Set(cutTools ? selectedToolNames : ALL_TOOL_NAMES);
		const loadedToolGroups: ToolGroup[] = [];
		const toolsCalledThisTurn: string[] = [];
		const activeTools = () =>
			cutTools ? [...tools.filter((t) => activeToolNames.has(t.function.name)), loadToolsDefinition] : tools;

		// Verktøyblokken først når vi vet om verktøyene sendes i det hele tatt.
		answerTrack.promptParts?.unshift({
			name: 'verktøy',
			chars: skipTools ? 0 : cutTools ? JSON.stringify(activeTools()).length : toolsJsonChars()
		});

		// Ruteren kan tvinge websøk for steds-/ferske spørsmål. Da slår vi på
		// verktøy (selv i conversational-modus) og låser første kall til web_search.
		const forceWebSearch = Boolean(routingDecision.forceWebSearch) && !isSpecializedContext;

		// Legacy beholder rutingens modellforslag for samtale-modus; ellers gjelder
		// brukerens valg, så standardmodellen.
		const initialSendsTools = forceWebSearch || !skipTools;
		const legacyResolvedModel = legacyChatModels && !preferredModel && isConversationalMode
			? (routingDecision.modelSuggestion ?? 'gpt-5.4')
			: undefined;

		const initialModelDecision = legacyResolvedModel
			? { model: legacyResolvedModel, reason: `ai_routed_${routingDecision.mode}` }
			: chooseChatModel({
				phase: 'initial',
				preferredModel,
				configuredDefault: configuredChatModel,
				hasImage: Boolean(effectiveImageUrl),
				userInput: latestUserInput,
				withTools: initialSendsTools
			});
		const initialFallbackSizing = { temperature: 0.8, maxTokens: effectiveImageUrl ? 1500 : 1000 };

		// Første kall til OpenAI med tools
		await emitProgress(onProgress, 'model_request', 'Sender forespørsel til modellen...', {
			model: initialModelDecision.model,
			reason: initialModelDecision.reason
		});
		console.log('🧠 Model selected (initial):', initialModelDecision.model, `(${initialModelDecision.reason})`);
		const initialCallStartedAt = chatPerf.wallMs();
		let completion = await createChatCompletionWithFallback(
			openai,
			{
				model: initialModelDecision.model,
				messages,
				...(forceWebSearch
					? { tools: activeTools(), tool_choice: { type: 'function' as const, function: { name: 'web_search' } } }
					: skipTools
						? {}
						: { tools: activeTools(), tool_choice: 'auto' as const }),
				...completionSizing(initialModelDecision.model, {
					...initialFallbackSizing,
					maxTokens: isConversationalMode ? 2000 : initialFallbackSizing.maxTokens,
					reasoningEffort,
					verbosity,
					withTools: initialSendsTools
				})
			},
			initialFallbackSizing,
			{ stream: streamHooks, ...modelHooks }
		);
		answerTrack.model = completion.model ?? initialModelDecision.model;
		trackModelCall(initialCallStartedAt, completion.usage);

		let responseMessage = completion.choices[0]?.message;
		let createdGoalId: string | null = null;
		let createdTheme: { id: string; name: string; emoji?: string | null; conversationId?: string | null } | null = null;
		let archivedTheme: { id: string; name: string; emoji?: string | null } | null = null;
		let checklistCreated = false;
		let checklistUpdated = false;
		let widgetProposal: import('$lib/artifacts/widget-draft').WidgetDraft | null = null;
		let widgetFlow: WidgetCreationFlow | null = null;
		let statusWidget: import('$lib/ai/tools/weather-forecast').WeatherStatusWidget | null = null;
		let photoAnnotation: import('$lib/ai/tools/annotate-photo').PhotoAnnotationResult | null = null;
		let photoAnnotationImageUrl: string | null = null;
		let researchCard: ResearchCard | null = null;

		await emitProgress(onProgress, 'model_response', 'Første modellrespons mottatt.', {
			finishReason: completion.choices[0]?.finish_reason ?? null,
			toolCalls: responseMessage?.tool_calls?.length || 0
		});

		// Debug logging
		console.log('\n🤖 OpenAI Response:');
		console.log('Finish reason:', completion.choices[0]?.finish_reason);
		console.log('Tool calls:', responseMessage?.tool_calls?.length || 0);
		if (responseMessage?.tool_calls) {
			console.log('Tools requested:', responseMessage.tool_calls.map(tc => 
				tc.type === 'function' ? tc.function.name : tc.type
			).join(', '));
		}
		console.log('Direct response:', responseMessage?.content?.substring(0, 100) || 'none');

		/**
		 * Vektmålinger modellen har slått opp i DETTE svaret.
		 *
		 * Verktøyrundene under er laget for «oppslag -> beslutning -> endring», så uten
		 * dette kunne modellen finne en måling i runde 1 og slette den i runde 2 — uten
		 * at brukeren rakk å se spørsmålet. En sletting av en sensorrad kan ikke angres
		 * fra flaten, så den skal komme fra et senere svar, etter at brukeren har svart.
		 */
		const weightIdsFoundThisTurn = new Set<string>();

		// Håndter tool calls i flere runder slik at modellen kan gjøre oppslag -> beslutning -> endring.
		for (let toolRound = 0; toolRound < 5 && responseMessage?.tool_calls?.length; toolRound += 1) {
			console.log(`\n🔧 Executing tools (round ${toolRound + 1})...`);
			await emitProgress(onProgress, 'tool_round_started', `Starter verktøyrunde ${toolRound + 1}.`, {
				round: toolRound + 1,
				toolCount: responseMessage.tool_calls.length
			});

			messages.push({
				role: 'assistant',
				content: null,
				tool_calls: responseMessage.tool_calls
			});

			for (const toolCall of responseMessage.tool_calls) {
				const toolName = toolCall.type === 'function' ? toolCall.function.name : toolCall.type;
				const toolArgs = toolCall.type === 'function' ? toolCall.function.arguments : 'N/A';
				console.log(`\n  Tool: ${toolName}`);
				console.log(`  Args: ${toolArgs.substring(0, 200)}`);
				if (toolCall.type === 'function') {
					await emitProgress(onProgress, 'tool_started', getToolProgressMessage(toolCall.function.name), {
						round: toolRound + 1,
						toolName: toolCall.function.name
					});
				}
				const messagesBefore = messages.length;
				if (toolCall.type === 'function') toolsCalledThisTurn.push(toolCall.function.name);

				if (toolCall.type === 'function' && toolCall.function.name === LOAD_TOOLS_NAME) {
					let groups: ToolGroup[] = [];
					try {
						groups = parseToolGroups(JSON.parse(toolCall.function.arguments)?.groups);
					} catch {
						groups = [];
					}
					const added = [...toolNamesForGroups(ALL_TOOL_NAMES, groups)].filter((n) => !activeToolNames.has(n));
					for (const n of added) activeToolNames.add(n);
					loadedToolGroups.push(...groups);
					messages.push({
						role: 'tool',
						content: JSON.stringify(
							groups.length > 0
								? { success: true, loaded: groups, tools: added, message: 'Verktøyene er tilgjengelige nå. Bruk dem.' }
								: { success: false, message: `Ingen gyldige grupper. Velg blant: ${LOADABLE_GROUPS.join(', ')}.` }
						),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'check_similar_goals') {
					const args = JSON.parse(toolCall.function.arguments);
					const similarGoals = await findSimilarGoals(userId, args.title, 70);

					if (similarGoals.length > 0) {
						const goalsList = similarGoals
							.map(g => `- "${g.title}" (${g.similarity.toFixed(0)}% match, status: ${g.status})`)
							.join('\n');

						messages.push({
							role: 'tool',
							content: JSON.stringify({
								found: true,
								count: similarGoals.length,
								goals: similarGoals,
								message: `Fant ${similarGoals.length} lignende mål:\n${goalsList}\n\nVIKTIG: IKKE opprett nytt mål uten å spørre brukeren først! Spør: "Jeg ser du allerede har lignende mål. Vil du at jeg skal opprette et nytt mål likevel, eller skal vi jobbe videre med et av de eksisterende?"`
							}),
							tool_call_id: toolCall.id
						});
					} else {
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								found: false,
								message: 'Ingen lignende mål funnet. Du kan trygt opprette det nye målet.'
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'check_similar_tasks') {
					const args = JSON.parse(toolCall.function.arguments);
					const similarTasks = await findSimilarTasks(args.goalId, args.title, 70);

					if (similarTasks.length > 0) {
						const tasksList = similarTasks
							.map(t => `- "${t.title}" (${t.similarity.toFixed(0)}% match)`)
							.join('\n');

						messages.push({
							role: 'tool',
							content: JSON.stringify({
								found: true,
								count: similarTasks.length,
								tasks: similarTasks,
								message: `Fant ${similarTasks.length} lignende oppgaver:\n${tasksList}\n\nVIKTIG: IKKE opprett ny oppgave uten å spørre brukeren først!`
							}),
							tool_call_id: toolCall.id
						});
					} else {
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								found: false,
								message: 'Ingen lignende oppgaver funnet. Du kan trygt opprette den nye oppgaven.'
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_goal') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await createGoalTool.execute({
						userId,
						...args,
						themeId: args.themeId || conversation.themeId || undefined
					});
					if (result.success) createdGoalId = result.goalId;
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'update_goal') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await updateGoalTool.execute({ userId, ...args });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_task') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await createTaskTool.execute({ userId, ...args });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_activity') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await logActivityTool.execute({ userId, ...args });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_sleep_disturbance') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🌙 Log sleep disturbance:', args.kind);
					const result = await logSleepDisturbanceTool.execute({ userId, ...args });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_nap') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await logNapTool.execute({ userId, ...args });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_chore') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await logChoreTool.execute({ userId, ...args });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_parent_time') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await logParentTimeTool.execute({ userId, ...args });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_memory') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await createMemoryTool.execute({ userId, ...args, source: conversation.id });
					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_theme') {
					const args = JSON.parse(toolCall.function.arguments);
					const { manageThemeTool } = await import('$lib/ai/tools/manage-theme');
					
					const result = await manageThemeTool.execute({
						userId,
						conversationId: conversation.id,
						...args
					});

					if (result.success && result.theme?.id) {
						createdTheme = {
							id: result.theme.id,
							name: result.theme.name,
							emoji: result.theme.emoji ?? null,
							conversationId: result.theme.conversationId ?? null
						};
					}

					if (result.success && result.archivedTheme?.id) {
						archivedTheme = {
							id: result.archivedTheme.id,
							name: result.archivedTheme.name,
							emoji: result.archivedTheme.emoji ?? null
						};
					}

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_sensor_data') {
					const args = JSON.parse(toolCall.function.arguments);

					if (args?.queryType === 'trend' && args?.period && !args?.periodKey) {
						const inferredStartYear = inferStartYearFromText(latestUserInput);
						if (inferredStartYear) {
							args.periodKey = inferredStartYear;
							console.log('  📊 Inferred trend periodKey from user input:', inferredStartYear);
						}
					}
					// Døgnvindu for skjermtid: utled fromHour/toHour fra teksten hvis modellen ikke satte dem,
					// så «hvor mye scroller jeg mellom kl. 16 og 20?» alltid får vindu-data.
					if (/skjermtid|scroll|skjerm/i.test(latestUserInput)) {
						const win = inferHourWindowFromText(latestUserInput);
						if (win && (args.fromHour == null || args.toHour == null)) {
							args.metric = 'screen_time';
							args.fromHour = win.fromHour;
							args.toHour = win.toHour;
							console.log('  📱 Inferred screen-time hour window:', win);
						}
					}
					const { querySensorDataTool } = await import('$lib/ai/tools/query-sensor-data');
					
					console.log('  📊 Querying sensor data with:', args);
					const result = await querySensorDataTool.execute({
						userId,
						...args
					});
					console.log('  📊 Result:', result.success ? 'Success' : 'Failed', result.message);

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_training') {
					const args = JSON.parse(toolCall.function.arguments || '{}');
					console.log('  🏃 Query training:', args.queryType ?? 'load');
					const result = await queryTrainingTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_movement') {
					const args = JSON.parse(toolCall.function.arguments || '{}');
					console.log('  🧭 Query movement:', args.queryType);
					const result = await queryMovementTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_weight') {
					const args = JSON.parse(toolCall.function.arguments || '{}');
					console.log('  ⚖️ Query weight:', args.queryType ?? 'trend');
					const result = await queryWeightTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (
					toolCall.type === 'function' &&
					toolCall.function.name === 'manage_weight_measurement'
				) {
					const args = JSON.parse(toolCall.function.arguments || '{}');
					console.log('  ⚖️ Manage weight measurement:', args.action, args.date ?? args.id ?? '');
					// `foundThisTurn` settes ETTER modellens argumenter, så den kan ikke
					// overstyres fra en verktøyparameter.
					const result = await manageWeightMeasurementTool.execute({
						userId,
						...args,
						foundThisTurn: [...weightIdsFoundThisTurn]
					});
					for (const found of (result as { maalinger?: Array<{ id?: string }> }).maalinger ?? []) {
						if (found.id) weightIdsFoundThisTurn.add(found.id);
					}
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_sleep') {
					const args = JSON.parse(toolCall.function.arguments || '{}');
					console.log('  😴 Query sleep:', args.queryType ?? 'recent');
					const result = await querySleepTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_egenfrekvens') {
					const args = JSON.parse(toolCall.function.arguments || '{}');
					console.log('  🧭 Query egenfrekvens:', args.queryType ?? 'recent');
					const result = await queryEgenfrekvensTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_tesla_vehicle') {
					const args = JSON.parse(toolCall.function.arguments || '{}');
					const { queryTeslaVehicleTool } = await import('$lib/ai/tools/query-tesla-vehicle');
					console.log('  🚗 Querying Tesla vehicle with:', args);
					const result = await queryTeslaVehicleTool.execute({ userId, ...args });
					console.log('  🚗 Result:', result.success ? 'Success' : 'Failed', result.message);

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_reflections') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📖 Querying reflections:', args);
					const result = await queryReflectionsTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_writing') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  ✍️ Querying writing:', args);
					const result = await queryWritingTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_economics') {
					const args = JSON.parse(toolCall.function.arguments);

					if ((args?.queryType === 'transactions' || args?.queryType === 'spending_summary') && !args?.month && !args?.dateRange && !args?.payPeriod) {
						const inferred = inferEconomicsArgsFromText(latestUserInput);
						if (inferred.payPeriod && !args.payPeriod) args.payPeriod = inferred.payPeriod;
						if (inferred.month && !args.month) args.month = inferred.month;
						if (inferred.dateRange && !args.dateRange) args.dateRange = inferred.dateRange;
						if (inferred.filterCategory && !args.filterCategory) args.filterCategory = inferred.filterCategory;
					}

					if ((args?.queryType === 'transactions' || args?.queryType === 'spending_summary') && !args?.filterCategory) {
						const inferred = inferEconomicsArgsFromText(latestUserInput);
						if (inferred.filterCategory) args.filterCategory = inferred.filterCategory;
					}

					console.log('  💰 Querying economics with:', args);
					const result = await queryEconomicsTool.execute({
						userId,
						...args
					});
					console.log('  💰 Result:', result.success ? 'Success' : 'Failed', result.message);

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_food') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Querying food:', args);
					const result = await queryFoodTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_recipe') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Manage recipe:', args.action);
					const result = await manageRecipeTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_meal_plan') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Manage meal plan:', args.action);
					const result = await manageMealPlanTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_pantry') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Manage pantry:', args.action);
					const result = await managePantryTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_lunchbox') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🥪 Manage lunchbox:', args.action);
					const result = await manageLunchboxTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'find_recipes') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Find recipes:', args.action);
					const result = await findRecipesTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_food_settings') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Manage food settings:', args.action);
					const result = await manageFoodSettingsTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'generate_shopping_list') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Generate shopping list:', args.weekContext);
					const result = await generateShoppingListTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'analyze_meal_image') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🍽️ Analyze meal image');
					const result = await analyzeMealImageTool.execute(args);
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_nutrition') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🥗 Query nutrition:', args.queryType);
					const result = await queryNutritionTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_nutrition') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🥗 Log nutrition:', args.description);
					const result = await logNutritionTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_hunger') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🥗 Log hunger:', args.level);
					const result = await logHungerTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_nutrition_targets') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🥗 Manage nutrition targets:', args.action);
					const result = await manageNutritionTargetsTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_family') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  👨‍👩‍👧 Query family:', args.queryType);
					const result = await queryFamilyTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_person') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  👨‍👩‍👧 Manage person:', args.action);
					const result = await managePersonTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_relation') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  👨‍👩‍👧 Manage relation:', args.action);
					const result = await manageRelationTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_home') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🏠 Query home:', args.queryType);
					const { queryHomeTool } = await import('$lib/ai/tools/query-home');
					const result = await queryHomeTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_project') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📋 Manage project:', args.action);
					const { manageProjectTool } = await import('$lib/ai/tools/manage-project');
					const result = await manageProjectTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_project_tasks') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  ✅ Manage project tasks:', args.action);
					const { manageProjectTasksTool } = await import('$lib/ai/tools/manage-project-tasks');
					const result = await manageProjectTasksTool.execute({
						...args,
						userId,
						themeId: args.themeId || conversation.themeId
					});
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_project_contacts') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📇 Manage project contacts:', args.action);
					const { manageProjectContactsTool } = await import('$lib/ai/tools/manage-project-contacts');
					const result = await manageProjectContactsTool.execute({
						...args,
						userId,
						themeId: args.themeId || conversation.themeId
					});
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_training_program') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🏃 Manage training program:', args.action);
					const { manageTrainingProgramTool } = await import('$lib/ai/tools/manage-training-program');
					const result = await manageTrainingProgramTool.execute({ ...args, userId });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_projects') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📋 Query projects:', args.domain ?? 'all');
					const { queryProjectsTool } = await import('$lib/ai/tools/query-projects');
					const result = await queryProjectsTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'link_to_project') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🔗 Link to project:', args.action, args.entity);
					const { linkToProjectTool } = await import('$lib/ai/tools/link-to-project');
					const result = await linkToProjectTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_procedure') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📋 Manage procedure:', args.action);
					const { manageProcedureTool } = await import('$lib/ai/tools/manage-procedure');
					const result = await manageProcedureTool.execute({ userId, conversationId: conversation.id, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_day_tasks') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📅 Manage day tasks:', Array.isArray(args.items) ? args.items.length : 0);
					const { manageDayTasksTool } = await import('$lib/ai/tools/manage-day-tasks');
					const result = await manageDayTasksTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_home_routine') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🏠 Manage home routine:', args.title);
					const { manageHomeRoutineTool } = await import('$lib/ai/tools/manage-home-routine');
					const result = await manageHomeRoutineTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_routine') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🔁 Manage routine:', args.action, args.title ?? args.id ?? '');
					const { manageRoutineTool } = await import('$lib/ai/tools/manage-routine');
					const result = await manageRoutineTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_streak') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🔥 Manage streak:', args.action, args.title ?? args.id ?? '');
					const { manageStreakTool } = await import('$lib/ai/tools/manage-streak');
					const result = await manageStreakTool.execute({ userId, ...args });
					messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: toolCall.id });
				} else if (toolCall.type === 'function' && toolCall.function.name === 'record_tracking_event') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🧩 Recording tracking event:', args);

					const result = await recordTrackingEvent({
						userId,
						seriesId: typeof args.seriesId === 'string' ? args.seriesId : undefined,
						taskId: typeof args.taskId === 'string' ? args.taskId : undefined,
						taskTitle: typeof args.taskTitle === 'string' ? args.taskTitle : undefined,
						recordTypeKey: typeof args.recordTypeKey === 'string' ? args.recordTypeKey : undefined,
						recordTypeLabel: typeof args.recordTypeLabel === 'string' ? args.recordTypeLabel : undefined,
						kind: args.kind === 'measurement' ? 'measurement' : 'activity',
						date: typeof args.date === 'string' ? args.date : new Date().toISOString().slice(0, 10),
						note: typeof args.note === 'string' ? args.note : undefined,
						measurements: Array.isArray(args.measurements) ? args.measurements : [],
						autoCreateSeries: args.autoCreateSeries !== false,
						createSeriesOnly: args.createSeriesOnly === true,
						title: typeof args.title === 'string' ? args.title : undefined,
						themeId: typeof args.themeId === 'string' ? args.themeId : undefined,
						conversationId: conversation.id,
						autoRegister: args.autoRegister === true,
						confirmationPolicy:
							args.confirmationPolicy === 'always' ||
							args.confirmationPolicy === 'low_confidence_only' ||
							args.confirmationPolicy === 'never'
								? args.confirmationPolicy
								: undefined,
						sourceImageUrl: effectiveImageUrl,
						metadata: {
							original_tool: 'record_tracking_event',
							confidence: 'high'
						}
					});

					messages.push({
						role: 'tool',
						content: JSON.stringify({
							success: result.success,
							duplicate: result.duplicate ?? false,
							createdOnly: result.createdOnly ?? false,
							eventId: result.event?.id ?? null,
							seriesId: result.series?.id ?? null,
							recordTypeKey: result.recordType?.key ?? null,
							linkedTaskTitle: result.linkedTask?.title ?? null,
							message: result.duplicate
								? 'Duplikat oppdaget for denne perioden, registreringen ble ikke lagret.'
								: result.createdOnly
									? `✅ Sporing satt opp${result.linkedTask?.title ? ` for "${result.linkedTask.title}"` : ''}.\n\nNår du faktisk har gjort aktiviteten kan du skrive:\n- "Jeg har gjort mikroyoga"\n- "Logg mikroyoga i dag"`
								: `✅ Registrert${result.recordType?.label ? ` ${result.recordType.label}` : ''}${result.linkedTask?.title ? ` og koblet til "${result.linkedTask.title}"` : ''}.\n\nNeste gang kan du skrive for eksempel:\n- "Jeg har gjort mikroyoga"\n- "Logg mikroyoga i dag"`
						}),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'record_screen_time') {
					const args = JSON.parse(toolCall.function.arguments);
					const imageUrl =
						typeof args.imageUrl === 'string' && args.imageUrl.length > 0
							? args.imageUrl
							: effectiveImageUrl || lastConversationImageUrl;
					console.log('  📱 Recording screen time from image:', Boolean(imageUrl));

					let toolResult: Record<string, unknown>;
					if (!imageUrl) {
						toolResult = {
							success: false,
							message: 'Fant ingen bilde å tolke. Be brukeren laste opp et iOS Skjermtid-skjermbilde.'
						};
					} else {
						const { parseScreenTimeImage } = await import('$lib/server/integrations/screen-time-parser');
						const { ingestDailyScreenTime, ingestWeeklyScreenTime, formatScreenTime, scrollingMinutes } =
							await import('$lib/server/integrations/screen-time');
						const parsed = await parseScreenTimeImage(imageUrl);

						if (parsed.kind === 'unknown') {
							toolResult = {
								success: false,
								message: 'Bildet ble ikke gjenkjent som et iOS Skjermtid-skjermbilde.'
							};
						} else if (parsed.kind === 'weekly' && args.captureType !== 'daily') {
							const res = await ingestWeeklyScreenTime(
								userId,
								parsed.weekly,
								typeof args.weekStartISO === 'string' ? args.weekStartISO : undefined
							);
							toolResult = {
								success: true,
								kind: 'weekly',
								weekStartISO: res.weekStartISO,
								daysRecorded: res.days.length,
								weekTotal: formatScreenTime(parsed.weekly.weekTotalMinutes),
								avgPerDay: formatScreenTime(parsed.weekly.avgPerDayMinutes),
								scrolling: formatScreenTime(scrollingMinutes(parsed.weekly.categories)),
								confidence: parsed.confidence,
								message: `Lagret ukesbilde for uken som starter ${res.weekStartISO} (${res.days.length} dager).`
							};
						} else if (parsed.kind === 'daily' || args.captureType === 'daily') {
							const daily = parsed.kind === 'daily' ? parsed.daily : null;
							if (!daily) {
								toolResult = { success: false, message: 'Klarte ikke å lese dagsdata fra bildet.' };
							} else {
								const dateISO =
									(typeof args.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.dateISO)
										? args.dateISO
										: parsed.kind === 'daily'
											? parsed.dateISO
											: undefined) ?? new Date().toISOString().slice(0, 10);
								await ingestDailyScreenTime(userId, dateISO, { ...daily, captureType: 'daily' });
								toolResult = {
									success: true,
									kind: 'daily',
									dateISO,
									total: formatScreenTime(daily.totalMinutes),
									scrolling: formatScreenTime(scrollingMinutes(daily.categories)),
									hasHourly: Array.isArray(daily.hourly) && daily.hourly.length > 0,
									confidence: parsed.confidence,
									message: `Lagret dagsbilde for ${dateISO}.`
								};
							}
						} else {
							toolResult = { success: false, message: 'Ukjent bildetype.' };
						}
					}

					messages.push({
						role: 'tool',
						content: JSON.stringify(toolResult),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'web_search') {
					const args = JSON.parse(toolCall.function.arguments) as {
						query?: string;
						saveToTheme?: boolean;
						themeId?: string;
						deep?: boolean;
					};
					const searchQuery = typeof args.query === 'string' ? args.query.trim() : '';

					if (!searchQuery) {
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								success: false,
								message: 'Mangler query for web_search.'
							}),
							tool_call_id: toolCall.id
						});
						continue;
					}

					try {
						// themeId hentes fra samtalens tema med mindre modellen oppgir et eksplisitt.
						const targetThemeId =
							(typeof args.themeId === 'string' && args.themeId) || conversation.themeId || null;

						// Hent temaets foretrukne/ekskluderte kilder for kildestyring.
						const themeDomains = targetThemeId
							? await getThemeResearchDomains(targetThemeId, userId).catch(() => null)
							: null;

						const result = await executeWebSearch(searchQuery, {
							themeDomains,
							deep: args.deep === true
						});

						// Lagre research-runden som funn på temaet når modellen ber om det.
						let saved: { savedToTheme: boolean; themeName?: string } = { savedToTheme: false };
						if (args.saveToTheme && result.success && targetThemeId) {
							try {
								const persisted = await saveThemeResearch({
									themeId: targetThemeId,
									userId,
									query: searchQuery,
									summary: result.findings,
									sources: result.sources
								});
								if (persisted) saved = { savedToTheme: true, themeName: persisted.themeName };
							} catch (saveError) {
								console.warn('  🌐 Kunne ikke lagre research til tema:', saveError);
							}
						}

						// Bygg kilde-kort til UI (bunnpanel med kilder + bilder, kart for reise).
						if (result.success) {
							let map: ResearchCardMap | null = null;
							if (result.topic === 'travel' && targetThemeId) {
								map = await resolveThemeMap(targetThemeId, userId).catch(() => null);
							}
							researchCard = buildResearchCard({
								query: searchQuery,
								sources: result.sources,
								images: result.images,
								map
							});
						}

						messages.push({
							role: 'tool',
							content: JSON.stringify({ ...result, ...saved }),
							tool_call_id: toolCall.id
						});
					} catch (error) {
						console.error('  🌐 Web search failed:', error);
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								success: false,
								query: searchQuery,
								message: 'Web search feilet. Prøv igjen med en mer konkret formulering.'
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'book_research') {
					const args = JSON.parse(toolCall.function.arguments) as {
						bookId?: string;
						query?: string;
						focus?: 'critics' | 'bibliography' | 'theme' | 'general';
					};

					if (!args.query || typeof args.query !== 'string') {
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								findings: '',
								sources: [],
								error: 'Mangler query for book_research.'
							}),
							tool_call_id: toolCall.id
						});
						continue;
					}

					try {
						const result = await executeBookResearch(
							{ bookId: args.bookId, query: args.query.trim(), focus: args.focus },
							{ userId }
						);
						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
							tool_call_id: toolCall.id
						});
					} catch (error) {
						console.error('  📚 book_research failed:', error);
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								findings: '',
								sources: [],
								error: 'book_research feilet. Prøv igjen.'
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'film_research') {
					const args = JSON.parse(toolCall.function.arguments) as {
						filmId?: string;
						query?: string;
						focus?: 'critics' | 'filmography' | 'theme' | 'general';
					};

					if (!args.query || typeof args.query !== 'string') {
						messages.push({
							role: 'tool',
							content: JSON.stringify({ findings: '', sources: [], error: 'Mangler query for film_research.' }),
							tool_call_id: toolCall.id
						});
						continue;
					}

					try {
						const result = await executeFilmResearch(
							{ filmId: args.filmId, query: args.query.trim(), focus: args.focus },
							{ userId }
						);
						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
							tool_call_id: toolCall.id
						});
					} catch (error) {
						console.error('  🎬 film_research failed:', error);
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								findings: '',
								sources: [],
								error: 'film_research feilet. Prøv igjen.'
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'weather_forecast') {
					const args = JSON.parse(toolCall.function.arguments) as {
						latitude?: number;
						longitude?: number;
						locationName?: string;
					};

					try {
						const { weatherForecastTool } = await import('$lib/ai/tools/weather-forecast');
						const result = await weatherForecastTool.execute({
							timezone: userTimezone,
							...args,
							userId
						});

						if (result.success && result.widget) {
							statusWidget = result.widget;
						}

						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
							tool_call_id: toolCall.id
						});
					} catch (error) {
						console.error('  ☁️ Weather lookup failed:', error);
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								success: false,
								message: 'Værdata kunne ikke hentes nå.'
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'annotate_photo_composition') {
					const args = JSON.parse(toolCall.function.arguments) as {
						imageUrl?: string;
						summary?: string;
						overlays?: unknown[];
					};

					try {
						const { annotatePhotoCompositionTool } = await import('$lib/ai/tools/annotate-photo');
						const result = await annotatePhotoCompositionTool.execute({
							imageUrl: args.imageUrl || effectiveImageUrl || '',
							summary: args.summary || '',
							overlays: Array.isArray(args.overlays) ? args.overlays as import('$lib/ai/tools/annotate-photo').CompositionOverlay[] : []
						});

						if (result.success && result.annotation) {
							photoAnnotation = result.annotation;
							photoAnnotationImageUrl = args.imageUrl || effectiveImageUrl || null;
						}

						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
							tool_call_id: toolCall.id
						});
					} catch (error) {
						console.error('  🖼️ Photo annotation failed:', error);
						messages.push({
							role: 'tool',
							content: JSON.stringify({
								success: false,
								message: 'Klarte ikke lage bildeannotering.'
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'search_metrics') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🔍 Searching metrics:', args);
					try {
						const result = await executeSearchMetrics(args);
						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						console.error('  🔍 Metric search failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke søke i metrikkregister' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'propose_widget') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📊 Proposing widget:', args);
					try {
						const { proposeWidgetTool } = await import('$lib/ai/tools/propose-widget');
						const result = await proposeWidgetTool.execute({ userId, ...args });
						if (result.success) {
							widgetProposal = result.draft;
							widgetFlow = result.flow ?? null;
						}
						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						console.error('  📊 Widget proposal failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke lage widget-forslag' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_widget') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📊 Creating widget:', args);

					try {
						// Resolve filterCategory/filterSubcategory from metricKey if provided
						let resolvedCategory = args.filterCategory ?? null;
						let resolvedSubcategory = args.filterSubcategory ?? null;
						if (args.metricKey) {
							const metricDef = getMetricByKey(args.metricKey);
							if (metricDef) {
								resolvedCategory = metricDef.filterCategory ?? resolvedCategory;
								resolvedSubcategory = metricDef.filterSubcategory ?? resolvedSubcategory;
							}
						}

						const existing = await findSimilarWidget(
							userId,
							{
								metricType: args.metricType,
								range: args.range,
								filterCategory: resolvedCategory
							},
							{ pinnedOnly: true }
						);

						if (existing) {
							console.log('  📊 Widget already exists:', existing.id);
							widgetFlow = markWidgetFlowCreated(widgetFlow, existing.id);
							messages.push({
								role: 'tool',
								content: JSON.stringify({ success: true, widgetId: existing.id, title: existing.title, pinned: true, alreadyExisted: true }),
								tool_call_id: toolCall.id
							});
						} else {
							const widget = await createUserWidget(userId, {
								title: args.title || '',
								metricType: args.metricType,
								aggregation: args.aggregation,
								period: args.period,
								range: args.range,
								goal: args.goal ?? null,
								filterCategory: resolvedCategory,
								filterSubcategory: resolvedSubcategory,
								filterHourFrom: args.filterHourFrom ?? null,
								filterHourTo: args.filterHourTo ?? null,
								metricKey: args.metricKey ?? null,
								unit: args.unit || '',
								color: args.color || '#7c8ef5',
								pinned: args.pinned !== false
							});

							widgetFlow = markWidgetFlowCreated(widgetFlow, widget.id);

							// Varm opp aggregat-cache i bakgrunnen for denne metrikken
							if (args.metricKey) {
								const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
								runInBackground(aggregateSingleMetric(userId, args.metricKey, fromDate));
							}

							console.log('  📊 Widget created:', widget.id);
							messages.push({
								role: 'tool',
								content: JSON.stringify({ success: true, widgetId: widget.id, title: widget.title, pinned: widget.pinned }),
								tool_call_id: toolCall.id
							});
						}
					} catch (e) {
						console.error('  📊 Widget creation failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke opprette widget' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'get_widgets') {
					try {
						const widgets = await listWidgetsForChat(userId);

						messages.push({
							role: 'tool',
							content: JSON.stringify({ widgets }),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						messages.push({
							role: 'tool',
							content: JSON.stringify({ error: 'Klarte ikke hente widgets' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'update_widget') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📊 Updating widget:', args.widgetId, args);

					try {
						const updated = await updateUserWidget(userId, args.widgetId, {
							title: args.title,
							goal: args.goal,
							thresholdWarn: args.thresholdWarn,
							thresholdSuccess: args.thresholdSuccess,
							color: args.color
						});

						if (!updated) {
							messages.push({
								role: 'tool',
								content: JSON.stringify({ success: false, error: 'Widget ikke funnet' }),
								tool_call_id: toolCall.id
							});
						} else {
							messages.push({
								role: 'tool',
								content: JSON.stringify({ success: true, widgetId: updated.id, title: updated.title }),
								tool_call_id: toolCall.id
							});
						}
					} catch (e) {
						console.error('  📊 Widget update failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke oppdatere widget' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_checklist') {
					const args = JSON.parse(toolCall.function.arguments) as {
						title: string;
						emoji: string;
						context?: string;
						items: string[];
					};

					try {
						const [checklist] = await db.insert(checklists).values({
							userId,
							title: args.title,
							emoji: args.emoji,
							context: args.context ?? null
						}).returning();

						if (args.items?.length) {
							// Parse hvert punkt (tid/sted/reise/måltid/aktivitet/kobling) via den
							// felles builderen — samme resultat som manuell oppretting. For
							// generelle lister (kontekst som «tur»/«reise») blir det ren tekst.
							const built = await Promise.all(
								args.items.map((text) =>
									buildChecklistItemFields({
										userId,
										context: checklist.context,
										text,
										allowTaskCreation: false
									})
								)
							);
							const createdItems = await db
								.insert(checklistItems)
								.values(
									built.map((fields, i) => ({
										checklistId: checklist.id,
										userId,
										text: fields.text,
										startDate: fields.startDate,
										sortOrder: i,
										...(Object.keys(fields.metadata).length > 0 ? { metadata: fields.metadata } : {})
									}))
								)
								.returning();
							for (const item of createdItems) {
								runInBackground(PersonMentionService.indexChecklistItem(userId, item.id, item.text));
							}
							for (const f of built) {
								if (f.locationDayIso) runInBackground(syncStaysForDate(userId, f.locationDayIso));
							}
							for (const item of createdItems) {
								if (item.metadata?.mealType) {
									runInBackground(afterMealItemWritten(userId, item, checklist.context));
								}
							}
						}

						checklistCreated = true;

						messages.push({
							role: 'tool',
							content: JSON.stringify({
								success: true,
								checklistId: checklist.id,
								title: checklist.title,
								emoji: checklist.emoji,
								itemCount: args.items?.length ?? 0,
								message: `✅ Sjekkliste "${checklist.title}" opprettet med ${args.items?.length ?? 0} punkter! Den vises nå som en widget på hjemskjermen.`
							}),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						console.error('  📋 Checklist creation failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke opprette sjekkliste' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'get_active_checklists') {
					try {
						const activeChecklists = await db.query.checklists.findMany({
							where: and(eq(checklists.userId, userId), isNull(checklists.completedAt)),
							with: {
								items: {
									orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
								}
							},
							orderBy: (c, { desc }) => [desc(c.createdAt)]
						});

						messages.push({
							role: 'tool',
							content: JSON.stringify({
								count: activeChecklists.length,
								checklists: activeChecklists.map((checklist) => ({
									id: checklist.id,
									title: checklist.title,
									emoji: checklist.emoji,
									context: checklist.context,
									itemCount: checklist.items.length,
									completedCount: checklist.items.filter((item) => item.checked).length,
									items: checklist.items.map((item) => ({
										id: item.id,
										text: item.text,
										checked: item.checked
									}))
								}))
							}),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						console.error('  📋 Checklist lookup failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke hente aktive sjekklister' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'add_checklist_items') {
					const args = JSON.parse(toolCall.function.arguments) as {
						checklistId: string;
						items: string[];
					};

					try {
						const checklist = await db.query.checklists.findFirst({
							where: and(eq(checklists.id, args.checklistId), eq(checklists.userId, userId)),
							with: {
								items: {
									orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
								}
							}
						});

						if (!checklist) {
							messages.push({
								role: 'tool',
								content: JSON.stringify({ success: false, error: 'Sjekkliste ikke funnet' }),
								tool_call_id: toolCall.id
							});
							continue;
						}

						const normalizeItem = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
						const existingItems = new Set(checklist.items.map((item) => normalizeItem(item.text)));
						const candidateItems = (args.items ?? [])
							.map((item) => item.trim())
							.filter(Boolean);
						const itemsToAdd = candidateItems.filter((item, index) => {
							const normalized = normalizeItem(item);
							const firstOccurrence = candidateItems.findIndex((candidate) => normalizeItem(candidate) === normalized) === index;
							return firstOccurrence && !existingItems.has(normalized);
						});
						const skippedItems = candidateItems.filter((item) => !itemsToAdd.includes(item));

						if (itemsToAdd.length > 0) {
							const nextSortOrder = checklist.items.reduce((maxSortOrder, item) => Math.max(maxSortOrder, item.sortOrder), -1) + 1;

							// Parse hvert nytt punkt via den felles builderen (bruker den
							// eksisterende sjekklistens kontekst — f.eks. dag-/ukenivå).
							const built = await Promise.all(
								itemsToAdd.map((text) =>
									buildChecklistItemFields({
										userId,
										context: checklist.context,
										text,
										allowTaskCreation: false
									})
								)
							);
							const createdItems = await db
								.insert(checklistItems)
								.values(
									built.map((fields, index) => ({
										checklistId: checklist.id,
										userId,
										text: fields.text,
										startDate: fields.startDate,
										sortOrder: nextSortOrder + index,
										...(Object.keys(fields.metadata).length > 0 ? { metadata: fields.metadata } : {})
									}))
								)
								.returning();
							for (const item of createdItems) {
								runInBackground(PersonMentionService.indexChecklistItem(userId, item.id, item.text));
							}
							for (const f of built) {
								if (f.locationDayIso) runInBackground(syncStaysForDate(userId, f.locationDayIso));
							}
							for (const item of createdItems) {
								if (item.metadata?.mealType) {
									runInBackground(afterMealItemWritten(userId, item, checklist.context));
								}
							}

							if (checklist.completedAt) {
								await db
									.update(checklists)
									.set({ completedAt: null })
									.where(eq(checklists.id, checklist.id));
							}

							checklistUpdated = true;
						}

						messages.push({
							role: 'tool',
							content: JSON.stringify({
								success: true,
								checklistId: checklist.id,
								title: checklist.title,
								addedCount: itemsToAdd.length,
								addedItems: itemsToAdd,
								skippedItems,
								message: itemsToAdd.length > 0
									? `La til ${itemsToAdd.length} nye punkter i "${checklist.title}".`
									: `Ingen nye punkter lagt til i "${checklist.title}" fordi de allerede fantes.`
							}),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						console.error('  📋 Checklist update failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke utvide sjekkliste' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'add_to_week_plan') {
					const args = JSON.parse(toolCall.function.arguments) as {
						weekOffset?: number;
						items: string[];
					};
					try {
						const { addToWeekPlanTool } = await import('$lib/ai/tools/add-to-week-plan');
						const result = await addToWeekPlanTool.execute({ userId, ...args });
						checklistUpdated = true;
						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						console.error('  📋 add_to_week_plan failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke legge tiltak på ukelista' }),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'plan_day') {
					const args = JSON.parse(toolCall.function.arguments) as {
						dayIso: string;
						weekDashedKey: string;
						headline: string;
						tasks: string[];
					};

					try {
						const compactKey = args.weekDashedKey.replace('-W', 'W');

						if (args.headline.trim()) {
							await upsertPlanArtifactField({
								userId,
								kind: 'day',
								periodKey: args.dayIso,
								parentPeriodKey: compactKey,
								field: 'headline',
								content: args.headline
							});
						}

						const dayContext = `week:${args.weekDashedKey}:day:${args.dayIso}`;
						let dayChecklist = await db.query.checklists.findFirst({
							where: and(eq(checklists.userId, userId), eq(checklists.context, dayContext)),
							with: {
								items: {
									orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
								}
							}
						});

						if (!dayChecklist) {
							const [newChecklist] = await db
								.insert(checklists)
								.values({
									userId,
									title: `Dag ${args.dayIso}`,
									emoji: '☑️',
									context: dayContext
								})
								.returning();
							dayChecklist = { ...newChecklist!, items: [] };
						}

						const existingTexts = new Set(
							(dayChecklist.items ?? []).map((item) => item.text.trim().toLowerCase())
						);
						const toAdd = (args.tasks ?? [])
							.map((t) => t.trim())
							.filter((t) => t.length > 0 && !existingTexts.has(t.toLowerCase()));

						if (toAdd.length > 0) {
							const nextSortOrder =
								(dayChecklist.items ?? []).reduce(
									(max, item) => Math.max(max, item.sortOrder),
									-1
								) + 1;
							// Parse hvert dag-punkt (tid/sted/reise/måltid/aktivitet/kobling) via
							// den felles builderen, slik at klokkeslett, personer osv. blir riktig
							// — i stedet for å lagre rå tekst som «Fikse matpakker kl. 18».
							const built = await Promise.all(
								toAdd.map((text) =>
									buildChecklistItemFields({
										userId,
										context: dayContext,
										text,
										allowTaskCreation: false
									})
								)
							);
							const createdItems = await db
								.insert(checklistItems)
								.values(
									built.map((fields, i) => ({
										checklistId: dayChecklist!.id,
										userId,
										text: fields.text,
										startDate: fields.startDate,
										sortOrder: nextSortOrder + i,
										...(Object.keys(fields.metadata).length > 0 ? { metadata: fields.metadata } : {})
									}))
								)
								.returning();
							for (const item of createdItems) {
								runInBackground(PersonMentionService.indexChecklistItem(userId, item.id, item.text));
							}
							if (built.some((f) => f.locationDayIso)) {
								runInBackground(syncStaysForDate(userId, args.dayIso));
							}
							for (const item of createdItems) {
								if (item.metadata?.mealType) {
									runInBackground(afterMealItemWritten(userId, item, dayContext));
								}
							}
						}

						checklistCreated = true;

						messages.push({
							role: 'tool',
							content: JSON.stringify({
								success: true,
								headline: args.headline,
								addedTasks: toAdd.length,
								message: `Dagsplan lagret! Enlinjer: "${args.headline}". ${toAdd.length > 0 ? `${toAdd.length} oppgaver lagt til.` : 'Ingen nye oppgaver.'}`
							}),
							tool_call_id: toolCall.id
						});
					} catch (e) {
						console.error('  📅 plan_day failed:', e);
						messages.push({
							role: 'tool',
							content: JSON.stringify({ success: false, error: 'Klarte ikke lagre dagsplan' }),
							tool_call_id: toolCall.id
						});
					}
				}
				// Sikkerhetsnett: hvis ingen gren håndterte dette tool-kallet, MÅ vi likevel
				// svare på tool_call_id — ellers avviser OpenAI neste runde og hele svaret feiler
				// med en generisk feil i UI.
				if (messages.length === messagesBefore) {
					console.warn(`[chat] Uhåndtert tool-kall: ${toolName} — sender fallback-svar.`);
					messages.push({
						role: 'tool',
						content: JSON.stringify({
							success: false,
							message: `Verktøyet "${toolName}" er ikke tilgjengelig akkurat nå. Svar brukeren ut fra det du allerede vet.`
						}),
						tool_call_id: toolCall.id
					});
				}
				// Log tool result
				const toolResultMsg = messages[messages.length - 1];
				if (messages.length > messagesBefore && toolResultMsg?.role === 'tool') {
					try {
						const resultObj = JSON.parse(toolResultMsg.content as string);
						const success = resultObj.success !== false;
						const summary =
							resultObj.results?.map((r: { title?: string; snippet?: string }) => `"${r.title || ''}" – ${(r.snippet || '').substring(0, 80)}`).join('\n    ') ||
							resultObj.message?.substring(0, 200) ||
							(success ? '(success)' : '(failed)');
						console.log(`  Result [${toolName}]: ${success ? '✅' : '❌'} ${summary}`);
					} catch {
						console.log(`  Result [${toolName}]: (raw) ${String(toolResultMsg.content).substring(0, 200)}`);
					}
				}
				if (toolCall.type === 'function') {
					await emitProgress(onProgress, 'tool_completed', `Ferdig med ${toolCall.function.name}.`, {
						round: toolRound + 1,
						toolName: toolCall.function.name
					});
				}
			}

			// Ny runde der modellen kan bruke tool-resultatene til flere oppslag eller gi slutt-svar.
			const followupModelDecision = chooseChatModel({
				phase: 'followup',
				preferredModel,
				configuredDefault: configuredChatModel,
				hasImage: Boolean(effectiveImageUrl),
				userInput: latestUserInput,
				toolCallCount: responseMessage.tool_calls.length,
				toolRound,
				withTools: true
			});
			await emitProgress(onProgress, 'model_followup_request', 'Ber modellen bruke verktøyresultatene...', {
				model: followupModelDecision.model,
				reason: followupModelDecision.reason,
				round: toolRound + 1
			});
			console.log(
				'🧠 Model selected (followup):',
				followupModelDecision.model,
				`(${followupModelDecision.reason}, round ${toolRound + 1})`
			);
			const followupFallbackSizing = { temperature: 0.3, maxTokens: 1000 };
			const followupCallStartedAt = chatPerf.wallMs();
			completion = await createChatCompletionWithFallback(
				openai,
				{
					model: followupModelDecision.model,
					messages,
					tools: activeTools(),
					tool_choice: 'auto',
					...completionSizing(followupModelDecision.model, {
						...followupFallbackSizing,
						reasoningEffort,
						verbosity,
						withTools: true
					})
				},
				followupFallbackSizing,
				{ stream: streamHooks, ...modelHooks }
			);
			answerTrack.model = completion.model ?? followupModelDecision.model;
			answerTrack.toolRounds += 1;
			trackModelCall(followupCallStartedAt, completion.usage);

			responseMessage = completion.choices[0]?.message;
			await emitProgress(onProgress, 'model_followup_response', 'Modellen svarte etter verktøyrunden.', {
				finishReason: completion.choices[0]?.finish_reason ?? null,
				toolCalls: responseMessage?.tool_calls?.length || 0
			});
		}

		const finalMessage = stripToolLeakage(responseMessage?.content || 'Beklager, jeg fikk ikke generert noe svar.');
		const assistantMetadata: Record<string, unknown> = {};
		if (createdGoalId) assistantMetadata.goalId = createdGoalId;
		if (widgetProposal) assistantMetadata.widgetProposal = widgetProposal;
		if (widgetFlow) assistantMetadata.widgetFlow = widgetFlow;
		assistantMetadata.routingDecision = routingDecision;
		// Verktøyene dette svaret kalte — neste meldings verktøyutvalg leser dem.
		const realToolsCalled = [...new Set(toolsCalledThisTurn.filter((n) => n !== LOAD_TOOLS_NAME))];
		if (realToolsCalled.length > 0) assistantMetadata.toolsCalled = realToolsCalled;
		if (statusWidget) assistantMetadata.statusWidget = statusWidget;
		if (photoAnnotation) assistantMetadata.photoAnnotation = photoAnnotation;
		if (photoAnnotationImageUrl) assistantMetadata.photoAnnotationImageUrl = photoAnnotationImageUrl;
		if (researchCard) assistantMetadata.researchCard = researchCard;

		await emitProgress(onProgress, 'finalizing', 'Lagrer og ferdigstiller svar...');

		// Lagre assistentens svar til database
		const savedAssistantMessage = await addMessage({
			conversationId: conversation.id,
			role: 'assistant',
			content: finalMessage,
			metadata: Object.keys(assistantMetadata).length > 0 ? assistantMetadata : null
		});

		await emitProgress(onProgress, 'completed', 'Svar klart.', {
			conversationId: conversation.id
		});

		flushPerf({
			model: answerTrack.model ?? initialModelDecision.model,
			firstTokenMs: answerTrack.firstTokenMs,
			totalMs: chatPerf.wallMs(),
			toolRounds: answerTrack.toolRounds,
			fallback: answerTrack.fallback,
			streamed: answerTrack.streamed,
			rejection: answerTrack.rejection,
			modelMs: answerTrack.modelMs,
			promptTokens: answerTrack.promptTokens,
			completionTokens: answerTrack.completionTokens,
			reasoningTokens: answerTrack.reasoningTokens,
			promptTokensTotal: answerTrack.promptTokensTotal,
			cachedTokens: answerTrack.cachedTokens,
			promptParts: answerTrack.promptParts,
			toolSelection: skipTools
				? null
				: {
						mode: toolSelectionMode,
						groups: toolSelection.groups,
						sources: toolSelection.sources,
						selected: selectedToolNames.size,
						total: ALL_TOOL_NAMES.length,
						...evaluateToolSelection(selectedToolNames, toolsCalledThisTurn),
						loaded: [...new Set(loadedToolGroups)]
					}
		});

		return {
			message: finalMessage,
			conversationId: conversation.id,
			// DB-id-er slik at klienten kan referere de lagrede meldingene (rediger/slett).
			userMessageId: savedUserMessage.id,
			assistantMessageId: savedAssistantMessage.id,
			goalCreated: createdGoalId !== null,
			goalId: createdGoalId,
			themeCreated: createdTheme !== null,
			theme: createdTheme,
			themeArchived: archivedTheme !== null,
			archivedTheme,
			checklistCreated,
			checklistUpdated,
			checklistChanged: checklistCreated || checklistUpdated,
			routingDecision,
			widgetProposal,
			widgetFlow,
			statusWidget,
			photoAnnotation,
			photoAnnotationImageUrl,
			researchCard,
		};
	} catch (error) {
		flushPerf(null);
		console.error('Error in chat API:', error);
		
		if (error instanceof _ChatRequestError) {
			throw error;
		}
		
		let errorMessage = 'Internal server error';
		
		if (error instanceof Error) {
			if (error.message.includes('API key')) {
				errorMessage = 'OpenAI API-nøkkel mangler eller er ugyldig';
			} else if (error.message.includes('rate limit')) {
				errorMessage = 'For mange forespørsler. Prøv igjen om litt.';
			} else if (error.message.includes('DATABASE')) {
				errorMessage = 'Databasefeil. Kontakt support.';
			}
		}
		
		throw new _ChatRequestError(errorMessage, 500);
	}
}

export const POST: RequestHandler = async ({ request, locals, fetch }) => {
	try {
		const payload = await _runChatRequest({
			body: await request.json(),
			userId: locals.userId,
			requestUrl: request.url,
			requestFetch: fetch
		});

		return json(payload);
	} catch (error) {
		if (error instanceof _ChatRequestError) {
			return json({ error: error.message }, { status: error.status });
		}

		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
