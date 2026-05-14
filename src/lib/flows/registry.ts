/**
 * Flow Registry - Sentralt register over alle tilgjengelige flyter
 */

import type { Flow, FlowId, FlowDomain } from './types';
import {
	ACTIONS_PYRAMID,
	ACTIONS_SLIDER_LABELS,
	FEELINGS_PYRAMID,
	FEELINGS_SLIDER_LABELS,
	THOUGHTS_PYRAMID,
	THOUGHTS_SLIDER_LABELS,
	BALANCE_LABELS,
	EGENFREKVENS_THRESHOLDS,
	getPyramidGroups
} from '$lib/domains/egenfrekvens';

export const FLOWS: Record<FlowId, Flow> = {
	health_weight_onboarding: {
		id: 'health_weight_onboarding',
		name: 'Vekt & Kropp',
		description: 'Del historikk og sett mål for vektutvikling',
		icon: '⚖️',
		domain: 'health',
		trigger: 'manual',
		estimatedMinutes: 5,
		parentTheme: 'Helse',
		badge: 'Populær',
		steps: [
			{
				id: 'context',
				type: 'mixed',
				title: 'Fortell litt om bakgrunnen din',
				prompt: 'Hva har fungert før? Hva har vært vanskelig?',
				fields: [
					{
						id: 'historyText',
						type: 'textarea',
						label: 'Historikk og kontekst',
						placeholder: 'Hva har fungert før, hva har vært vanskelig?',
						required: false
					}
				]
			},
			{
				id: 'goals',
				type: 'form',
				title: 'Sett mål',
				fields: [
					{
						id: 'startDate',
						type: 'date',
						label: 'Startdato',
						required: true
					},
					{
						id: 'endDate',
						type: 'date',
						label: 'Måldato',
						required: true
					},
					{
						id: 'startWeight',
						type: 'number',
						label: 'Startvekt (kg)',
						step: 0.1,
						required: false
					},
					{
						id: 'targetWeight',
						type: 'number',
						label: 'Målvekt (kg)',
						step: 0.1,
						required: false
					}
				]
			}
		]
	},

	health_sleep_onboarding: {
		id: 'health_sleep_onboarding',
		name: 'Søvn & Hvile',
		description: 'Kartlegg søvnmønster og sett mål for bedre søvn',
		icon: '😴',
		domain: 'health',
		trigger: 'manual',
		estimatedMinutes: 5,
		parentTheme: 'Helse',
		steps: [
			{
				id: 'current_pattern',
				type: 'chat',
				prompt:
					'Hvordan er søvnmønsteret ditt for tiden? Når legger du deg, står du opp, og hvordan har kvaliteten vært?'
			},
			{
				id: 'goals',
				type: 'form',
				title: 'Søvnmål',
				fields: [
					{
						id: 'targetHours',
						type: 'slider',
						label: 'Målsetting søvn per natt (timer)',
						min: 6,
						max: 10,
						step: 0.5,
						defaultValue: 8
					},
					{
						id: 'bedtimeGoal',
						type: 'text',
						label: 'Ønsket leggetid',
						placeholder: '23:00'
					}
				]
			}
		]
	},

	health_training_onboarding: {
		id: 'health_training_onboarding',
		name: 'Trening & Aktivitet',
		description: 'Kartlegg treningsnivå og lag en realistisk plan',
		icon: '🏃‍♂️',
		domain: 'health',
		trigger: 'manual',
		estimatedMinutes: 5,
		parentTheme: 'Helse',
		steps: [
			{
				id: 'current_level',
				type: 'chat',
				prompt: 'Hvor aktiv er du nå? Hva trener du, hvor ofte, og hva er målet?'
			},
			{
				id: 'preferences',
				type: 'form',
				title: 'Preferanser',
				fields: [
					{
						id: 'activities',
						type: 'multiselect',
						label: 'Hva liker du?',
						options: [
							{ value: 'running', label: 'Løping' },
							{ value: 'cycling', label: 'Sykling' },
							{ value: 'gym', label: 'Styrke/gym' },
							{ value: 'swimming', label: 'Svømming' },
							{ value: 'walking', label: 'Gåturer' },
							{ value: 'team_sports', label: 'Lagsport' },
							{ value: 'yoga', label: 'Yoga/stretching' }
						]
					},
					{
						id: 'frequency',
						type: 'slider',
						label: 'Ønsket frekvens (økter per uke)',
						min: 1,
						max: 7,
						step: 1,
						defaultValue: 3
					}
				]
			}
		]
	},

	economics_budget_setup: {
		id: 'economics_budget_setup',
		name: 'Sett opp budsjett',
		description: 'Lag et realistisk budsjett basert på inntekt og utgifter',
		icon: '💰',
		domain: 'economics',
		trigger: 'manual',
		estimatedMinutes: 10,
		parentTheme: 'Økonomi',
		steps: [
			{
				id: 'income',
				type: 'form',
				title: 'Inntekt',
				fields: [
					{
						id: 'monthlyIncome',
						type: 'number',
						label: 'Månedlig inntekt etter skatt',
						required: true
					}
				]
			},
			{
				id: 'spending_analysis',
				type: 'chat',
				prompt:
					'La meg hente dine faktiske utgifter siste 3 måneder så vi kan lage et realistisk budsjett.'
			},
			{
				id: 'budget_goals',
				type: 'form',
				title: 'Budsjettrammer',
				fields: [
					{
						id: 'savingsGoal',
						type: 'number',
						label: 'Månedlig sparemål (kr)',
						placeholder: '5000'
					}
				]
			}
		]
	},

	economics_savings_goal: {
		id: 'economics_savings_goal',
		name: 'Sparemål',
		description: 'Sett og planlegg et langsiktig sparemål',
		icon: '🎯',
		domain: 'economics',
		trigger: 'manual',
		estimatedMinutes: 5,
		parentTheme: 'Økonomi',
		steps: [
			{
				id: 'goal_definition',
				type: 'form',
				title: 'Hva sparer du til?',
				fields: [
					{
						id: 'goalName',
						type: 'text',
						label: 'Navn på mål',
						placeholder: 'Ny bil, ferie, buffer...'
					},
					{
						id: 'targetAmount',
						type: 'number',
						label: 'Målbeløp (kr)',
						required: true
					},
					{
						id: 'deadline',
						type: 'date',
						label: 'Når skal du ha spart dette?',
						required: false
					}
				]
			}
		]
	},

	economics_category_budget: {
		id: 'economics_category_budget',
		name: 'Budsjettrammer',
		description: 'Sett månedlig mål for en utgiftskategori',
		icon: '📊',
		domain: 'economics',
		trigger: 'manual',
		estimatedMinutes: 3,
		parentTheme: 'Økonomi',
		badge: 'Praktisk',
		steps: [
			{
				id: 'category_selection',
				type: 'form',
				title: 'Velg kategori og sett mål',
				fields: [
					{
						id: 'category',
						type: 'select',
						label: 'Kategori',
						required: true,
						options: [
							{ value: 'dagligvarer', label: '🛒 Dagligvarer' },
							{ value: 'kafe_og_restaurant', label: '🍽️ Kafe og restaurant' },
							{ value: 'bil_og_transport', label: '🚗 Transport og bil' },
							{ value: 'helse_og_velvaere', label: '💊 Helse og velvære' },
							{ value: 'medier_og_underholdning', label: '📱 Medier og underholdning' },
							{ value: 'hobby_og_fritid', label: '🎉 Hobby og fritid' },
							{ value: 'hjem_og_hage', label: '🔨 Hjem og hage' },
							{ value: 'klaer_og_utstyr', label: '🛍️ Klær og utstyr' },
							{ value: 'barn', label: '👶 Barn' },
							{ value: 'reise', label: '✈️ Reise' }
						]
					},
					{
						id: 'monthlyBudget',
						type: 'number',
						label: 'Månedlig budsjett (kr)',
						placeholder: '9000',
						required: true
					}
				]
			}
		]
	},

	planning_week_plan: {
		id: 'planning_week_plan',
		name: 'Planlegg uka',
		description: 'Sett mål og lag plan for kommende uke',
		icon: '🗓️',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 5,
		steps: [
			{
				id: 'chat',
				type: 'chat',
				title: 'Planlegg uka',
				prompt: 'Planlegg uke',
				autoSend: true
			}
		]
	},

	planning_week_review: {
		id: 'planning_week_review',
		name: 'Avslutt uka',
		description: 'Reflekter over uka og ta med deg læring',
		icon: '🪞',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 5,
		steps: [
			{
				id: 'chat',
				type: 'chat',
				title: 'Avslutt uka',
				prompt: 'Avslutt uke',
				autoSend: true
			}
		]
	},

	food_meal_chat: {
		id: 'food_meal_chat',
		name: 'Planlegg måltid',
		description: 'Få hjelp til å planlegge et måltid: oppskrift, handleliste og bruk av det du har i skapet.',
		icon: '🍽️',
		domain: 'food',
		trigger: 'manual',
		estimatedMinutes: 4,
		steps: [
			{
				id: 'chat',
				type: 'chat',
				title: 'Planlegg måltid',
				prompt: 'Hjelp meg planlegge dette måltidet.',
				autoSend: true
			}
		]
	},

	planning_goal_setup: {
		id: 'planning_goal_setup',
		name: 'Nytt mål',
		description: 'Sett opp et nytt mål med oppgaver og milepæler',
		icon: '🎯',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 8,
		steps: [
			{
				id: 'goal_definition',
				type: 'chat',
				prompt: 'Hva vil du oppnå? Beskriv målet ditt så konkret som mulig.'
			},
			{
				id: 'goal_details',
				type: 'form',
				title: 'Måldetaljer',
				fields: [
					{
						id: 'goalTitle',
						type: 'text',
						label: 'Navn på mål',
						required: true
					},
					{
						id: 'goalCategory',
						type: 'select',
						label: 'Kategori',
						options: [
							{ value: 'health', label: 'Helse' },
							{ value: 'career', label: 'Karriere' },
							{ value: 'finance', label: 'Økonomi' },
							{ value: 'relationship', label: 'Samliv' },
							{ value: 'personal', label: 'Personlig utvikling' }
						]
					},
					{
						id: 'deadline',
						type: 'date',
						label: 'Ønsket fullføringsdato'
					}
				]
			},
			{
				id: 'breakdown',
				type: 'chat',
				prompt: 'La meg foreslå konkrete oppgaver for å nå dette målet.'
			}
		]
	},

	day_plan: {
		id: 'day_plan',
		name: 'Planlegg dag',
		description: 'Sett overskrift og velg oppgaver for dagen',
		icon: '📋',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 3,
		steps: [
			{
				id: 'headline',
				type: 'form',
				title: 'Hva handler dagen om?',
				fields: [
					{
						id: 'headline',
						type: 'textarea',
						label: 'Dagsoverskrift',
						placeholder: 'F.eks: Holde familien flytende mens Nils er syk.',
						required: true
					}
				]
			},
			{
				id: 'tasks',
				type: 'checklist',
				title: 'Velg dagsoppgaver',
				itemsKey: 'carryovers',
				extraItemsKey: 'weekTasks',
				aiSuggestionsFromField: 'headline',
				enableAiRefinement: true
			}
		],
		onComplete: async (data, context) => {
			await fetch('/api/day-plan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					dayIso: context.dayIso,
					weekDashedKey: context.weekDashedKey,
					headline: data.headline ?? '',
					tasks: (data.selectedTasks as string[]) ?? []
				})
			});
		}
	},

	day_close: {
		id: 'day_close',
		name: 'Avslutt dag',
		description: 'Bestem hva du tar med til neste dag',
		icon: '✓',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 2,
		steps: [
			{
				id: 'decisions',
				type: 'decision-list',
				title: 'Hva tar du med til neste dag?',
				openItemsKey: 'openItems'
			}
		]
	},

	planning_month_plan: {
		id: 'planning_month_plan',
		name: 'Planlegg måneden',
		description: 'Reflekter over forrige måned og legg planen for neste',
		icon: '🗓️',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 15,
		steps: [
			{
				id: 'refleksjon',
				type: 'chat',
				title: 'Refleksjon over forrige måned',
				autoSend: true,
				prompt: 'Oppsummer forrige måned og inviter til refleksjon.'
			},
			{
				id: 'uloste_oppgaver',
				type: 'decision-list',
				title: 'Uløste oppgaver – hva tar du med videre?',
				openItemsKey: 'openItems'
			},
			{
				id: 'gjentakende_oppgaver',
				type: 'checklist',
				title: 'Gjentakende oppgaver',
				extraItemsKey: 'weekTasks'
			},
			{
				id: 'maal',
				type: 'chat',
				title: 'Månedsmål',
				autoSend: true,
				prompt: 'Gjennomgå målene fra forrige måned og hjelp med å sette mål for neste måned.'
			},
			{
				id: 'maanedshistorie',
				type: 'chat',
				title: 'Månedshistorie',
				autoSend: true,
				prompt: 'Hjelp brukeren å skrive en kort månedsbeskrivelse.'
			}
		],
		onComplete: async (data, context) => {
			const carryoverTexts = (context.openItems ?? [])
				.filter((item) => (data['carryoverIds'] as string[] ?? []).includes(item.id))
				.map((item) => item.text);

			const selectedTasks = (data['selectedTasks'] as string[]) ?? [];
			const goalUpdatesText = (data['maal_lastMessage'] as string) ?? '';
			const narrative = (data['maanedshistorie_lastMessage'] as string) ?? '';
			const refleksjonText = (data['refleksjon_lastMessage'] as string) ?? '';
			const prevMonthGoals = context.prevMonthData?.monthGoals ?? [];

			await fetch('/api/month-plan/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					monthKey: context.monthKey,
					carryoverTexts,
					selectedTasks,
					goalUpdatesText,
					prevMonthGoals,
					narrative,
					refleksjonText
				})
			});
		}
	},

	planning_quarter_plan: {
		id: 'planning_quarter_plan',
		name: 'Planlegg kvartalet',
		description: 'Bryt års-visjonen ned til 3-måneders mål og milepæler',
		icon: '🎢',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 12,
		steps: [
			{
				id: 'reflection',
				type: 'chat',
				title: 'Refleksjon over forrige kvartal',
				autoSend: true,
				prompt: 'Oppsummer forrige kvartal og hva vi lærte.'
			},
			{
				id: 'goals',
				type: 'chat',
				title: 'Kvartalsmål',
				autoSend: true,
				prompt: 'Foreslå 2-3 kvartalsmål som tar oss nærmere års-visjonen, brutt ned i månedsmål.'
			},
			{
				id: 'vision',
				type: 'chat',
				title: 'Hvor vil vi være om 3 måneder?',
				autoSend: true,
				prompt: 'Hjelp brukeren skrive en kort kvartalsvisjon.'
			}
		]
	},

	planning_year_plan: {
		id: 'planning_year_plan',
		name: 'Planlegg året',
		description: 'Sett retning for 12 måneder fremover, koblet til 5-års drømmen',
		icon: '🧭',
		domain: 'planning',
		trigger: 'manual',
		estimatedMinutes: 20,
		steps: [
			{
				id: 'review',
				type: 'chat',
				title: 'Tilbakeblikk på året som gikk',
				autoSend: true,
				prompt: 'Oppsummer fjoråret med fokus på fremdrift mot 5-års drømmen.'
			},
			{
				id: 'vision',
				type: 'chat',
				title: 'Års-visjon',
				autoSend: true,
				prompt: 'Hjelp brukeren skrive en realistisk og motiverende års-visjon.'
			},
			{
				id: 'goals',
				type: 'chat',
				title: 'Års-mål',
				autoSend: true,
				prompt: 'Foreslå 3-5 års-mål som operasjonaliserer visjonen, fordel dem på kvartaler.'
			}
		]
	},

	family_onboarding: {
		id: 'family_onboarding',
		name: 'Bli kjent med familien',
		description: 'Registrer hvem som bor i hjemmet, partner, barn, foreldre og svigerfamilie. Gir Resonans grunnlaget for å huske og koble familieobservasjoner til riktig person.',
		icon: '👨‍👩‍👧‍👦',
		domain: 'family',
		trigger: 'manual',
		estimatedMinutes: 8,
		theme: 'Familie',
		parentTheme: 'Samliv',
		steps: [
			{
				id: 'partner',
				type: 'chat',
				title: 'Partner / samboer',
				autoSend: true,
				prompt: 'Hvem er partneren din (om noen)? Navn, fødselsdato hvis du vil dele, og noen ord om hvor langt dere har vært sammen.',
				systemPrompt:
					'Bruk manage_person.suggest_create + create for å registrere partner. Lag en relasjon via manage_relation (relationType=family, subType=partnered_with eller married_to). Hold tonen lett.'
			},
			{
				id: 'barn',
				type: 'chat',
				title: 'Barn',
				autoSend: true,
				prompt:
					'Hvilke barn har dere? Skriv navn, fødselsdato/alder. Hvis de er på Spond, kan du dele gruppene de er i (lag, kor, korps).',
				systemPrompt:
					'For hvert barn: manage_person.create med kind=child og birthDate. Spør om Spond-grupper og lagre dem som spondGroupIds. Lag relasjon parent_of fra self.'
			},
			{
				id: 'foreldre',
				type: 'chat',
				title: 'Foreldre',
				autoSend: true,
				prompt: 'Hvem er foreldrene dine? Hvor bor de, og hvor ofte snakker dere?',
				systemPrompt:
					'Opprett person med kind=parent. Foreslå å registrere hvor nære dere står (closeness 1-5).'
			},
			{
				id: 'sviger',
				type: 'chat',
				title: 'Svigerfamilie',
				autoSend: true,
				prompt:
					'Vil du registrere svigerfamilien? Du kan også fortelle litt om relasjonen — den kan være noe du vil jobbe med.',
				systemPrompt:
					'Opprett personer med kind=in_law. Hvis bruker beskriver utfordringer, foreslå et mål for relasjonsarbeid (men opprett kun etter bekreftelse).'
			},
			{
				id: 'foreldretid',
				type: 'chat',
				title: 'Foreldretid',
				autoSend: true,
				prompt:
					'Skal vi sette opp tracking av 1-til-1-tid med hvert barn? Foreslå et ukentlig mål per barn (f.eks. 2 timer alenetid).',
				systemPrompt:
					'Opprett en tracking_series per barn for foreldretid (recordTypeKey=parent_time_<navn>, kind=activity). Foreslå mål per uke.'
			}
		]
	},

	family_summer_planning: {
		id: 'family_summer_planning',
		name: 'Sommerferieplanlegging',
		description: 'Strukturer sommerferien: hvem reiser med hvem, viktige datoer og logistikk per familiemedlem.',
		icon: '🏖️',
		domain: 'family',
		trigger: 'manual',
		estimatedMinutes: 10,
		theme: 'Familie',
		parentTheme: 'Samliv',
		steps: [
			{
				id: 'overview',
				type: 'chat',
				title: 'Hovedlinjer',
				autoSend: true,
				prompt: 'Hva er de viktigste planene for sommeren? Når starter ferien, og når er familien samlet?',
				systemPrompt: 'Bruk query_family persons for å hente alle familiemedlemmer. Sett opp en grov tidslinje for sommeren.'
			},
			{
				id: 'per-barn',
				type: 'chat',
				title: 'Per barn',
				autoSend: true,
				prompt: 'Gå gjennom hvert barn: er det aktiviteter, leirer, besøk hos slekt, idretts-arrangementer (Spond) i ferien?',
				systemPrompt:
					'For hvert barn, kall query_family person_detail og se på upcoming events. Foreslå tasks med personId for ting som må bookes.'
			},
			{
				id: 'logistikk',
				type: 'chat',
				title: 'Logistikk',
				autoSend: true,
				prompt: 'Hvilke konkrete ting må bestilles eller forberedes? Reise, aktiviteter, klær, helse.',
				systemPrompt:
					'Foreslå en checklist via create_checklist med items knyttet til personId der relevant. Vurder å foreslå en reise-tema hvis ferien er stor.'
			}
		]
	},

	family_relation_check_in: {
		id: 'family_relation_check_in',
		name: 'Relasjons-check-in',
		description: 'Reflekter over relasjoner du har lyst til å pleie — svigerfamilie, foreldre eller venner du ikke har snakket med på en stund.',
		icon: '💞',
		domain: 'family',
		trigger: 'manual',
		estimatedMinutes: 5,
		theme: 'Familie',
		parentTheme: 'Samliv',
		steps: [
			{
				id: 'pulsen',
				type: 'chat',
				title: 'Hvem skal du pleie?',
				autoSend: true,
				prompt: 'Hvilken relasjon vil du fokusere på akkurat nå? Hvordan står det til, og hva ønsker du?',
				systemPrompt:
					'Identifiser personen via query_family.find_by_name. Hent person_detail for kontekst. Speil følelser før du foreslår tiltak.'
			},
			{
				id: 'tiltak',
				type: 'chat',
				title: 'Konkret tiltak',
				autoSend: true,
				prompt: 'Hva er en konkret ting du kan gjøre denne uka for denne relasjonen?',
				systemPrompt: 'Foreslå et task med personId og frequency=weekly. Spør før du oppretter.'
			}
		]
	},

	egenfrekvens_checkin: {
		id: 'egenfrekvens_checkin',
		name: 'Egenfrekvens-sjekkin',
		description: 'Ta tempen på handlinger, følelser og tanker',
		icon: '🎚️',
		domain: 'egenfrekvens',
		trigger: 'manual',
		estimatedMinutes: 2,
		focus: true,
		parentTheme: 'Egenfrekvens',
		steps: [
			{
				id: 'step_actions',
				type: 'form',
				title: 'Handlinger',
				prompt: 'Hva gjør du?',
				autoAdvance: true,
				fields: [{
					id: 'actions',
					type: 'slider',
					label: 'Handlingsnivå',
					min: 1, max: 5, step: 1,
					defaultValue: 3,
					helperLabels: ACTIONS_SLIDER_LABELS
				}],
				validation: (d) => Number.isInteger(d.actions)
			},
			{
				id: 'step_actions_signals',
				type: 'form',
				title: 'Hva kjenner du igjen?',
				fields: [{
					id: 'actions_signals',
					type: 'multiselect',
					label: 'Velg det som treffer (valgfritt)',
					required: false,
					optionGroupsFn: (data) => getPyramidGroups(
						ACTIONS_PYRAMID,
						Number(data.actions ?? 3),
						data._dreamReasons?.actions
					)
				}]
			},
			{
				id: 'step_feelings',
				type: 'form',
				title: 'Følelser',
				prompt: 'Hva kjenner du?',
				autoAdvance: true,
				fields: [{
					id: 'feelings',
					type: 'slider',
					label: 'Følelsesnivå',
					min: 1, max: 5, step: 1,
					defaultValue: 3,
					helperLabels: FEELINGS_SLIDER_LABELS
				}],
				validation: (d) => Number.isInteger(d.feelings)
			},
			{
				id: 'step_feelings_signals',
				type: 'form',
				title: 'Hva passer nå?',
				fields: [{
					id: 'feelings_signals',
					type: 'multiselect',
					label: 'Velg det som treffer (valgfritt)',
					required: false,
					optionGroupsFn: (data) => getPyramidGroups(
						FEELINGS_PYRAMID,
						Number(data.feelings ?? 3),
						data._dreamReasons?.feelings
					)
				}]
			},
			{
				id: 'step_thoughts',
				type: 'form',
				title: 'Tanker',
				prompt: 'Hva skjer i hodet?',
				autoAdvance: true,
				fields: [{
					id: 'thoughts',
					type: 'slider',
					label: 'Tankenivå',
					min: 1, max: 5, step: 1,
					defaultValue: 3,
					helperLabels: THOUGHTS_SLIDER_LABELS
				}],
				validation: (d) => Number.isInteger(d.thoughts)
			},
			{
				id: 'step_thoughts_signals',
				type: 'form',
				title: 'Hva kjenner du igjen?',
				fields: [{
					id: 'thoughts_signals',
					type: 'multiselect',
					label: 'Velg det som treffer (valgfritt)',
					required: false,
					optionGroupsFn: (data) => getPyramidGroups(
						THOUGHTS_PYRAMID,
						Number(data.thoughts ?? 3),
						data._dreamReasons?.thoughts
					)
				}]
			},
			{
				id: 'step_balance',
				type: 'form',
				title: 'Balanse',
				prompt: 'Alt tatt i betraktning — hvor ligger du?',
				fields: [{
					id: 'balance',
					type: 'slider',
					label: 'Samlet balanse',
					min: -5, max: 5, step: 1,
					defaultValue: 0,
					helperLabels: BALANCE_LABELS
				}],
				validation: (d) => Number.isInteger(d.balance)
			},
			{
				id: 'reflection',
				type: 'chat',
				title: 'Refleksjon',
				autoSend: true,
				buildPrompts: (data) => {
					const a = Number(data.actions ?? 3);
					const f = Number(data.feelings ?? 3);
					const t = Number(data.thoughts ?? 3);
					const b = Number(data.balance ?? 0);
					const aSignals: string[] = data.actions_signals ?? [];
					const fSignals: string[] = data.feelings_signals ?? [];
					const tSignals: string[] = data.thoughts_signals ?? [];

					const aLevel = ACTIONS_PYRAMID[a];
					const fLevel = FEELINGS_PYRAMID[f];
					const tLevel = THOUGHTS_PYRAMID[t];

					const lines: string[] = [
						'Du er en varm, kort samtalepartner. Brukeren har akkurat fylt ut en egenfrekvens-sjekkin.',
						'Start med å speile tilstanden i én setning — vis at du ser helheten, ikke bare tallene.',
						'Still ETT åpent spørsmål som inviterer til selvobservasjon.',
						'Ikke vær løsningsorientert. Fokuser på hva som funker, eller ett enkelt grep for å snu noe negativt.',
						'Ikke ramse opp data. Bruk signalene til å vise at du ser dem.',
						'Viktig: dimensjonene kan avvike. H5/F1/T1 er ikke "middels" — det kan være overstyring eller maskering.',
						'',
						'SJEKKIN:',
						`- Handlinger: ${a}/5 ${aLevel?.title ?? ''}${aSignals.length ? ` — ${aSignals.join(', ')}` : ''}`,
						`- Følelser: ${f}/5 ${fLevel?.title ?? ''}${fSignals.length ? ` — ${fSignals.join(', ')}` : ''}`,
						`- Tanker: ${t}/5 ${tLevel?.title ?? ''}${tSignals.length ? ` — ${tSignals.join(', ')}` : ''}`,
						`- Balanse: ${b > 0 ? '+' : ''}${b} (${BALANCE_LABELS[b] ?? ''})`,
					];

					const extreme = EGENFREKVENS_THRESHOLDS.reflectIf({ balance: b, thoughts: t, feelings: f, actions: a });
					const mismatch = Math.abs(a - f) >= 3 || Math.abs(a - t) >= 3;

					let prompt: string;
					if (mismatch) {
						prompt = 'Det er et spenn mellom det du gjør og det du kjenner. Hva tror du det handler om?';
					} else if (extreme) {
						prompt = 'Noe skiller seg ut i dag. Hva ligger bak, tror du?';
					} else if (b >= 3) {
						prompt = 'Det ser ut som en god dag. Hva gir deg energi akkurat nå?';
					} else {
						prompt = 'Takk for sjekkinnen. Hva er det viktigste du tar med deg herfra?';
					}

					return { systemPrompt: lines.join('\n'), prompt };
				}
			}
		],
		onComplete: async (data) => {
			const reasons: Record<string, string[]> = {};
			if (Array.isArray(data.actions_signals) && data.actions_signals.length)
				reasons.actions = data.actions_signals;
			if (Array.isArray(data.feelings_signals) && data.feelings_signals.length)
				reasons.feelings = data.feelings_signals;
			if (Array.isArray(data.thoughts_signals) && data.thoughts_signals.length)
				reasons.thoughts = data.thoughts_signals;

			const a = Number(data.actions);
			const f = Number(data.feelings);
			const t = Number(data.thoughts);
			const b = Number(data.balance);
			const aLevel = ACTIONS_PYRAMID[a];
			const fLevel = FEELINGS_PYRAMID[f];
			const tLevel = THOUGHTS_PYRAMID[t];

			const stateSummary = [
				`H${a} ${aLevel?.title ?? ''}`,
				`F${f} ${fLevel?.title ?? ''}`,
				`T${t} ${tLevel?.title ?? ''}`,
				`B${b > 0 ? '+' : ''}${b} ${BALANCE_LABELS[b] ?? ''}`
			].join(' · ');

			const thread: Array<{ role: string; text: string }> = data['reflection_thread'] ?? [];
			const userMessages = thread.filter((m) => m.role === 'user').map((m) => m.text);
			const aiMessages = thread.filter((m) => m.role === 'assistant').map((m) => m.text);

			const reflectionParts = [stateSummary];
			if (userMessages.length > 0) reflectionParts.push(userMessages.join(' | '));
			if (aiMessages.length > 0) reflectionParts.push(aiMessages[aiMessages.length - 1]);
			const reflection = reflectionParts.join('\n');

			const res = await fetch('/api/egenfrekvens/checkin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					balance: b,
					thoughts: t,
					feelings: f,
					actions: a,
					note: null,
					reflection,
					reflectionThread: thread.length > 0 ? thread : undefined,
					reasons: Object.keys(reasons).length > 0 ? reasons : undefined
				})
			});

			if (res.ok && thread.length > 0) {
				const result = await res.json();
				if (result.eventId) {
					fetch('/api/egenfrekvens/synthesize-reflection', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ eventId: result.eventId })
					}).catch(() => {});
				}
			}
		}
	}
};

/**
 * Hent alle flyter for et gitt domene
 */
export function getFlowsByDomain(domain: FlowDomain): Flow[] {
	return Object.values(FLOWS).filter((flow) => flow.domain === domain);
}

/**
 * Hent alle flyter som passer for et tema (basert på parentTheme eller theme)
 */
export function getFlowsByTheme(themeName: string, parentTheme?: string | null): Flow[] {
	return Object.values(FLOWS).filter((flow) => {
		// Match på eksakt tema-navn (hvis flow har theme-felt)
		if (flow.theme === themeName) return true;
		// Match hvis flowens parentTheme matcher temaets navn
		if (flow.parentTheme === themeName) return true;
		// Match hvis flowens parentTheme matcher det innsendte parentTheme
		if (parentTheme && flow.parentTheme === parentTheme) return true;
		// Hvis flow ikke har spesifikt tema/parentTheme, vis den ikke
		return false;
	});
}

/**
 * Hent en enkelt flow basert på ID
 */
export function getFlowById(flowId: FlowId): Flow | undefined {
	return FLOWS[flowId];
}

/**
 * Hent alle flyter (for oversikt eller admin)
 */
export function getAllFlows(): Flow[] {
	return Object.values(FLOWS);
}

/**
 * Hent flyter som bør auto-foreslås (for notifikasjoner eller dashboards)
 */
export function getAutoSuggestedFlows(): Flow[] {
	return Object.values(FLOWS).filter((flow) => flow.trigger === 'auto_suggest');
}
