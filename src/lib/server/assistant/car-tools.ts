import type { AssistantTool } from './tools';
import { getNearbyChargersForUser } from '$lib/server/integrations/tesla-sync';

/**
 * Bil-verktøy som hører hjemme på serveren. Kjøreruting og lagrede steder eies bevisst av
 * Ekko-klienten (on-device) — se klient-verktøyene i `client-tools.ts` — fordi sensitive
 * `SavedPlace`-koordinater aldri skal forlate enheten. Serveren beholder kun det som ikke har
 * sted-personvern: ladere nær bilen (Tesla) og biltilstand (delt `query_tesla_vehicle`).
 */
export const CAR_ASSISTANT_TOOLS: AssistantTool[] = [
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
