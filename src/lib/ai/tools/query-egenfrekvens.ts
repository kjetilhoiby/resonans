/**
 * Leseverktøy for egenfrekvens — innsjekkene på balanse, tanker, følelser og
 * handlinger.
 *
 * Dette hullet var det største av de fire: det finnes ingen
 * `query_sensor_data`-metrikk for `egenfrekvens_checkin`, så chatten kunne ikke se
 * innsjekkene i det hele tatt. På «hvordan har uka mi vært?» hadde modellen
 * ingenting — i det domenet der brukeren har skrevet mest selv.
 *
 * Samme kilde som flaten, av samme grunn som `query_training`.
 */

import { z } from 'zod';
import { loadEgenfrekvensDashboardData } from '$lib/server/egenfrekvens-dashboard';
import {
	summarizeEgenfrekvensForChat,
	type EgenfrekvensQueryType
} from '$lib/domain/ai/egenfrekvens-summary';

/** Leservinduet. Samme default som dashboardet. */
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 90;

export const queryEgenfrekvensTool = {
	name: 'query_egenfrekvens',
	description: `Les egenfrekvens-innsjekkene — balanse, tanker, følelser, handlinger og det brukeren selv har skrevet. Samme data brukeren ser på Egenfrekvens-temaet.

Bruk denne når brukeren spør hvordan de har hatt det, om overskudd eller underskudd, om stress, om mønstre i humøret, eller viser til noe de har sjekket inn. Ingen annen tool ser disse dataene.

queryType:
- 'recent' (standard): dagene siste to uker med balanse, nivåer og brukerens egne notater.
- 'trend': snitt over perioden, og snitt per periode av døgnet (natt/morgen/arbeidsdag/ettermiddag/kveld) — det er der mønsteret vises.
- 'latest': siste dag i detalj, med hver periode-innsjekk for seg.

Om tallene:
- Balanse går fra −5 til 5 med 0 som nøytralt. Bruk balanceLabel — brukerens egen merkelapp fra slideren («Underskudd», «Overskudd») — framfor å tolke tallet selv.
- Nivå er 1–5 per periode, høyere er bedre.
- byPeriod er poenget i et trend-svar: «morgenene er tunge, kveldene greie» er et annet svar enn et lavt dagssnitt.
- noteTruncated true betyr at brukeren skrev mer enn du fikk se. Ikke oppsummer det som om du leste alt — spør heller.
- reflectionSynthesis er et sammendrag av en refleksjonstråd, ikke brukerens egne setninger. Ikke siter det som et sitat.

Dette er selvrapportering om hvordan noen har det. Møt det som er sagt, ikke tallene alene, og ikke still en diagnose.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z
			.enum(['recent', 'trend', 'latest'])
			.optional()
			.describe('Hvilket utsnitt. Default recent.'),
		days: z.number().optional().describe('Antall dager tilbake (default 30, maks 90)')
	}),

	execute: async (args: { userId: string; queryType?: EgenfrekvensQueryType; days?: number }) => {
		const rangeDays = Math.min(
			MAX_RANGE_DAYS,
			Math.max(1, Math.round(args.days ?? DEFAULT_RANGE_DAYS))
		);
		const payload = await loadEgenfrekvensDashboardData(args.userId, rangeDays);
		return summarizeEgenfrekvensForChat(payload, args.queryType ?? 'recent');
	}
};
