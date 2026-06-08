export function formatWorkoutDistance(distanceKm: number | null | undefined): string {
	if (distanceKm == null || distanceKm <= 0) return '';
	return `${distanceKm.toFixed(1)} km`;
}

export function formatWorkoutDuration(durationSeconds: number | null | undefined): string {
	if (durationSeconds == null || durationSeconds <= 0) return '';
	const totalMinutes = Math.round(durationSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours > 0) return `${hours} t ${minutes} min`;
	return `${minutes} min`;
}

export function formatWorkoutPace(paceSecondsPerKm: number | null | undefined): string {
	if (paceSecondsPerKm == null || paceSecondsPerKm <= 0) return '';
	const minutes = Math.floor(paceSecondsPerKm / 60);
	const seconds = Math.round(paceSecondsPerKm % 60).toString().padStart(2, '0');
	return `${minutes}:${seconds} /km`;
}

export function formatWorkoutTimestamp(timestamp: string): string {
	const d = new Date(timestamp);
	return d.toLocaleDateString('nb-NO', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function formatRelativeDay(iso: string): string {
	const d = new Date(iso);
	const now = new Date();
	const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
	if (diff === 0) return 'I dag';
	if (diff === 1) return 'I går';
	if (diff < 7) return d.toLocaleDateString('nb-NO', { weekday: 'long' });
	return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

export function formatShortDate(date: Date): string {
	return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}
