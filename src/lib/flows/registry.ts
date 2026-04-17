/**
 * Flow Registry - Sentralt register over alle tilgjengelige flyter
 */

import type { Flow, FlowId, FlowDomain } from './types';

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
				aiSuggestionsFromField: 'headline'
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
