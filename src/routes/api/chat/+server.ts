import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai, SYSTEM_PROMPT } from '$lib/server/openai';
import { createGoal, createTask, getUserActiveGoalsAndTasks, findSimilarGoals, findSimilarTasks } from '$lib/server/goals';
import { ensureDefaultUser, DEFAULT_USER_ID } from '$lib/server/users';
import { getOrCreateConversation, addMessage, getConversationHistory } from '$lib/server/conversations';
import { logActivity } from '$lib/server/activities';
import { buildMemoryContext, createMemory } from '$lib/server/memories';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// Definer tools/functions som AI-en kan bruke
const tools = [
	{
		type: 'function' as const,
		function: {
			name: 'check_similar_goals',
			description: 'Sjekk om det finnes lignende mål før du oppretter et nytt. BRUK ALLTID DETTE FØR create_goal!',
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: 'Tittelen på målet du vurderer å opprette'
					}
				},
				required: ['title']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'check_similar_tasks',
			description: 'Sjekk om det finnes lignende oppgaver under et mål før du oppretter en ny. BRUK ALLTID DETTE FØR create_task!',
			parameters: {
				type: 'object',
				properties: {
					goalId: {
						type: 'string',
						description: 'UUID til målet du vil opprette oppgave under'
					},
					title: {
						type: 'string',
						description: 'Tittelen på oppgaven du vurderer å opprette'
					}
				},
				required: ['goalId', 'title']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'create_goal',
			description: 'Opprett et nytt mål for brukeren. VIKTIG: Sjekk ALLTID med check_similar_goals først! Hvis lignende mål finnes, spør brukeren om de vil oppdatere eksisterende eller opprette nytt.',
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
			description: 'Opprett en konkret oppgave knyttet til et mål. VIKTIG: Sjekk ALLTID med check_similar_tasks først! Hvis lignende oppgave finnes, spør brukeren. goalId må være den faktiske UUID-en.',
			parameters: {
				type: 'object',
				properties: {
					goalId: {
						type: 'string',
						description: 'UUID til målet denne oppgaven tilhører. Dette er en lang ID-streng som f.eks "a1b2c3d4-e5f6-7890-abcd-ef1234567890". ALDRI bruk tittel, nummer eller slug - kun den faktiske UUID-en fra listen over aktive mål.'
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
	},
	{
		type: 'function' as const,
		function: {
			name: 'log_activity',
			description: 'Registrer en aktivitet/hendelse med målbare verdier. Dette kan være trening, date, stemningsregistrering, osv. Aktiviteten kobles automatisk til relevante oppgaver.',
			parameters: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						description: 'Type aktivitet. Format: kategori_spesifikk (f.eks: workout_run, workout_strength, relationship_date, relationship_tufte_talk, mental_mood_check)',
						examples: ['workout_run', 'workout_strength', 'relationship_date', 'mental_mood_check']
					},
					duration: {
						type: 'number',
						description: 'Varighet i minutter (hvis relevant)'
					},
					note: {
						type: 'string',
						description: 'Brukerens notat om aktiviteten'
					},
					metrics: {
						type: 'array',
						description: 'Målbare verdier fra aktiviteten',
						items: {
							type: 'object',
							properties: {
								metricType: {
									type: 'string',
									description: 'Type måling (f.eks: distance, quality_rating, mood_score, energy_level)'
								},
								value: {
									type: 'number',
									description: 'Verdien som ble målt'
								},
								unit: {
									type: 'string',
									description: 'Enhet for målingen (f.eks: km, rating_1_10, minutes)'
								}
							},
							required: ['metricType', 'value']
						}
					},
					taskIds: {
						type: 'array',
						description: 'Valgfritt: Spesifikke task IDs denne aktiviteten skal telle mot. Hvis ikke angitt, matcher systemet automatisk.',
						items: {
							type: 'string'
						}
					}
				},
				required: ['type', 'metrics']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'create_memory',
			description: 'Lagre viktig informasjon om brukeren som skal huskes permanent. Kan være generelt eller tema-spesifikt.',
			parameters: {
				type: 'object',
				properties: {
					category: {
						type: 'string',
						description: 'Kategori for minnet',
						enum: ['personal', 'relationship', 'fitness', 'mental_health', 'preferences', 'other']
					},
					content: {
						type: 'string',
						description: 'Selve minnet - skriv som en kort, faktisk påstand (f.eks: "Brukeren heter Kjetil", "Har to barn: Ola (7), Emma (4)")'
					},
					importance: {
						type: 'string',
						description: 'Hvor viktig er dette minnet?',
						enum: ['high', 'medium', 'low']
					},
					themeId: {
						type: 'string',
						description: 'Valgfritt: Tema-ID for tema-spesifikke memories. Brukes under tema-kartlegging.'
					}
				},
				required: ['category', 'content']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'manage_theme',
			description: 'Administrer tema (tematiske områder) for å organisere mål og samtaler. Foreslå nye tema når bruker diskuterer mål som ikke passer i eksisterende tema.',
			parameters: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						description: 'Handling å utføre',
						enum: ['suggest_create', 'create', 'list', 'archive']
					},
					name: {
						type: 'string',
						description: 'Temanavn (f.eks: "Vennskap", "Løping", "Familie")'
					},
					emoji: {
						type: 'string',
						description: 'Emoji som representerer temaet (f.eks: "🤝", "🏃‍♂️", "👨‍👩‍👦")'
					},
					parentTheme: {
						type: 'string',
						description: 'Overordnet kategori (f.eks: "Samliv", "Helse", "Foreldreliv", "Karriere", "Økonomi")',
						enum: ['Samliv', 'Helse', 'Foreldreliv', 'Karriere', 'Økonomi', 'Personlig utvikling']
					},
					description: {
						type: 'string',
						description: 'Kort beskrivelse av hva dette temaet dekker'
					},
					reason: {
						type: 'string',
						description: 'Forklaring til bruker om hvorfor dette temaet er foreslått'
					},
					themeId: {
						type: 'string',
						description: 'Tema-ID (påkrevd for archive-handling)'
					}
				},
				required: ['action']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'query_sensor_data',
			description: 'ALLTID bruk dette for å hente faktiske helsedata fra Withings. ALDRI oppgi data fra hukommelsen - data må hentes live! Bruk "latest" for nyeste uke, "trend" for flere perioder (f.eks. "siste 3 måneder"), "period_summary" for én periode, "raw_events" for detaljerte målinger.',
			parameters: {
				type: 'object',
				properties: {
					queryType: {
						type: 'string',
						description: 'Type spørring: "latest"=nyeste uke, "trend"=sammenlign perioder (BRUK for "siste X måneder/uker"), "period_summary"=én periode, "raw_events"=detaljert',
						enum: ['latest', 'period_summary', 'trend', 'raw_events']
					},
					period: {
						type: 'string',
						description: 'Tidsperiode for aggregater',
						enum: ['week', 'month', 'year']
					},
					periodKey: {
						type: 'string',
						description: 'Spesifikk periode (f.eks: "2025W43", "2025M10", "2025")'
					},
					metric: {
						type: 'string',
						description: 'Hvilken metrikk å fokusere på',
						enum: ['weight', 'steps', 'sleep', 'intense_minutes', 'all']
					},
					limit: {
						type: 'number',
						description: 'Max antall resultater (for raw_events eller trend)'
					},
					startDate: {
						type: 'string',
						description: 'Startdato for raw events (ISO format)'
					},
					endDate: {
						type: 'string',
						description: 'Sluttdato for raw events (ISO format)'
					}
				},
				required: ['queryType']
			}
		}
	}
];

export const POST: RequestHandler = async ({ request }) => {
	try {
		// Sørg for at default bruker eksisterer
		await ensureDefaultUser();

		const { message, imageUrl } = await request.json();

		if ((!message || typeof message !== 'string') && !imageUrl) {
			return json({ error: 'Invalid message' }, { status: 400 });
		}

		// Hent eller opprett samtale
		const conversation = await getOrCreateConversation(DEFAULT_USER_ID);

		// Lagre brukerens melding med imageUrl hvis present
		await addMessage({
			conversationId: conversation.id,
			role: 'user',
			content: message || '📷 [Bilde]',
			imageUrl
		});

		// Hent samtale-historikk (siste 5 meldinger for umiddelbar kontekst)
		const history = await getConversationHistory(conversation.id, 5);

		// Bygg memory context (viktig informasjon om brukeren)
		const memoryContext = await buildMemoryContext(DEFAULT_USER_ID);

		// Hent brukerens aktive mål og oppgaver for kontekst
		const activeGoals = await getUserActiveGoalsAndTasks(DEFAULT_USER_ID);
		
		// Bygg kontekst-melding med aktive mål
		let goalsContext = '\n\n--- BRUKERENS AKTIVE MÅL OG OPPGAVER ---\n';
		if (activeGoals.length === 0) {
			goalsContext += 'Brukeren har ingen aktive mål ennå.\n';
		} else {
			for (const goal of activeGoals) {
				goalsContext += `\nMÅL: "${goal.title}" (ID: ${goal.id})\n`;
				goalsContext += `Kategori: ${goal.category?.name || 'Ingen'}\n`;
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

		// Add current date context
		const today = new Date();
		const dateContext = `\n--- DAGENS DATO ---\nDagens dato er: ${today.toLocaleDateString('nb-NO', { 
			year: 'numeric', 
			month: 'long', 
			day: 'numeric',
			weekday: 'long'
		})} (${today.toISOString().split('T')[0]})\n--- SLUTT PÅ DATO ---\n\n`;

		// Bygg meldingshistorikk for OpenAI
		const messages: ChatCompletionMessageParam[] = [
			{ role: 'system', content: SYSTEM_PROMPT + memoryContext + goalsContext + dateContext }
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

		// Legg til siste melding - støtt både tekst og bilde
		if (imageUrl) {
			// Bruk Vision API format
			messages.push({
				role: 'user',
				content: [
					{
						type: 'image_url',
						image_url: { url: imageUrl }
					},
					{
						type: 'text',
						text: message || 'Hva ser du på dette bildet? Kan du hjelpe meg å analysere det i forhold til målene mine?'
					}
				]
			});
		}
		// Note: siste tekstmelding er allerede lagt til via history

		// Første kall til OpenAI med tools
		// Bruk gpt-4o når vi har bilder (Vision support)
		let completion = await openai.chat.completions.create({
			model: imageUrl ? 'gpt-4o' : 'gpt-4o-mini',
			messages,
			tools,
			tool_choice: 'auto',
			temperature: 0.7,
			max_tokens: imageUrl ? 1500 : 1000 // Mer tokens for bildeanalyse
		});

		let responseMessage = completion.choices[0]?.message;
		let createdGoalId: string | null = null;

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

		// Håndter tool calls hvis AI-en vil bruke dem
		if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
			console.log('\n🔧 Executing tools...');
			
			// Legg til assistant message med alle tool calls først
			messages.push({
				role: 'assistant',
				content: null,
				tool_calls: responseMessage.tool_calls
			});

			// Håndter alle tool calls
			for (const toolCall of responseMessage.tool_calls) {
				console.log(`\n  Tool: ${toolCall.type === 'function' ? toolCall.function.name : toolCall.type}`);
				console.log(`  Args: ${toolCall.type === 'function' ? toolCall.function.arguments.substring(0, 100) : 'N/A'}`);
				
				if (toolCall.type === 'function' && toolCall.function.name === 'check_similar_goals') {
					const args = JSON.parse(toolCall.function.arguments);
					const similarGoals = await findSimilarGoals(DEFAULT_USER_ID, args.title, 70);

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
					const goal = await createGoal({
						userId: DEFAULT_USER_ID,
						...args
					});
					createdGoalId = goal.id;

					messages.push({
						role: 'tool',
						content: JSON.stringify({ 
							success: true, 
							goalId: goal.id,
							goalTitle: goal.title,
							message: `✅ Målet "${goal.title}" er opprettet med ID: ${goal.id}. VIKTIG: Bruk denne eksakte ID-en hvis du skal lage oppgaver for dette målet!` 
						}),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_task') {
					try {
						const args = JSON.parse(toolCall.function.arguments);
						const task = await createTask(args);

						messages.push({
							role: 'tool',
							content: JSON.stringify({ 
								success: true, 
								taskId: task.id,
								message: `Oppgaven "${task.title}" er opprettet!` 
							}),
							tool_call_id: toolCall.id
						});
					} catch (error) {
						// Håndter feil - f.eks. ugyldig goalId
						let errorMessage = 'Kunne ikke opprette oppgave';
						if (error instanceof Error && error.message.includes('foreign key')) {
							errorMessage = `FEIL: goalId er ugyldig! Sjekk listen over aktive mål og bruk den eksakte UUID-en derfra. Ikke bruk tittel eller nummer.`;
						}
						messages.push({
							role: 'tool',
							content: JSON.stringify({ 
								success: false, 
								error: errorMessage
							}),
							tool_call_id: toolCall.id
						});
					}
				} else if (toolCall.type === 'function' && toolCall.function.name === 'log_activity') {
					const args = JSON.parse(toolCall.function.arguments);
					const result = await logActivity({
						userId: DEFAULT_USER_ID,
						...args
					});

					// Bygg en fin melding om hva som ble registrert
					const taskSummary = result.progressEntries.map((p) => 
						`• ${p.task.title}${p.value ? ` (+${p.value} ${p.task.unit || ''})` : ''}`
					).join('\n');

					messages.push({
						role: 'tool',
						content: JSON.stringify({ 
							success: true,
							activityId: result.activity.id,
							tasksUpdated: result.progressEntries.length,
							message: `✅ Aktivitet registrert!\n\nTeller mot:\n${taskSummary || '(Ingen matchende oppgaver funnet)'}` 
						}),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_memory') {
					const args = JSON.parse(toolCall.function.arguments);
					const memory = await createMemory({
						userId: DEFAULT_USER_ID,
						themeId: args.themeId || null,
						category: args.category,
						content: args.content,
						importance: args.importance || 'medium',
						source: conversation.id
					});

					messages.push({
						role: 'tool',
						content: JSON.stringify({ 
							success: true,
							memoryId: memory.id,
							themeSpecific: !!args.themeId,
							message: `Memory lagret${args.themeId ? ' (tema-spesifikk)' : ''}: ${args.content}` 
						}),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'manage_theme') {
					const args = JSON.parse(toolCall.function.arguments);
					const { manageThemeTool } = await import('$lib/ai/tools/manage-theme');
					
					const result = await manageThemeTool.execute({
						userId: DEFAULT_USER_ID,
						...args
					});

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_sensor_data') {
					const args = JSON.parse(toolCall.function.arguments);
					const { querySensorDataTool } = await import('$lib/ai/tools/query-sensor-data');
					
					console.log('  📊 Querying sensor data with:', args);
					const result = await querySensorDataTool.execute({
						userId: DEFAULT_USER_ID,
						...args
					});
					console.log('  📊 Result:', result.success ? 'Success' : 'Failed', result.message);

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				}
			}

			// Nytt kall for å få et naturlig svar (etter alle tool calls er håndtert)
			completion = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages,
				temperature: 0.7,
				max_tokens: 1000
			});

			responseMessage = completion.choices[0]?.message;
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
