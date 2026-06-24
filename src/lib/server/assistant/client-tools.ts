import type OpenAI from 'openai';

/**
 * Klient-verktøy (allow-list) som KJØRES PÅ EKKO-ENHETEN, ikke på serveren. Kjøreruting og
 * lagrede steder bor on-device fordi sensitive `SavedPlace`-koordinater aldri skal forlate
 * enheten. Serveren tilbyr definisjonene til modellen, men når modellen kaller ett av dem,
 * suspenderes turen: toolCall-en sendes til klienten, som kjører den og POSTer resultatet
 * tilbake til /api/apps/assistant/tool-result. Kun lesing/deling — ingen bil-kommandoer.
 *
 * Kontrakten (args = kun strenger; resultatfelt) matcher Ekkos ASSISTANT_HYBRID_TOOLS.md.
 */
export const CLIENT_TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
	{
		type: 'function',
		function: {
			name: 'driveDistance',
			description:
				'Kjøreavstand og estimert kjøretid fra bilens posisjon til et sted. Beregnes på enheten. Returnerer distanceKm, etaMinutes, destinationName. Bruk for «hvor langt/lenge er det å kjøre til X».',
			parameters: {
				type: 'object',
				properties: {
					to: {
						type: 'string',
						description: 'Reisemål ved navn — offentlig sted eller brukerens lagrede sted (f.eks. «IKEA Furuset», «Hytta»)'
					}
				},
				required: ['to']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'resolvePlace',
			description:
				'Slå opp / bekreft et sted ved navn (inkludert brukerens lagrede steder). Returnerer destinationName og found. Bruk for å sjekke at et sted finnes før du svarer.',
			parameters: {
				type: 'object',
				properties: {
					name: { type: 'string', description: 'Stedsnavn å slå opp' },
					to: { type: 'string', description: 'Alternativt feltnavn for stedet' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'nearestPlace',
			description:
				'Nærmeste kjente/lagrede sted til bilens nåværende posisjon. Returnerer placeName og found. Bruk for «hvor er bilen» / «hva er i nærheten».',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'sendToCar',
			description:
				'Del et reisemål til bilens navigasjon (lager en delelenke på enheten). Returnerer destinationName og shareURL. Dette er en handling — bekreft med brukeren før du kaller den.',
			parameters: {
				type: 'object',
				properties: { to: { type: 'string', description: 'Reisemål å sende til bilen' } },
				required: ['to']
			}
		}
	}
];

/** Navnene som rutes til klienten (resten kjøres server-side i agent-løkka). */
export const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOL_DEFINITIONS.map((d) => d.function.name));
