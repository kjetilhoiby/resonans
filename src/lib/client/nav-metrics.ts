const START_KEY = 'resonans:nav:start';

type NavMarker = {
	from: string;
	to: string;
	startedAt: number;
};

function isBrowser(): boolean {
	return typeof window !== 'undefined';
}

export function startNavMetric(from: string, to: string): void {
	if (!isBrowser()) return;

	const marker: NavMarker = {
		from,
		to,
		startedAt: performance.now()
	};

	try {
		sessionStorage.setItem(START_KEY, JSON.stringify(marker));
	} catch {
		// ignore storage errors
	}
}

export function finishNavMetric(expectedTo: string): number | null {
	if (!isBrowser()) return null;

	let marker: NavMarker | null = null;
	try {
		const raw = sessionStorage.getItem(START_KEY);
		if (!raw) return null;
		marker = JSON.parse(raw) as NavMarker;
		sessionStorage.removeItem(START_KEY);
	} catch {
		return null;
	}

	if (!marker || marker.to !== expectedTo || !Number.isFinite(marker.startedAt)) {
		return null;
	}

	const durationMs = performance.now() - marker.startedAt;
	console.info(`[nav-metric] ${marker.from} -> ${marker.to}: ${Math.round(durationMs)}ms`);
	return durationMs;
}

export async function timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
	if (!isBrowser()) return fn();
	const t0 = performance.now();
	try {
		const result = await fn();
		console.info(`[perf] ${label}: ${Math.round(performance.now() - t0)}ms`);
		return result;
	} catch (err) {
		console.info(`[perf] ${label}: ${Math.round(performance.now() - t0)}ms (feil)`);
		throw err;
	}
}
