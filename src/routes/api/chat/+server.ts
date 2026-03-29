import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai, SYSTEM_PROMPT } from '$lib/server/openai';
import { createGoal, createTask, getUserActiveGoalsAndTasks, findSimilarGoals, findSimilarTasks } from '$lib/server/goals';
import { getOrCreateConversation, addMessage, getConversationHistory, getConversationByIdForUser } from '$lib/server/conversations';
import { logActivity } from '$lib/server/activities';
import { buildMemoryContext, createMemory } from '$lib/server/memories';
import { isFutureVisionText, seedThemeInstructionFromFutureVision } from '$lib/server/theme-instructions';
import { queryEconomicsTool } from '$lib/ai/tools/query-economics';
import { USER_ID_HEADER_NAME } from '$lib/server/request-user';
import { db } from '$lib/db';
import { userWidgets, checklists, checklistItems } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
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
					themeId: {
						type: 'string',
						description: 'Valgfritt tema-ID hvis målet skal kobles til et eksisterende tema, for eksempel et nylig opprettet tema.'
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
						description: 'Valgfritt: Tema-ID. For archive kan du også bruke name direkte hvis navnet er entydig.'
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
			description: 'ALLTID bruk dette for å hente faktiske helsedata fra Withings. ALDRI oppgi data fra hukommelsen - data må hentes live! Bruk "latest" for nyeste uke, "trend" for flere perioder (f.eks. "siste 3 måneder"), "period_summary" for én periode, "raw_events" for detaljerte målinger eller treningsøkter.',
			parameters: {
				type: 'object',
				properties: {
					queryType: {
						type: 'string',
						description: 'Type spørring: "latest"=nyeste uke, "trend"=sammenlign perioder (f.eks. siste 3 mnd), "period_summary"=én periode, "raw_events"=enkeltverdier/alle målinger/treningsøkter (BRUK for "enkeltverdier", "alle målinger", "detaljert", "treningsøkter")',
						enum: ['latest', 'period_summary', 'trend', 'raw_events']
					},
					period: {
						type: 'string',
						description: 'Tidsperiode for aggregater (kun for trend/period_summary)',
						enum: ['week', 'month', 'year']
					},
					periodKey: {
						type: 'string',
						description: 'Spesifikk periode (f.eks: "2025W43", "2025M10", "2025")'
					},
					metric: {
						type: 'string',
						description: 'Hvilken metrikk å fokusere på',
						enum: ['weight', 'steps', 'sleep', 'intense_minutes', 'heartrate', 'workouts', 'all']
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
	},
	{
		type: 'function' as const,
		function: {
			name: 'record_screen_time',
			description: 'Registrer skjermtid fra et skjermbilde eller brukerens beskrivelse. Kan brukes for daglig skjermtid-tracking.',
			parameters: {
				type: 'object',
				properties: {
					date: {
						type: 'string',
						description: 'Dato for skjermtiden (ISO format: YYYY-MM-DD)'
					},
					totalMinutes: {
						type: 'number',
						description: 'Total skjermtid i minutter'
					},
					appBreakdown: {
						type: 'object',
						description: 'Fordeling av skjermtid per app (valgfritt)',
						additionalProperties: {
							type: 'number',
							description: 'Minutter brukt i appen'
						}
					},
					note: {
						type: 'string',
						description: 'Valgfri merknad eller kontekst'
					}
				},
				required: ['date', 'totalMinutes']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'record_workout',
			description: 'Registrer en treningsøkt. Støtter både cardio (løping, sykling) og styrketrening.',
			parameters: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						description: 'Type trening',
						enum: ['running', 'cycling', 'walking', 'strength', 'yoga', 'swimming', 'other']
					},
					date: {
						type: 'string',
						description: 'Dato for økten (ISO format: YYYY-MM-DD)'
					},
					durationMinutes: {
						type: 'number',
						description: 'Varighet i minutter'
					},
					distance: {
						type: 'number',
						description: 'Distanse i kilometer (kun for cardio)'
					},
					exercises: {
						type: 'array',
						description: 'Liste over øvelser for styrketrening',
						items: {
							type: 'object',
							properties: {
								name: { type: 'string' },
								sets: { type: 'number' },
								reps: { type: 'number' },
								weight: { type: 'number', description: 'Vekt i kg' }
							}
						}
					},
					notes: {
						type: 'string',
						description: 'Valgfri merknad om økten'
					}
				},
				required: ['type', 'date', 'durationMinutes']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
					name: 'query_economics',
					description: 'Hent økonomisk data fra tilkoblede bankkontoer. Brukes for saldo, transaksjoner, forbruk per måned og kontoliste.',
					parameters: {
						type: 'object',
						properties: {
							queryType: {
								type: 'string',
								description: 'Type økonomi-spørring',
								enum: ['balance', 'transactions', 'spending_summary', 'account_list']
							},
							month: {
								type: 'string',
								description: 'Måned i format YYYY-MM, for eksempel 2026-01'
							},
							dateRange: {
								type: 'object',
								properties: {
									start: {
										type: 'string',
										description: 'Startdato i format YYYY-MM-DD'
									},
									end: {
										type: 'string',
										description: 'Sluttdato i format YYYY-MM-DD'
									}
								}
							},
							accountId: {
								type: 'string',
								description: 'Valgfri konto-ID for å begrense spørringen til én konto'
							},
							limit: {
								type: 'number',
								description: 'Maks antall transaksjoner å hente tilbake'
							},
							sortBy: {
								type: 'string',
								description: 'Sortering for transaksjoner',
								enum: ['date', 'amount']
							}
						},
						required: ['queryType']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
			name: 'record_mood',
			description: 'Registrer humør/følelsestilstand for et tidspunkt.',
			parameters: {
				type: 'object',
				properties: {
					rating: {
						type: 'number',
						description: 'Humør på skala 1-10 (1=veldig dårlig, 10=utmerket)',
						minimum: 1,
						maximum: 10
					},
					date: {
						type: 'string',
						description: 'Dato (ISO format: YYYY-MM-DD)'
					},
					time: {
						type: 'string',
						description: 'Tidspunkt (HH:MM format, valgfritt)'
					},
					note: {
						type: 'string',
						description: 'Valgfri beskrivelse av humøret/hva som påvirket det'
					},
					tags: {
						type: 'array',
						description: 'Valgfrie tags som beskriver følelsen',
						items: {
							type: 'string',
							enum: ['glad', 'trist', 'stresset', 'sliten', 'energisk', 'motivert', 'frustrert', 'rolig', 'bekymret', 'fornøyd']
						}
					}
				},
				required: ['rating', 'date']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'create_widget',
			description: 'Opprett en ny widget som viser en bestemt metrikk på hjemskjermen. Bruk når brukeren vil se en spesifikk statistikk, f.eks. "vis meg søvn per dag siste 30 dager" eller "lagre en widget for løpedistanse denne uken". Widgeten kan festes til hjemskjermen.',
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: 'Kort, beskrivende tittel på widgeten (maks 40 tegn), f.eks. "Søvn / dag", "Ukentlig løping"'
					},
					metricType: {
						type: 'string',
						description: 'Hvilken metrikk widgeten viser',
						enum: ['weight', 'sleepDuration', 'steps', 'distance', 'workoutCount', 'heartrate', 'mood', 'screenTime', 'amount']
					},
					aggregation: {
						type: 'string',
						description: 'Aggregeringsmetode: avg=gjennomsnitt, sum=sum, count=antall, latest=siste verdi',
						enum: ['avg', 'sum', 'count', 'latest']
					},
					period: {
						type: 'string',
						description: 'Tidsoppløsning for sparkline: day=daglig, week=ukentlig, month=månedlig',
						enum: ['day', 'week', 'month']
					},
					range: {
						type: 'string',
						description: 'Tidsvindu for data: last7=siste 7 dager, last14=siste 14 dager, last30=siste 30 dager, current_week=inneværende uke, current_month=inneværende måned, current_year=inneværende år',
						enum: ['last7', 'last14', 'last30', 'current_week', 'current_month', 'current_year']
					},
					filterCategory: {
						type: 'string',
						description: 'Valgfri kategorifilter for amount-metrikk. Bruk dette for å vise kun utgifter i en bestemt kategori. Gyldige verdier: dagligvare, mat, bolig, transport, helse, abonnement, underholdning, shopping, barn, forsikring, sparing, overføring, lønn, annet',
						enum: ['dagligvare', 'mat', 'bolig', 'transport', 'helse', 'abonnement', 'underholdning', 'shopping', 'barn', 'forsikring', 'sparing', 'overføring', 'lønn', 'annet']
					},
					unit: {
						type: 'string',
						description: 'Enhet som vises på widgeten, f.eks. "kg", "timer", "km", "steg", "kr"'
					},
					goal: {
						type: 'number',
						description: 'Valgfritt mål for å vise fremgang som prosentring (f.eks. 10000 for steg, 8 for søvntimer)'
					},
					color: {
						type: 'string',
						description: 'Hex-farge for widgeten, f.eks. #7c8ef5 (blå), #82c882 (grønn), #e07070 (rød), #f0b429 (gul), #5fa0a0 (teal)',
						enum: ['#7c8ef5', '#82c882', '#e07070', '#f0b429', '#5fa0a0', '#d4829a']
					},
					pinned: {
						type: 'boolean',
						description: 'Om widgeten skal festes til hjemskjermen med én gang (default: true)'
					}
				},
				required: ['title', 'metricType', 'aggregation', 'period', 'range', 'unit']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'get_widgets',
			description: 'Henter brukerens eksisterende widgets. Bruk denne FØRST når brukeren vil konfigurere, oppdatere eller slette en spesifikk widget, slik at du kan finne riktig widget-ID.',
			parameters: {
				type: 'object',
				properties: {},
				required: []
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'update_widget',
			description: 'Oppdater konfigurasjon på en eksisterende widget. Bruk etter get_widgets for å finne riktig widgetId. Kan sette terskelverdier (thresholdWarn/thresholdSuccess), mål, tittel og farge.',
			parameters: {
				type: 'object',
				properties: {
					widgetId: {
						type: 'string',
						description: 'ID til widgeten som skal oppdateres (fra get_widgets)'
					},
					title: {
						type: 'string',
						description: 'Ny tittel (valgfritt)'
					},
					goal: {
						type: 'number',
						description: 'Nytt mål (sett til null for å fjerne)'
					},
					thresholdWarn: {
						type: 'number',
						description: 'Terskelverdi for advarsel (gul/rød). For høyere-er-bedre-metrikker (steg, søvn): verdi UNDER denne = advarsel. For lavere-er-bedre (vekt, forbruk): verdi OVER denne = advarsel. Sett til null for å fjerne.'
					},
					thresholdSuccess: {
						type: 'number',
						description: 'Terskelverdi for suksess (grønn). For høyere-er-bedre-metrikker: verdi OVER denne = suksess. For lavere-er-bedre: verdi UNDER denne = suksess. Sett til null for å fjerne.'
					},
					color: {
						type: 'string',
						enum: ['#7c8ef5', '#82c882', '#e07070', '#f0b429', '#5fa0a0', '#d4829a'],
						description: 'Ny farge (valgfritt)'
					}
				},
				required: ['widgetId']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'create_checklist',
			description: 'Opprett en sjekkliste for brukeren med konkrete punkter. Bruk når brukeren nevner at de skal på tur, forberede noe, pakke, eller har en liste de vil holde orden på. Foreslå relevante punkter basert på konteksten.',
			parameters: {
				type: 'object',
				properties: {
					title: {
						type: 'string',
						description: 'Tittel på sjekklisten, f.eks. "Forberede tur til Bergen" eller "Pakkeliste sommerferie"'
					},
					emoji: {
						type: 'string',
						description: 'Emoji som representerer listen, f.eks. ✈️ 🎒 🚗 🏖️ ⛷️ 🗺️'
					},
					context: {
						type: 'string',
						description: 'Kontekst for listen',
						enum: ['tur', 'reise', 'pakkeliste', 'event', 'forberedelse', 'handling', 'annet']
					},
					items: {
						type: 'array',
						description: 'Liste over konkrete punkter. Lag 6-12 relevante, spesifikke punkter.',
						items: { type: 'string' }
					}
				},
				required: ['title', 'emoji', 'items']
			}
		}
	}
];

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const userId = locals.userId;

		const { message, imageUrl, conversationId: requestedConversationId } = await request.json();

		if ((!message || typeof message !== 'string') && !imageUrl) {
			return json({ error: 'Invalid message' }, { status: 400 });
		}

		// Bruk oppgitt conversationId (verifisert mot bruker) eller hent/opprett standard
		const conversation =
			requestedConversationId && typeof requestedConversationId === 'string'
				? ((await getConversationByIdForUser(requestedConversationId, userId)) ??
					(await getOrCreateConversation(userId)))
				: await getOrCreateConversation(userId);

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
		const memoryContext = await buildMemoryContext(userId);

		// Hent brukerens aktive mål og oppgaver for kontekst
		const activeGoals = await getUserActiveGoalsAndTasks(userId);
		
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
		let createdTheme: { id: string; name: string; emoji?: string | null; conversationId?: string | null } | null = null;
		let archivedTheme: { id: string; name: string; emoji?: string | null } | null = null;

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
					const goal = await createGoal({
						userId,
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
						userId,
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
						userId,
						themeId: args.themeId || null,
						category: args.category,
						content: args.content,
						importance: args.importance || 'medium',
						source: conversation.id
					});

					if (args.themeId && typeof args.content === 'string' && isFutureVisionText(args.content)) {
						await seedThemeInstructionFromFutureVision(userId, args.themeId, args.content);
					}

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
				} else if (toolCall.type === 'function' && toolCall.function.name === 'query_economics') {
					const args = JSON.parse(toolCall.function.arguments);

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
				} else if (toolCall.type === 'function' && toolCall.function.name === 'record_screen_time') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📱 Recording screen time:', args);

					// Call API to save record
					const response = await fetch(`${request.url.replace('/api/chat', '/api/ai-records')}`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							[USER_ID_HEADER_NAME]: userId
						},
						body: JSON.stringify({
							type: 'screen_time',
							date: args.date,
							data: {
								totalMinutes: args.totalMinutes,
								appBreakdown: args.appBreakdown,
								note: args.note
							},
							metadata: {
								confidence: 'high',
								original_tool: 'record_screen_time'
							}
						})
					});

					const result = await response.json();
					console.log('  📱 Result:', result.success ? 'Success' : 'Failed', result.message);

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'record_workout') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  🏃 Recording workout:', args);

					const response = await fetch(`${request.url.replace('/api/chat', '/api/ai-records')}`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							[USER_ID_HEADER_NAME]: userId
						},
						body: JSON.stringify({
							type: 'workout',
							date: args.date,
							data: {
								sportType: args.type,
								duration: args.durationMinutes * 60, // Convert to seconds
								distance: args.distance ? args.distance * 1000 : undefined, // Convert to meters
								exercises: args.exercises,
								notes: args.notes
							},
							metadata: {
								confidence: 'high',
								original_tool: 'record_workout'
							}
						})
					});

					const result = await response.json();
					console.log('  🏃 Result:', result.success ? 'Success' : 'Failed', result.message);

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'record_mood') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  😊 Recording mood:', args);

					const response = await fetch(`${request.url.replace('/api/chat', '/api/ai-records')}`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							[USER_ID_HEADER_NAME]: userId
						},
						body: JSON.stringify({
							type: 'mood',
							date: args.date,
							data: {
								rating: args.rating,
								time: args.time,
								note: args.note,
								tags: args.tags
							},
							metadata: {
								confidence: 'high',
								original_tool: 'record_mood'
							}
						})
					});

					const result = await response.json();
					console.log('  😊 Result:', result.success ? 'Success' : 'Failed', result.message);

					messages.push({
						role: 'tool',
						content: JSON.stringify(result),
						tool_call_id: toolCall.id
					});
				} else if (toolCall.type === 'function' && toolCall.function.name === 'create_widget') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📊 Creating widget:', args);

					try {
						// Sjekk om bruker allerede har en pinned widget med samme metricType + range + filterCategory
						const existing = await db
							.select({ id: userWidgets.id, title: userWidgets.title })
							.from(userWidgets)
							.where(
								and(
									eq(userWidgets.userId, userId),
									eq(userWidgets.metricType, args.metricType),
									eq(userWidgets.range, args.range),
									eq(userWidgets.pinned, true),
									args.filterCategory
										? eq(userWidgets.filterCategory, args.filterCategory)
										: sql`filter_category IS NULL`
								)
							)
							.limit(1);

						if (existing.length > 0) {
							console.log('  📊 Widget already exists:', existing[0].id);
							messages.push({
								role: 'tool',
								content: JSON.stringify({ success: true, widgetId: existing[0].id, title: existing[0].title, pinned: true, alreadyExisted: true }),
								tool_call_id: toolCall.id
							});
						} else {
							const [widget] = await db
								.insert(userWidgets)
								.values({
									userId,
									title: (args.title || '').trim().slice(0, 80),
									metricType: args.metricType,
									aggregation: args.aggregation,
									period: args.period,
									range: args.range,
									goal: args.goal != null ? String(args.goal) : null,
									filterCategory: args.filterCategory ?? null,
									unit: (args.unit || '').slice(0, 20),
									color: args.color || '#7c8ef5',
									pinned: args.pinned !== false,
									sortOrder: 0,
								})
								.returning();

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
						const widgets = await db
							.select({
								id: userWidgets.id,
								title: userWidgets.title,
								metricType: userWidgets.metricType,
								aggregation: userWidgets.aggregation,
								period: userWidgets.period,
								range: userWidgets.range,
								unit: userWidgets.unit,
								goal: userWidgets.goal,
								thresholdWarn: userWidgets.thresholdWarn,
								thresholdSuccess: userWidgets.thresholdSuccess,
								color: userWidgets.color,
								pinned: userWidgets.pinned,
							})
							.from(userWidgets)
							.where(eq(userWidgets.userId, userId))
							.orderBy(userWidgets.sortOrder, userWidgets.createdAt);

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
						const updates: Record<string, unknown> = { updatedAt: new Date() };
						if (typeof args.title === 'string' && args.title.trim()) updates.title = args.title.trim().slice(0, 80);
						if (typeof args.goal === 'number') updates.goal = String(args.goal);
						if (args.goal === null) updates.goal = null;
						if (typeof args.thresholdWarn === 'number') updates.thresholdWarn = String(args.thresholdWarn);
						if (args.thresholdWarn === null) updates.thresholdWarn = null;
						if (typeof args.thresholdSuccess === 'number') updates.thresholdSuccess = String(args.thresholdSuccess);
						if (args.thresholdSuccess === null) updates.thresholdSuccess = null;
						if (typeof args.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(args.color)) updates.color = args.color;

						const [updated] = await db
							.update(userWidgets)
							.set(updates)
							.where(and(eq(userWidgets.id, args.widgetId), eq(userWidgets.userId, userId)))
							.returning({ id: userWidgets.id, title: userWidgets.title });

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
							await db.insert(checklistItems).values(
								args.items.map((text, i) => ({
									checklistId: checklist.id,
									userId,
									text,
									sortOrder: i
								}))
							);
						}

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
			conversationId: conversation.id,
			goalCreated: createdGoalId !== null,
			goalId: createdGoalId,
			themeCreated: createdTheme !== null,
			theme: createdTheme,
			themeArchived: archivedTheme !== null,
			archivedTheme,
			checklistCreated: true
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
