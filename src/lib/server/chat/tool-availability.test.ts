import { describe, it, expect } from 'vitest';
import { shouldOfferToolsInitially } from './tool-availability';

describe('shouldOfferToolsInitially', () => {
	it('tilbyr verktøy i vanlig (ikke-samtalende) modus', () => {
		expect(shouldOfferToolsInitially({ isConversationalMode: false })).toBe(true);
	});

	it('dropper verktøy i samtalende modus uten eksplisitt tillatelse', () => {
		expect(shouldOfferToolsInitially({ isConversationalMode: true })).toBe(false);
		expect(shouldOfferToolsInitially({ isConversationalMode: true, allowToolsInConversation: false })).toBe(false);
	});

	it('regresjonsvakt: coaching-konteksten får verktøy selv om den er samtalende', () => {
		// Livskompass-coachingen setter systemPromptPrefix (→ conversational) + allowToolsInConversation,
		// så add_to_week_plan er tilgjengelig på første kall. Uten dette laget innsjekken aldri oppgaver.
		expect(shouldOfferToolsInitially({ isConversationalMode: true, allowToolsInConversation: true })).toBe(true);
	});
});
