import type { WidgetDraft } from '$lib/artifacts/widget-draft';

export type WidgetCreationFlowState =
	| 'intent_detected'
	| 'draft_created'
	| 'preview_rendered'
	| 'refine_text'
	| 'configure'
	| 'confirm_create'
	| 'created'
	| 'discarded';

export interface WidgetCreationFlow {
	state: WidgetCreationFlowState;
	draft: WidgetDraft | null;
	duplicateWidgetId?: string | null;
	createdWidgetId?: string | null;
	createdAt: string;
	updatedAt: string;
}

function nowIso() {
	return new Date().toISOString();
}

export function createWidgetFlowFromDraft(draft: WidgetDraft, duplicateWidgetId?: string | null): WidgetCreationFlow {
	const now = nowIso();
	return {
		state: 'draft_created',
		draft,
		duplicateWidgetId: duplicateWidgetId ?? null,
		createdWidgetId: null,
		createdAt: now,
		updatedAt: now
	};
}

export function markWidgetFlowCreated(flow: WidgetCreationFlow | null, widgetId: string): WidgetCreationFlow {
	const now = nowIso();
	return {
		state: 'created',
		draft: flow?.draft ?? null,
		duplicateWidgetId: flow?.duplicateWidgetId ?? null,
		createdWidgetId: widgetId,
		createdAt: flow?.createdAt ?? now,
		updatedAt: now
	};
}
