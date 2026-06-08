// Shared types and utilities for settings/sources components

export type BackgroundJobStatus = 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';

export type QueuedJob = {
	id: string;
	status: BackgroundJobStatus;
	createdAt?: string;
	updatedAt?: string;
	startedAt?: string | null;
	finishedAt?: string | null;
	error?: string | null;
	result?: Record<string, unknown> | null;
};

export function formatDateTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString('nb-NO');
}

export function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	const h = Math.floor(m / 60);
	if (h > 0) return `${h}t ${m % 60}m ${s}s`;
	return `${m}m ${s}s`;
}

export function isTerminalJobStatus(status?: string): boolean {
	return status === 'completed' || status === 'failed' || status === 'canceled';
}

export function formatJobStatus(status?: string): string {
	switch (status) {
		case 'queued': return 'Køet';
		case 'running': return 'Kjører';
		case 'retry': return 'Forsøker igjen';
		case 'completed': return 'Fullført';
		case 'failed': return 'Feilet';
		case 'canceled': return 'Avbrutt';
		default: return status || 'Ukjent';
	}
}

export async function kickJobProcessor(): Promise<void> {
	try {
		await fetch('/api/admin/jobs/process', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ limit: 1 })
		});
	} catch { /* best-effort */ }
}
