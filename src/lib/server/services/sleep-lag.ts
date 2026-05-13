const BEDTIME_IDEAL = 22;
const BEDTIME_LATEST = 24;
const WAKE_IDEAL = 6;
const WAKE_LATEST = 8;

const osloTimeFormatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Oslo',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

function getOsloHourFraction(date: Date): number {
	const parts = osloTimeFormatter.formatToParts(date);
	const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
	const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
	return hour + minute / 60;
}

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

export function computeSleepLag(sleepStart: Date, sleepEnd: Date): number | undefined {
	if (!(sleepStart instanceof Date) || Number.isNaN(sleepStart.getTime())) return undefined;
	if (!(sleepEnd instanceof Date) || Number.isNaN(sleepEnd.getTime())) return undefined;

	const rawBedHour = getOsloHourFraction(sleepStart);
	const wakeHour = getOsloHourFraction(sleepEnd);

	// Etter midnatt teller som forlengelse av kvelden (00:30 → 24.5)
	const bedHour = rawBedHour < 12 ? rawBedHour + 24 : rawBedHour;

	const bedLag = clamp01((bedHour - BEDTIME_IDEAL) / (BEDTIME_LATEST - BEDTIME_IDEAL));
	const wakeLag = clamp01((wakeHour - WAKE_IDEAL) / (WAKE_LATEST - WAKE_IDEAL));

	return Math.round((bedLag * 0.5 + wakeLag * 0.5) * 100);
}
