import { detectPromptFocusModules } from '$lib/server/openai';
import { DOMAIN_METADATA } from '$lib/domains';

export type ChatDomain = 'health' | 'economics' | 'planning' | 'themes' | 'general';
export type ChatSkill = 'widget_creation' | 'checklist_planning' | 'goal_planning' | 'theme_management' | 'general_chat';

export interface ChatRoutingDecision {
	domains: ChatDomain[];
	skills: ChatSkill[];
	focusModules: ReturnType<typeof detectPromptFocusModules>;
	hints: string[];
	domainHints?: string[];
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

	if (domains.size === 0) domains.add('general');
	if (skills.size === 0) skills.add('general_chat');

	return {
		domains: Array.from(domains),
		skills: Array.from(skills),
		focusModules,
		hints,
		domainHints: domainHints.length > 0 ? domainHints : undefined
	};
}
