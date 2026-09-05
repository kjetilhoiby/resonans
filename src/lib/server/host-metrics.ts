import { readFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { desc, gte, lte, and, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { hostSamples } from '$lib/db/schema';
import { parseMeminfo, toHostHighlight, type HostSample } from '$lib/domain/host-metrics';

/**
 * Sampling og lesing av vertsmålinger. Tolkningen bor i domenelaget.
 *
 * Se `$lib/domain/host-metrics.ts` for hvorfor dette finnes i det hele tatt.
 */

/**
 * Hvor lenge vi tar vare på målingene.
 *
 * En rad per minutt er ~43 000 i måneden — smått mot `sensor_events`. Sju
 * dager dekker «hva skjedde i natt» og «skjedde det samme forrige uke», som
 * er de to spørsmålene man faktisk stiller.
 */
export const RETENTION_DAYS = 7;

/** Sannsynlighet for at et tikk også rydder. Som `pruneOldClaims`. */
const PRUNE_PROBABILITY = 0.02;

/**
 * Leser vertens tilstand. `null` når vi ikke er på Linux eller `/proc` ikke
 * er lesbart — sampling skal aldri kunne velte dispatcheren.
 */
export async function readHostSample(): Promise<HostSample | null> {
	let text: string;
	try {
		text = await readFile('/proc/meminfo', 'utf8');
	} catch {
		return null;
	}

	const mem = parseMeminfo(text);
	if (!mem) return null;

	const [load1, load5, load15] = loadavg();
	return { ...mem, load1, load5, load15 };
}

/**
 * Sampler og lagrer én måling.
 *
 * **Kalles FØR lederlås-sjekken i dispatcheren, med vilje.** Øyeblikkene vi
 * bryr oss om er nettopp de der lederskapet kan være i ferd med å ryke — en
 * standby-instans som måler er mer verdt enn en tapt måling. To rader samme
 * minutt under rullende oppdatering er derfor forventet, ikke en feil, og
 * `instance` skiller dem.
 *
 * Feiler stille: en manglende måling skal aldri stoppe cron.
 */
export async function recordHostSample(instance: string): Promise<HostSample | null> {
	const s = await readHostSample();
	if (!s) return null;

	try {
		await db.insert(hostSamples).values({
			memTotalKb: s.memTotalKb,
			memAvailableKb: s.memAvailableKb,
			memFreeKb: s.memFreeKb,
			cachedKb: s.cachedKb,
			swapTotalKb: s.swapTotalKb,
			swapFreeKb: s.swapFreeKb,
			load1: s.load1,
			load5: s.load5,
			load15: s.load15,
			instance
		});

		if (Math.random() < PRUNE_PROBABILITY) {
			await db
				.delete(hostSamples)
				.where(lte(hostSamples.sampledAt, sql`now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`));
		}
	} catch (err) {
		console.warn('[vert] kunne ikke lagre måling:', err);
		return s;
	}

	return s;
}

const MAX_SAMPLES = 1500;

/**
 * Målingene i et vindu, nyeste først, med domenelagets dom på den ferskeste.
 *
 * `worst` er den med lavest `memAvailableKb` — det er den man leter etter når
 * man spør «hvor nære var vi», og en middelverdi ville glattet den bort på
 * nøyaktig samme måte som Coolifys graf gjorde 3. september.
 */
export async function loadHostWindow(fromMs: number, toMs: number) {
	const rows = await db
		.select({
			sampledAt: hostSamples.sampledAt,
			memTotalKb: hostSamples.memTotalKb,
			memAvailableKb: hostSamples.memAvailableKb,
			memFreeKb: hostSamples.memFreeKb,
			cachedKb: hostSamples.cachedKb,
			swapTotalKb: hostSamples.swapTotalKb,
			swapFreeKb: hostSamples.swapFreeKb,
			load1: hostSamples.load1,
			load5: hostSamples.load5,
			load15: hostSamples.load15,
			instance: hostSamples.instance
		})
		.from(hostSamples)
		.where(
			and(gte(hostSamples.sampledAt, new Date(fromMs)), lte(hostSamples.sampledAt, new Date(toMs)))
		)
		.orderBy(desc(hostSamples.sampledAt))
		.limit(MAX_SAMPLES);

	if (rows.length === 0) return { samples: [], latest: null, worst: null, truncated: false };

	const toSample = (r: (typeof rows)[number]): HostSample => ({
		memTotalKb: r.memTotalKb,
		memAvailableKb: r.memAvailableKb,
		memFreeKb: r.memFreeKb,
		cachedKb: r.cachedKb,
		swapTotalKb: r.swapTotalKb,
		swapFreeKb: r.swapFreeKb,
		load1: r.load1,
		load5: r.load5,
		load15: r.load15
	});

	const worstRow = rows.reduce((a, b) => (b.memAvailableKb < a.memAvailableKb ? b : a));

	// Formen på `latest`/`worst` bor i domenelaget, ikke her — se
	// `toHostHighlight` for hvorfor tidsfeltet heter `sampledAt` begge steder.
	const highlight = (r: (typeof rows)[number]) =>
		toHostHighlight(r.sampledAt.toISOString(), toSample(r));

	return {
		samples: rows.map((r) => ({ ...r, sampledAt: r.sampledAt.toISOString() })),
		latest: highlight(rows[0]),
		worst: highlight(worstRow),
		truncated: rows.length >= MAX_SAMPLES
	};
}
