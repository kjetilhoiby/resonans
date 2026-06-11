/**
 * Nettverkslag for BreakdownModal — AI-forslag til oppgavenedbrytning.
 * Injiseres som mock på /design.
 */
export type LoadBreakdownSuggestions = (input: {
	taskTitle: string;
	taskDescription: string;
}) => Promise<string[]>;

export const loadBreakdownSuggestions: LoadBreakdownSuggestions = async ({ taskTitle, taskDescription }) => {
	const res = await fetch('/api/breakdown/suggestions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ taskTitle, taskDescription, context: '' })
	});
	if (!res.ok) throw new Error('Failed to load suggestions');
	const data = (await res.json()) as { suggestions: string[] };
	return data.suggestions;
};
