import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai, SYSTEM_PROMPT } from '$lib/server/openai';
import { createGoal, createTask } from '$lib/server/goals';
import { ensureDefaultUser, DEFAULT_USER_ID } from '$lib/server/users';
import { getOrCreateConversation, addMessage, getConversationHistory } from '$lib/server/conversations';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// Definer tools/functions som AI-en kan bruke
const tools = [
	{
		type: 'function' as const,
		function: {
			name: 'create_goal',
			description: 'Opprett et nytt mål for brukeren basert på samtalen. Bruk dette når brukeren har definert et konkret mål.',
			parameters: {
				type: 'object',
				properties: {
					categoryName: {
						type: 'string',
						description: 'Kategori for målet (f.eks: "Trening", "Parforhold", "Mental helse", "Karriere")',
						enum: ['Trening', 'Parforhold', 'Mental helse', 'Karriere', 'Økonomi', 'Hobby', 'Annet']
					},
					title: {
						type: 'string',
						description: 'Kort, konkret tittel for målet (f.eks: "Løpe 5 km uten pause")'
					},
					description: {
						type: 'string',
						description: 'Detaljert beskrivelse av målet, inkludert hvorfor det er viktig for brukeren'
					},
					targetDate: {
						type: 'string',
						description: 'Måldato i ISO format (YYYY-MM-DD), hvis brukeren har spesifisert en tidsfrist'
					}
				},
				required: ['categoryName', 'title', 'description']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'create_task',
			description: 'Opprett en konkret oppgave knyttet til et mål. Bruk dette for å bryte ned et mål i handlingsbare steg.',
			parameters: {
				type: 'object',
				properties: {
					goalId: {
						type: 'string',
						description: 'ID-en til målet denne oppgaven tilhører'
					},
					title: {
						type: 'string',
						description: 'Tittel på oppgaven (f.eks: "Løpe 3 ganger i uken")'
					},
					description: {
						type: 'string',
						description: 'Beskrivelse av hvordan oppgaven skal utføres'
					},
					frequency: {
						type: 'string',
						description: 'Hvor ofte oppgaven skal gjøres',
						enum: ['daily', 'weekly', 'monthly', 'once']
					},
					targetValue: {
						type: 'number',
						description: 'Målverdi (f.eks: 3 for "3 ganger per uke")'
					},
					unit: {
						type: 'string',
						description: 'Enhet for måling (f.eks: "ganger per uke", "minutter", "kilometer")'
					}
				},
				required: ['goalId', 'title', 'frequency']
			}
		}
	}
];

export const POST: RequestHandler = async ({ request }) => {
	try {
		// Sørg for at default bruker eksisterer
		await ensureDefaultUser();

		const { message } = await request.json();

		if (!message || typeof message !== 'string') {
			return json({ error: 'Invalid message' }, { status: 400 });
		}

		// Hent eller opprett samtale
		const conversation = await getOrCreateConversation(DEFAULT_USER_ID);

		// Lagre brukerens melding
		await addMessage({
			conversationId: conversation.id,
			role: 'user',
			content: message
		});

		// Hent samtale-historikk (siste 10 meldinger for kontekst)
		const history = await getConversationHistory(conversation.id, 10);

		// Bygg meldingshistorikk for OpenAI
		const messages: ChatCompletionMessageParam[] = [
			{ role: 'system', content: SYSTEM_PROMPT }
		];

		// Legg til historikk (unntatt den siste brukermeldingen som allerede er der)
		for (const msg of history) {
			if (msg.role === 'user' || msg.role === 'assistant') {
				messages.push({
					role: msg.role,
					content: msg.content
				});
			}
		}

		// Første kall til OpenAI med tools
		let completion = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages,
			tools,
			tool_choice: 'auto',
			temperature: 0.7,
			max_tokens: 1000
		});

		let responseMessage = completion.choices[0]?.message;
		let createdGoalId: string | null = null;

		// Håndter tool calls hvis AI-en vil bruke dem
		if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
			const toolCall = responseMessage.tool_calls[0];
			
			if (toolCall.type === 'function' && toolCall.function.name === 'create_goal') {
				const args = JSON.parse(toolCall.function.arguments);
				const goal = await createGoal({
					userId: DEFAULT_USER_ID,
					...args
				});
				createdGoalId = goal.id;

				// Legg til tool response og be om nytt svar
				messages.push({
					role: 'assistant',
					content: null,
					tool_calls: responseMessage.tool_calls
				});
				messages.push({
					role: 'tool',
					content: JSON.stringify({ 
						success: true, 
						goalId: goal.id,
						message: `Målet "${goal.title}" er opprettet!` 
					}),
					tool_call_id: toolCall.id
				});

				// Nytt kall for å få et naturlig svar
				completion = await openai.chat.completions.create({
					model: 'gpt-4o-mini',
					messages,
					temperature: 0.7,
					max_tokens: 1000
				});

				responseMessage = completion.choices[0]?.message;
			} else if (toolCall.type === 'function' && toolCall.function.name === 'create_task') {
				const args = JSON.parse(toolCall.function.arguments);
				const task = await createTask(args);

				messages.push({
					role: 'assistant',
					content: null,
					tool_calls: responseMessage.tool_calls
				});
				messages.push({
					role: 'tool',
					content: JSON.stringify({ 
						success: true, 
						taskId: task.id,
						message: `Oppgaven "${task.title}" er opprettet!` 
					}),
					tool_call_id: toolCall.id
				});

				completion = await openai.chat.completions.create({
					model: 'gpt-4o-mini',
					messages,
					temperature: 0.7,
					max_tokens: 1000
				});

				responseMessage = completion.choices[0]?.message;
			}
		}

		const finalMessage = responseMessage?.content || 'Beklager, jeg fikk ikke generert noe svar.';

		// Lagre assistentens svar til database
		await addMessage({
			conversationId: conversation.id,
			role: 'assistant',
			content: finalMessage,
			metadata: createdGoalId ? { goalId: createdGoalId } : null
		});

		return json({ 
			message: finalMessage,
			goalCreated: createdGoalId !== null,
			goalId: createdGoalId
		});
	} catch (error) {
		console.error('Error in chat API:', error);
		
		// Gi mer spesifikke feilmeldinger
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
		
		return json(
			{ error: errorMessage },
			{ status: 500 }
		);
	}
};
