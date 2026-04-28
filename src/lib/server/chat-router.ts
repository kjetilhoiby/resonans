import { detectPromptFocusModules } from '$lib/server/openai';
import { openai } from '$lib/server/openai';
import { DOMAIN_METADATA } from '$lib/domains';

export type ChatDomain = 'health' | 'economics' | 'food' | 'planning' | 'themes' | 'general';
export type ChatSkill = 'widget_creation' | 'checklist_planning' | 'goal_planning' | 'theme_management' | 'general_chat';
export type ChatMode = 'tool' | 'conversation' | 'domain';

export interface UserBookContext {
	id: string;
	title: string;
	author?: string | null;
	themeId: string;
	themeName?: string | null;
}

export interface ChatRoutingDecision {
	domains: ChatDomain[];
	skills: ChatSkill[];
	focusModules: ReturnType<typeof detectPromptFocusModules>;
	hints: string[];
	domainHints?: string[];
	mode: ChatMode;
	modelSuggestion?: string;
	/** Set when the router detects the user wants to navigate to a specific book */
	routedBook?: { bookId: string; bookTitle: string; themeId: string };
}

export function routeChatRequest(input: string): ChatRoutingDecision {
	const text = input.toLowerCase();
	const focusModules = detectPromptFocusModules(input);
	const domains = new Set<ChatDomain>();
	const skills = new Set<ChatSkill>();
	const hints: string[] = [];
	const domainHints: string[] = [];

	if (focusModules.includes('health')) {
		domains.add('health');
		domainHints.push(DOMAIN_METADATA.health.systemPromptHint);
	}
	if (focusModules.includes('economics')) {
		domains.add('economics');
		domainHints.push(DOMAIN_METADATA.economics.systemPromptHint);
	}
	if (focusModules.includes('food') || /mat|middag|frokost|lunsj|matpakke|oppskrift|recipe|pantry|fryser|kjøleskap|kjoleskap|skap|handleliste|kjokken|kjøkken|måltid|maltid|ukemeny|meny/.test(text)) {
		domains.add('food');
		domainHints.push(DOMAIN_METADATA.food.systemPromptHint);
	}
	if (focusModules.includes('themes')) domains.add('themes');
	if (focusModules.includes('planning')) domains.add('planning');

	if (/widget|hjemskjerm|oversikt|vis meg|snitt|per dag|per uke|per mnd/.test(text)) {
		skills.add('widget_creation');
		hints.push('Prioriter widget-flyt med forslag før opprettelse.');
	}

	if (/sjekkliste|pakkeliste|legg til punkt|mangler/.test(text)) {
		skills.add('checklist_planning');
		hints.push('Vurder create_checklist/get_active_checklists/add_checklist_items.');
	}

	if (/mal|mål|oppgave|plan|ukeplan/.test(text)) {
		skills.add('goal_planning');
	}

	if (/tema|samliv|helse|okonomi|økonomi|karriere|foreld/.test(text)) {
		skills.add('theme_management');
	}

	if (/nyhet|nyheter|siste|oppdatering|aktuelt|aktuell|krig|konflikt|politikk|valg|børs|marked|iran|ukraina|gaza/.test(text)) {
		hints.push('Bruk web_search for ferske eller tidsavhengige fakta før du svarer.');
	}

	if (domains.size === 0) domains.add('general');
	if (skills.size === 0) skills.add('general_chat');

	// Fallback mode: infer from skills
	const mode: ChatMode = skills.has('widget_creation') || skills.has('checklist_planning') || skills.has('goal_planning')
		? 'tool'
		: (domains.has('health') || domains.has('economics') || domains.has('food'))
			? 'domain'
			: 'conversation';

	return {
		domains: Array.from(domains),
		skills: Array.from(skills),
		focusModules,
		hints,
		domainHints: domainHints.length > 0 ? domainHints : undefined,
		mode
	};
}

const ROUTER_SYSTEM_PROMPT = `Du er en ruter for en personlig AI-assistent. Svar KUN med gyldig JSON.

Bestem routing basert på meldingen:
- mode:
  "tool"         — brukeren vil gjøre noe konkret: opprette mål/oppgave, logge aktivitet, lage widget, sjekkliste
  "domain"       — spørsmål om data: helse-statistikk, økonomi/forbruk, planer, temaer
  "conversation" — snakke, reflektere, utforske, få råd, diskutere (bruk sterkere modell)
  "book"         — brukeren vil gå til, snakke om eller fortsette en bestemt bok (kun hvis du er sikker)
- domains: relevante domener, array av: "health", "economics", "food", "planning", "themes", "general"
- modelSuggestion: inkluder kun "gpt-5.4" hvis samtalen er dyp, refleksiv eller kreativ, ellers utelat feltet
- hints: maks 2 korte hints (én setning hver) til hoved-assistenten, eller tom array
- bookId: kun sett dette hvis mode="book" og du kan identifisere boken fra konteksten

Eksempel: {"mode":"conversation","domains":["general"],"modelSuggestion":"gpt-5.4","hints":["Brukeren virker usikker, møt dem der de er"]}
Eksempel: {"mode":"tool","domains":["health"],"hints":["Sjekk eksisterende mål før du oppretter nytt"]}
Eksempel: {"mode":"book","domains":["themes"],"bookId":"<uuid>","hints":[]}`;

export async function aiRouteChatRequest(
	input: string,
	userContext?: { recentBooks?: UserBookContext[] }
): Promise<ChatRoutingDecision> {
	const regexFallback = routeChatRequest(input);
	try {
		let contextBlock = '';
		if (userContext?.recentBooks && userContext.recentBooks.length > 0) {
			const bookLines = userContext.recentBooks
				.map((b) => `  - ID: ${b.id}, Tittel: "${b.title}"${b.author ? `, Forfatter: ${b.author}` : ''}${b.themeName ? `, Tema: "${b.themeName}"` : ''}`)
				.join('\n');
			contextBlock = `\n\nBrukerens nylige bøker (bruk dette for å gjenkjenne bokreferanser):\n${bookLines}`;
		}

		const completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: ROUTER_SYSTEM_PROMPT },
				{ role: 'user', content: input + contextBlock }
			],
			response_format: { type: 'json_object' },
			max_tokens: 150,
			temperature: 0
		});

		const raw = completion.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(raw) as {
			mode?: string;
			domains?: string[];
			modelSuggestion?: string;
			hints?: string[];
			bookId?: string;
		};

		const rawMode = parsed.mode === 'book' ? 'conversation' : parsed.mode;
		const mode: ChatMode = (rawMode === 'tool' || rawMode === 'conversation' || rawMode === 'domain')
			? rawMode
			: regexFallback.mode;

		const domains = (parsed.domains ?? [])
			.filter((d): d is ChatDomain => ['health', 'economics', 'food', 'planning', 'themes', 'general'].includes(d));

		// Resolve routedBook if router identified a specific book
		let routedBook: ChatRoutingDecision['routedBook'];
		if (parsed.mode === 'book' && parsed.bookId && userContext?.recentBooks) {
			const matched = userContext.recentBooks.find((b) => b.id === parsed.bookId);
			if (matched) {
				routedBook = { bookId: matched.id, bookTitle: matched.title, themeId: matched.themeId };
			}
		}

		return {
			...regexFallback,
			mode,
			domains: domains.length > 0 ? domains : regexFallback.domains,
			hints: [...regexFallback.hints, ...(parsed.hints ?? [])],
			modelSuggestion: parsed.modelSuggestion,
			routedBook
		};
	} catch (err) {
		console.warn('⚠️ AI router failed, falling back to regex routing:', err);
		return regexFallback;
	}
}
