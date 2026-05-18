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
	}
};

export function getAppConfig(appId: string): ExternalAppConfig | null {
	return APP_REGISTRY[appId] ?? null;
}

export function getAllApps(): ExternalAppConfig[] {
	return Object.values(APP_REGISTRY);
}
