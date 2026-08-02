import { invalidateAll } from '$app/navigation';

/**
 * Skrivekall for treningsløp. Var tidligere form-actions på /trening, men den
 * ruten blir en redirect til Trening-undertemaet — og en redirect kan ikke ta
 * imot POST. Endepunktene er derfor frittstående under /api/tracks/*.
 */
async function postTracks(path: string, body: Record<string, unknown>): Promise<string | null> {
	try {
		const res = await fetch(`/api/tracks/${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const payload = await res.json().catch(() => null);
			return payload?.error ?? 'Noe gikk galt';
		}
		await invalidateAll();
		return null;
	} catch {
		return 'Fikk ikke kontakt med serveren';
	}
}

/** Opprett treningsløp med baseline. Returnerer feilmelding, eller null. */
export function createTrainingPlan(baseline: {
	armhevinger?: number;
	planke?: number;
	pullupNegativ?: number;
	ukesKm?: number;
	paceSek?: number;
}): Promise<string | null> {
	return postTracks('plan', baseline);
}

/** Merk en milepæl nådd / ikke nådd. */
export function setMilestone(milestoneId: string, achieved: boolean): Promise<string | null> {
	return postTracks('milestone', { milestoneId, achieved });
}

/** Opprett en rute fra ruteskjemaet. */
export function createTrainingRoute(fields: Record<string, unknown>): Promise<string | null> {
	return postTracks('routes', fields);
}

/** Skjemafelter → vanlig objekt, så de kan sendes som JSON. */
export function formFields(form: HTMLFormElement): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of new FormData(form)) {
		if (typeof value === 'string') out[key] = value;
	}
	return out;
}
