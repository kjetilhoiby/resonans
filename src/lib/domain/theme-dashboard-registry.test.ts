import { describe, it, expect } from 'vitest';
import { resolveThemeDashboardKind, getThemeDashboardDefinition } from './theme-dashboard-registry';

describe('resolveThemeDashboardKind — kjøretøy', () => {
	it('matcher kjøretøy-temanavn', () => {
		expect(resolveThemeDashboardKind('Bil')).toBe('vehicle');
		expect(resolveThemeDashboardKind('Kjøretøy')).toBe('vehicle');
		expect(resolveThemeDashboardKind('Tesla')).toBe('vehicle');
		expect(resolveThemeDashboardKind('Elbil')).toBe('vehicle');
	});

	it('gir kjøretøy-definisjon med riktig ikon og label', () => {
		expect(getThemeDashboardDefinition('Bil')).toEqual({
			kind: 'vehicle',
			label: 'Kjøretøy',
			icon: '🚗'
		});
	});

	it('kolliderer ikke med andre dashboards', () => {
		expect(resolveThemeDashboardKind('Økonomi')).toBe('economics');
		expect(resolveThemeDashboardKind('Hjem')).toBe('home');
		expect(resolveThemeDashboardKind('Helse')).toBe('health');
	});
});

describe('resolveThemeDashboardKind — film', () => {
	it('matcher film-temanavn', () => {
		expect(resolveThemeDashboardKind('Film')).toBe('film');
		expect(resolveThemeDashboardKind('Filmer')).toBe('film');
		expect(resolveThemeDashboardKind('Kino')).toBe('film');
		expect(resolveThemeDashboardKind('Movies')).toBe('film');
	});

	it('gir film-definisjon med riktig ikon og label', () => {
		expect(getThemeDashboardDefinition('Film')).toEqual({
			kind: 'film',
			label: 'Film',
			icon: '🎬'
		});
	});

	it('kolliderer ikke med bøker eller familie', () => {
		expect(resolveThemeDashboardKind('Bøker')).toBe('books');
		expect(resolveThemeDashboardKind('Familie')).toBe('family');
		// "film" (4 tegn) matcher kun som helt ord, ikke som delstreng i andre navn
		expect(resolveThemeDashboardKind('Filantropi')).toBeNull();
	});
});

describe('resolveThemeDashboardKind — helse-mortemaet og undertemaene', () => {
	it('gir mortemaet health', () => {
		expect(resolveThemeDashboardKind('Helse')).toBe('health');
	});

	it('gir hvert undertema sin egen dashboardtype', () => {
		expect(resolveThemeDashboardKind('Trening')).toBe('training');
		expect(resolveThemeDashboardKind('Søvn')).toBe('sleep');
		expect(resolveThemeDashboardKind('Skjermtid')).toBe('screentime');
		expect(resolveThemeDashboardKind('Ernæring')).toBe('nutrition');
		expect(resolveThemeDashboardKind('Egenfrekvens')).toBe('egenfrekvens');
	});

	it('gir definisjon med label og ikon for de nye typene', () => {
		expect(getThemeDashboardDefinition('Trening')).toEqual({ kind: 'training', label: 'Trening', icon: '🏃' });
		expect(getThemeDashboardDefinition('Søvn')).toEqual({ kind: 'sleep', label: 'Søvn', icon: '😴' });
		expect(getThemeDashboardDefinition('Skjermtid')).toEqual({ kind: 'screentime', label: 'Skjermtid', icon: '📱' });
		expect(getThemeDashboardDefinition('Ernæring')).toEqual({ kind: 'nutrition', label: 'Ernæring', icon: '🥗' });
	});

	it('matcher norske tegn som ikke dekomponeres (ø og æ)', () => {
		// «ø» og «æ» har ingen kanonisk dekomponering, så en ASCII-skrevet term
		// ville aldri truffet disse navnene. Begge skrivemåter skal virke.
		expect(resolveThemeDashboardKind('Søvn')).toBe('sleep');
		expect(resolveThemeDashboardKind('Sovn')).toBe('sleep');
		expect(resolveThemeDashboardKind('Ernæring')).toBe('nutrition');
		expect(resolveThemeDashboardKind('Ernaring')).toBe('nutrition');
		expect(resolveThemeDashboardKind('Løping')).toBe('training');
		expect(resolveThemeDashboardKind('Loping')).toBe('training');
	});

	it('lar sammensatte helsenavn beholde mordashboardet', () => {
		// health står før training/sleep i matcher-lista nettopp for dette.
		expect(resolveThemeDashboardKind('Helse og trening')).toBe('health');
		expect(resolveThemeDashboardKind('Helse og søvn')).toBe('health');
	});

	it('ruter psykisk/mental helse til egenfrekvens, ikke health', () => {
		// Regresjonsvern: «helse» er 5 tegn og matcher som delstreng, så
		// egenfrekvens må stå først i lista for at disse skal treffe riktig.
		expect(resolveThemeDashboardKind('Psykisk helse')).toBe('egenfrekvens');
		expect(resolveThemeDashboardKind('Mental helse')).toBe('egenfrekvens');
		expect(resolveThemeDashboardKind('Mental trening')).toBe('egenfrekvens');
	});

	it('lar ernæring ikke stjele mat-temaer', () => {
		expect(resolveThemeDashboardKind('Mat')).toBe('food');
		expect(resolveThemeDashboardKind('Mat og ernæring')).toBe('food');
		expect(resolveThemeDashboardKind('Kosthold og mat')).toBe('food');
		expect(resolveThemeDashboardKind('Kosthold')).toBe('nutrition');
	});

	it('lar aktivitets-temaer være i fred for treningsdashboardet', () => {
		// «aktivitet» blir bevisst liggende på health: flyttet til training
		// ville disse fått treningsprogram og baseline-skjema.
		expect(resolveThemeDashboardKind('Barnas aktiviteter')).toBe('health');
		expect(resolveThemeDashboardKind('Fritidsaktiviteter')).toBe('health');
		expect(resolveThemeDashboardKind('Fysisk aktivitet')).toBe('health');
	});

	it('gir vekt og kropp sitt eget dashboard', () => {
		/**
		 * Snudd i august 2026. Begrunnelsen for å holde vekt på mortemaet var at det
		 * er utfallsmålet de andre grenene driver — men en høst der vekt er
		 * hovedfokuset trenger sin egen historikk, sine milepæler og sin egen graf.
		 */
		expect(resolveThemeDashboardKind('Vekt')).toBe('weight');
		expect(resolveThemeDashboardKind('Kropp')).toBe('weight');
		expect(resolveThemeDashboardKind('Kroppsvekt')).toBe('weight');
	});

	it('lar sammensatte helse-navn beholde mordashboardet', () => {
		// Rekkefølgen i matcheren: health står før weight, så «helse» vinner.
		expect(resolveThemeDashboardKind('Helse og vekt')).toBe('health');
	});

	it('lar korte termer ikke matche inni lengre ord', () => {
		// «løp»/«run» er ≤ 4 tegn og matcher kun som helt ord.
		expect(resolveThemeDashboardKind('Løp')).toBe('training');
		expect(resolveThemeDashboardKind('Litteratur')).toBe('books');
	});
});

describe('skrivetema', () => {
	it('gjenkjenner temanavnet', () => {
		expect(resolveThemeDashboardKind('Skriving')).toBe('writing');
		expect(resolveThemeDashboardKind('skriveprosjekt')).toBe('writing');
		expect(resolveThemeDashboardKind('Forfatterskap')).toBe('writing');
	});

	it('kaprer ikke temaer som bare inneholder «skriv» som delstreng', () => {
		// «skriv» er 5 tegn og ville matchet som delstreng — derfor er termene
		// bevisst lange. Dette er regelen som gjorde at tema ble valgt bort i
		// fase 2 på feil grunnlag.
		expect(resolveThemeDashboardKind('Beskrivelse av huset')).not.toBe('writing');
		expect(resolveThemeDashboardKind('Jobbeskrivelse')).not.toBe('writing');
	});

	it('stjeler ikke fra eksisterende temaer', () => {
		expect(resolveThemeDashboardKind('Helse')).toBe('health');
		expect(resolveThemeDashboardKind('Vekt')).toBe('weight');
		expect(resolveThemeDashboardKind('Bøker')).toBe('books');
	});
});
