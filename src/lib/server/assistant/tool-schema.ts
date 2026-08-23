/**
 * Zod-parametrene på et delt verktøy → funksjonsdefinisjonen OpenAI vil ha.
 *
 * ## Hvorfor dette bor for seg
 *
 * Chat-endepunktet hadde **håndskrevne kopier** av skjemaene for verktøy som alt
 * hadde zod-parametre i verktøymodulen. Det er ikke en teoretisk fare: 23. august
 * 2026 fikk `create_goal` en `targetWeightKg`-parameter og en beskrivelse som sa at
 * vektmål oppgis som en MÅLVEKT — men web-chatten leste sin egen kopi, der det
 * fortsatt sto «-3 for kg ned». Modellen fulgte kopien, sendte en endring, og målet
 * siktet mot 93 kg der brukeren hadde sagt 95. Instruksen fantes, men ikke på flaten
 * brukeren brukte.
 *
 * Modulen ligger ved siden av `shared-tools.ts` framfor inni den, fordi
 * chat-endepunktet bare trenger konverteringen — ikke hele assistent-registeret med
 * alle verktøyimportene sine.
 */

import { z } from 'zod';

/** Felt endepunktet fyller selv, og som modellen derfor ikke skal se. */
const ALWAYS_OMITTED = ['userId'];

export function toParametersSchema(parameters: unknown, omit: Set<string>): Record<string, unknown> {
	const hasShape =
		!!parameters && typeof parameters === 'object' && 'shape' in (parameters as Record<string, unknown>);
	if (!hasShape) return { type: 'object', properties: {} };

	const shape = { ...(parameters as { shape: Record<string, z.ZodType> }).shape };
	for (const key of omit) delete shape[key];

	try {
		const schema = z.toJSONSchema(z.object(shape), {
			io: 'input',
			unrepresentable: 'any'
		}) as Record<string, unknown>;
		delete schema.$schema;
		return schema;
	} catch (error) {
		console.warn('[tool-schema] kunne ikke konvertere parameters-skjema:', error);
		return { type: 'object', properties: {}, additionalProperties: true };
	}
}

interface SharedToolShape {
	name: string;
	description?: string;
	parameters?: unknown;
}

/**
 * Verktøyet som en OpenAI-funksjonsdefinisjon, med beskrivelsen fra modulen.
 *
 * Bruk denne i chat-endepunktets `tools`-liste framfor å skrive skjemaet av: en kopi
 * driver fra originalen uten at noe blir rødt.
 */
export function openAiFunctionDefinition(
	tool: SharedToolShape,
	opts: { omit?: string[] } = {}
) {
	return {
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description ?? tool.name,
			parameters: toParametersSchema(
				tool.parameters,
				new Set([...ALWAYS_OMITTED, ...(opts.omit ?? [])])
			)
		}
	};
}
