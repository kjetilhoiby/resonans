/**
 * Delt cron-logikk for GitHub Actions-dispatcheren (`.github/workflows/cron.yml`).
 *
 * GitHub Actions er master-klokka og fyrer hvert 5. minutt, men scheduleren
 * er notorisk treg/upålitelig — spesielt på det overbelastede midnatt-UTC-slotet.
 * En jobb med ett enkelt matchende minutt (f.eks. `0 0 * * *`) ble tidligere
 * hoppet helt over hvis dispatcheren var forsinket mer enn catch-up-vinduet.
 *
 * Løsningen: et romslig oppslagsvindu (DISPATCH_LOOKBACK_MS) kombinert med
 * dedup mot siste faktiske kjøring. Vinduet sørger for at en forsinket
 * dispatch fortsatt fanger slotet; dedup-en sørger for at høyfrekvente jobber
 * (hvert 5. minutt) ikke kjøres flere ganger for samme slot.
 *
 * Logikken bor her (og testes i cron-schedule.test.ts) slik at den er
 * enkilde-sannhet — endepunktet /api/cron/jobs?due=1 beregner due-jobbene
 * server-side, og workflow-scriptet trenger ikke duplisere cron-parsing.
 */

/** Hvor langt bakover dispatcheren leter etter et matchende slot. */
export const DISPATCH_LOOKBACK_MS = 60 * 60_000; // 60 min — absorberer GH-jitter

function matchField(field: string, value: number): boolean {
	if (field === '*') return true;
	return field.split(',').some((part) => {
		if (part.includes('/')) {
			const [range, step] = part.split('/');
			const s = parseInt(step, 10);
			if (range === '*') return value % s === 0;
			const [a, b] = range.split('-').map(Number);
			return value >= a && value <= (isNaN(b) ? a : b) && (value - a) % s === 0;
		}
		if (part.includes('-')) {
			const [a, b] = part.split('-').map(Number);
			return value >= a && value <= b;
		}
		return parseInt(part, 10) === value;
	});
}

/** Sjekker om et 5-felt cron-uttrykk matcher et gitt tidspunkt (UTC). */
export function cronMatches(expr: string, date: Date): boolean {
	const [min, hour, dom, month, dow] = expr.trim().split(/\s+/);
	return (
		matchField(min, date.getUTCMinutes()) &&
		matchField(hour, date.getUTCHours()) &&
		matchField(dom, date.getUTCDate()) &&
		matchField(month, date.getUTCMonth() + 1) &&
		matchField(dow, date.getUTCDay())
	);
}

/**
 * Finner det nyeste minutt-justerte tidspunktet innenfor oppslagsvinduet
 * [now - lookbackMs, now] som matcher cron-uttrykket. Returnerer null hvis
 * ingen matcher i vinduet.
 */
export function mostRecentMatch(
	expr: string,
	now: Date,
	lookbackMs: number = DISPATCH_LOOKBACK_MS
): Date | null {
	const steps = Math.floor(lookbackMs / 60_000);
	for (let i = 0; i <= steps; i++) {
		const t = new Date(now.getTime() - i * 60_000);
		t.setUTCSeconds(0, 0);
		if (cronMatches(expr, t)) return t;
	}
	return null;
}

/**
 * Avgjør om en jobb skal kjøre nå.
 *
 * Due hvis det finnes et matchende slot i vinduet som jobben ikke allerede
 * har kjørt for. `lastRunAt` er siste faktiske kjøring (uavhengig av status),
 * slik at en allerede-kjørt eller nettopp-feilet jobb ikke trigges på nytt
 * før neste slot.
 */
export function isDue(
	expr: string,
	now: Date,
	lastRunAt: Date | null,
	lookbackMs: number = DISPATCH_LOOKBACK_MS
): boolean {
	const slot = mostRecentMatch(expr, now, lookbackMs);
	if (!slot) return false;
	if (lastRunAt && lastRunAt.getTime() >= slot.getTime()) return false;
	return true;
}
