/**
 * Leseverktøy for treningsflatas egne tall.
 *
 * Fram til dette fantes bare `query_sensor_data` med `metric='effort'|'workouts'`,
 * som returnerer rå ukesaggregater. Så på «ser du belastning/effort/trening denne
 * uka?» svarte modellen «10 treningsøkter, 94,2 km» mens fanen ved siden av viste
 * «426 av 232–278», «−14, Sliten» og «Balanse 36/100». Ikke en hallusinasjon —
 * bare alt den hadde.
 *
 * Datainnhentingen gjenbruker `loadTrainingDashboardData`, altså samme kilde som
 * flaten. Det er med vilje: to veier inn til de samme tallene ville drevet fra
 * hverandre, og da er en assistent som sier noe annet enn skjermen verre enn en
 * som ikke svarer. Sammendraget bor i `$lib/domain/ai/training-summary.ts` og er
 * testet uten database.
 */

import { z } from 'zod';
import { loadTrainingDashboardData } from '$lib/server/training-dashboard';
import {
	summarizeTrainingForChat,
	type TrainingQueryType
} from '$lib/domain/ai/training-summary';

export const queryTrainingTool = {
	name: 'query_training',
	description: `Les treningsflatas beregnede tall — belastning, ukesbudsjett, balanse, kapasitet og treningsløp. Dette er de SAMME tallene brukeren ser på Trening-temaet.

Bruk denne, ikke query_sensor_data, når brukeren spør om belastning, effort, form, hvor hard uka har vært, om det er rom for en hard økt, restitusjon, pulsfall eller VO2max. query_sensor_data gir rå økt-tellinger og distanser; det er et annet spørsmål.

queryType:
- 'load' (standard): ukas effort mot båndet (bandMin–bandMax), prognose for uka, og belastningen bak den — CTL (form), ATL (tretthet), TSB (balanse) med ferdig klassifisering.
- 'balance': fordelingen mellom disipliner siste fire uker, løpsintensitet, styrkedekning, og den ene nudgen som peker på det største avviket.
- 'capacity': VO2max og pulsfall (HRR60).
- 'sessions': de siste utholdenhetsøktene med effort, km og minutter.
- 'plan': aktivt treningsløp, dagens forslag, forventet tempo og milepæler.
- 'volume': akkumulerte løpte kilometer hittil i år og hittil i måneden, mot de foregående årene og månedene PÅ SAMME DAG i perioden. Bruk denne på «hvor mye har jeg løpt i år», «ligger jeg foran i fjor», «er dette en god måned».

Om tallene:
- effort er TRIMP når puls finnes, MET-fallback ellers. El-sykkel teller mindre per minutt enn vanlig sykkel og telles som egen kategori.
- TSB er negativ når akutt belastning ligger over formen. Bruk status.label ordrett («Sliten», «I balanse») — den er delt med kortet på flaten, så du sier det samme som skjermen.
- ctlSettled false betyr at serien er kortere enn CTL-ens 42-dagers tidskonstant; formtallet er da fortsatt på vei opp fra null og skal ikke leses som et nivå.
- vo2max og pulsfall oppgis som BESTE observasjon i vinduet, ikke siste. Begge forutsetter at brukeren presset — en rolig økt gir et lavt tall som bare sier at den var rolig, ikke at formen falt. Si «beste siste åtte uker», ikke «din VO2max er».
- wellAnchored false på pulsfall betyr at fallet var i gang før målingen startet: tallet er et gulv. Si det.
- 'volume' sammenligner på SAMME DAG i perioden, ikke mot fjorårets sluttall. Bruk sentence-feltet ordrett; den bærer regelen. «Du ligger 380 km bak i fjor» er sant hver vår og betyr ingenting.
- completed er tidligere perioders SLUTTALL. Det er svaret på «hvor mye løp jeg i 2024», ikke på «ligger jeg foran».
- Mangler et felt, si hva som mangler kort — ikke påstå at du ikke har tilgang.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z
			.enum(['load', 'balance', 'capacity', 'sessions', 'plan', 'volume'])
			.optional()
			.describe('Hvilket utsnitt. Default load.')
	}),

	execute: async (args: { userId: string; queryType?: TrainingQueryType }) => {
		// evaluateMilestones utelates: et leseverktøy skal ikke skrive til basen.
		const payload = await loadTrainingDashboardData(args.userId);
		return summarizeTrainingForChat(payload, args.queryType ?? 'load');
	}
};
