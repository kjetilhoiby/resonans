import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEffortBaseline } from '$lib/server/services/effort-service';
import {
	HR_ZONE_PURPOSES,
	hrZoneBands,
	isUsableHrBaseline
} from '$lib/domain/health/hr-zones';

/**
 * GET /api/apps/heart-rate-baseline
 *
 * Hvilepuls, makspuls og de fem sonebåndene i bpm — til sonecoaching i Ekko.
 *
 * ## Hvorfor endepunktet finnes
 *
 * Soner er DEFINERT av makspulsen. Ekko hadde til august 2026 bare en
 * `UserDefaults`-verdi med fallback 190, mens Resonans hele tiden har utledet
 * makspulsen ordentlig (`resolveMaxHr`: brukerens egen verdi → Tanaka på alder →
 * persentil-trimmet observert topp) og hvilepulsen fra søvn framfor fra økter.
 * Ti slag feil makspuls flytter hele Z2-båndet rundt sju slag — altså mer enn
 * bredden på slingringsmonnet en coach opererer med. Appen coachet mot et gjettet
 * tall, og den gjetningen er den ene inngangsverdien alt annet hviler på.
 *
 * ## Hvorfor båndene sendes ferdig utregnet
 *
 * Serveren kunne nøyd seg med `restHr`/`maxHr` og latt appen regne. Men da bor
 * grensene to steder, i to språk, og de driver fra hverandre uten at noe sier
 * fra — nøyaktig den feilen dette arbeidet retter. Appen skal kunne SI båndet
 * («Sone 2 i dag. 128 til 140») uten å ha en formel; regnestykket er serverens.
 *
 * `usable: false` når pulsreserven er for liten til å tro på. Da skal appen
 * skru av sonecoaching og si hvorfor, ikke falle tilbake på et gjettet bånd.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const baseline = await getEffortBaseline(userId);
	const bands = hrZoneBands(baseline);

	return json({
		restHr: baseline.restHr,
		maxHr: baseline.maxHr,
		/** 'default' betyr at ingen av brukerens data holdt — appen bør si det. */
		restHrSource: baseline.restHrSource ?? 'default',
		maxHrSource: baseline.maxHrSource ?? 'default',
		/** false = begge tallene er fallback-verdier, ikke utledet av brukerens data. */
		derived: baseline.derived,
		/** Referansetempo for rolig løping, når vi har nok økter. Null ellers. */
		easyPaceSecPerKm: baseline.easyPaceSecPerKm ?? null,
		usable: isUsableHrBaseline(baseline),
		basis: 'hrr' as const,
		zones:
			bands?.map((band) => ({
				zone: band.zone,
				label: band.label,
				purpose: HR_ZONE_PURPOSES[band.zone],
				lowerBpm: band.lowerBpm,
				upperBpm: band.upperBpm
			})) ?? []
	});
};
