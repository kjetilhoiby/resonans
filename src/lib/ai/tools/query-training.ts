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
- 'trailing': SLEPENDE volum — summen av siste 7, 30 og 90 dager, med brukerens eget kvartilbånd for samme tid på året, og rampen mot forrige like lange vindu. Bruk denne på «hvor mye løper jeg nå», «er jeg i rute», «bygger jeg opp», «har volumet falt». Dette er et ANNET spørsmål enn 'volume': den nullstilles 1. januar, denne gjør ikke det.
- 'quality': INTENSITET — rolige minutter, kvalitetsminutter og minutter «i midten» per uke siste tolv uker (weeklyMinutes), pluss andelen rolige/grå/harde ØKTER siste 7/30/90 dager. Bruk denne på «trener jeg riktig», «er det for mye i midten», «er treningen polarisert», «nok rolig trening», «nok hardt».

Om tallene:
- effort er TRIMP når puls finnes, MET-fallback ellers. El-sykkel teller mindre per minutt enn vanlig sykkel og telles som egen kategori.
- TSB er negativ når akutt belastning ligger over formen. Bruk status.label ordrett («Sliten», «I balanse») — den er delt med kortet på flaten, så du sier det samme som skjermen.
- ctlSettled false betyr at serien er kortere enn CTL-ens 42-dagers tidskonstant; formtallet er da fortsatt på vei opp fra null og skal ikke leses som et nivå.
- vo2max og pulsfall oppgis som BESTE observasjon i vinduet, ikke siste. Begge forutsetter at brukeren presset — en rolig økt gir et lavt tall som bare sier at den var rolig, ikke at formen falt. Si «beste siste åtte uker», ikke «din VO2max er».
- wellAnchored false på pulsfall betyr at fallet var i gang før målingen startet: tallet er et gulv. Si det.
- 'volume' sammenligner på SAMME DAG i perioden, ikke mot fjorårets sluttall. Bruk sentence-feltet ordrett; den bærer regelen. «Du ligger 380 km bak i fjor» er sant hver vår og betyr ingenting.
- completed er tidligere perioders SLUTTALL. Det er svaret på «hvor mye løp jeg i 2024», ikke på «ligger jeg foran».
- 'trailing' og 'quality' har hver et sentence-felt per vindu. SITER det ordrett — det bærer forbeholdene: hva sammenligningen ble gjort mot, og at en bratt rampe IKKE er en dom om kroppen. Restitusjonsspørsmålet svares av 'load' (TSB), aldri av rampen.
- En bratt rampe i 'trailing' betyr at volumet vokser fort, ikke at brukeren har overtrent. To ulike dommer om «for mye» blir aldri enige; si «rask oppbygging» og vis til formkurven.
- weeklyMinutes er HOVEDSVARET i 'quality', og de tre tallene er UAVHENGIGE: «nok rolig» og «nok hardt» kan svares ja på det ene og nei på det andre. Regn dem ALDRI om til et forholdstall — 80 % grått og 20 % grått er også 80/20. Bruk qualityMinutes og qualityPerActiveWeek som absolutte tall.
- «I midten» (greyMinutes) er tid over sone 2 som IKKE ligger i en sammenhengende blokk over sone 4s gulv — for hardt til å bygge grunnmur billig, for kort til å flytte terskelen. Den blir aldri null: oppvarming, nedjogg og bakker på rolige turer havner der. Ikke sett et mål om 0, og ikke kall et tall høyt uten å ha ukene å sammenligne med — sentence sier det selv når det er for få uker.
- Kvalitetsminutter krever en SAMMENHENGENDE blokk (minst ett minutt) over sone 4s gulv. Fire bakker à 30 sekunder gir derfor 0 kvalitetsminutter og havner i midten — det er riktig, og det er hele grunnen til at målingen finnes.
- weeklyMinutes.coverage sier hvor mange økter i perioden som har tidsdelingen. withSplit 0 betyr at målingen er ny og historikken ikke er analysert ennå — si det, ikke at brukeren ikke har trent.
- Bøttene (windows/buckets) teller ØKTER, ikke minutter, og er BAKGRUNN til weeklyMinutes. coverage under 0,5 eller classifiedSessions under 5 betyr at fordelingen IKKE skal brukes — sentence sier det da selv. Si hvor mange økter som mangler, framfor å presentere andeler som fakta.
- Karakterene er en proxy: polarisert trening er definert av laktatterskler vi ikke måler. Si «grå er den største bøtta», ikke «du er 68/22/10».
- Mangler et felt, si hva som mangler kort — ikke påstå at du ikke har tilgang.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z
			.enum(['load', 'balance', 'capacity', 'sessions', 'plan', 'volume', 'trailing', 'quality'])
			.optional()
			.describe('Hvilket utsnitt. Default load.')
	}),

	execute: async (args: { userId: string; queryType?: TrainingQueryType }) => {
		// evaluateMilestones utelates: et leseverktøy skal ikke skrive til basen.
		const payload = await loadTrainingDashboardData(args.userId);
		return summarizeTrainingForChat(payload, args.queryType ?? 'load');
	}
};
