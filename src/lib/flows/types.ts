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
	| 'planning_goal_setup';

export type FlowDomain = 'health' | 'economics' | 'planning' | 'general';

export type FlowTrigger = 'manual' | 'auto_suggest' | 'onboarding';

export interface FlowStep {
	id: string;
	type: 'chat' | 'form' | 'mixed';
	title?: string;
	prompt?: string; // For chat-steg
	fields?: FlowFormField[]; // For form/mixed-steg
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

export interface Flow {
	id: FlowId;
	name: string;
	description: string;
	icon: string;
	domain: FlowDomain;
	trigger: FlowTrigger;
	estimatedMinutes?: number;
	steps?: FlowStep[]; // For multi-step flows
	// Handler-funksjon som kjøres når flow er ferdig
	onComplete?: (data: Record<string, any>, userId: string) => Promise<void>;
	// Metadata for visning
	badge?: string; // "Ny", "Anbefalt", etc
	theme?: string; // Theme-navn (f.eks "Helse") hvis flow skal vises kun på ett tema
	parentTheme?: string; // ParentTheme-navn (f.eks "Helse") hvis flow skal vises på alle temaer under
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
