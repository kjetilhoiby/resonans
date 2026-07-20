/**
 * Bygg den efemære `context`-strengen som sendes til `POST /api/apps/coach`
 * (§6). KUN aggregerte tall — aldri video, bilder eller per-frame-data.
 */
import type { SessionSummary } from './types';

/** Formatér ms som sekunder med én desimal, f.eks. `1200 → "1.2 s"`. */
function formatSeconds(ms: number | null): string {
	if (ms === null) return '–';
	return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Bygg norsk `context`-tekst fra en øktoppsummering. Formatet speiler
 * eksempelet i speccen §6 slik at coach-prompten får forutsigbar struktur.
 */
export function buildCoachContext(summary: SessionSummary): string {
	const lines = [
		'Pull-up-økt:',
		`- Reps: ${summary.reps}`,
		`- Hake over stang: ${summary.chinOverBarReps} av ${summary.reps}`,
		`- Full utstrekning i bunn: ${summary.fullExtensionReps} av ${summary.reps}`,
		`- Rene reps: ${summary.cleanReps} av ${summary.reps}`,
		`- Snitt opp-fase: ${formatSeconds(summary.avgConcentricMs)}`,
		`- Snitt ned-fase: ${formatSeconds(summary.avgEccentricMs)}`
	];
	return lines.join('\n');
}
