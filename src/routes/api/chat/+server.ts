import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai, SYSTEM_PROMPT } from '$lib/server/openai';
import { createGoal, createTask, getUserActiveGoalsAndTasks, findSimilarGoals, findSimilarTasks } from '$lib/server/goals';
import { getOrCreateConversation, addMessage, getConversationHistory, getConversationByIdForUser } from '$lib/server/conversations';
import { logActivity } from '$lib/server/activities';
import { buildMemoryContext, createMemory } from '$lib/server/memories';
import { isFutureVisionText, seedThemeInstructionFromFutureVision } from '$lib/server/theme-instructions';
import { queryEconomicsTool } from '$lib/ai/tools/query-economics';
import {
	createUserWidget,
	findSimilarWidget,
	listWidgetsForChat,
	updateUserWidget
} from '$lib/skills/widget-creation/service';
import { USER_ID_HEADER_NAME } from '$lib/server/request-user';
import { db } from '$lib/db';
import { checklists, checklistItems, users } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

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

function buildUserMessageForModel(message: string, attachment: AttachmentPayload | null): string {
	if (!attachment) {
		return message;
	}

	return `${message}\n\n--- VEDLEGG ---\n${describeAttachment(attachment)}\n--- SLUTT PÅ VEDLEGG ---`;
}

function getDefaultAttachmentLabel(attachment: AttachmentPayload | null): string {
	if (!attachment) return 'Vedlegg';
	if (attachment.kind === 'image') return '📷 [Bilde]';
	if (attachment.kind === 'audio') return `🎙️ ${attachment.name || 'Lydfil'}`;
	if (attachment.kind === 'document') return `📄 ${attachment.name || 'Dokument'}`;
	return `📎 ${attachment.name || 'Vedlegg'}`;
}

interface DuckDuckGoTopic {
	FirstURL?: string;
	Text?: string;
	Topics?: DuckDuckGoTopic[];
}

function collectDuckDuckGoTopics(topics: DuckDuckGoTopic[], maxItems = 6): Array<{ title: string; url: string }> {
	const collected: Array<{ title: string; url: string }> = [];
	const visit = (items: DuckDuckGoTopic[]) => {
		for (const item of items) {
			if (collected.length >= maxItems) return;
			if (item.FirstURL && item.Text) {
				collected.push({ title: item.Text, url: item.FirstURL });
			}
			if (Array.isArray(item.Topics) && item.Topics.length > 0) {
				visit(item.Topics);
			}
		}
	};

	visit(topics);
	return collected;
}

async function executeWebSearch(query: string) {
	const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
	const response = await fetch(searchUrl, {
		headers: { Accept: 'application/json' }
	});

	if (!response.ok) {
		throw new Error(`Web search failed with status ${response.status}`);
	}

	const payload = (await response.json()) as {
		Heading?: string;
		AbstractText?: string;
		AbstractURL?: string;
		RelatedTopics?: DuckDuckGoTopic[];
	};

	const relatedTopics = Array.isArray(payload.RelatedTopics)
		? collectDuckDuckGoTopics(payload.RelatedTopics)
		: [];

	const primary = payload.AbstractText
		? {
			title: payload.Heading || 'Sammendrag',
			snippet: payload.AbstractText,
			url: payload.AbstractURL || ''
		}
		: null;

	return {
		success: true,
		query,
		primary,
		results: relatedTopics,
		message: relatedTopics.length > 0 || primary
			? `Fant kilder på web for "${query}".`
			: `Ingen tydelige treff for "${query}". Prøv et mer spesifikt søk.`
	};
}

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
			description: 'Opprett et nytt mål for brukeren. VIKTIG: Sjekk ALLTID med check_similar_goals først! Hvis målet er målbart, send også canonical metricId og goal track-feltene slik at dashboardene kan bruke målet direkte.',
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
					},
					metricId: {
						type: 'string',
						description: 'Canonical metric id når målet er målbart. Bruk f.eks. running_distance, weight_change, grocery_spend, sleep_avg_night, steps_avg_day eller active_minutes_avg_day.'
					},
					goalKind: {
						type: 'string',
						description: 'Hvordan målet evalueres i dashboardet',
						enum: ['level', 'change', 'trajectory']
					},
					goalWindow: {
						type: 'string',
						description: 'Hvilken horisont målet gjelder for',
						enum: ['week', 'month', 'quarter', 'year', 'custom']
					},
					targetValue: {
						type: 'number',
						description: 'Målverdien for metrikksporet. Eksempler: 20 for km per uke, -3 for kg ned, 9000 for kroner per måned.'
					},
					unit: {
						type: 'string',
						description: 'Enhet for målverdien, f.eks. km, kg eller kr.'
					},
					durationDays: {
						type: 'number',
						description: 'Brukes kun når goalWindow er custom, f.eks. 60 for 2 måneder eller 730 for 2 år.'
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
			description: 'ALLTID bruk dette for å hente faktiske helsedata fra Withings. ALDRI oppgi data fra hukommelsen - data må hentes live! VIKTIG: Bruk "metric"-parameteren for å kun hente det brukeren spør om (f.eks. metric="workouts" for løping, metric="weight" for vekt). Bruk "latest" for nyeste uke, "trend" for flere perioder, "period_summary" for én periode, "raw_events" for detaljerte målinger.',
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
						description: 'Hvilken metrikk å fokusere på. VIKTIG: Bruk dette for å filtrere! Eksempler: metric="workouts" hvis brukeren spør om løping/trening, metric="weight" for vekt, metric="sleep" for søvn, metric="steps" for skritt. Bruk metric="all" kun for generelle spørsmål om helsedata.',
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
					name: 'weather_forecast',
					description: 'Hent værprognose fra MET.no basert på koordinater. Brukes når bruker spør om vær, eller når du vil berike svar med lokalt vær nå og neste time.',
					parameters: {
						type: 'object',
						properties: {
							latitude: {
								type: 'number',
								description: 'Breddegrad (f.eks. 59.91 for Oslo).'
							},
							longitude: {
								type: 'number',
								description: 'Lengdegrad (f.eks. 10.75 for Oslo).'
							},
							locationName: {
								type: 'string',
								description: 'Valgfri etikett for stedet, f.eks. bynavn.'
							}
						},
						required: []
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'web_search',
					description: 'Søk på web når spørsmålet handler om innhold utenfor brukerens egne sensordata, spesielt bokfakta, referanser, forfattere, kapitler eller kontekst som ikke finnes i samtalehistorikken.',
					parameters: {
						type: 'object',
						properties: {
							query: {
								type: 'string',
								description: 'Søkestreng for web, gjerne konkret med boktittel, forfatter og tema.'
							}
						},
						required: ['query']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'annotate_photo_composition',
					description: 'Lag visuelle bildeannoteringer for fotoanalyse (ledende linjer, fokusområder, tredjedeler). Bruk når bruker vil ha komposisjonsanalyse med figurer tegnet oppå bildet.',
					parameters: {
						type: 'object',
						properties: {
							imageUrl: {
								type: 'string',
								description: 'URL til bildet som skal annoteres. Hvis utelatt, bruk nylig vedlagt bilde i samtalen.'
							},
							summary: {
								type: 'string',
								description: 'Kort oppsummering av komposisjonsanalysen.'
							},
							overlays: {
								type: 'array',
								description: 'Liste med figurer i normaliserte koordinater (0..1).',
								items: {
									type: 'object'
								}
							}
						},
						required: ['summary', 'overlays']
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
			name: 'propose_widget',
			description: 'Foreslå en widget til brukeren UTEN å opprette den i databasen. Bruk ALLTID DETTE FØR create_widget. Returnerer et widget-draft som brukeren ser i et forslagskort der de kan bekrefte, konfigurere eller forkaste. Bruk når bruker vil ha en ny widget ("lag widget for dagligvare", "vis søvn siste 30 dager", "widget for løpedistanse"). ALDRI opprett widget direkte uten forslag og bekreftelse.',
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
						description: 'Tidsvindu for data',
						enum: ['last7', 'last14', 'last30', 'current_week', 'current_month', 'current_year']
					},
					filterCategory: {
						type: 'string',
						description: 'Valgfri kategorifilter for amount-metrikk',
						enum: ['dagligvare', 'mat', 'bolig', 'transport', 'helse', 'abonnement', 'underholdning', 'shopping', 'barn', 'forsikring', 'sparing', 'overføring', 'lønn', 'annet']
					},
					unit: {
						type: 'string',
						description: 'Enhet som vises på widgeten, f.eks. "kg", "timer", "km", "steg", "kr"'
					},
					goal: {
						type: 'number',
						description: 'MÅL-VERDI for å vise fremgang som prosentring. Sett når bruker nevner konkret mål.'
					},
					color: {
						type: 'string',
						description: 'Hex-farge for widgeten',
						enum: ['#7c8ef5', '#82c882', '#e07070', '#f0b429', '#5fa0a0', '#d4829a']
					}
				},
				required: ['title', 'metricType', 'aggregation', 'period', 'range', 'unit']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'create_widget',
			description: 'Opprett widget i databasen. Bruk KUN etter at brukeren eksplisitt har bekreftet et propose_widget-forslag. ALDRI uten forutgående propose_widget og bekreftelse fra bruker. Widgeten festes til hjemskjermen.',
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
						description: 'MÅL-VERDI for å vise fremgang som prosentring. BRUK ALLTID dette når brukeren nevner et konkret mål! Eksempler: 15 (for 15 km/uke), 10000 (for 10000 skritt/dag), 8 (for 8 timer søvn/natt). Hvis brukeren sier "jeg vil løpe 15 km hver uke", så er goal=15.'
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
	},
	{
		type: 'function' as const,
		function: {
			name: 'get_active_checklists',
			description: 'Hent brukerens aktive sjekklister med punkter. Bruk dette før du utvider en eksisterende liste eller når brukeren refererer til en liste de allerede har.',
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
			name: 'add_checklist_items',
			description: 'Legg til nye punkter i en eksisterende sjekkliste. Bruk etter get_active_checklists når brukeren vil utvide, supplere eller forbedre en liste som allerede finnes.',
			parameters: {
				type: 'object',
				properties: {
					checklistId: {
						type: 'string',
						description: 'ID til sjekklisten som skal utvides.'
					},
					items: {
						type: 'array',
						description: 'Nye punkter som skal legges til. Send bare de nye punktene, ikke hele listen på nytt.',
						items: { type: 'string' }
					}
				},
				required: ['checklistId', 'items']
			}
		}
	}
];

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const userId = locals.userId;

		const body = await request.json();
		const { message, imageUrl, conversationId: requestedConversationId } = body;
		const attachment = isAttachmentPayload(body.attachment) ? body.attachment : null;
		const userProfile = await db.query.users.findFirst({
			columns: { timezone: true },
			where: eq(users.id, userId)
		});
		const userTimezone = userProfile?.timezone ?? 'Europe/Oslo';
		const effectiveImageUrl =
			typeof imageUrl === 'string' && imageUrl.length > 0
				? imageUrl
				: attachment?.kind === 'image'
					? attachment.url
					: undefined;

		if ((!message || typeof message !== 'string') && !effectiveImageUrl && !attachment) {
			return json({ error: 'Invalid message' }, { status: 400 });
		}

		// Bruk oppgitt conversationId (verifisert mot bruker) eller hent/opprett standard
		const conversation =
			requestedConversationId && typeof requestedConversationId === 'string'
				? ((await getConversationByIdForUser(requestedConversationId, userId)) ??
					(await getOrCreateConversation(userId)))
				: await getOrCreateConversation(userId);

		// Lagre brukerens melding med imageUrl hvis present
		const savedUserMessage = await addMessage({
			conversationId: conversation.id,
			role: 'user',
			content: message || getDefaultAttachmentLabel(attachment),
			imageUrl: effectiveImageUrl,
			metadata: attachment ? { attachment } : undefined
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
			if (msg.id === savedUserMessage.id) {
				continue;
			}

			if (msg.role === 'user' || msg.role === 'assistant') {
				const messageAttachment = isAttachmentPayload((msg.metadata as { attachment?: unknown } | null | undefined)?.attachment)
					? (msg.metadata as { attachment: AttachmentPayload }).attachment
					: null;
				messages.push({
					role: msg.role,
					content: msg.role === 'user'
						? buildUserMessageForModel(msg.content, messageAttachment)
						: msg.content
				});
			}
		}

		// Legg til siste melding - støtt både tekst og vedlegg
		if (effectiveImageUrl) {
			// Bruk Vision API format
			messages.push({
				role: 'user',
				content: [
					{
						type: 'image_url',
						image_url: { url: effectiveImageUrl }
					},
					{
						type: 'text',
						text: buildUserMessageForModel(
							typeof message === 'string' && message.trim().length > 0
								? message
								: 'Hva ser du på dette bildet, og hva bør vi gjøre videre?',
							attachment
						)
					}
				]
			});
		} else {
			messages.push({
				role: 'user',
				content: buildUserMessageForModel(
					typeof message === 'string' ? message : getDefaultAttachmentLabel(attachment),
					attachment
				)
			});
		}

		// Første kall til OpenAI med tools
		// Bruk gpt-4o når vi har bilder (Vision support)
		let completion = await openai.chat.completions.create({
			model: effectiveImageUrl ? 'gpt-4o' : 'gpt-4o-mini',
			messages,
			tools,
			tool_choice: 'auto',
			temperature: 0.7,
			max_tokens: effectiveImageUrl ? 1500 : 1000 // Mer tokens for bildeanalyse
		});

		let responseMessage = completion.choices[0]?.message;
		let createdGoalId: string | null = null;
		let createdTheme: { id: string; name: string; emoji?: string | null; conversationId?: string | null } | null = null;
		let archivedTheme: { id: string; name: string; emoji?: string | null } | null = null;
		let checklistCreated = false;
		let checklistUpdated = false;
		let widgetProposal: import('$lib/artifacts/widget-draft').WidgetDraft | null = null;
		let statusWidget: import('$lib/ai/tools/weather-forecast').WeatherStatusWidget | null = null;
		let photoAnnotation: import('$lib/ai/tools/annotate-photo').PhotoAnnotationResult | null = null;
		let photoAnnotationImageUrl: string | null = null;

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

		// Håndter tool calls i flere runder slik at modellen kan gjøre oppslag -> beslutning -> endring.
		for (let toolRound = 0; toolRound < 5 && responseMessage?.tool_calls?.length; toolRound += 1) {
			console.log(`\n🔧 Executing tools (round ${toolRound + 1})...`);

			messages.push({
				role: 'assistant',
				content: null,
				tool_calls: responseMessage.tool_calls
			});

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
				} else if (toolCall.type === 'function' && toolCall.function.name === 'web_search') {
					const args = JSON.parse(toolCall.function.arguments) as { query?: string };
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
						const result = await executeWebSearch(searchQuery);
						messages.push({
							role: 'tool',
							content: JSON.stringify(result),
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
							...args
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
				} else if (toolCall.type === 'function' && toolCall.function.name === 'propose_widget') {
					const args = JSON.parse(toolCall.function.arguments);
					console.log('  📊 Proposing widget:', args);
					try {
						const { proposeWidgetTool } = await import('$lib/ai/tools/propose-widget');
						const result = await proposeWidgetTool.execute({ userId, ...args });
						if (result.success) {
							widgetProposal = result.draft;
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
						const existing = await findSimilarWidget(
							userId,
							{
								metricType: args.metricType,
								range: args.range,
								filterCategory: args.filterCategory ?? null
							},
							{ pinnedOnly: true }
						);

						if (existing) {
							console.log('  📊 Widget already exists:', existing.id);
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
								filterCategory: args.filterCategory ?? null,
								unit: args.unit || '',
								color: args.color || '#7c8ef5',
								pinned: args.pinned !== false
							});

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
							await db.insert(checklistItems).values(
								args.items.map((text, i) => ({
									checklistId: checklist.id,
									userId,
									text,
									sortOrder: i
								}))
							);
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

							await db.insert(checklistItems).values(
								itemsToAdd.map((text, index) => ({
									checklistId: checklist.id,
									userId,
									text,
									sortOrder: nextSortOrder + index
								}))
							);

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
				}
			}

			// Ny runde der modellen kan bruke tool-resultatene til flere oppslag eller gi slutt-svar.
			completion = await openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages,
				tools,
				tool_choice: 'auto',
				temperature: 0.7,
				max_tokens: 1000
			});

			responseMessage = completion.choices[0]?.message;
		}

		const finalMessage = responseMessage?.content || 'Beklager, jeg fikk ikke generert noe svar.';
		const assistantMetadata: Record<string, unknown> = {};
		if (createdGoalId) assistantMetadata.goalId = createdGoalId;
		if (widgetProposal) assistantMetadata.widgetProposal = widgetProposal;
		if (statusWidget) assistantMetadata.statusWidget = statusWidget;
		if (photoAnnotation) assistantMetadata.photoAnnotation = photoAnnotation;
		if (photoAnnotationImageUrl) assistantMetadata.photoAnnotationImageUrl = photoAnnotationImageUrl;

		// Lagre assistentens svar til database
		await addMessage({
			conversationId: conversation.id,
			role: 'assistant',
			content: finalMessage,
			metadata: Object.keys(assistantMetadata).length > 0 ? assistantMetadata : null
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
			checklistCreated,
			checklistUpdated,
			checklistChanged: checklistCreated || checklistUpdated,
			widgetProposal,
			statusWidget,
			photoAnnotation,
			photoAnnotationImageUrl,
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
