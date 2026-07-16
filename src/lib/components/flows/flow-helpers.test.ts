import { describe, expect, it } from 'vitest';
import {
	FLOW_DRAFT_MAX_AGE_MS,
	flowDraftKey,
	parseChatMessage,
	parseFlowDraft,
	rehydrateChatMessages,
	serializeChatThread,
	serializeFlowDraft
} from './flow-helpers';

describe('chat-tråd serialisering/rehydrering', () => {
	it('runder tur-retur med rawText bevart', () => {
		const messages = [
			{ role: 'user' as const, text: 'Hei' },
			{ role: 'assistant' as const, text: 'Svar uten markører', rawText: 'Svar uten markører\n<status>Internt destillat</status>' }
		];
		const rehydrated = rehydrateChatMessages(serializeChatThread(messages));
		expect(rehydrated).toHaveLength(2);
		expect(rehydrated[1].rawText).toContain('<status>Internt destillat</status>');
		expect(rehydrated[1].text).toBe('Svar uten markører');
	});

	it('utelater rawText når den er lik visningsteksten', () => {
		const saved = serializeChatThread([{ role: 'assistant', text: 'Samme', rawText: 'Samme' }]);
		expect(saved[0]).toEqual({ role: 'assistant', text: 'Samme' });
	});

	it('rehydrerer gamle tråder uten rawText (bakoverkompatibelt)', () => {
		const rehydrated = rehydrateChatMessages([{ role: 'user', text: 'Gammel melding' }]);
		expect(rehydrated).toEqual([{ role: 'user', text: 'Gammel melding' }]);
	});

	it('gir tom liste for korrupt eller ukjent form', () => {
		expect(rehydrateChatMessages(undefined)).toEqual([]);
		expect(rehydrateChatMessages('tekst')).toEqual([]);
		expect(rehydrateChatMessages([{ role: 'robot', text: 'x' }, null, { role: 'user' }])).toEqual([]);
	});
});

describe('parseChatMessage', () => {
	it('stripper <status>-blokken så den ikke lekker ut i chatten', () => {
		const raw =
			'Det høres ut som et tungt år. Hva tror du selv lå bak?\n\n<status>\nHvor var du: sliten\nHva ville du oppnå: ikke kartlagt ennå\n</status>';
		expect(parseChatMessage(raw).text).toBe('Det høres ut som et tungt år. Hva tror du selv lå bak?');
	});

	it('stripper <bursdagsmål>-blokken', () => {
		const raw = 'Fine mål!\n<bursdagsmål>\nLøpe 600 km\nSkjermfri etter 22\n</bursdagsmål>';
		expect(parseChatMessage(raw).text).toBe('Fine mål!');
	});

	it('beholder vanlig tekst og <oppgaver>-bullets', () => {
		const parsed = parseChatMessage('Her er forslag:\n<oppgaver>\nBytt filter\nBestill sko\n</oppgaver>');
		expect(parsed.text).toBe('Her er forslag:\n- Bytt filter\n- Bestill sko');
	});

	it('plukker ut [PLAN_KLAR]-bekreftelse', () => {
		const parsed = parseChatMessage('Planen er klar [PLAN_KLAR]');
		expect(parsed.text).toBe('Planen er klar');
		expect(parsed.confirmAction).toBe('Ja, lagre planen');
	});
});

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
