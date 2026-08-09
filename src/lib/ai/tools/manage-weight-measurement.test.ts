import { describe, it, expect } from 'vitest';
import { CONFIRMATION_REQUIRED, needsUserConfirmation } from './manage-weight-measurement';

/**
 * Porten som gjør bekreftelsen til noe annet enn en instruksjon i prompten.
 *
 * Begge chat-løkkene kjører opptil fem verktøyrunder i samme svar, laget for
 * «oppslag → beslutning → endring». Uten denne porten kunne modellen finne målingen
 * i runde 1 og slette den i runde 2, og brukeren så aldri spørsmålet.
 */
describe('needsUserConfirmation', () => {
	it('nekter når målingen ble funnet i samme svar', () => {
		// Modellen har nettopp slått den opp. Brukeren har ikke rukket å si noe.
		expect(needsUserConfirmation('måling-1', ['måling-1'])).toBe(true);
	});

	it('slipper gjennom når oppslaget skjedde i et tidligere svar', () => {
		// Id-en finnes i samtalehistorikken, men ikke i denne turen — altså har
		// brukeren svart i mellomtiden. Det er hele signalet.
		expect(needsUserConfirmation('måling-1', [])).toBe(false);
		expect(needsUserConfirmation('måling-1', ['en-annen'])).toBe(false);
	});

	it('slipper gjennom når kallstedet ikke fører tilstand', () => {
		// Et kallsted uten turtilstand skal ikke låse slettingen helt — porten er en
		// vakt mot modellens egen iver, ikke mot brukeren.
		expect(needsUserConfirmation('måling-1', undefined)).toBe(false);
	});
});

describe('CONFIRMATION_REQUIRED', () => {
	it('sier hva modellen skal gjøre nå, ikke bare at det ble avvist', () => {
		// Et bart «avvist» får modellen til å prøve igjen med samme argumenter.
		expect(CONFIRMATION_REQUIRED.ok).toBe(false);
		expect(CONFIRMATION_REQUIRED.hint).toContain('spør');
		expect(CONFIRMATION_REQUIRED.hint).toContain('etter at brukeren har svart ja');
	});
});
