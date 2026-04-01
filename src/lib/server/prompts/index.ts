// Prompt builder — Assembles base + domain-specific + skill-specific prompts

import { BASE_PROMPT } from './base';
import { DOMAIN_PROMPTS, type DomainPromptKey } from './domains';
import type { ChatRoutingDecision } from '../chat-router';

export function buildModularSystemPrompt(routing: ChatRoutingDecision): string {
	const blocks: string[] = [BASE_PROMPT];

	// Add relevant domain-specific blocks
	for (const domain of routing.domains) {
		const key = domain as DomainPromptKey;
		if (key in DOMAIN_PROMPTS) {
			blocks.push(`\n---\n\n${DOMAIN_PROMPTS[key]}`);
		}
	}

	// Add routing hints if present
	if (routing.domainHints && routing.domainHints.length > 0) {
		blocks.push(`\n---\n\n**FOR DENNE MELDINGEN:**\n${routing.domainHints.map(h => `• ${h}`).join('\n')}`);
	}

	// Add skill-specific hints
	if (routing.hints && routing.hints.length > 0) {
		blocks.push(`\n---\n\n**AKTIVERTE SKILLS:**\n${routing.hints.map(h => `• ${h}`).join('\n')}`);
	}

	return blocks.join('\n');
}

export { BASE_PROMPT };
export { DOMAIN_PROMPTS };
