/**
 * Debug: Dump raw Withings API response for cycling/e-bike workouts
 * Shows exactly what data fields come back per activity
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';

config();

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

// Cycling-related Withings category codes
const CYCLING_CATEGORIES = {
	1: 'walking',  // for reference
	6: 'cycling',
	191: 'indoor_cycling',
	272: 'e_bike',
	525: 'e_bike (alt)'
};

// --- Step 1: Get Withings sensor credentials ---
const sensors = await db.execute(sql`
	SELECT id, user_id, credentials, config
	FROM sensors
	WHERE provider = 'withings' AND is_active = true
	LIMIT 1
`);

if (sensors.length === 0) {
	console.error('No active Withings sensor found');
	await client.end();
	process.exit(1);
}

const sensor = sensors[0];
const credentials = JSON.parse(atob(sensor.credentials));

// --- Step 2: Refresh token if needed ---
async function getAccessToken() {
	const now = Math.floor(Date.now() / 1000);
	if (credentials.expires_at && now >= credentials.expires_at - 300) {
		console.log('Token expired, refreshing...');
		const resp = await fetch('https://wbsapi.withings.net/v2/oauth2', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				action: 'requesttoken',
				grant_type: 'refresh_token',
				client_id: process.env.WITHINGS_CLIENT_ID,
				client_secret: process.env.WITHINGS_CLIENT_SECRET,
				refresh_token: credentials.refresh_token
			})
		});
		const data = await resp.json();
		if (data.status !== 0) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

		// Update DB
		const newCreds = btoa(JSON.stringify({
			access_token: data.body.access_token,
			refresh_token: data.body.refresh_token,
			expires_at: now + data.body.expires_in
		}));
		await db.execute(sql`
			UPDATE sensors SET credentials = ${newCreds}, updated_at = NOW()
			WHERE id = ${sensor.id}
		`);
		return data.body.access_token;
	}
	return credentials.access_token;
}

const accessToken = await getAccessToken();

// --- Step 3: Fetch workouts with ALL data fields ---
const DATA_FIELDS = [
	'calories', 'intensity', 'manual_distance', 'manual_calories',
	'hr_average', 'hr_min', 'hr_max',
	'hr_zone_0', 'hr_zone_1', 'hr_zone_2', 'hr_zone_3',
	'pause_duration', 'algo_pause_duration',
	'spo2_average', 'steps', 'distance', 'elevation',
	'pool_laps', 'strokes', 'pool_length',
	'effduration', 'hr_zone_4'
].join(',');

// Fetch last 90 days to get a good sample
const endDate = new Date();
const startDate = new Date();
startDate.setDate(startDate.getDate() - 90);

console.log(`\nFetching workouts ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}\n`);

const resp = await fetch('https://wbsapi.withings.net/v2/measure', {
	method: 'POST',
	headers: {
		'Authorization': `Bearer ${accessToken}`,
		'Content-Type': 'application/x-www-form-urlencoded'
	},
	body: new URLSearchParams({
		action: 'getworkouts',
		startdateymd: startDate.toISOString().split('T')[0],
		enddateymd: endDate.toISOString().split('T')[0],
		data_fields: DATA_FIELDS
	})
});

const result = await resp.json();

if (result.status !== 0) {
	console.error('API error:', result);
	await client.end();
	process.exit(1);
}

const workouts = result.body?.series || [];
console.log(`Total workouts: ${workouts.length}\n`);

// --- Step 4: Show cycling/e-bike workouts with full raw data ---
const cyclingCats = new Set([6, 191, 272, 525]);
const cyclingWorkouts = workouts.filter(w => cyclingCats.has(w.category));

console.log(`Cycling/e-bike workouts: ${cyclingWorkouts.length}\n`);
console.log('='.repeat(80));

cyclingWorkouts.forEach((w, i) => {
	const start = new Date(w.startdate * 1000);
	const end = new Date(w.enddate * 1000);
	const durationMin = Math.round((w.enddate - w.startdate) / 60);
	const type = CYCLING_CATEGORIES[w.category] || `unknown(${w.category})`;

	console.log(`\n[${i + 1}] ${type.toUpperCase()} — ${start.toLocaleDateString('no-NO')} ${start.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })} (${durationMin} min)`);
	console.log(`    category: ${w.category}, deviceid: ${w.deviceid}`);
	console.log(`    RAW data object:`);

	if (w.data) {
		const entries = Object.entries(w.data).sort(([a], [b]) => a.localeCompare(b));
		for (const [key, val] of entries) {
			let display = val;
			if (key === 'distance') display = `${val} m (${(val / 1000).toFixed(2)} km)`;
			if (key === 'elevation') display = `${val} m`;
			if (key.startsWith('hr_zone_')) display = `${val} (${typeof val === 'number' ? Math.round(val) : val}%)`;
			if (key === 'pause_duration' || key === 'algo_pause_duration' || key === 'effduration') display = `${val} s (${Math.round(val / 60)} min)`;
			console.log(`      ${key}: ${display}`);
		}
	} else {
		console.log(`      (no data object!)`);
	}
});

// --- Step 5: Also show a few non-cycling for comparison ---
console.log('\n' + '='.repeat(80));
console.log('\nFor comparison — a few other workout types:\n');

const otherWorkouts = workouts.filter(w => !cyclingCats.has(w.category)).slice(0, 3);
otherWorkouts.forEach((w, i) => {
	const start = new Date(w.startdate * 1000);
	const durationMin = Math.round((w.enddate - w.startdate) / 60);
	const type = CYCLING_CATEGORIES[w.category] || `cat ${w.category}`;

	console.log(`[${i + 1}] ${type} — ${start.toLocaleDateString('no-NO')} (${durationMin} min)`);
	if (w.data) {
		for (const [key, val] of Object.entries(w.data).sort(([a], [b]) => a.localeCompare(b))) {
			console.log(`      ${key}: ${val}`);
		}
	}
	console.log('');
});

await client.end();
console.log('\nDone.');
