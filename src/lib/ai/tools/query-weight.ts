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
- 'monthly': snittvekt per måned gjennom HELE historikken, med hull fylt av interpolasjon. Bruk denne på «list vekta per måned», «hvordan har vekta gått år for år», «snittvekt i 2019».

ALDRI finn på månedstall. Trenger du en serie, hent 'monthly' — den finnes. Et oppdiktet tall merket «interpolert» er verre enn å si at du ikke vet, fordi merkelappen gir oppspinnet en metode.

Om 'monthly':
- Hver rad har source: 'measured' (snitt av dagsverdiene den måneden) eller 'interpolated' (regnet lineært mellom nabomånedene). SI hvilke som er anslag — ikke presenter dem som målinger.
- gapMonths på en interpolert rad sier hvor stort hullet den ligger i er. Et anslag midt i et hull på fjorten måneder skal kvalifiseres, ikke oppgis som et tall.
- measuredFrom er første måned med en ekte måling. Spør brukeren om data lenger tilbake enn det, er DET svaret — serien er aldri ekstrapolert bakover, og du skal heller ikke gjøre det selv.

Om tallene:
- ALLE endringstall er regnet på TRENDEN (etterslepende 7-dagerssnitt), ikke på enkeltmålinger. Si «trenden», ikke «du veide».
- changes[].actualDays sier hvor langt tilbake referansepunktet faktisk lå. Er den mye større enn windowDays, veide brukeren seg ikke i vinduet — si det framfor å presentere det som «siste 7 dager».
- coverage.enoughHistory false ⇒ ikke kall noe «lavest noensinne». Rekorder krever en historikk å være rekord i.
- Er mer enn omtrent en tredel av nedgangen muskel, skal tonen falle. composition.sentence sier det; ikke feire et vekttap som er muskeltap.
- fatShare er ikke garantert mellom 0 og 1 — falt fettet mer enn vekta fordi muskelen økte, blir den over 1. Bruk setningen framfor å lage en prosent av den.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z
			.enum(['trend', 'milestones', 'composition', 'monthly'])
			.optional()
			.describe('Hvilket utsnitt. Default trend.')
	}),

	execute: async (args: { userId: string; queryType?: WeightQueryType }) => {
		const payload = await loadWeightDashboardData(args.userId);
		return summarizeWeightForChat(payload, args.queryType ?? 'trend');
	}
};
