/**
 * Det aktive vektmålet — målvekt, baseline og frist.
 *
 * ## Hvorfor denne finnes ved siden av `metricSettings.weight.goal`
 *
 * Terskelarket bærer ET TALL: målvekta. Det holder til «1,8 kg til målet», men
 * ikke til noe som handler om VEIEN dit — en andel krever et startpunkt, og en
 * estimert dato krever i tillegg en frist. Begge deler ligger i `goals`-raden,
 * i `metadata` (`startValue`, `startDate`, `endDate`), og har gjort det hele
 * tiden. `weight-nugget-rules.ts` brukte toppen av den pågående nedgangen som
 * baseline nettopp fordi ingen hadde lest den herfra.
 *
 * ## To kilder til målvekt, og de kan sprike
 *
 * `metricSettings.weight.goal` og `goals.metadata` er ulike rader som ingen
 * holder i sync. Krydderet løser det ikke ved å velge en vinner — det lar dem
 * aldri stå ved siden av hverandre (`ECHOES` i `weight-nugget-rules.ts`), så
 * brukeren aldri ser to måltall i samme varsel. Se «Navngi kilden når to kilder
 * betyr det samme» i CLAUDE.md.
 */

import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { readGoalTargetValue } from '$lib/domain/goal-tracks';
import { resolveWeightGoalNumbers } from '$lib/domain/health/weight-goal';

/** Metrikk-id-en et vektmål bærer i `goals.metadata`. */
const WEIGHT_METRIC_ID = 'weight_change';

/**
 * Taket på hvor mange aktive mål vi ser på.
 *
 * Vektmål er få — dette er en vakt mot en rad-eksplosjon, ikke en utvelgelse.
 * Utvelgelsen skjer på frist, se under.
 */
const MAX_GOALS = 20;

export interface WeightGoalTrack {
	goalId: string;
	title: string;
	/** Baselinen målet måles fra. */
	startWeight: number;
	/** Vekta målet sikter mot. */
	targetWeight: number;
	/** `YYYY-MM-DD`. */
	startDate: string;
	/** `YYYY-MM-DD`. Fristen. */
	endDate: string;
	/** Om baselinen sto på målet, eller ble hentet fra en måling. */
	startSource: 'oppgitt' | 'maalt';
}

function isoDay(value: unknown, fallback: Date): string {
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
	if (value instanceof Date && Number.isFinite(value.getTime())) {
		return value.toISOString().slice(0, 10);
	}
	const parsed = typeof value === 'string' ? new Date(value) : null;
	if (parsed && Number.isFinite(parsed.getTime())) return parsed.toISOString().slice(0, 10);
	return fallback.toISOString().slice(0, 10);
}

/**
 * Det aktive vektmålet med nærmest frist, eller null.
 *
 * ## Hvorfor nærmeste frist, og ikke det nyeste
 *
 * Har man både et toårsmål og et delmål til jul, er delmålet det man kan gjøre
 * noe med denne uka — og det er det et varsel skal handle om. Et mål med frist
 * i fortida hoppes over: en estimert dato mot en frist som var i fjor er en
 * setning om noe som er avgjort.
 *
 * **Mål UTEN frist finnes ikke her.** En dato-estimering trenger noe å måles
 * mot, og en andel uten frist er fortsatt en andel — men da mangler halve
 * verdien, og et mål uten `endDate` er uansett ikke noe `projectGoal` kan
 * uttale seg om.
 */
export async function readActiveWeightGoal(
	userId: string,
	options: {
		/**
		 * Hele vekthistorikken, stigende.
		 *
		 * Fallback-baselinen regnes PER MÅL som første måling på eller etter
		 * målets startdato — ikke som ett tall kalleren sender inn. Et mål startet
		 * i april og et startet i fjor har ulike startpunkter, og den eldste
		 * målingen i historikken er ingen av dem.
		 */
		weightDays: ReadonlyArray<{ date: string; weightKg: number }>;
		/** Dagens Oslo-dato. Frister før denne hoppes over. */
		today: string;
	}
): Promise<WeightGoalTrack | null> {
	const rows = await db.query.goals.findMany({
		where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
		columns: { id: true, title: true, targetDate: true, metadata: true, createdAt: true },
		limit: MAX_GOALS
	});

	const candidates: WeightGoalTrack[] = [];

	for (const row of rows) {
		const meta = (row.metadata ?? {}) as Record<string, unknown>;
		if (meta.metricId !== WEIGHT_METRIC_ID) continue;

		const endRaw = meta.endDate ?? row.targetDate;
		if (!endRaw) continue;
		const endDate = isoDay(endRaw, row.createdAt);
		if (endDate < options.today) continue;

		const startDate = isoDay(meta.startDate, row.createdAt);
		const numbers = resolveWeightGoalNumbers({
			rawTargetValue: readGoalTargetValue(meta),
			startValue: typeof meta.startValue === 'number' ? meta.startValue : null,
			fallbackStartWeight: options.weightDays.find((d) => d.date >= startDate)?.weightKg ?? null
		});
		if (!numbers) continue;

		candidates.push({
			goalId: row.id,
			title: row.title,
			startWeight: numbers.startWeight,
			targetWeight: numbers.targetWeight,
			startDate,
			endDate,
			startSource: numbers.startSource
		});
	}

	candidates.sort((a, b) => (a.endDate < b.endDate ? -1 : a.endDate > b.endDate ? 1 : 0));
	return candidates[0] ?? null;
}
