/**
 * Hovedchattens verktøy — definisjonene, aldri utførelsen.
 *
 * ## Hvorfor dette bor for seg
 *
 * Lista lå inline i `routes/api/chat/+server.ts` fram til oktober 2026, i en fil
 * på 4 700 linjer. Det gjorde den umulig å importere for noen andre enn ruta:
 * Stemmegaffel (`resonans-lab/stemmegaffel`), som måler modeller mot det
 * Resonans faktisk sender, måtte måle verktøyvalg mot tretten egne
 * stedfortredere — og et verktøyvalg målt mot andre verktøy er ikke en måling
 * av det chatten gjør.
 *
 * `chat-tools.json` ved siden av er den samme lista som ren data, skrevet av
 * `tools.test.ts`. Den finnes fordi flere oppføringer leser feltene fra
 * verktøymodulene, og modulene drar med seg databasen: laben kan lese JSON-en
 * uten å ta inn noe av det. Endrer du et verktøy, oppdater fila med
 * `npx vitest run src/lib/server/chat/tools.test.ts -u` — testen feiler ellers,
 * og det er hele poenget: en kopi som kan drive uten at noe blir rødt, er
 * nettopp det `openAiFunctionDefinition` finnes for å unngå.
 *
 * Nye verktøy legges HER, og må i tillegg ha en gruppe i `TOOL_GROUP_MAP`
 * (`$lib/domain/ai/tool-selection.ts`). Utførelsen bor fortsatt i ruta.
 */
import { bookResearchToolDefinition } from '$lib/ai/tools/book-research';
import { createGoalTool } from '$lib/ai/tools/create-goal';
import { filmResearchToolDefinition } from '$lib/ai/tools/film-research';
import { logHungerTool } from '$lib/ai/tools/log-hunger';
import { logNutritionTool } from '$lib/ai/tools/log-nutrition';
import { logSleepDisturbanceTool } from '$lib/ai/tools/log-sleep-disturbance';
import { manageNutritionTargetsTool } from '$lib/ai/tools/manage-nutrition-targets';
import { manageWeightMeasurementTool } from '$lib/ai/tools/manage-weight-measurement';
import { queryEgenfrekvensTool } from '$lib/ai/tools/query-egenfrekvens';
import { queryMovementTool } from '$lib/ai/tools/query-movement';
import { queryNutritionTool } from '$lib/ai/tools/query-nutrition';
import { querySleepTool } from '$lib/ai/tools/query-sleep';
import { queryTrainingTool } from '$lib/ai/tools/query-training';
import { queryWeightTool } from '$lib/ai/tools/query-weight';
import { updateGoalTool } from '$lib/ai/tools/update-goal';
import { PARENT_THEME_SUGGESTIONS } from '$lib/domain/health-subthemes';
import { LIVSKOMPASS_DIMENSION_IDS } from '$lib/domains/livskompass/dimensions';
import { openAiFunctionDefinition } from '$lib/server/assistant/tool-schema';

export const CHAT_TOOLS = [
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
	/**
	 * Generert fra verktøymodulen, ikke skrevet av.
	 *
	 * Blokka her var en håndskrevet kopi, og kopien drev fra originalen: da
	 * `create_goal` fikk `targetWeightKg` og beskjed om at vektmål oppgis som en
	 * MÅLVEKT, sto det fortsatt «-3 for kg ned» her. Modellen fulgte kopien, sendte en
	 * endring, og et mål brukeren hadde sagt «til 95 kg» om siktet mot 93. Se
	 * `$lib/server/assistant/tool-schema.ts`.
	 */
	openAiFunctionDefinition(createGoalTool),
	{
		type: 'function' as const,
		function: {
			name: updateGoalTool.name,
			description: updateGoalTool.description,
			parameters: {
				type: 'object',
				properties: {
					goalId: {
						type: 'string',
						description: 'UUID-en til målet, fra lista over aktive mål. Aldri tittel eller nummer.'
					},
					action: {
						type: 'string',
						enum: ['adjust_target', 'set_deadline', 'pause', 'resume', 'complete', 'abandon'],
						description: 'Hva som skal endres'
					},
					targetValue: {
						type: 'number',
						description: 'Ny målverdi (adjust_target). For vektmål: MÅLVEKTEN i kg.'
					},
					targetDate: {
						type: 'string',
						description: 'Ny frist YYYY-MM-DD (set_deadline).'
					}
				},
				required: ['goalId', 'action']
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
			description: 'Registrer en tradisjonell aktivitet/trening med målbare verdier (løp, styrketrening, date osv). IKKE bruk denne for vaner/mål som er koblet til tracking series (f.eks. mikroyoga, skjermtid) — bruk record_tracking_event for disse. Aktiviteten kobles automatisk til relevante oppgaver uten tracking series.',
			parameters: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						description: 'Type aktivitet. Format: kategori_spesifikk (f.eks: workout_run, workout_strength, relationship_date, life_admin_errands)',
						examples: ['workout_run', 'workout_strength', 'relationship_date', 'life_admin_errands']
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
									description: 'Type måling (f.eks: distance, quality_rating, energy_level)'
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
			name: logSleepDisturbanceTool.name,
			description: logSleepDisturbanceTool.description,
			parameters: logSleepDisturbanceTool.parameters
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'log_nap',
			description:
				'Registrer en powernap/hvil på dagtid — «tok en powernap», «hvilte en halvtime i ettermiddag», «la meg nedpå i stad». Kall verktøyet én gang per hvil (to hvileøkter = to kall). Bruk time når brukeren oppgir omtrentlig tidspunkt; utelat hvis hvilen nettopp ble avsluttet.',
			parameters: {
				type: 'object',
				properties: {
					durationMinutes: {
						type: 'number',
						description: 'Varighet i minutter (5–180). Anslå 20 hvis brukeren ikke sier noe.'
					},
					time: {
						type: 'string',
						description: 'Starttidspunkt i dag som HH:MM lokal tid (f.eks. "14:30"). Utelat hvis hvilen nettopp ble avsluttet.'
					},
					note: {
						type: 'string',
						description: 'Kort notat, f.eks. hvorfor («sliten etter dårlig natt»)'
					}
				},
				required: ['durationMinutes']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'log_chore',
			description:
				'Logg en gjennomført husarbeids-oppgave og hvem som gjorde den — «jeg tok oppvasken», «kona støvsuget stua». Brukes til å følge fordelingen av husarbeid mot 50/50. Kall verktøyet én gang per oppgave.',
			parameters: {
				type: 'object',
				properties: {
					task: {
						type: 'string',
						description: 'Kort beskrivelse, f.eks. «oppvask», «støvsuge stua», «klesvask»'
					},
					doneBy: {
						type: 'string',
						enum: ['meg', 'partner'],
						description: '«meg» = brukeren selv, «partner» = ektefelle/samboer'
					},
					minutes: {
						type: 'number',
						description: 'Anslått tidsbruk i minutter (valgfritt)'
					}
				},
				required: ['task', 'doneBy']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'log_parent_time',
			description:
				'Logg fokusert tid med ett barn — «leste en halvtime med Emma», «fotball med Noah i to timer». Kall verktøyet én gang per barn. Brukes til foreldretid-mål og ukesoversikt.',
			parameters: {
				type: 'object',
				properties: {
					childName: {
						type: 'string',
						description: 'Barnets fornavn, f.eks. «Emma»'
					},
					minutes: {
						type: 'number',
						description: 'Antall minutter fokusert tid'
					},
					activity: {
						type: 'string',
						description: 'Kort hva dere gjorde, f.eks. «lesing», «fotball» (valgfritt)'
					}
				},
				required: ['childName', 'minutes']
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
						// NB: ingen enum. Den utelot «Hjem» og «Familie» — de to
						// mortemaene som faktisk finnes i koden — og blokkerte
						// dermed AI-en fra å opprette hus-prosjekter og ferier.
						description: `Overordnet kategori. Mortemaer som eier undertemaer i dag: "${PARENT_THEME_SUGGESTIONS.join('", "')}". Andre kategorier er lov.`
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
			description: 'Rå helsedata og aggregater fra Withings — antall økter, distanser, skritt, enkeltmålinger. ALDRI oppgi data fra hukommelsen; hent live. VIKTIG: Bruk "metric"-parameteren for å kun hente det brukeren spør om (f.eks. metric="workouts" for løping, metric="weight" for vekt). Bruk "latest" for nyeste uke, "trend" for flere perioder, "period_summary" for én periode, "raw_events" for detaljerte målinger. Hvis bruker spør "fra 2017", "siden 2017" eller annet startår: send periodKey med startåret (f.eks. "2017") for trend. Hvis verktøyet ikke finner data: svar med manglende data og neste steg, IKKE estimer eller finn på tall.\n\nMEN — for undertemaenes egne beregnede tall finnes egne verktøy, og de svarer på et annet spørsmål enn dette: BELASTNING/effort/form/restitusjon/pulsfall/VO2max → query_training. VEKTTREND/milepæler/kroppssammensetning → query_weight. FJERNE/SLETTE en enkelt vektmåling som er feil → manage_weight_measurement (dette verktøyet er kun lesing og kan ikke slette noe). SØVNKVALITET/sovepuls/HRV/forstyrrelser → query_sleep. Hvordan brukeren HAR HATT DET (balanse, overskudd, stress, innsjekk) → query_egenfrekvens. De fire gir de samme tallene brukeren ser på flatene; dette verktøyet gir råmaterialet under dem.',
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
						description: 'Spesifikk periode (f.eks: "2025W43", "2025M10", "2025"). For trend med historisk start (f.eks. "fra 2017"), sett periodKey til startåret.'
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
	/**
	 * Undertemaenes beregnede lag. Beskrivelsene bor på verktøymodulene, så chatten og
	 * Ekko-assistenten (shared-tools.ts) presenterer dem likt — de har drevet fra
	 * hverandre før, og en modell som får ulike instrukser på to flater oppfører seg
	 * ulikt uten at noen ser hvorfor.
	 */
	{
		type: 'function' as const,
		function: {
			name: queryTrainingTool.name,
			description: queryTrainingTool.description,
			parameters: {
				type: 'object',
				properties: {
					queryType: {
						type: 'string',
						enum: ['load', 'balance', 'capacity', 'sessions', 'plan'],
						description: 'Hvilket utsnitt. Default load.'
					}
				}
			}
		}
	},
	openAiFunctionDefinition(queryWeightTool),
	openAiFunctionDefinition(queryMovementTool),
	{
		type: 'function' as const,
		function: {
			name: manageWeightMeasurementTool.name,
			description: manageWeightMeasurementTool.description,
			parameters: {
				type: 'object',
				properties: {
					action: {
						type: 'string',
						enum: ['find', 'delete'],
						description: 'find først, alltid. delete krever id fra et find-svar.'
					},
					date: {
						type: 'string',
						description: 'YYYY-MM-DD. Kun for find. Utelates for de mistenkelige målingene.'
					},
					id: {
						type: 'string',
						description: 'Målingens id, fra et find-svar. Påkrevd for delete.'
					}
				},
				required: ['action']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: querySleepTool.name,
			description: querySleepTool.description,
			parameters: {
				type: 'object',
				properties: {
					queryType: {
						type: 'string',
						enum: ['recent', 'physiology', 'disturbances'],
						description: 'Hvilket utsnitt. Default recent.'
					}
				}
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: queryEgenfrekvensTool.name,
			description: queryEgenfrekvensTool.description,
			parameters: {
				type: 'object',
				properties: {
					queryType: {
						type: 'string',
						enum: ['recent', 'trend', 'latest'],
						description: 'Hvilket utsnitt. Default recent.'
					},
					days: { type: 'number', description: 'Dager tilbake (default 30, maks 90)' }
				}
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'query_tesla_vehicle',
			description: 'Hent gjeldende tilstand for brukerens Tesla: batteriprosent, rekkevidde, ladestatus, posisjon, kilometerstand, lås og innetemperatur. Bruk ved spørsmål om bil/elbil/lading/batteri/rekkevidde/hvor bilen står. Leser ferskeste lagrede data; sett forceLive=true kun når brukeren eksplisitt vil ha live-status NÅ (kan vekke bilen).',
			parameters: {
				type: 'object',
				properties: {
					forceLive: {
						type: 'boolean',
						description: 'Hent ferskt øyeblikksbilde direkte fra Tesla (kan vekke bilen). Default false = les lagrede data.'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'record_tracking_event',
			description: 'Generisk registrering av vaner/aktiviteter/målinger i tracking-systemet. Bruk denne i stedet for hardkodede record_* tools. Kan opprette ny serie ved første registrering eller bruke eksisterende seriesId/taskId ved senere registreringer. Systemet finner automatisk eksisterende serie for recordTypeKey hvis seriesId ikke oppgis.',
			parameters: {
				type: 'object',
				properties: {
					seriesId: {
						type: 'string',
						description: 'Valgfritt: eksisterende tracking-serie-ID. Bruk når registrering skal knyttes til en kjent serie.'
					},
					taskId: {
						type: 'string',
						description: 'Valgfritt: task-ID som serien skal kobles til. Bruk dette rett etter create_task for å knytte tracking-serien til oppgaven. Gjør at registreringer automatisk teller fremgang på ukemål-siden.'
					},
					taskTitle: {
						type: 'string',
						description: 'Valgfritt: task-tittel fra dagsplan/ukeplan (f.eks. "mikroyoga"). Brukes som fallback for å finne riktig oppgave når taskId ikke er kjent.'
					},
					recordTypeKey: {
						type: 'string',
						description: 'Nøkkel for registreringstype, f.eks. mikroyoga, screen_time, mood. Bruk lowercase med underscore. Systemet gjenbruker eksisterende serie for samme nøkkel.'
					},
					recordTypeLabel: {
						type: 'string',
						description: 'Lesbart navn for typen, brukes ved første opprettelse.'
					},
					kind: {
						type: 'string',
						enum: ['activity', 'measurement'],
						description: 'Om registreringen primært er en aktivitet eller måling.'
					},
					date: {
						type: 'string',
						description: 'Dato for registreringen (ISO format: YYYY-MM-DD)'
					},
					note: {
						type: 'string',
						description: 'Valgfri kontekst/merknad.'
					},
					measurements: {
						type: 'array',
						description: 'Liste over målinger knyttet til registreringen, f.eks. reps/minutter/score.',
						items: {
							type: 'object',
							properties: {
								key: { type: 'string' },
								value: {
									oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }]
								},
								unit: { type: 'string' }
							},
							required: ['key', 'value']
						}
					},
					autoCreateSeries: {
						type: 'boolean',
						description: 'Om ny serie skal opprettes automatisk hvis ingen eksisterer.'
					},
					createSeriesOnly: {
						type: 'boolean',
						description: 'Hvis true opprettes eller kobles kun tracking-serien, uten at det registreres en gjennomføring for i dag. Bruk denne når et mål settes opp første gang.'
					},
					title: {
						type: 'string',
						description: 'Tittel for serien ved første opprettelse.'
					},
					themeId: {
						type: 'string',
						description: 'Valgfri tema-ID for serien.'
					},
					autoRegister: {
						type: 'boolean',
						description: 'Skal denne serien kunne auto-registreres av triage neste gang?'
					},
					confirmationPolicy: {
						type: 'string',
						enum: ['always', 'low_confidence_only', 'never']
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'record_screen_time',
			description: 'Tolk og lagre et iOS Skjermtid-skjermbilde brukeren har lastet opp. Bruk denne når brukeren sender et skjermbilde fra «Skjermtid» (Uke- eller Dag-fane). Systemet kjenner igjen om det er et uke- eller dagsbilde, henter ut tall (total skjermtid, kategorier inkl. sosiale medier/«scrolling», topp-apper og fordeling per time) og lagrer det som helse-sensordata. Bildet hentes automatisk fra den vedlagte meldingen.',
			parameters: {
				type: 'object',
				properties: {
					imageUrl: {
						type: 'string',
						description: 'Valgfritt: URL til skjermbildet. Utelat for å bruke bildet i gjeldende melding.'
					},
					captureType: {
						type: 'string',
						enum: ['weekly', 'daily', 'auto'],
						description: 'Hint om bildetype. Bruk auto (default) for å la systemet avgjøre.'
					},
					weekStartISO: {
						type: 'string',
						description: 'Valgfritt for ukesbilde: mandag i den aktuelle uken (YYYY-MM-DD). Default forrige uke.'
					},
					dateISO: {
						type: 'string',
						description: 'Valgfritt for dagsbilde: datoen bildet gjelder (YYYY-MM-DD). Default leses fra bildet.'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'query_reflections',
			description:
				"Hent brukerens lagrede refleksjoner og samtale-transkripter i FULLTEKST. Oppsummeringene i konteksten er indeks — bruk dette når du trenger brukerens egne ord: hele livsintervjuet (kind 'livsintervju_chat'), Balanse-materialet ('livsintervju_kilde' — rått kildemateriale fra tidligere dype samtaler), retningssamtalene ('retningssamtale'), selvangivelsen ('birthday_interview_chat'), eller andre refleksjoner ('day_close', 'week_review', 'month_review'). SEMANTISK SØK: sett 'query' til et tema/spørsmål for å finne de mest relevante refleksjonene på tvers av typer — bruk dette når du ikke vet hvilken kind svaret bor i. Typisk når brukeren spør «hva sa jeg egentlig om …» eller du vil sitere presist i stedet for å parafrasere.",
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description:
							'Semantisk søk: tema eller spørsmål («trening og motivasjon») — mest relevante først, på tvers av typer. Utelat for nyeste.'
					},
					kind: {
						type: 'string',
						description:
							"Refleksjonstype, f.eks. 'livsintervju_chat', 'livsintervju', 'livsintervju_kilde', 'retningssamtale', 'retningsgap', 'birthday_interview_chat', 'week_review'. Utelat for alle typer."
					},
					periodKey: {
						type: 'string',
						description: "Periode, f.eks. '2026' (år) eller '2026-Q3' (kvartal). Utelat for nyeste."
					},
					limit: {
						type: 'number',
						description: 'Antall refleksjoner (default 3, maks 10)'
					}
				},
				required: []
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'query_writing',
			description:
				"Les brukerens skriveprosjekter og dokumenter (skjønnlitteratur, dikt, notatblokk). queryType 'projects' = oversikt med ordtelling og skrivestreak («hvor langt har jeg kommet»). 'documents' = dokumentliste nyeste først («hva skrev jeg sist»). 'search' = semantisk søk i teksten («hvem er Ida», «hva har jeg om havna»). AVGRENSNING: dette dekker tekst brukeren REDIGERER og kommer tilbake til. Dagsnotater, feriedagbok, livsintervju og refleksjoner er query_reflections. Oppskrifter, ukemeny og lager er query_food.",
			parameters: {
				type: 'object',
				properties: {
					queryType: {
						type: 'string',
						enum: ['projects', 'documents', 'search'],
						description: "'projects' | 'documents' | 'search'"
					},
					query: {
						type: 'string',
						description: "Søketekst for queryType 'search'. Treffer også omskrivinger."
					},
					projectId: {
						type: 'string',
						description: 'Avgrens til ett prosjekt. Utelat for frie notater i notatblokka.'
					},
					kind: {
						type: 'string',
						description:
							'Dokumenttype: scene, kapittel, karakter, sted, notat, dikt, liste, transkripsjon.'
					},
					limit: { type: 'number', description: 'Antall (default 5, maks 20)' }
				},
				required: ['queryType']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
					name: 'query_economics',
					description: 'Hent økonomisk data fra tilkoblede bankkontoer. Brukes for saldo, transaksjoner, forbruk per måned og kontoliste.\n\nqueryType:\n- balance: Hent kontosaldo\n- transactions: Hent enkelt-transaksjoner (krever month eller dateRange)\n- spending_summary: Hent forbruk gruppert per kategori (krever month eller payPeriod). Kan filtreres til én kategori med "category".\n- category_trend: Hent månedlige totaler for ÉN kategori over et dato-spenn (krever dateRange + category). BRUK DETTE når bruker ber om månedlig utvikling for én kategori, f.eks. "dagligvare per måned".\n- account_list: List alle tilkoblede kontoer\n\nFor spørsmål om lønnsmåned/siden lønn: bruk payPeriod="current".',
					parameters: {
						type: 'object',
						properties: {
							queryType: {
								type: 'string',
								description: 'Type økonomi-spørring',
								enum: ['balance', 'transactions', 'spending_summary', 'category_trend', 'account_list']
							},
							month: {
								type: 'string',
								description: 'Måned i format YYYY-MM, for eksempel 2026-01'
							},
							payPeriod: {
								type: 'string',
								description: 'Bruk "current" for inneværende lønnsmåned (fra siste lønnsdag til i dag).',
								enum: ['current']
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
							category: {
								type: 'string',
								description: 'Normalisert kategori-ID for filtrering. Eksempler: "dagligvarer", "kafe_og_restaurant", "bil_og_transport", "helse_og_velvaere", "faste_boutgifter", "forsikring", "sparing", "reise", "medier_og_underholdning". Brukes med spending_summary og category_trend.'
							},
							filterCategory: {
								type: 'string',
								description: 'Valgfri kategori (alias for category), f.eks. dagligvarer, kafe_og_restaurant, bil_og_transport'
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
					name: 'query_family',
					description: 'Hent familie-/relasjonsdata: alle personer, relasjoner, eller detaljert info om én person (memories, åpne mål, kommende events, mentions). queryType: persons | relations | person_detail (krever personId) | find_by_name (krever name).',
					parameters: {
						type: 'object',
						properties: {
							queryType: { type: 'string', enum: ['persons', 'relations', 'person_detail', 'find_by_name'] },
							personId: { type: 'string' },
							name: { type: 'string' },
							kind: { type: 'string' },
							limit: { type: 'number' }
						},
						required: ['queryType']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_person',
					description: 'Opprett, oppdater eller arkiver en person. Bruk suggest_create FØR create når personen kun er nevnt i samtale. action=create krever name. action=update/archive krever personId.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['suggest_create', 'create', 'update', 'archive'] },
							personId: { type: 'string' },
							name: { type: 'string' },
							fullName: { type: 'string' },
							nickname: { type: 'string' },
							birthDate: { type: 'string', description: 'YYYY-MM-DD' },
							kind: { type: 'string', enum: ['child', 'partner', 'parent', 'sibling', 'in_law', 'extended_family', 'friend', 'colleague', 'self', 'other'] },
							avatarEmoji: { type: 'string' },
							notes: { type: 'string' },
							spondGroupIds: { type: 'array', items: { type: 'string' } },
							emailAddresses: { type: 'array', items: { type: 'string' } },
							aliases: { type: 'array', items: { type: 'string' } }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_relation',
					description: 'Opprett eller slett relasjon mellom to personer. relationType: family|friend|work. fromPersonId=null betyr selv (brukeren).',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['create', 'delete'] },
							relationId: { type: 'string' },
							fromPersonId: { type: 'string' },
							toPersonId: { type: 'string' },
							relationType: { type: 'string', enum: ['family', 'friend', 'work'] },
							subType: { type: 'string', enum: ['parent_of', 'child_of', 'married_to', 'partnered_with', 'sibling_of', 'in_law_of', 'friend_of', 'colleague_of'] },
							closeness: { type: 'number', minimum: 1, maximum: 5 },
							notes: { type: 'string' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'query_home',
					description: 'Hent hus/hjem-data: aktive hus-prosjekter med burn-up + budsjett, sesong-oppgaver, husarbeids-rutiner og siste apparat-events. queryType: overview | projects | seasonal_tasks | routines | appliance_events.',
					parameters: {
						type: 'object',
						properties: {
							queryType: { type: 'string', enum: ['overview', 'projects', 'seasonal_tasks', 'routines', 'appliance_events'] },
							seasonOnly: { type: 'boolean' },
							limit: { type: 'number' }
						},
						required: ['queryType']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_project',
					description: "Opprett, oppdater, fullfør eller avbryt et prosjekt (domen-agnostisk). For hus-prosjekter, sett domain='home' og type='renovation'|'maintenance'|'repair'|'organize'. Legg rom og andre detaljer i metadata. Eksempel: { action:'create', domain:'home', type:'renovation', title:'Pusse opp baderom', budgetNok:80000, metadata:{ room:'bathroom' } }.",
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['create', 'update', 'complete', 'cancel'] },
							projectId: { type: 'string' },
							domain: { type: 'string' },
							themeId: { type: 'string' },
							title: { type: 'string' },
							description: { type: 'string' },
							type: { type: 'string' },
							status: { type: 'string', enum: ['planning', 'active', 'paused', 'done', 'cancelled'] },
							budgetNok: { type: 'number' },
							startedAt: { type: 'string', description: 'ISO date' },
							targetCompletionAt: { type: 'string', description: 'ISO date' },
							metadata: { type: 'object' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_project_tasks',
					description: "Styr oppgavelista til et hus-prosjekt (tema-undertema av Hjem). Bruk når brukeren snakker om hva som må gjøres i prosjektet. action: 'create' (ny oppgave/underoppgave), 'update' (endre tekst/frist/estimat/avhengigheter), 'check' (kryss av/gjenåpne), 'delete'. themeId er prosjektets tema-id (oppgitt i PROSJEKTOPPGAVER-konteksten). Underoppgave: sett parentId. INNKJØP: sett shopping=true og store=butikknavn, og la text være kun varen (f.eks. text='aluminiumslister', store='Maxbo'). AVHENGIGHET: «A må gjøres før B». Hvis A er NY: opprett A i ÉN kall med blocksItemIds=[B.id] (da blokkeres B av A automatisk). Hvis begge finnes: update B med blockedBy=[A.id]. blockedBy peker på id-er som må fullføres FØRST. VIKTIG: når brukeren sier «A før B», sett ALDRI blockedBy på A — da blir retningen feil. A blokkerer B, så B.blockedBy=[A] (eller bruk blocksItemIds på A). itemId/parentId/blockedBy bruker id-ene fra PROSJEKTOPPGAVER-konteksten.",
					parameters: {
						type: 'object',
						properties: {
							themeId: { type: 'string', description: 'Prosjektets tema-id' },
							action: { type: 'string', enum: ['create', 'update', 'check', 'delete'] },
							itemId: { type: 'string', description: 'Oppgave-id (for update/check/delete)' },
							text: { type: 'string', description: "Oppgavetekst. Innkjøp: 'kjøp: X på [butikk]'" },
							parentId: { type: 'string', description: 'Forelder-oppgavens id (for underoppgave)' },
							shopping: { type: 'boolean', description: 'true hvis dette skal kjøpes' },
							store: { type: 'string', description: 'Butikknavn for innkjøp, f.eks. Maxbo' },
							dueDate: { type: 'string', description: 'Frist YYYY-MM-DD' },
							estimateMinutes: { type: 'number', description: 'Estimat i minutter (60=1t, 480=1 dag)' },
							blockedBy: { type: 'array', items: { type: 'string' }, description: 'Id-er som må fullføres FØRST denne' },
							blocksItemIds: { type: 'array', items: { type: 'string' }, description: 'Id-er som må vente på DENNE (denne gjøres først). «A før B»: opprett A med blocksItemIds=[B.id].' },
							checked: { type: 'boolean', description: 'true=kryss av, false=gjenåpne' }
						},
						required: ['themeId', 'action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_project_contacts',
					description: "Styr kontaktlista til et kommunikasjons-/arrangement-prosjekt (tema-undertema av Hjem). Bruk når prosjektet handler om å følge opp folk: samle kontaktinfo, sette oppfølgingsdato (purredato) og registrere status. action: 'create' (ny kontakt), 'update' (endre felter/status/oppfølging), 'delete', 'list' (hent alle). themeId er prosjektets tema-id (oppgitt i PROSJEKTKONTAKTER-konteksten). status: 'todo' (ikke kontaktet), 'venter' (venter på svar), 'ferdig' (avklart). followUpAt (YYYY-MM-DD) driver purre-nudgen: forfalte kontakter som ikke er 'ferdig' varsles. Selve e-postene/samtalene formulerer du i chatten — dette verktøyet lagrer kontaktene og oppfølgingen.",
					parameters: {
						type: 'object',
						properties: {
							themeId: { type: 'string', description: 'Prosjektets tema-id' },
							action: { type: 'string', enum: ['create', 'update', 'delete', 'list'] },
							contactId: { type: 'string', description: 'Kontakt-id (for update/delete)' },
							name: { type: 'string', description: 'Navn på kontakten' },
							role: { type: 'string', description: 'Rolle, f.eks. Rørlegger, Nabo, Leverandør' },
							phone: { type: 'string', description: 'Telefonnummer' },
							email: { type: 'string', description: 'E-postadresse' },
							status: { type: 'string', enum: ['todo', 'venter', 'ferdig'] },
							notes: { type: 'string', description: 'Fritt notat om kontakten' },
							followUpAt: { type: 'string', description: 'Oppfølging/purredato YYYY-MM-DD' }
						},
						required: ['themeId', 'action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_training_program',
					description: "Forklar og ENDRE brukerens adaptive treningsprogram direkte når brukeren foreslår justeringer (typisk etter et varsel om at planen ble rekalkulert). Ring ALLTID action='get' først for å se uker, økter (med sessionId) og siste automatiske justeringer — bruk det til å forklare hva som endret seg og hvorfor, og til å finne riktig sessionId. Deretter: 'move_session' (flytt økt til annen ukedag, dayNumber 1=man..7=søn), 'set_pace' (sett tempo i sek/km på én økt via sessionId, eller alle fremtidige av en runType), 'scale_volume' (skaler distanse/varighet, factor f.eks. 0.9=−10% eller 1.1=+10%, for én weekNumber eller fra fromWeek og fremover), 'set_preference' (varige føringer som den ukentlige automatiske justeringen respekterer: pinnedDays=ukedager løp ikke skal flyttes fra, lockPace=lås tempoet, volumeBias=ønsket volumnivå 0.5–1.5, note=fri føring). programId er valgfri — utelat den for brukerens aktive program. Bekreft konkrete endringer med brukeren før du gjør dem hvis det er tvil.",
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['get', 'move_session', 'set_pace', 'scale_volume', 'set_preference'] },
							programId: { type: 'string', description: 'Valgfri — utelat for aktivt program' },
							sessionId: { type: 'string', description: 'Økt-id fra get (for move_session/set_pace)' },
							newDay: { type: 'number', description: 'Ny ukedag 1=man..7=søn (move_session)' },
							paceSecPerKm: { type: 'number', description: 'Tempo i sekunder per km (set_pace), f.eks. 330 = 5:30/km' },
							runType: { type: 'string', enum: ['easy', 'tempo', 'intervals', 'long'], description: 'For set_pace på alle fremtidige av denne typen' },
							factor: { type: 'number', description: 'Volumfaktor (scale_volume), 0.5–1.5' },
							weekNumber: { type: 'number', description: 'Skaler kun denne uka (scale_volume)' },
							fromWeek: { type: 'number', description: 'Gjelder fra og med denne uka og fremover' },
							pinnedDays: { type: 'array', items: { type: 'number' }, description: 'Ukedager (1-7) der løp ikke skal flyttes (set_preference)' },
							lockPace: { type: 'boolean', description: 'Lås tempoet mot auto-rekalkulering (set_preference)' },
							volumeBias: { type: 'number', description: 'Ønsket volumnivå 0.5–1.5 (set_preference)' },
							note: { type: 'string', description: 'Fri føring coachen noterer (set_preference)' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'query_projects',
					description: 'List prosjekter med burn-up + kost-vs-budsjett. Filter på domain, status, themeId, eller søk i tittel. Bruk dette for å finne projectId før manage_project.update/complete eller link_to_project.',
					parameters: {
						type: 'object',
						properties: {
							domain: { type: 'string' },
							status: { type: 'string', enum: ['planning', 'active', 'paused', 'done', 'cancelled'] },
							themeId: { type: 'string' },
							searchTitle: { type: 'string' },
							projectId: { type: 'string' }
						}
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'link_to_project',
					description: 'Koble eksisterende oppgaver, sjekklist-items eller transaksjoner til et prosjekt (action=attach), eller fjern koblingen (action=detach). Linkede items teller mot burn-up; linkede transaksjoner teller mot kost-vs-budsjett. Bekreft med bruker før du kobler transaksjoner.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['attach', 'detach'] },
							entity: { type: 'string', enum: ['task', 'checklist_item', 'transaction'] },
							entityIds: { type: 'array', items: { type: 'string' } },
							projectId: { type: 'string' }
						},
						required: ['action', 'entity', 'entityIds']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_procedure',
					description: 'Opprett, oppdater eller slett en fremgangsmåte/oppskrift (prosedyre for hverdagsoppgaver, IKKE mat-oppskrifter). action=suggest_save for å foreslå lagring etter relevant samtale. action=create for å faktisk lagre. Bruk triggerKeywords for matching mot fremtidige oppgaver.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['create', 'update', 'delete', 'suggest_save'] },
							id: { type: 'string' },
							title: { type: 'string' },
							summary: { type: 'string', description: 'Markdown-formatert fremgangsmåte/forklaring' },
							steps: { type: 'array', items: { type: 'string' }, description: 'Sjekkliste-trinn i rekkefølge' },
							domain: { type: 'string', enum: ['health', 'economics', 'food', 'family', 'self', 'home'] },
							themeId: { type: 'string' },
							conversationId: { type: 'string' },
							triggerKeywords: { type: 'array', items: { type: 'string' }, description: 'Nøkkelord for å matche mot oppgaver, f.eks. ["stryke", "skjorte", "bøye"]' },
							emoji: { type: 'string' },
							shared: { type: 'boolean' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_day_tasks',
					description: 'Legg punkter i en bestemt dags oppgaveliste (dagslisten på forsiden). Bruk når brukeren vil huske noe på en konkret dato — turer, "ha med"-ting, frister, avtaler. Sett personName for å knytte punktet til riktig barn/person. Skriv teksten naturlig og selvforklarende.',
					parameters: {
						type: 'object',
						properties: {
							items: {
								type: 'array',
								description: 'Punktene som skal legges til',
								items: {
									type: 'object',
									properties: {
										text: { type: 'string', description: 'Selvforklarende punkttekst, uten personnavn' },
										dayIso: { type: 'string', description: 'Dagen punktet vises på, YYYY-MM-DD' },
										dueDate: { type: 'string', description: 'Valgfri hard frist, YYYY-MM-DD' },
										personName: { type: 'string', description: 'Navn på person punktet gjelder' }
									},
									required: ['text', 'dayIso']
								}
							}
						},
						required: ['items']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_home_routine',
					description: "Opprett en hus-rutine — checklist med context='home_routine'. Eksempler: ukentlig vaskerutine, sesong-oppgaver, klesvask-rotasjon. Knytt til prosjekt via projectId hvis relevant.",
					parameters: {
						type: 'object',
						properties: {
							title: { type: 'string' },
							emoji: { type: 'string' },
							items: { type: 'array', items: { type: 'string' } },
							projectId: { type: 'string' }
						},
						required: ['title', 'items']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_routine',
					description: 'Administrer brukerens rutiner — faste, gjentakende grupper av små handlinger knyttet til ukedag og tidspunkt. Eksempler: "Lørdag morgen" (støvsuge, vaske bad), "Hverdagskveld" (matpakker, rydde kjøkken), "Morgen" (vann, yoga). Dagens rutiner materialiseres automatisk som checklists og vises på hjemskjermen. action=list/create/update/delete. slot styrer tidspunkt på dagen. daysOfWeek bruker 0=søndag..6=lørdag.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
							id: { type: 'string' },
							title: { type: 'string' },
							emoji: { type: 'string' },
							slot: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'flex'] },
							daysOfWeek: {
								type: 'array',
								items: { type: 'integer', minimum: 0, maximum: 6 },
								description: '0=søndag, 1=mandag, ..., 6=lørdag. F.eks. [6] = lørdag, [1,2,3,4,5] = hverdager.'
							},
							items: {
								type: 'array',
								items: { type: 'string' },
								description: 'Items i rekkefølgen de skal vises.'
							},
							active: { type: 'boolean' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_streak',
					description: 'Administrer brukerens streaks — «hvor mange runder på rad har jeg holdt?». rule=consecutive_days for dager på rad (yoga, lett styrke). rule=count_per_window for perioder over en terskel (config.windowDays 7 + config.threshold 2 = «uker på rad med minst to løpeturer»). rule=max_interval for periodisk vedlikehold innen et intervall (config.intervalDays 5 = «hårklipp innen fem dager», 14 = «badevask innen to uker»). Vedlikehold løftes automatisk fram på ukeplanen når det nærmer seg forfall — ikke lag egne nedtellingsoppgaver for det. source: {kind:"workout",sportFamily} for treningsøkter, {kind:"sensor_event",dataType,textMatch} for sensorhendelser, {kind:"manual"} når brukeren registrerer selv. action=list/create/update/delete/log (log registrerer en gjennomført runde). Pause-toleranse: config.maxGapDays + config.maxGaps lar en rekke overleve korte pauser (ferie/sykdom) — og gjenoppretter en brutt rekke retroaktivt, siden streaks beregnes fra hendelser og ikke har lagret teller. Pausen vises i teksten, den skjules ikke.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['list', 'create', 'update', 'delete', 'log'] },
							id: { type: 'string' },
							title: { type: 'string' },
							emoji: { type: 'string' },
							rule: { type: 'string', enum: ['consecutive_days', 'count_per_window', 'max_interval'] },
							source: {
								type: 'object',
								properties: {
									kind: { type: 'string', enum: ['workout', 'sensor_event', 'manual'] },
									sportFamily: { type: 'string', description: "running, yoga, strength, cycling, walking, swimming" },
									dataType: { type: 'string', description: "f.eks. chore_done" },
									textMatch: { type: 'string', description: 'Fritekst-filter, f.eks. "badevask"' }
								},
								required: ['kind']
							},
							config: {
								type: 'object',
								properties: {
									windowDays: { type: 'integer', description: '7 = kalenderuke' },
									threshold: { type: 'integer', description: 'Hendelser som kreves per periode' },
									intervalDays: { type: 'integer', description: 'Maks dager mellom to runder' },
									dueSoonDays: { type: 'integer', description: 'Varsle så mange dager før forfall' },
									maxGapDays: { type: 'integer', description: 'Hvor lang én pause kan være uten å bryte rekka (0 = ingen toleranse). Kun consecutive_days/count_per_window' },
									maxGaps: { type: 'integer', description: 'Hvor mange pauser som tolereres i rekka. Default 1 når maxGapDays er satt' }
								}
							},
							active: { type: 'boolean' },
							date: { type: 'string', description: "Etterregistrering av runde: 'YYYY-MM-DD'" }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'query_food',
					description: 'Hent mat-data: måltider, ukemeny, pantry/fryserinnhold. queryType: meals (måltidsliste), meal_plan (krever weekContext "YYYY-W##"), pantry (kan filtreres på location), expiring_soon (varer som går ut, krever days).',
					parameters: {
						type: 'object',
						properties: {
							queryType: { type: 'string', enum: ['meals', 'meal_plan', 'pantry', 'expiring_soon'] },
							weekContext: { type: 'string', description: 'ISO-uke, f.eks. "2026-W17"' },
							location: { type: 'string', enum: ['pantry', 'fridge', 'freezer'] },
							days: { type: 'number' },
							limit: { type: 'number' }
						},
						required: ['queryType']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_recipe',
					description: 'Opprett, oppdater eller slett et måltid (navn pluss valgfri oppskrift: ingredienser, instruksjoner, bilde). action=create krever title; ingredients er valgfritt. action=update/delete krever id.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['create', 'update', 'delete'] },
							id: { type: 'string' },
							title: { type: 'string' },
							description: { type: 'string' },
							ingredients: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										name: { type: 'string' },
										quantity: { type: 'number' },
										unit: { type: 'string' },
										optional: { type: 'boolean' }
									},
									required: ['name']
								}
							},
							instructions: { type: 'array', items: { type: 'string' } },
							prepTimeMin: { type: 'number' },
							cookTimeMin: { type: 'number' },
							servings: { type: 'number' },
							tags: { type: 'array', items: { type: 'string' } },
							mainProtein: { type: 'string', description: 'kjøtt/kylling/svin/fisk/torsk/vegetar/egg — la stå tom for retter uten fast protein-struktur' },
							mainCarb: { type: 'string', description: 'pasta/potet/ris/brød/couscous/nudler' },
							greens: { type: 'string', description: 'salat/kokte grønnsaker/rotgrønnsaker osv.' },
							wantMore: { type: 'boolean', description: 'true hvis familien ønsker mer av denne — løftes i forslag' },
							effortLevel: { type: 'string', enum: ['lav', 'middels', 'høy'] },
							imageUrl: { type: 'string' },
							sourceUrl: { type: 'string' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_meal_plan',
					description: 'Legg til, oppdater eller fjern en oppføring i ukemenyen. Knytt til et lagret måltid via mealId, eller send mealName for å auto-opprette en måltidsrad (kun navn) som senere kan utvides med oppskrift via manage_recipe.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['create', 'update', 'delete'] },
							id: { type: 'string' },
							weekContext: { type: 'string', description: 'ISO-uke, f.eks. "2026-W17"' },
							date: { type: 'string', description: 'YYYY-MM-DD' },
							mealType: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
							mealId: { type: 'string' },
							mealName: { type: 'string', description: 'Navn på måltid; auto-opprettes hvis ikke mealId er gitt' },
							notes: { type: 'string' },
							servings: { type: 'number' },
							photoUrl: { type: 'string' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_pantry',
					description: 'Oppdater pantry/fryser/kjøleskap. action: add (krever name+location), update (krever id), remove (krever id), use (krever id, kan oppgi consumeQuantity).',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['add', 'update', 'remove', 'use'] },
							id: { type: 'string' },
							name: { type: 'string' },
							location: { type: 'string', enum: ['pantry', 'fridge', 'freezer'] },
							quantity: { type: 'number' },
							unit: { type: 'string' },
							expiresAt: { type: 'string', description: 'YYYY-MM-DD' },
							notes: { type: 'string' },
							consumeQuantity: { type: 'number' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_lunchbox',
					description: 'Matpakke-hjelperen: dagens forslag per barn (get_suggestions), marker pakket (log_packed), logg retur («Ola hadde med 2 skiver hjem» → log_return med childName+itemName), oppdater preferanser (set_preferences), legg til komponent i biblioteket (add_component), foreslå NYE komponenter (suggest_components — basert på preferanser, bibliotek og retur; presenter og legg til valgte med add_component).',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['get_suggestions', 'log_packed', 'log_return', 'set_preferences', 'add_component', 'suggest_components'] },
							childName: { type: 'string' },
							date: { type: 'string', description: 'YYYY-MM-DD, default i dag' },
							itemName: { type: 'string' },
							quantity: { type: 'number' },
							degree: { type: 'string', enum: ['alt', 'mesteparten', 'noe'] },
							likes: { type: 'array', items: { type: 'string' } },
							dislikes: { type: 'array', items: { type: 'string' } },
							allergies: { type: 'array', items: { type: 'string' } },
							appetite: { type: 'string', enum: ['liten', 'middels', 'stor'] },
							componentName: { type: 'string' },
							componentKind: { type: 'string', enum: ['palegg', 'brod', 'frukt', 'gront', 'notter', 'annet'] },
							instruction: { type: 'string', description: 'Fritekst-ønske for suggest_components, f.eks. «mer frukt»' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'find_recipes',
					description: 'Finn ekte oppskrifter på norske oppskriftssider basert på ingredienser (default: lageret, utløpsvarer prioriteres) og preferanser; barnas allergier ekskluderes automatisk. action=search gir kandidater med URL; action=import henter valgt oppskrift inn i kartoteket. Bruk ved «hva kan jeg lage med …», «finn en oppskrift på …».',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['search', 'import'] },
							query: { type: 'string', description: 'Frisøk, f.eks. "rask fiskemiddag"' },
							ingredients: { type: 'array', items: { type: 'string' } },
							constraints: { type: 'string', description: 'F.eks. "barnevennlig, under 30 min"' },
							maxResults: { type: 'number' },
							url: { type: 'string', description: 'Kandidat-URL for action=import' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'manage_food_settings',
					description: 'Familiens matinnstillinger på husholdningsnivå (ikke per barn): weekRhythmNote (faste ukemønstre og myke føringer som «fredag = taco», «onsdag Oda-dag», «mandager holder vi det enkelt») og ukebudsjett. get leser, set oppdaterer. Kall get først når du legger til én ting, så du bygger videre på eksisterende tekst.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['get', 'set'] },
							weekRhythmNote: { type: 'string', description: 'Full ny ukerytme-tekst (erstatter eksisterende)' },
							groceryBudgetWeekly: { type: 'number', description: 'Ukebudsjett i kr, eller null for å fjerne' }
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'generate_shopping_list',
					description: 'Bygg handleliste fra ukemenyens måltider, minus ingredienser som finnes i pantry. Returnerer dedupliserte items klare for å bli lagt inn i en sjekkliste.',
					parameters: {
						type: 'object',
						properties: {
							weekContext: { type: 'string', description: 'ISO-uke, f.eks. "2026-W17"' },
							includeOptional: { type: 'boolean' }
						},
						required: ['weekContext']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'analyze_meal_image',
					description: 'Analyser et matbilde (Cloudinary-URL) med GPT-4o vision og returner anslag av rett, ingredienser og næringsinnhold per porsjon. Resultatet er et grovt estimat.',
					parameters: {
						type: 'object',
						properties: {
							imageUrl: { type: 'string' },
							servings: { type: 'number' }
						},
						required: ['imageUrl']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: queryNutritionTool.name,
					// Beskrivelsen bor på verktøymodulen. Den var duplisert her, og hadde
					// alt drevet fra originalen: kopien nevnte ikke forbrukskilden,
					// vektkontrollen eller forbruk per dag.
					description: queryNutritionTool.description,
					parameters: {
						type: 'object',
						properties: {
							queryType: { type: 'string', enum: ['today', 'recent'] },
							days: { type: 'number', description: 'Dager for recent (default 7, maks 30)' }
						},
						required: ['queryType']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: logNutritionTool.name,
					description: logNutritionTool.description,
					parameters: logNutritionTool.parameters
				}
			},
			{
				type: 'function' as const,
				function: {
					name: logHungerTool.name,
					description:
						'Registrer hvor sulten brukeren er, 1–5 (1 = ikke sulten, 5 = skrubbsulten). Bruk når brukeren OPPGIR et nivå, eller svarer på sultvarselets «hvor sulten er du, 1–5?». IKKE gjett nivået ut fra ordbruk — skalaen er kalibrert mot brukerens egne svar, og et gjettet tall ødelegger kalibreringen. Er nivået uklart, spør. Systemet legger selv på det kumulative gapet, og lærer over tid hvilket gap som gjør denne brukeren sulten. Si aldri noe om blodsukker.',
					parameters: {
						type: 'object',
						properties: {
							level: { type: 'number', description: 'Sultnivået brukeren oppgav, 1–5. Aldri gjettet.' },
							note: { type: 'string', description: 'Brukerens egne ord, hvis de sa mer enn tallet.' }
						},
						required: ['level']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: manageNutritionTargetsTool.name,
					description:
						'Les eller sett dagsmålene for kalorier, protein og makrofordeling. Bruk get når brukeren spør hva målene er, og FØR du endrer ett av dem — du må se de andre for ikke å lage en umulig kombinasjon. Bruk set på «sett kalorimålet til 2600», «jeg vil ha 180 g protein», «2 gram protein per kilo». Bare feltene du sender endres. Send proteinPerKg for gram per kilo, så regnes det om med siste vekt. Andelene trenger ikke summere til 100; får du en warning tilbake, SI den til brukeren. Målene vises og kan justeres på Ernæring-temaet.',
					parameters: {
						type: 'object',
						properties: {
							action: { type: 'string', enum: ['get', 'set'] },
							kcalTarget: { type: ['number', 'null'], description: 'Dagsmål kcal, 800–6000. null fjerner.' },
							proteinTarget: { type: ['number', 'null'], description: 'Proteinmål i gram, 30–400. null fjerner.' },
							proteinPerKg: { type: 'number', description: 'Gram protein per kg kroppsvekt, f.eks. 1.8.' },
							proteinPct: { type: ['number', 'null'], description: 'Proteinandel av energien, i prosent.' },
							carbsPct: { type: ['number', 'null'], description: 'Karboandel av energien, i prosent.' },
							fatPct: { type: ['number', 'null'], description: 'Fettandel av energien, i prosent.' },
							useDefaultMacroSplit: {
								type: 'boolean',
								description: 'Setter 30/40/30 når brukeren vil ha en fordeling uten å ha en mening om tallene.'
							}
						},
						required: ['action']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'weather_forecast',
					description: 'Hent værprognose fra MET.no basert på koordinater. Uten koordinater brukes brukerens hjem (fra Akser), ellers Oslo — oppgi koordinater bare for et ANNET sted enn hjemme. Brukes når bruker spør om vær, eller når du vil berike svar med lokalt vær nå og neste time.',
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
					description: 'Søk på web og få et kort, kildebasert sammendrag (Tavily). Bruk når brukeren spør om aktuelle hendelser, tidsavhengige fakta, steder/aktiviteter, personer, referanser eller annen kunnskap som ikke finnes i brukerdata. Verktøyet henter sider, oppsummerer og returnerer kilder. Sett saveToTheme=true når brukeren undersøker noe som hører til det aktive temaet og bør tas vare på (f.eks. «hva kan jeg gjøre i Hornbæk» på et ferietema) — da lagres runden som funn i Research-seksjonen i Filer på temasiden.',
					parameters: {
						type: 'object',
						properties: {
							query: {
								type: 'string',
								description: 'Konkret søkestreng for web, gjerne med tema, navn, sted og tidsrom, for eksempel "aktiviteter i Hornbæk om sommeren" eller "Iran war update April 2026".'
							},
							saveToTheme: {
								type: 'boolean',
								description: 'Sett true for å lagre denne research-runden som funn på det aktive temaet. Bruk kun når brukeren undersøker noe knyttet til temaet og vil ha det tatt vare på.'
							},
							deep: {
								type: 'boolean',
								description: 'Sett true for grundigere research: flere vinkel-søk flettes sammen (f.eks. severdigheter + mat + praktisk for et reisemål). Bruk ved planlegging eller når brukeren vil ha en bred oversikt.'
							}
						},
						required: ['query']
					}
				}
			},
			bookResearchToolDefinition,
			filmResearchToolDefinition,
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
					name: 'search_metrics',
					description: `Søk i metrikkregisteret for å finne riktig metricKey til widgets.
Bruk ALLTID dette FØR propose_widget når brukeren ber om widget for:
- Økonomi/forbruk (transport, mat, elbil, strøm, osv.)
- En kategori du ikke er sikker på nøkkelnavnet til
- Helse-metrikker der du er usikker

Returnerer en liste med key, label, defaultAggregation, defaultUnit og filterCategory.
Bruk key-feltet direkte som metricKey i propose_widget.`,
					parameters: {
						type: 'object',
						properties: {
							query: {
								type: 'string',
								description: 'Fritekst søk, f.eks. "elbil lading transport", "dagligvarer mat", "søvn", "trening"'
							},
							domain: {
								type: 'string',
								enum: ['health', 'spending', 'income', 'all'],
								description: 'Begrens til domene. Utelat eller bruk "all" for å søke i alt.'
							},
							limit: {
								type: 'number',
								description: 'Maks antall resultater (standard: 8)'
							}
						},
						required: ['query']
					}
				}
			},
			{
				type: 'function' as const,
				function: {
					name: 'propose_widget',
					description: 'Foreslå en widget til brukeren UTEN å opprette den i databasen. Bruk ALLTID DETTE FØR create_widget. Returnerer et widget-draft som brukeren ser i et forslagskort der de kan bekrefte, konfigurere eller forkaste. Bruk når bruker vil ha en ny widget ("lag widget for dagligvare", "vis søvn siste 30 dager", "widget for løpedistanse"). ALDRI opprett widget direkte uten forslag og bekreftelse. For økonomi/forbruk: bruk search_metrics først for å finne riktig metricKey.',
					parameters: {
						type: 'object',
						properties: {
							title: {
								type: 'string',
								description: 'Kort, beskrivende tittel på widgeten (maks 40 tegn), f.eks. "Søvn / dag", "Ukentlig løping"'
							},
							metricKey: {
								type: 'string',
								description: 'Metrikkens nøkkel fra search_metrics, f.eks. "spending_bil_og_transport_drivstoff". Bruk dette fremfor metricType+filterCategory for økonomi-widgets. Sett metricType til "amount" når metricKey er oppgitt.'
							},
							metricType: {
								type: 'string',
								description: 'Hvilken metrikk widgeten viser. Bruk "amount" for alle økonomi-metrikker (kombinert med metricKey for presisjon).',
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
								description: 'Valgfri kategorifilter for amount-metrikk (settes automatisk fra metricKey hvis oppgitt)',
								enum: ['innskudd', 'dagligvarer', 'kafe_og_restaurant', 'faste_boutgifter', 'annet_lan_og_gjeld', 'bil_og_transport', 'helse_og_velvaere', 'medier_og_underholdning', 'hobby_og_fritid', 'hjem_og_hage', 'klaer_og_utstyr', 'barn', 'barnehage_og_sfo', 'forsikring', 'bilforsikring_og_billan', 'sparing', 'reise', 'diverse', 'ukategorisert']
							},
							filterSubcategory: {
								type: 'string',
								description: 'Valgfri underkategorifilter, f.eks. "drivstoff", "kollektivtransport". Settes automatisk fra metricKey hvis oppgitt.'
							},
							filterHourFrom: {
								type: 'number',
								description: 'Timevindu-start (0–23, inklusiv) — KUN for screenTime. F.eks. 16 for «skjermtid kl. 16–19». Krever at filterHourTo også settes.'
							},
							filterHourTo: {
								type: 'number',
								description: 'Timevindu-slutt (1–24, eksklusiv) — KUN for screenTime. F.eks. 19 for «skjermtid kl. 16–19».'
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
					metricKey: {
						type: 'string',
						description: 'Metrikkens nøkkel fra search_metrics, f.eks. "spending_bil_og_transport_drivstoff". Bruk dette fremfor metricType+filterCategory for økonomi-widgets.'
					},
					metricType: {
						type: 'string',
						description: 'Hvilken metrikk widgeten viser. Bruk "amount" for alle økonomi-metrikker (kombinert med metricKey for presisjon).',
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
						description: 'Valgfri kategorifilter for amount-metrikk (settes automatisk fra metricKey hvis oppgitt). Gyldige verdier: innskudd (inntekter), dagligvarer, kafe_og_restaurant, faste_boutgifter, annet_lan_og_gjeld, bil_og_transport, helse_og_velvaere, medier_og_underholdning, hobby_og_fritid, hjem_og_hage, klaer_og_utstyr, barn, barnehage_og_sfo, forsikring, bilforsikring_og_billan, sparing, reise, diverse, ukategorisert',
						enum: ['innskudd', 'dagligvarer', 'kafe_og_restaurant', 'faste_boutgifter', 'annet_lan_og_gjeld', 'bil_og_transport', 'helse_og_velvaere', 'medier_og_underholdning', 'hobby_og_fritid', 'hjem_og_hage', 'klaer_og_utstyr', 'barn', 'barnehage_og_sfo', 'forsikring', 'bilforsikring_og_billan', 'sparing', 'reise', 'diverse', 'ukategorisert']
					},
					filterSubcategory: {
						type: 'string',
						description: 'Valgfri underkategorifilter, f.eks. "drivstoff", "kollektivtransport". Settes automatisk fra metricKey hvis oppgitt.'
					},
					filterHourFrom: {
						type: 'number',
						description: 'Timevindu-start (0–23, inklusiv) — KUN for screenTime. F.eks. 16 for «skjermtid kl. 16–19». Krever at filterHourTo også settes.'
					},
					filterHourTo: {
						type: 'number',
						description: 'Timevindu-slutt (1–24, eksklusiv) — KUN for screenTime. F.eks. 19 for «skjermtid kl. 16–19».'
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
	},
	{
		type: 'function' as const,
		function: {
			name: 'add_to_week_plan',
			description: 'Legg målbare tiltak på en ukes sjekkliste (ukelista) — finner eller oppretter ukas liste automatisk. Bruk når brukeren vil føre opp konkrete mål/tiltak for en uke, f.eks. fra livskompass-coachingen («legg dette på neste ukes liste»). Skriv frekvens rett i teksten («Skjermfri 16–19 tre kvelder», «Legge meg før kl. 21 en gang») — systemet lager riktig antall punkter og trekker ut klokkeslett. Kommer tiltaket fra livskompass-coachingen: sett dimension til dimensjons-id-en tiltaket skal heve, så spores målet frem til neste innsjekk.',
			parameters: {
				type: 'object',
				properties: {
					weekOffset: {
						type: 'number',
						description: 'Hvilken uke: 0 = denne uka, 1 = neste uke (standard). Bruk 1 for «neste uke».'
					},
					items: {
						type: 'array',
						description: 'Tiltakene som skal føres opp, med frekvens i teksten der det er relevant.',
						items: {
							type: 'object',
							properties: {
								text: {
									type: 'string',
									description: 'Tiltaket, med frekvens i teksten der det er relevant («Skjermfri 16–19 tre kvelder»).'
								},
								dimension: {
									type: 'string',
									enum: LIVSKOMPASS_DIMENSION_IDS,
									description: 'Livskompass-dimensjonen tiltaket skal heve. Kun for kompass-mål fra livskompass-coachingen — utelat ellers.'
								}
							},
							required: ['text']
						}
					}
				},
				required: ['items']
			}
		}
	},
	{
		type: 'function' as const,
		function: {
			name: 'plan_day',
			description: 'Lagre dagsplan for brukeren: enlinjer (kort beskrivelse av hva dagen handler om) og dagsoppgaver. Kall dette verktøyet etter at du har avklart enlinjer og oppgaver med brukeren. Skriv klokkeslett rett inn i oppgaveteksten (f.eks. "Handle middag kl. 18" eller "Legge barna kl. 18:45") og nevn personer med @navn (f.eks. "Hente @Nils kl. 16") — systemet trekker automatisk ut tidspunkt og personer.',
			parameters: {
				type: 'object',
				properties: {
					dayIso: {
						type: 'string',
						description: 'ISO-dato for dagen, f.eks. "2025-01-20"'
					},
					weekDashedKey: {
						type: 'string',
						description: 'Ukenøkkel i format "2025-W03"'
					},
					headline: {
						type: 'string',
						description: 'Enlinjer for dagen – én setning som oppsummerer hva dagen handler om'
					},
					tasks: {
						type: 'array',
						description: 'Konkrete dagsoppgaver å legge i dagslista. Inkluder klokkeslett inline der det er relevant ("kl. 18", "kl. 18:45") og @navn for personer — disse parses automatisk ut i egne felt.',
						items: { type: 'string' }
					}
				},
				required: ['dayIso', 'weekDashedKey', 'headline', 'tasks']
			}
		}
	}];
