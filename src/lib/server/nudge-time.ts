function toHmFromParts(parts: Intl.DateTimeFormatPart[]) {
	const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
	return `${hour}:${minute}`;
}

export function localHm(timeZone: string, now: Date) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	return toHmFromParts(formatter.formatToParts(now));
}

export function localIsoDay(timeZone: string, now: Date) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = formatter.formatToParts(now);
	const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
	const m = parts.find((p) => p.type === 'month')?.value ?? '01';
	const d = parts.find((p) => p.type === 'day')?.value ?? '01';
	return `${y}-${m}-${d}`;
}

/** Millisekund-offset (lokal tid minus UTC) for tidssonen ved gitt instant. */
export function tzOffsetMs(timeZone: string, at: Date): number {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
	const parts = formatter.formatToParts(at);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
	// hour12:false kan gi '24' ved midnatt — normaliser til 0.
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour') % 24,
		get('minute'),
		get('second')
	);
	return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * UTC-intervallet [start, end) for en lokal ISO-dag i gitt tidssone. To-pass
 * offset-oppslag håndterer DST-overganger (offsetten ved det naive gjettet kan
 * avvike fra offsetten ved den faktiske lokale midnatten).
 */
export function localDayUtcRange(isoDay: string, timeZone: string): { start: Date; end: Date } {
	const utcMsForLocalMidnight = (naiveUtcMs: number) => {
		let ms = naiveUtcMs - tzOffsetMs(timeZone, new Date(naiveUtcMs));
		ms = naiveUtcMs - tzOffsetMs(timeZone, new Date(ms));
		return ms;
	};
	const naive = Date.parse(`${isoDay}T00:00:00Z`);
	return {
		start: new Date(utcMsForLocalMidnight(naive)),
		end: new Date(utcMsForLocalMidnight(naive + 86_400_000))
	};
}

/**
 * ISO-8601 med numerisk offset i gitt tidssone, f.eks. '2026-07-03T09:15:00+02:00'.
 * Sekund-oppløsning (millisekunder droppes).
 */
export function isoWithTzOffset(d: Date, timeZone: string): string {
	const offsetMin = Math.round(tzOffsetMs(timeZone, d) / 60_000);
	const local = new Date(Math.floor(d.getTime() / 1000) * 1000 + offsetMin * 60_000);
	const pad = (n: number) => String(n).padStart(2, '0');
	const sign = offsetMin < 0 ? '-' : '+';
	const abs = Math.abs(offsetMin);
	return (
		`${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
		`T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

export function hmToMinutes(hm: string) {
	const [hRaw, mRaw] = hm.split(':');
	const h = Number.parseInt(hRaw ?? '', 10);
	const m = Number.parseInt(mRaw ?? '', 10);
	if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
		return null;
	}
	return h * 60 + m;
}

export function isWithinRecentMinutesWindow(nowHm: string, targetHm: string, windowMinutes: number) {
	const nowMin = hmToMinutes(nowHm);
	const targetMin = hmToMinutes(targetHm);
	if (nowMin === null || targetMin === null) return false;
	const delta = (nowMin - targetMin + 1440) % 1440;
	return delta >= 0 && delta < windowMinutes;
}
