/**
 * Nettverkslag for BreakdownModal — AI-samtale + forslag til oppgavenedbrytning.
 * Injiseres som mock på /design.
 */
export interface BreakdownChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

export type LoadBreakdownSuggestions = (input: {
	taskTitle: string;
	taskDescription: string;
	/** Lesbar transkripsjon av samtalen som ekstra kontekst til forslagene. */
	context?: string;
}) => Promise<string[]>;

export type SendBreakdownChat = (input: {
	taskTitle: string;
	taskDescription: string;
	messages: BreakdownChatMessage[];
}) => Promise<string>;

export const loadBreakdownSuggestions: LoadBreakdownSuggestions = async ({
	taskTitle,
	taskDescription,
	context = ''
}) => {
	const res = await fetch('/api/breakdown/suggestions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ taskTitle, taskDescription, context })
	});
	if (!res.ok) throw new Error('Failed to load suggestions');
	const data = (await res.json()) as { suggestions: string[] };
	return data.suggestions;
};

export const sendBreakdownChat: SendBreakdownChat = async ({ taskTitle, taskDescription, messages }) => {
	const res = await fetch('/api/breakdown/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ taskTitle, taskDescription, messages })
	});
	if (!res.ok) throw new Error('Kunne ikke sende melding');
	const data = (await res.json()) as { reply: string };
	return data.reply;
};

/** Bygger en lesbar transkripsjon av nedbrytnings-samtalen som kontekst til forslagene. */
export function buildBreakdownContextFromChat(messages: BreakdownChatMessage[]): string {
	const lines = messages
		.filter((m) => m.content.trim().length > 0)
		.map((m) => `${m.role === 'user' ? 'Bruker' : 'Assistent'}: ${m.content.trim()}`);
	if (lines.length === 0) return '';
	return `Samtale om oppgaven:\n${lines.join('\n')}`;
}
