/**
 * screen-time-series.ts
 *
 * Rene hjelpere for skjermtid-grafer: bygger akkumulert ukeserie
 * (mandag 00:00 → søndag 24:00) fra dagstotaler + evt. time-for-time-detalj,
 * og dato-hjelpere for ukesbilder. Ingen DB/server-avhengigheter — brukes
 * både server- og klientside.
 */

export const HOURS_PER_WEEK = 168;

export interface CumulativeDayInput {
	totalMinutes: number;
	/** 24 verdier, minutter per klokketime (0–23). Utelatt = ingen time-detalj. */
	hourly?: number[];
}

/** ScreenTimeHourBucket[] → 24-elements array med minutter per klokketime. */
export function hourlyArrayFromBuckets(
	buckets: Array<{ hour: number; totalMinutes: number }> | undefined | null
): number[] | undefined {
	if (!Array.isArray(buckets) || buckets.length === 0) return undefined;
	const out = new Array(24).fill(0);
	let any = false;
	for (const b of buckets) {
		if (!b || typeof b.hour !== 'number' || b.hour < 0 || b.hour > 23) continue;
		const v =
			typeof b.totalMinutes === 'number' && Number.isFinite(b.totalMinutes)
				? Math.max(0, b.totalMinutes)
				: 0;
		out[b.hour] += v;
		any = true;
	}
	return any ? out : undefined;
}

/**
 * Fordel en dagstotal utover døgnet når time-detalj mangler.
 * Bruker ukeprofilen (sum per klokketime fra dager med detalj) som fasong,
 * ellers flat fordeling over døgnet.
 */
function distributeDayTotal(totalMinutes: number, profile?: number[]): number[] {
	const out = new Array(24).fill(0);
	if (totalMinutes <= 0) return out;
	const profileSum = profile?.reduce((s, v) => s + Math.max(0, v), 0) ?? 0;
	if (profile && profileSum > 0) {
		for (let h = 0; h < 24; h++) out[h] = (Math.max(0, profile[h] ?? 0) / profileSum) * totalMinutes;
	} else {
		out.fill(totalMinutes / 24);
	}
	return out;
}

/**
 * Akkumulert serie for en uke: punkt 0 = mandag 00:00 (alltid 0), punkt 24·n =
 * slutten av dag n. Verdiene er totale minutter så langt i uka. Serien kuttes
 * etter siste dag med data, slik at en pågående uke ikke får en flat hale.
 * Full uke gir 169 punkter. Tom array hvis uka ikke har data.
 *
 * Dager med time-detalj skaleres slik at timesummen treffer dagstotalen
 * (vision-tolkningen kan bomme litt på enkelttimer).
 */
export function buildCumulativeWeekSeries(
	days: CumulativeDayInput[],
	fallbackProfile?: number[]
): number[] {
	let lastDayWithData = -1;
	for (let i = 0; i < Math.min(7, days.length); i++) {
		if ((days[i]?.totalMinutes ?? 0) > 0 || days[i]?.hourly?.some((v) => v > 0)) {
			lastDayWithData = i;
		}
	}
	if (lastDayWithData < 0) return [];

	const points: number[] = [0];
	let sum = 0;
	for (let day = 0; day <= lastDayWithData; day++) {
		const d = days[day];
		const total = Math.max(0, d?.totalMinutes ?? 0);
		const hourSum = d?.hourly?.reduce((s, v) => s + Math.max(0, v), 0) ?? 0;
		let perHour: number[];
		if (d?.hourly && hourSum > 0) {
			const scale = total > 0 ? total / hourSum : 1;
			perHour = d.hourly.map((v) => Math.max(0, v) * scale);
		} else {
			perHour = distributeDayTotal(total, fallbackProfile);
		}
		for (let h = 0; h < 24; h++) {
			sum += perHour[h] ?? 0;
			points.push(sum);
		}
	}
	return points;
}

function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Mandag i ISO-uken som inneholder datoen (YYYY-MM-DD → YYYY-MM-DD). */
export function mondayOfWeekISO(dateISO: string): string | undefined {
	const m = dateISO?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return undefined;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
	if (Number.isNaN(d.getTime())) return undefined;
	const dow = (d.getDay() + 6) % 7; // 0 = mandag
	d.setDate(d.getDate() - dow);
	return toISODate(d);
}

/** Mandag i forrige ISO-uke relativt til `ref` (default i dag). */
export function previousWeekMondayISO(ref: Date = new Date()): string {
	const thisMonday = mondayOfWeekISO(toISODate(ref))!;
	const [y, mo, da] = thisMonday.split('-').map(Number);
	const d = new Date(y, mo - 1, da, 12);
	d.setDate(d.getDate() - 7);
	return toISODate(d);
}
