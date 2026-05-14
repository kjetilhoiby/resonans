/**
 * One-time migration: merge duplicate workouts from different sources.
 *
 * 1. Backfills sourceData on Withings workouts that lack it
 * 2. Finds cross-source duplicates (±10 min, compatible sport type)
 * 3. Merges Strava data into the Withings row and deletes the Strava duplicate
 */
import postgres from 'postgres';
import { config } from 'dotenv';

config();
const client = postgres(process.env.DATABASE_URL);

const SPORT_ALIASES = {
	cycling: 'bike', e_bike: 'bike', indoor_cycling: 'bike',
	running: 'run', indoor_running: 'run',
	walking: 'walk', indoor_walking: 'walk', hiking: 'walk',
	lift_weights: 'strength', calisthenics: 'strength', weight_training: 'strength',
};

function sportsCompatible(a, b) {
	if (!a || !b) return false;
	if (a === b) return true;
	return (SPORT_ALIASES[a] || a) === (SPORT_ALIASES[b] || b);
}

const SOURCE_PRIORITY = {
	distance: ['strava', 'withings'],
	gpsTrack: ['strava'],
	elevation: ['strava', 'withings'],
	elevationMax: ['strava', 'withings'],
	elevationMin: ['strava', 'withings'],
	avgHeartRate: ['withings', 'strava'],
	maxHeartRate: ['withings', 'strava'],
	minHeartRate: ['withings', 'strava'],
	hrCurve: ['withings', 'strava'],
	hrZones: ['withings', 'strava'],
	calories: ['strava', 'withings'],
	avgSpeed: ['strava', 'withings'],
	maxSpeed: ['strava', 'withings'],
	avgPower: ['strava'],
	avgCadence: ['strava'],
};

function mergeData(existing, incoming, incomingSource) {
	const sourceData = { ...(existing.sourceData || {}) };

	if (Object.keys(sourceData).length === 0 && existing.sportType) {
		const { sourceData: _sd, ...clean } = existing;
		sourceData['withings'] = clean;
	}

	const { sourceData: _sd, ...incomingClean } = incoming;
	sourceData[incomingSource] = incomingClean;

	const allSources = Object.keys(sourceData);
	const allFields = new Set();
	for (const src of Object.values(sourceData)) {
		for (const key of Object.keys(src)) allFields.add(key);
	}

	const merged = {
		sportType: existing.sportType || incoming.sportType,
		duration: existing.duration || incoming.duration,
	};

	for (const field of allFields) {
		if (field === 'sportType' || field === 'duration') continue;
		const priority = SOURCE_PRIORITY[field] || allSources;
		let bestVal;
		for (const src of priority) {
			const val = sourceData[src]?.[field];
			if (val != null) { bestVal = val; break; }
		}
		if (bestVal == null) {
			for (const src of allSources) {
				const val = sourceData[src]?.[field];
				if (val != null) { bestVal = val; break; }
			}
		}
		if (bestVal != null) merged[field] = bestVal;
	}

	merged.sourceData = sourceData;
	return merged;
}

// ── Step 1: Backfill sourceData on Withings workouts ────────────────────────
console.log('Step 1: Backfilling sourceData on Withings workouts...');

const withingsRows = await client`
	SELECT se.id, se.data
	FROM sensor_events se
	JOIN sensors s ON se.sensor_id = s.id
	WHERE se.data_type = 'workout'
	  AND s.provider = 'withings'
	  AND NOT (se.data ? 'sourceData')
`;

console.log(`  Found ${withingsRows.length} Withings workouts without sourceData`);

for (const row of withingsRows) {
	const data = row.data;
	const { sourceData: _sd, ...clean } = data;
	const updated = {
		...data,
		sourceData: { withings: clean }
	};
	await client`UPDATE sensor_events SET data = ${client.json(updated)} WHERE id = ${row.id}`;
}
console.log(`  Backfilled ${withingsRows.length} rows`);

// ── Step 2: Find and merge cross-source duplicates ──────────────────────────
console.log('\nStep 2: Finding cross-source duplicates...');

const allWorkouts = await client`
	SELECT se.id, se.sensor_id, se.timestamp, se.data, se.metadata,
	       s.provider
	FROM sensor_events se
	JOIN sensors s ON se.sensor_id = s.id
	WHERE se.data_type = 'workout'
	ORDER BY se.timestamp
`;

console.log(`  Total workouts: ${allWorkouts.length}`);

// Group into potential duplicates by time proximity
const WINDOW_MS = 10 * 60 * 1000;
let mergedCount = 0;
let deletedIds = [];

// Index by provider for quick lookup
const byProvider = {};
for (const w of allWorkouts) {
	(byProvider[w.provider] ??= []).push(w);
}

const stravaWorkouts = byProvider['strava'] || [];
const withingsWorkouts = byProvider['withings'] || [];

console.log(`  Strava: ${stravaWorkouts.length}, Withings: ${withingsWorkouts.length}`);

// For each Strava workout, find matching Withings workout
const withingsUsed = new Set();

for (const strava of stravaWorkouts) {
	const stravaTs = new Date(strava.timestamp).getTime();
	const stravaDataParsed = typeof strava.data === 'string' ? JSON.parse(strava.data) : strava.data;
	const stravaSport = stravaDataParsed?.sportType;

	const match = withingsWorkouts.find(w => {
		if (withingsUsed.has(w.id)) return false;
		const diff = Math.abs(new Date(w.timestamp).getTime() - stravaTs);
		if (diff > WINDOW_MS) return false;
		const wData = typeof w.data === 'string' ? JSON.parse(w.data) : w.data;
		return sportsCompatible(wData?.sportType, stravaSport);
	});

	if (match) {
		const matchData = typeof match.data === 'string' ? JSON.parse(match.data) : match.data;
		const stravaData = typeof strava.data === 'string' ? JSON.parse(strava.data) : strava.data;
		const matchMeta = typeof match.metadata === 'string' ? JSON.parse(match.metadata) : match.metadata;
		const merged = mergeData(matchData, stravaData, 'strava');
		const mergedMeta = {
			...(matchMeta || {}),
			sources: ['withings_sync_workout', 'strava_sync']
		};

		await client`
			UPDATE sensor_events
			SET data = ${client.json(merged)},
			    metadata = ${client.json(mergedMeta)}
			WHERE id = ${match.id}
		`;

		deletedIds.push(strava.id);
		withingsUsed.add(match.id);
		mergedCount++;
	}
}

console.log(`  Merged ${mergedCount} pairs`);

// ── Step 3: Delete Strava duplicates that were merged ───────────────────────
if (deletedIds.length > 0) {
	console.log(`\nStep 3: Deleting ${deletedIds.length} merged Strava duplicates...`);

	// Batch delete
	const batchSize = 100;
	for (let i = 0; i < deletedIds.length; i += batchSize) {
		const batch = deletedIds.slice(i, i + batchSize);
		await client`DELETE FROM sensor_events WHERE id = ANY(${batch})`;
	}
	console.log(`  Deleted ${deletedIds.length} duplicate rows`);
}

// ── Step 4: Verify ──────────────────────────────────────────────────────────
console.log('\nStep 4: Verification...');

const remaining = await client`SELECT count(*) as cnt FROM sensor_events WHERE data_type = 'workout'`;
const mergedRows = await client`
	SELECT count(*) as cnt FROM sensor_events
	WHERE data_type = 'workout'
	  AND data->'sourceData' ? 'strava'
	  AND data->'sourceData' ? 'withings'
`;
const stravaOnly = await client`
	SELECT count(*) as cnt FROM sensor_events
	WHERE data_type = 'workout'
	  AND data->'sourceData' ? 'strava'
	  AND NOT (data->'sourceData' ? 'withings')
`;
const withingsOnly = await client`
	SELECT count(*) as cnt FROM sensor_events
	WHERE data_type = 'workout'
	  AND data->'sourceData' ? 'withings'
	  AND NOT (data->'sourceData' ? 'strava')
`;

console.log(`  Total workouts: ${remaining[0].cnt}`);
console.log(`  Merged (both sources): ${mergedRows[0].cnt}`);
console.log(`  Strava only: ${stravaOnly[0].cnt}`);
console.log(`  Withings only: ${withingsOnly[0].cnt}`);

await client.end();
console.log('\nDone.');
