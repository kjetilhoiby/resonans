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
