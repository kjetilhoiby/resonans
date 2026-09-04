import { describe, it, expect } from 'vitest';
import { isPublicPath } from './public-paths';

describe('isPublicPath — /api/diagnostikk er eksakt match', () => {
	it('er offentlig i seg selv', () => {
		expect(isPublicPath('/api/diagnostikk')).toBe(true);
		expect(isPublicPath('/api/diagnostikk/')).toBe(true);
	});

	// Samme vakt som for /api/health: et framtidig detaljendepunkt skal måtte
	// be om tilgang selv, ikke arve åpenheten fra forelderen.
	it('krever auth for alt UNDER /api/diagnostikk/', () => {
		expect(isPublicPath('/api/diagnostikk/detaljer')).toBe(false);
		expect(isPublicPath('/api/diagnostikk/logger')).toBe(false);
		expect(isPublicPath('/api/diagnostikk/hva-som-helst')).toBe(false);
	});

	it('treffer ikke et navn som bare begynner likt', () => {
		expect(isPublicPath('/api/diagnostikk-intern')).toBe(false);
	});
});

describe('isPublicPath — /api/health er eksakt match', () => {
	it('slipper gjennom helsesjekken selv', () => {
		expect(isPublicPath('/api/health')).toBe(true);
	});

	it('slipper gjennom med etterfølgende skråstrek', () => {
		// Hooks kjører før SvelteKit normaliserer trailing slash, så begge former
		// må treffe — ellers ville uptime-sjekken plutselig krevd innlogging.
		expect(isPublicPath('/api/health/')).toBe(true);
	});

	it('krever auth for alt UNDER /api/health/', () => {
		// Regresjonsvern mot tre reelle bugs: effort-weight (prod-feil),
		// weight-onboarding (stille 401) og weight-series (200 med tomme data
		// til uautentiserte kallere). Alle tre kom av at /api/health var
		// prefiksmatch, slik at locals.userId aldri ble satt.
		expect(isPublicPath('/api/health/weight-series')).toBe(false);
		expect(isPublicPath('/api/health/weight-onboarding')).toBe(false);
		expect(isPublicPath('/api/health/effort-weight')).toBe(false);
		expect(isPublicPath('/api/health/hva-som-helst')).toBe(false);
	});

	it('matcher ikke stier som bare starter med samme tekst', () => {
		// Fanger at eksakt match ikke er blitt til prefiksmatch igjen.
		expect(isPublicPath('/api/healthcheck')).toBe(false);
		expect(isPublicPath('/api/health-status')).toBe(false);
	});
});

describe('isPublicPath — prefikser med reelle undersider', () => {
	it('slipper gjennom cron-endepunktene', () => {
		expect(isPublicPath('/api/cron')).toBe(true);
		expect(isPublicPath('/api/cron/monitoring')).toBe(true);
	});

	it('slipper gjennom delingslenker og live-økter', () => {
		expect(isPublicPath('/api/share-link/abc123')).toBe(true);
		expect(isPublicPath('/api/live/session-42')).toBe(true);
	});

	it('slipper gjennom webhooks og OAuth-callbacks', () => {
		expect(isPublicPath('/api/email-inbound')).toBe(true);
		expect(isPublicPath('/api/email/inbound')).toBe(true);
		expect(isPublicPath('/api/workouts/email-inbound')).toBe(true);
		expect(isPublicPath('/api/scheduler/trigger')).toBe(true);
		expect(isPublicPath('/api/apps/authorize')).toBe(true);
		expect(isPublicPath('/api/apps/callback')).toBe(true);
		expect(isPublicPath('/api/apps/strava/connect')).toBe(true);
		expect(isPublicPath('/api/apps/strava/callback')).toBe(true);
		expect(isPublicPath('/api/apps/live-session/messages')).toBe(true);
	});

	it('slipper gjennom sidestier med undersider', () => {
		expect(isPublicPath('/auth')).toBe(true);
		expect(isPublicPath('/auth/callback')).toBe(true);
		expect(isPublicPath('/design')).toBe(true);
		expect(isPublicPath('/design/flater')).toBe(true);
		expect(isPublicPath('/share/abc')).toBe(true);
		expect(isPublicPath('/partner-invite/xyz')).toBe(true);
		expect(isPublicPath('/live/42')).toBe(true);
	});

	it('slipper gjennom robots og favicon', () => {
		expect(isPublicPath('/robots.txt')).toBe(true);
		expect(isPublicPath('/favicon.ico')).toBe(true);
	});
});

describe('isPublicPath — resten krever auth', () => {
	it('holder appen og de øvrige API-ene lukket', () => {
		expect(isPublicPath('/')).toBe(false);
		expect(isPublicPath('/tema/helse')).toBe(false);
		expect(isPublicPath('/api/tema/123')).toBe(false);
		expect(isPublicPath('/api/helse/vekt-onboarding')).toBe(false);
		expect(isPublicPath('/api/helse/undertema/ensure')).toBe(false);
		expect(isPublicPath('/api/effort-weight')).toBe(false);
		expect(isPublicPath('/api/tracks/plan')).toBe(false);
		expect(isPublicPath('/settings/sources')).toBe(false);
	});

	it('lar Ekkos øvrige app-endepunkter være lukket', () => {
		// Bare de tre eksplisitt listede /api/apps/*-stiene er offentlige;
		// resten går gjennom vanlig auth eller API-hemmelighet.
		expect(isPublicPath('/api/apps/programs')).toBe(false);
		expect(isPublicPath('/api/apps/event')).toBe(false);
		expect(isPublicPath('/api/apps/coach')).toBe(false);
	});
});
