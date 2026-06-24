import type { AssistantTool } from './tools';
import { getStoredTeslaState, getNearbyChargersForUser } from '$lib/server/integrations/tesla-sync';

/**
 * Bil- og biltur-verktøy for assistenten — kjernen i «bilekspert»-rollen.
 *
 * Kjøreavstand/-tid bygges på nøkkelfri OpenStreetMap-stack (samme valg som resten av appen):
 *   - geokoding via Nominatim (stedsnavn → koordinater)
 *   - ruting via OSRM (koordinater → kjøreavstand + kjøretid)
 * Startpunkt er bilens lagrede posisjon når brukeren ikke oppgir et eget. Ladeplanlegging gjør
 * modellen ved å kombinere kjøreavstand (driving_route) med bilens rekkevidde
 * (query_tesla_vehicle) og ev. nearby_chargers — derfor holder vi disse verktøyene rene og små.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
// Nominatim/OSRM krever en identifiserbar User-Agent for server-kall.
const USER_AGENT = 'resonans-app/1.0 (https://resonans.no)';

export interface GeoPoint {
	lat: number;
	lon: number;
	label: string;
}

interface NominatimItem {
	lat: string;
	lon: string;
	display_name: string;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const R = 6371;
	const dLat = ((b.lat - a.lat) * Math.PI) / 180;
	const dLon = ((b.lon - a.lon) * Math.PI) / 180;
	const lat1 = (a.lat * Math.PI) / 180;
	const lat2 = (b.lat * Math.PI) / 180;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Velg beste geo-treff: nærmest `near` når den er kjent, ellers Nominatims topptreff. Ren. */
export function pickGeo(items: NominatimItem[], near?: { lat: number; lon: number } | null): GeoPoint | null {
	const parsed: GeoPoint[] = [];
	for (const item of items) {
		const lat = Number.parseFloat(item.lat);
		const lon = Number.parseFloat(item.lon);
		if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
		parsed.push({ lat, lon, label: item.display_name.split(',').slice(0, 2).join(',').trim() });
	}
	if (parsed.length === 0) return null;
	if (!near) return parsed[0];
	return parsed.reduce((best, cur) => (haversineKm(near, cur) < haversineKm(near, best) ? cur : best));
}

/** Geokod et stedsnavn, biaset mot `near` når oppgitt. Returnerer null ved feil/ingen treff. */
export async function geocode(
	name: string,
	near?: { lat: number; lon: number } | null
): Promise<GeoPoint | null> {
	const params = new URLSearchParams({
		q: name,
		format: 'jsonv2',
		limit: '5',
		addressdetails: '1',
		'accept-language': 'nb,en'
	});
	if (near) {
		const d = 2.5; // ~250 km boks: myk nærhets-bias uten å ekskludere fjerne treff
		params.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
		params.set('bounded', '0');
	}
	try {
		const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
			headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
		});
		if (!res.ok) return null;
		return pickGeo((await res.json()) as NominatimItem[], near);
	} catch (error) {
		console.error('[assistant] geokoding feilet:', error);
		return null;
	}
}

/** Trekk ut kjøreavstand (km) og kjøretid (min) fra et OSRM-svar. Ren, så den kan testes. */
export function summarizeOsrmRoute(payload: unknown): { distanceKm: number; durationMin: number } | null {
	const route = (payload as { routes?: Array<{ distance?: unknown; duration?: unknown }> })?.routes?.[0];
	if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') return null;
	return {
		distanceKm: Math.round(route.distance / 100) / 10, // m → km, 1 desimal
		durationMin: Math.round(route.duration / 60) // s → min
	};
}

/** Bilens lagrede posisjon som GeoPoint, eller null hvis ukjent. */
async function carPosition(userId: string): Promise<GeoPoint | null> {
	const car = await getStoredTeslaState(userId);
	const loc = car.connected ? car.state?.location : null;
	if (!loc) return null;
	return { lat: loc.lat, lon: loc.lon, label: 'Bilens posisjon' };
}

export const CAR_ASSISTANT_TOOLS: AssistantTool[] = [
	{
		definition: {
			type: 'function',
			function: {
				name: 'driving_route',
				description:
					'Kjøreavstand og kjøretid mellom to steder (OpenStreetMap/OSRM, uten live trafikk). Startpunkt er bilens nåværende posisjon når du ikke oppgir origin. Bruk for «hvor langt/lenge er det å kjøre til X», og som grunnlag for ladevurdering (sammenlign avstand mot bilens rekkevidde fra query_tesla_vehicle).',
				parameters: {
					type: 'object',
					properties: {
						destination: { type: 'string', description: 'Reisemål, f.eks. «IKEA Furuset» eller «Volda»' },
						origin: {
							type: 'string',
							description: 'Valgfritt startpunkt. Utelat for å bruke bilens nåværende posisjon.'
						}
					},
					required: ['destination']
				}
			}
		},
		run: async (userId, args) => {
			const destination = typeof args.destination === 'string' ? args.destination.trim() : '';
			if (!destination) return { error: 'Oppgi et reisemål.' };

			let origin: GeoPoint | null;
			const originArg = typeof args.origin === 'string' ? args.origin.trim() : '';
			if (originArg) {
				origin = await geocode(originArg);
				if (!origin) return { error: `Fant ikke startstedet «${originArg}».` };
			} else {
				origin = await carPosition(userId);
				if (!origin) {
					return {
						error:
							'Vet ikke hvor bilen står (ingen fersk posisjon). Oppgi et startpunkt med origin, eller be brukeren synke bilen.'
					};
				}
			}

			const dest = await geocode(destination, origin);
			if (!dest) return { error: `Fant ikke reisemålet «${destination}».` };

			try {
				const url = `${OSRM_URL}/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=false`;
				const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
				if (!res.ok) return { error: 'Ruteberegning feilet.' };
				const summary = summarizeOsrmRoute(await res.json());
				if (!summary) return { error: 'Fant ingen kjørerute mellom stedene.' };
				return { origin, destination: dest, ...summary, trafficAware: false };
			} catch (error) {
				console.error('[assistant] OSRM-kall feilet:', error);
				return { error: 'Ruteberegning feilet.' };
			}
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'nearby_chargers',
				description:
					'Ladere nær bilens nåværende posisjon: superchargere med live stall-tilgjengelighet + destination chargers. Krever at bilen er våken og har fersk posisjon (svarer asleep:true ellers).',
				parameters: { type: 'object', properties: {} }
			}
		},
		run: async (userId) => {
			const r = await getNearbyChargersForUser(userId);
			return { asleep: r.asleep, chargers: r.chargers };
		}
	}
];
