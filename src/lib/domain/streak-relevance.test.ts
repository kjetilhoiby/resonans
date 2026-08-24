import { describe, it, expect } from 'vitest';
import { isStreakRelevantForTheme, streakDashboardKind } from './streak-relevance';

describe('streakDashboardKind', () => {
	it('sender treningsøkter til trening', () => {
		expect(streakDashboardKind({ kind: 'workout', sportFamily: 'running' })).toBe('training');
	});

	it('sender en datatype dit datatypen hører', () => {
		expect(streakDashboardKind({ kind: 'sensor_event', dataType: 'weight' })).toBe('weight');
		expect(streakDashboardKind({ kind: 'sensor_event', dataType: 'nutrition' })).toBe('nutrition');
		expect(streakDashboardKind({ kind: 'sensor_event', dataType: 'sleep' })).toBe('sleep');
	});

	it('gir null for en datatype uten flate', () => {
		expect(streakDashboardKind({ kind: 'sensor_event', dataType: 'tesla_charge' })).toBeNull();
	});

	it('gir null for manuelle streaks — tittelen er ikke en kilde', () => {
		// «Badevask» hører kanskje på Hjem, men å lese det ut av teksten treffer
		// nesten, og et kort på feil tema er verre enn et kort som ikke kommer.
		expect(streakDashboardKind({ kind: 'manual' })).toBeNull();
	});
});

describe('isStreakRelevantForTheme', () => {
	const løping = { source: { kind: 'workout', sportFamily: 'running' } as const };

	it('viser løpestreaken på et treningstema uten at noen har koblet den', () => {
		expect(isStreakRelevantForTheme(løping, { themeId: 't1', dashboardKind: 'training' })).toBe(true);
	});

	it('viser den ikke på et urelatert tema', () => {
		expect(isStreakRelevantForTheme(løping, { themeId: 't2', dashboardKind: 'economics' })).toBe(
			false
		);
	});

	it('lar en eksplisitt kobling vinne', () => {
		const koblet = { ...løping, themeId: 'maraton' };
		expect(isStreakRelevantForTheme(koblet, { themeId: 'maraton', dashboardKind: null })).toBe(true);
	});

	it('lar en eksplisitt kobling også UTELUKKE andre temaer', () => {
		// Har brukeren sagt at streaken hører på «Maraton 2027», skal den ikke også
		// stå på Trening — ellers blir et bevisst valg en tilleggsplassering.
		const koblet = { ...løping, themeId: 'maraton' };
		expect(isStreakRelevantForTheme(koblet, { themeId: 't1', dashboardKind: 'training' })).toBe(
			false
		);
	});

	it('viser en manuell streak bare der den er koblet', () => {
		const badevask = { source: { kind: 'manual' } as const, themeId: 'hjem' };
		expect(isStreakRelevantForTheme(badevask, { themeId: 'hjem', dashboardKind: 'home' })).toBe(true);
		expect(
			isStreakRelevantForTheme({ source: { kind: 'manual' } as const }, { dashboardKind: 'home' })
		).toBe(false);
	});
});
