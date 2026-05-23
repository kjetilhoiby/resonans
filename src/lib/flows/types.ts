/**
 * Flow system - Strukturerte onboarding- og handlingsflyter som kombinerer chat og skjema
 */

export type FlowId =
	| 'health_weight_onboarding'
	| 'health_sleep_onboarding'
	| 'health_training_onboarding'
	| 'economics_budget_setup'
	| 'economics_savings_goal'
	| 'economics_category_budget'
	| 'planning_week_plan'
	| 'planning_week_review'
	| 'planning_goal_setup'
	| 'planning_month_plan'
	| 'planning_quarter_plan'
	| 'planning_year_plan'
	| 'food_meal_chat'
	| 'family_onboarding'
	| 'family_summer_planning'
	| 'family_relation_check_in'
	| 'day_plan'
	| 'day_close'
	| 'egenfrekvens_checkin'
	| 'egenfrekvens_quick'
	| 'reflection_light'
	| 'quick_win'
	| 'inbox_note'
	| 'jobb_focus_timer';

export type FlowDomain = 'health' | 'economics' | 'food' | 'family' | 'planning' | 'general' | 'egenfrekvens' | 'jobb';

export type FlowTrigger = 'manual' | 'auto_suggest' | 'onboarding';

export interface FlowStep {
	id: string;
	type: 'chat' | 'form' | 'mixed' | 'checklist' | 'decision-list';
	title?: string;
	/** For chat: initial assistant message shown before user types */
	prompt?: string;
	/** For chat: system prompt sent with every message in this step */
	systemPrompt?: string;
	/** For chat: build prompt and systemPrompt dynamically from accumulated flowData */
	buildPrompts?: (data: Record<string, any>) => { prompt?: string; systemPrompt?: string };
	/** For chat: send `prompt` automatically on mount (no user input needed to trigger first response) */
	autoSend?: boolean;
	fields?: FlowFormField[];
	/** For checklist: which contextData key holds the items seed, e.g. 'carryovers' */
	itemsKey?: string;
	/** For checklist: which contextData key holds additional (deselected) items, e.g. 'weekTasks' */
	extraItemsKey?: string;
	/** For checklist: whether to fetch AI suggestions based on a headline field id */
	aiSuggestionsFromField?: string;
	/** For checklist: show an inline refinement prompt so the user can ask for more/different suggestions */
	enableAiRefinement?: boolean;
	/** For decision-list: which contextData key holds the open items */
	openItemsKey?: string;
	validation?: (data: Record<string, any>) => boolean | string;
	/** Skip this step entirely if predicate returns true. Evaluated against current flow data. */
	skipIf?: (data: Record<string, any>) => boolean;
	/** Auto-advance to next step after slider interaction (debounced). Form steps with a single slider. */
	autoAdvance?: boolean | { delayMs: number };
	/** Valgfri ekstra handlingsknapp i footeren — f.eks. "gå dypere" som hopper til en annen flow.
	 *  Parent-komponenten håndterer hva som skjer via FlowSheet sin `onsecondaryaction`-callback. */
	secondaryAction?: {
		/** Identifiserer handlingen for parent-handleren */
		id: string;
		/** Ikon/symbol vist i knappen (emoji eller kort tekst som '+') */
		icon: string;
		/** Valgfri aria-label */
		label?: string;
	};
}

export interface FlowFormField {
	id: string;
	type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'slider' | 'multiselect';
	label: string;
	placeholder?: string;
	required?: boolean;
	min?: number;
	max?: number;
	step?: number;
	options?: Array<{ value: string; label: string }>;
	/** Dynamic options based on current flowData and runtime context — overrides static options when present */
	optionsFn?: (data: Record<string, any>, context?: FlowContext) => Array<{ value: string; label: string }>;
	/** Grouped options for pyramid-style signal grids. Active level shown, others behind toggle. */
	optionGroupsFn?: (data: Record<string, any>) => Array<{
		label: string;
		isActive: boolean;
		options: Array<{ value: string; label: string }>;
	}>;
	defaultValue?: any;
	/** For slider: anchor labels keyed by integer value, rendered as helper text under the slider. */
	helperLabels?: Record<number, string>;
}

/** Dynamic runtime data passed to FlowSheet per invocation */
export interface FlowContext {
	/** Carry-over items from previous day */
	carryovers?: string[];
	/** Recurring week tasks */
	weekTasks?: string[];
	/** ISO date of the day being planned/closed */
	dayIso?: string;
	/** Dashed week key, e.g. "2026-W17" */
	weekDashedKey?: string;
	/** Pre-existing headline text */
	existingHeadline?: string;
	/** Open (unchecked) items for day-close */
	openItems?: Array<{ id: string; text: string }>;
	/** Passed through to AI suggestion fetching */
	dayLabel?: string;
	/** Egenfrekvens-sjekkin: morgen eller kveld (lest fra nudge-URL eller utledet fra klokkeslett) */
	slot?: 'morning' | 'evening';
	/** Per-step dynamic system prompts keyed by step id — overrides FlowStep.systemPrompt */
	systemPrompts?: Record<string, string>;
	/** Per-step initial prompt/prefill keyed by step id — overrides FlowStep.prompt */
	prompts?: Record<string, string>;
	/** Initial form data — seeds flowData on mount (e.g. pre-fill the note field with chat-draft) */
	initialData?: Record<string, any>;
	/** Contextual dream-reasons per dimension, fetched at flow open time */
	dreamReasons?: {
		actions?: Array<{ value: string; label: string; source: string }>;
		balance?: Array<{ value: string; label: string; source: string }>;
		thoughts?: Array<{ value: string; label: string; source: string }>;
		feelings?: Array<{ value: string; label: string; source: string }>;
	};
	/** Target month being planned, e.g. "2026-05" */
	monthKey?: string;
	/** Previous month's data injected server-side for AI context building */
	prevMonthData?: {
		monthName: string;
		note: string;
		reflection: string;
		uncheckedItems: Array<{ id: string; text: string }>;
		monthGoals: Array<{ title: string; currentValue: number; target: { value: number; unit: string }; trackingMetric: string }>;
		recurringTasks: string[];
	};
}

export interface Flow {
	id: FlowId;
	name: string;
	description: string;
	icon: string;
	domain: FlowDomain;
	trigger: FlowTrigger;
	estimatedMinutes?: number;
	/** Focus mode: fullscreen immersive layout with centered content, large controls, progress dots */
	focus?: boolean;
	steps?: FlowStep[];
	onComplete?: (data: Record<string, any>, context: FlowContext) => Promise<void>;
	badge?: string;
	theme?: string;
	parentTheme?: string;
}

export interface FlowSession {
	flowId: FlowId;
	currentStepIndex: number;
	data: Record<string, any>;
	startedAt: Date;
	completedAt?: Date;
}

export interface FlowCardProps {
	flow: Flow;
	onStart?: () => void;
}
