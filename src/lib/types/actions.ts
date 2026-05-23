import type { FlowId } from '$lib/flows/types';

export type ActionIntent =
	| { kind: 'open-flow'; flowId: FlowId; prefill?: Record<string, unknown> }
	| { kind: 'open-egenfrekvens'; slot: 'morning' | 'evening' }
	| { kind: 'open-day-plan'; iso: string; weekKey: string }
	| { kind: 'open-week-plan' }
	| { kind: 'open-month-plan'; monthKey: string }
	| { kind: 'navigate'; href: string };

export interface ActionCandidate {
	id: string;
	icon: string;
	label: string;
	value?: string | number;
	priority: number;
	source: 'system' | 'domain' | 'onboarding' | 'ai';
	intent: ActionIntent;
	expiresAt?: string;
}
