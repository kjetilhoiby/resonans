/**
 * Leseverktøy for søvnflaten.
 *
 * `query_sensor_data` med `metric='sleep'` gir rå søvnrader. Alt som gjør dem
 * lesbare — netter med Withings' segmentdeling slått sammen, dupper skilt ut,
 * døgnrytme, sovepuls mot din egen baseline, HRV, forstyrrelser og søvnmål — lå i
 * `loadSleepDashboardData` og ble bare brukt av dashboardet.
 *
 * Samme kilde som flaten, av samme grunn som `query_training`.
 */

import { z } from 'zod';
import { loadSleepDashboardData } from '$lib/server/sleep-dashboard';
import { summarizeSleepForChat, type SleepQueryType } from '$lib/domain/ai/sleep-summary';

export const querySleepTool = {
	name: 'query_sleep',
	description: `Les søvnflatas beregnede tall — netter, døgnrytme, sovepuls, HRV, forstyrrelser og søvnmål. Samme tall brukeren ser på Søvn-temaet.

Bruk denne framfor query_sensor_data når brukeren spør om søvnen sin, hvorfor de er trøtte, om de sover dårligere enn vanlig, eller om puls og HRV om natta.

queryType:
- 'recent' (standard): nattlengde per natt siste to uker, median leggetid og oppvåkning, dupper, og søvnmålene med status.
- 'physiology': sovepuls og HRV mot brukerens egen baseline, pluss pust/snorking siste natt som hadde tallene.
- 'disturbances': netter med «fikk ikke sove» og «våknet», per natt.

Om tallene:
- Siste natt er tallet, ikke beste natt — søvn måles hver natt uten innsats, i motsetning til VO2max og pulsfall. Baselinen er brukerens egen median over vinduet, med siste natt holdt utenfor.
- Sovepuls: latestRestingBpm (hr_min) er hvilepulsen. latestAverageBpm blander REM og oppvåkninger inn og ligger 5–10 slag høyere — kryssjekk, aldri hovedtallet. Lav puls er bra, så en STIGNING er signalet: band 'over' er det som er verdt å se på.
- HRV: si ALDRI absoluttverdien alene. SDNN varierer for mye mellom folk, og det finnes ingen normtabell. band 'ukjent' betyr for få netter til å regne avvik — da skal tallet ikke tolkes, heller ikke som «normalt».
- Mangler HRV, sier hrvAvailability hvorfor: sleepNights uten nightsWithHrv betyr at søvnen er synket men HRV ikke er. Det er to ulike ting, og brukeren skal få det riktige.
- segments 2 eller mer betyr at natta ble delt fordi brukeren var ute av senga — ikke to netter.
- awakeMinutes null betyr «vet ikke», ikke 0 minutter. Ikke gjett et tall.
- Si aldri noe om apné som en diagnose; apneaHypopneaIndex er enhetens eget tall.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z
			.enum(['recent', 'physiology', 'disturbances'])
			.optional()
			.describe('Hvilket utsnitt. Default recent.')
	}),

	execute: async (args: { userId: string; queryType?: SleepQueryType }) => {
		const payload = await loadSleepDashboardData(args.userId);
		return summarizeSleepForChat(payload, args.queryType ?? 'recent');
	}
};
