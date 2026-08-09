export interface ExternalAppConfig {
	id: string;
	label: string;
	deepLinkScheme: string;
	sensorProvider: string;
	sensorType: string;
	sensorSubtype: string;
}

const APP_REGISTRY: Record<string, ExternalAppConfig> = {
	ekko: {
		id: 'ekko',
		label: 'Ekko',
		deepLinkScheme: 'ekko',
		sensorProvider: 'ekko',
		sensorType: 'gps_device',
		sensorSubtype: 'iphone'
	},
	ping: {
		id: 'ping',
		label: 'Ping',
		deepLinkScheme: 'ping',
		sensorProvider: 'ping',
		sensorType: 'smart_plug',
		sensorSubtype: 'appliance_monitor'
	},
	/**
	 * Apple Health, lest av Ekko på telefonen.
	 *
	 * Ikke en app for seg — Ekko er transporten, og deler derfor deep link-skjema
	 * med den. Oppføringen finnes for at sensoren `healthkit` skal defineres ett
	 * sted: importen skal være synlig som egen kilde i `/settings/sources`, og
	 * kunne angres ved å slette én sensors hendelser.
	 */
	healthkit: {
		id: 'healthkit',
		label: 'Apple Health',
		deepLinkScheme: 'ekko',
		sensorProvider: 'healthkit',
		sensorType: 'health_tracker',
		sensorSubtype: 'iphone'
	}
};

export function getAppConfig(appId: string): ExternalAppConfig | null {
	return APP_REGISTRY[appId] ?? null;
}

export function getAllApps(): ExternalAppConfig[] {
	return Object.values(APP_REGISTRY);
}
