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
