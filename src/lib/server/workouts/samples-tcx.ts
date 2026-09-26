import type { WorkoutSample } from '$lib/domain/health/workout-samples';

/**
 * Gjenoppbygger en TCX uten posisjoner fra lagrede innendørs-samples.
 *
 * Brukes av etterpåsynken til Strava (`/api/apps/strava/sync`), som ikke har
 * originalfila – den lagres ikke. Utendørs bygges en GPX fra `trackPoints`; en
 * mølleøkt har ingen, og GPX kan ikke bære punkter uten posisjon. Formen er den
 * samme som Ekkos `TCXBuilder`, så Strava får det samme ved auto-push og etterpåsynk.
 */
export function buildIndoorTcx(
	samples: WorkoutSample[],
	opts: { startTime: Date; durationSeconds?: number; name?: string }
): string {
	const start = opts.startTime.toISOString();
	const last = samples[samples.length - 1];
	const distance = last ? Math.max(0, last.dist - samples[0].dist) : 0;
	const lastMs = last ? Date.parse(last.time) : NaN;
	const duration =
		opts.durationSeconds ??
		(Number.isFinite(lastMs) ? Math.max(0, Math.round((lastMs - opts.startTime.getTime()) / 1000)) : 0);
	const d0 = samples[0]?.dist ?? 0;

	const trackpoints = samples
		.map((s) => {
			const parts = [`<Trackpoint><Time>${new Date(s.time).toISOString()}</Time>`];
			if (typeof s.ele === 'number') parts.push(`<AltitudeMeters>${s.ele.toFixed(1)}</AltitudeMeters>`);
			parts.push(`<DistanceMeters>${Math.max(0, s.dist - d0).toFixed(1)}</DistanceMeters>`);
			if (typeof s.hr === 'number') parts.push(`<HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>`);
			parts.push('</Trackpoint>');
			return parts.join('');
		})
		.join('\n');

	// Ingen blanktegn før deklarasjonen: Strava avviser da fila.
	return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities>
<Activity Sport="Running">
<Id>${start}</Id>
<Lap StartTime="${start}">
<TotalTimeSeconds>${duration}</TotalTimeSeconds>
<DistanceMeters>${distance.toFixed(1)}</DistanceMeters>
<Calories>0</Calories>
<Intensity>Active</Intensity>
<TriggerMethod>Manual</TriggerMethod>
<Track>
${trackpoints}
</Track>
</Lap>${opts.name ? `\n<Notes>${escapeXml(opts.name)}</Notes>` : ''}
</Activity>
</Activities>
</TrainingCenterDatabase>`;
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (c) =>
		c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;'
	);
}
