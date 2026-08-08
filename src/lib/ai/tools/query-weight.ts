/**
 * Leseverktøy for vektflaten.
 *
 * `query_sensor_data` med `metric='weight'` gir siste måling. Det er nettopp
 * tallet som lyver: en dehydrert morgen er ikke en utvikling, og to enkeltmålinger
 * mot hverandre er støy i tilfeldig retning. Trenden, milepælene og
 * kroppssammensetningen fantes bare i `loadWeightDashboardData`.
 *
 * Samme kilde som flaten, av samme grunn som `query_training`.
 */

import { z } from 'zod';
import { loadWeightDashboardData } from '$lib/server/weight-dashboard';
import { summarizeWeightForChat, type WeightQueryType } from '$lib/domain/ai/weight-summary';

export const queryWeightTool = {
	name: 'query_weight',
	description: `Les vektflatas beregnede tall — trend, endring over tid, milepæler og kroppssammensetning. Samme tall brukeren ser på Vekt-temaet.

Bruk denne framfor query_sensor_data når brukeren spør om vekta si, om det går rette veien, om målet, eller om fett og muskel.

queryType:
- 'trend' (standard): siste veiing, trendverdi, endring over 7/30/90 dager, avstand til målvekt, laveste trendverdi i historikken.
- 'milestones': ferdig formulerte milepælsetninger, rangert. Velg ÉN og si den — ikke regn om tallene.
- 'composition': fett og muskel bak vektendringen.

Om tallene:
- ALLE endringstall er regnet på TRENDEN (etterslepende 7-dagerssnitt), ikke på enkeltmålinger. Si «trenden», ikke «du veide».
- changes[].actualDays sier hvor langt tilbake referansepunktet faktisk lå. Er den mye større enn windowDays, veide brukeren seg ikke i vinduet — si det framfor å presentere det som «siste 7 dager».
- coverage.enoughHistory false ⇒ ikke kall noe «lavest noensinne». Rekorder krever en historikk å være rekord i.
- Er mer enn omtrent en tredel av nedgangen muskel, skal tonen falle. composition.sentence sier det; ikke feire et vekttap som er muskeltap.
- fatShare er ikke garantert mellom 0 og 1 — falt fettet mer enn vekta fordi muskelen økte, blir den over 1. Bruk setningen framfor å lage en prosent av den.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z
			.enum(['trend', 'milestones', 'composition'])
			.optional()
			.describe('Hvilket utsnitt. Default trend.')
	}),

	execute: async (args: { userId: string; queryType?: WeightQueryType }) => {
		const payload = await loadWeightDashboardData(args.userId);
		return summarizeWeightForChat(payload, args.queryType ?? 'trend');
	}
};
