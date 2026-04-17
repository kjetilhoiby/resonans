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
	| 'day_plan'
	| 'day_close';

export type FlowDomain = 'health' | 'economics' | 'planning' | 'general';

export type FlowTrigger = 'manual' | 'auto_suggest' | 'onboarding';

export interface FlowStep {
	id: string;
	type: 'chat' | 'form' | 'mixed' | 'checklist' | 'decision-list';
	title?: string;
	/** For chat: initial assistant message shown before user types */
	prompt?: string;
	/** For chat: system prompt sent with every message in this step */
	systemPrompt?: string;
	/** For chat: send `prompt` automatically on mount (no user input needed to trigger first response) */
	autoSend?: boolean;
	fields?: FlowFormField[];
	/** For checklist: which contextData key holds the items seed, e.g. 'carryovers' */
	itemsKey?: string;
	/** For checklist: which contextData key holds additional (deselected) items, e.g. 'weekTasks' */
	extraItemsKey?: string;
	/** For checklist: whether to fetch AI suggestions based on a headline field id */
	aiSuggestionsFromField?: string;
	/** For decision-list: which contextData key holds the open items */
	openItemsKey?: string;
	validation?: (data: Record<string, any>) => boolean | string;
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
	defaultValue?: any;
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
	/** Per-step dynamic system prompts keyed by step id — overrides FlowStep.systemPrompt */
	systemPrompts?: Record<string, string>;
	/** Per-step initial prompt/prefill keyed by step id — overrides FlowStep.prompt */
	prompts?: Record<string, string>;
}

export interface Flow {
	id: FlowId;
	name: string;
	description: string;
	icon: string;
	domain: FlowDomain;
	trigger: FlowTrigger;
	estimatedMinutes?: number;
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
