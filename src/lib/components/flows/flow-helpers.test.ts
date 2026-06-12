import { describe, expect, it } from 'vitest';
import {
	FLOW_DRAFT_MAX_AGE_MS,
	flowDraftKey,
	parseFlowDraft,
	serializeFlowDraft
} from './flow-helpers';

describe('flow-utkast', () => {
	const now = 1_750_000_000_000;

	it('runder tur-retur med svar og steg', () => {
		const raw = serializeFlowDraft('birthday_interview', 3, { who: 'Meg', role_dad: 'Til stede' }, now);
		expect(parseFlowDraft(raw, 'birthday_interview', now)).toEqual({
			stepIndex: 3,
			data: { who: 'Meg', role_dad: 'Til stede' }
		});
	});

	it('avviser utkast for en annen flow', () => {
		const raw = serializeFlowDraft('birthday_interview', 2, {}, now);
		expect(parseFlowDraft(raw, 'reflection_light', now)).toBeNull();
	});

	it('avviser utkast eldre enn maksalderen', () => {
		const raw = serializeFlowDraft('birthday_interview', 2, { who: 'Meg' }, now);
		expect(parseFlowDraft(raw, 'birthday_interview', now + FLOW_DRAFT_MAX_AGE_MS + 1)).toBeNull();
		expect(parseFlowDraft(raw, 'birthday_interview', now + FLOW_DRAFT_MAX_AGE_MS - 1)).not.toBeNull();
	});

	it('avviser korrupt JSON, feil versjon og manglende felt', () => {
		expect(parseFlowDraft('ikke json', 'x', now)).toBeNull();
		expect(parseFlowDraft(null, 'x', now)).toBeNull();
		expect(parseFlowDraft(JSON.stringify({ v: 2, flowId: 'x', stepIndex: 1, data: {}, savedAt: now }), 'x', now)).toBeNull();
		expect(parseFlowDraft(JSON.stringify({ v: 1, flowId: 'x', savedAt: now }), 'x', now)).toBeNull();
	});

	it('lager stabil lagringsnøkkel per flow', () => {
		expect(flowDraftKey('birthday_interview')).toBe('flow-draft:birthday_interview');
	});
});
