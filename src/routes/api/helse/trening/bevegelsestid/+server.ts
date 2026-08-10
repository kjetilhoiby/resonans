import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-auth';
import {
	backfillMovingTime,
	DEFAULT_BACKFILL_LIMIT
} from '$lib/server/health/moving-time-backfill';

export const config = { maxDuration: 60 };

/**
 * Backfill av bevegelsestid på historiske økter.
 *
 * `POST /api/helse/trening/bevegelsestid?limit=500[&dryRun=true]`
 *
 * ## Hvorfor
 *
 * `data.duration` er elapsed — siste sporpunkt minus første. Glemmer man å avslutte
 * sporingen, teller den døde halen fullt ut, og MET-stien i effort-modellen er rent
 * lineær i varighet: en el-sykkeltur på 9,07 km sto som 2 t 20 min og fikk effort 114
 * der svaret var ~20. Samme varighet priser aktivitetsforbruket i
 * `energy-expenditure.ts`, så ett felt forurenset ukas effort, akutt/kronisk-dommen
 * og energibalansen samtidig.
 *
 * Nye økter får `data.movingDuration` ved opplasting. Denne jobben fyller feltet på
 * radene som ble skrevet før det — og den er ikke valgfri: ankeret i effort-budsjettet
 * er snittet av de siste fire hele ukene fra de *lagrede* skårene. Uten backfill ville
 * nye uker og ankeret ligget på hver sin skala uten at noe sa fra.
 *
 * ## Hva den gjør
 *
 * Leser sporet fra `sensor_events.data.trackPoints` og skriver `data.movingDuration`
 * på rader som mangler det. **Additiv og idempotent** — sletter ingenting, overskriver
 * ingenting, kan kjøres om igjen. `dryRun=true` viser hva den ville skrevet.
 *
 * Bevegelsestiden slår ikke gjennom i tallene av seg selv: `canonical_workouts` er en
 * projeksjon med lagret `effortScore`. Kjør
 * `POST /api/helse/trening/reprojiser?weeks=…` etterpå — svaret sier fra om det.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) return json({ error: 'Ikke innlogget.' }, { status: 401 });

	// Egne rader: en vanlig innlogget bruker. En annens: admin. Samme skille som
	// reprojiser-endepunktet.
	const requested = url.searchParams.get('userId')?.trim();
	if (requested && requested !== locals.userId) await requireAdmin(locals.userId);
	const userId = requested || locals.userId;

	const dryRun = url.searchParams.get('dryRun') === 'true';
	const limitRaw = url.searchParams.get('limit');
	const limit = limitRaw ? Number(limitRaw) : DEFAULT_BACKFILL_LIMIT;
	if (limitRaw && (!Number.isFinite(limit) || limit < 1)) {
		return json({ success: false, error: 'limit må være et positivt tall.' }, { status: 400 });
	}

	const result = await backfillMovingTime(userId, { dryRun, limit });

	console.log(
		`[moving-time-backfill] ${userId}: kandidater=${result.candidates} beregnet=${result.computed} uavklart=${result.inconclusive} skrevet=${result.written} dryRun=${dryRun}`
	);

	return json({
		success: true,
		...result,
		// Sies med ord fordi konsekvensen ellers oppdages framfor å bli fortalt: et
		// skrevet felt uten reprojeksjon ser ut som en jobb som ikke gjorde noe.
		nextStep:
			result.written > 0
				? 'Skrevet. Kjør POST /api/helse/trening/reprojiser?weeks=… for at de lagrede effort-skårene skal se de nye tallene — ellers står historikken på gammel skala.'
				: dryRun
					? 'Ingenting er skrevet. Kjør uten dryRun for å fylle feltet.'
					: result.candidates === 0
						? 'Ingen kandidater — alle økter med spor har feltet fra før.'
						: 'Ingen rader kunne beregnes. Se `inconclusive`: for få sporpunkter, for dårlig dekning, eller en sportsfamilie uten bevegelsestid (styrke, yoga, svømming).'
	});
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) return json({ error: 'Ikke innlogget.' }, { status: 401 });
	return json({
		success: true,
		usage: `POST /api/helse/trening/bevegelsestid?limit=${DEFAULT_BACKFILL_LIMIT}[&dryRun=true]`,
		hint: 'GET gjør ingenting — backfill skriver, og skriving hører på POST.'
	});
};
