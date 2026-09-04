import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import JSZip from 'jszip';
import { Encoder, Profile } from '@garmin/fitsdk';
import { BLOCK_PACE_RATIO, BLOCKING_AXES, decodeWorkoutFile } from './strava-import';
import { triageCandidate } from '$lib/domain/health/import-triage';
import { parseStravaManifest, skipReasonFor } from '$lib/domain/health/strava-export';

const START = new Date('2018-10-23T05:31:54.000Z');
const SEMICIRCLE = 180 / 2 ** 31;

function buildFitBytes(): Uint8Array {
	const enc = new Encoder();
	enc.onMesg(Profile.MesgNum.FILE_ID, {
		type: 'activity',
		timeCreated: START,
		manufacturer: 'garmin'
	} as never);
	for (let i = 0; i < 40; i += 1) {
		enc.onMesg(Profile.MesgNum.RECORD, {
			timestamp: new Date(START.getTime() + i * 30_000),
			positionLat: Math.round((59.91 + i * 0.0004) / SEMICIRCLE),
			positionLong: Math.round((10.75 + i * 0.0004) / SEMICIRCLE),
			altitude: 100 + (i % 7) * 3,
			heartRate: 130 + (i % 20),
			distance: i * 60
		} as never);
	}
	enc.onMesg(Profile.MesgNum.SESSION, {
		timestamp: START,
		startTime: START,
		sport: 'cycling',
		totalElapsedTime: 3605,
		totalTimerTime: 3500,
		totalDistance: 21370
	} as never);
	return enc.close();
}

const GPX = `<?xml version="1.0"?><gpx><trk><trkseg>${Array.from(
	{ length: 30 },
	(_, i) =>
		`<trkpt lat="${59.9 + i * 0.0005}" lon="${10.7 + i * 0.0005}">` +
		`<ele>${50 + i}</ele>` +
		`<time>${new Date(Date.parse('2015-05-01T10:00:00Z') + i * 30_000).toISOString()}</time>` +
		`<extensions><gpxtpx:hr>${140 + (i % 10)}</gpxtpx:hr></extensions></trkpt>`
).join('')}</trkseg></trk></gpx>`;

const MANIFEST = [
	'Aktivitets-ID,Aktivitetsdato,Aktivitetsnavn,Aktivitetstype,Totaltid,Distanse,Filnavn,Totaltid,Bevegelsestid,Distanse',
	'111,"23. okt. 2018",Ride,Sykkeltur,"1:00","21,37",activities/111.fit.gz,3605,3500,21370',
	'222,"1. mai 2015",Run,Løpetur,"0:15","2,3",activities/222.gpx.gz,900,880,2300',
	'333,"2. mai 2015",Walk,Gåtur,"0:15","2,3",activities/333.gpx,900,880,2300',
	'444,"3. mai 2015",Svøm,Svømming,"0:30","1",,1800,1800,1000'
].join('\n');

/** En zip formet som Strava-eksporten: gzippet FIT, gzippet GPX, bar GPX. */
async function buildExportZip(): Promise<JSZip> {
	const zip = new JSZip();
	zip.file('activities/111.fit.gz', gzipSync(Buffer.from(buildFitBytes())));
	zip.file('activities/222.gpx.gz', gzipSync(Buffer.from(GPX)));
	zip.file('activities/333.gpx', GPX);
	zip.file('activities.csv', MANIFEST);
	const bytes = await zip.generateAsync({ type: 'nodebuffer' });
	return JSZip.loadAsync(bytes);
}

describe('decodeWorkoutFile — hele stien fra zip', () => {
	it('pakker ut og dekoder alle tre formatene eksporten inneholder', async () => {
		const zip = await buildExportZip();
		const rows = parseStravaManifest(await zip.file('activities.csv')!.async('string'));
		const importable = rows.filter((r) => !skipReasonFor(r));
		expect(importable.map((r) => r.id)).toEqual(['111', '222', '333']);

		const formats: string[] = [];
		for (const row of importable) {
			const bytes = new Uint8Array(await zip.file(row.filePath!)!.async('uint8array'));
			const { workout: parsed } = decodeWorkoutFile(row.filePath!, bytes);
			expect(parsed, `${row.filePath} ga ingen spor`).not.toBeNull();
			expect(parsed!.trackPoints.length).toBeGreaterThan(10);
			formats.push(parsed!.sourceFormat);
		}
		expect(formats).toEqual(['fit', 'gpx', 'gpx']);
	});

	it('gir koordinater innenfor kartet fra en gzippet FIT', async () => {
		const zip = await buildExportZip();
		const bytes = new Uint8Array(await zip.file('activities/111.fit.gz')!.async('uint8array'));
		const { workout: parsed } = decodeWorkoutFile('activities/111.fit.gz', bytes);
		// Semisirkler ville gitt 714 754 141 her.
		expect(parsed!.trackPoints[0].lat).toBeCloseTo(59.91, 3);
		expect(parsed!.trackPoints[0].lon).toBeCloseTo(10.75, 3);
	});

	it('leser samme spor fra en gzippet og en bar GPX', async () => {
		const zip = await buildExportZip();
		const gz = decodeWorkoutFile(
			'activities/222.gpx.gz',
			new Uint8Array(await zip.file('activities/222.gpx.gz')!.async('uint8array'))
		).workout;
		const bare = decodeWorkoutFile(
			'activities/333.gpx',
			new Uint8Array(await zip.file('activities/333.gpx')!.async('uint8array'))
		).workout;
		expect(gz!.trackPoints).toEqual(bare!.trackPoints);
	});

	it('MANIFESTET eier sporten — parseGpx hardkoder løping', async () => {
		const zip = await buildExportZip();
		const rows = parseStravaManifest(await zip.file('activities.csv')!.async('string'));
		const walk = rows.find((r) => r.id === '333')!;
		const { workout: parsed } = decodeWorkoutFile(
			walk.filePath!,
			new Uint8Array(await zip.file(walk.filePath!)!.async('uint8array'))
		);
		// Dette er hele grunnen til at manifestet er autoritet: fila sier løping
		// om en gåtur, og importen ville lagt ~400 sykkelturer i løperekordene.
		expect(parsed!.sportType).toBe('running');
		expect(walk.sportType).toBe('walking');
	});

	it('MANIFESTET eier distansen — sporlengde er haversine med GPS-støyen i', async () => {
		const zip = await buildExportZip();
		const rows = parseStravaManifest(await zip.file('activities.csv')!.async('string'));
		const ride = rows.find((r) => r.id === '111')!;
		expect(ride.distanceMeters).toBe(21370);
		expect(ride.elapsedSeconds).toBe(3605);
		// Bevegelsestida lagres, men effort skåres på elapsed.
		expect(ride.movingSeconds).toBe(3500);
	});
});

describe('BLOCKING_AXES', () => {
	it('blokkerer BARE for-rask', () => {
		// De tre andre gjør reversibel skade: en kort økt kan skjules, en lang
		// rettes ved å kutte sporet, en langsom drar en trend litt. En for rask
		// blir en distanserekord, og en rekord er «min over alt».
		expect([...BLOCKING_AXES]).toEqual(['for-rask']);
	});
});

describe('BLOCK_PACE_RATIO — porten er romsligere enn rapporten', () => {
	const PR = { distanceMeters: 10000, seconds: 3120 };

	function blocks(distanceMeters: number, seconds: number): boolean {
		const findings = triageCandidate(
			{
				id: 'x',
				date: '',
				name: null,
				sportType: 'running',
				distanceMeters,
				elapsedSeconds: seconds,
				movingSeconds: seconds
			},
			{ paceReference: PR }
		);
		return findings.some((f) => BLOCKING_AXES.has(f.axis) && f.ratio >= BLOCK_PACE_RATIO);
	}

	it('lar en økt fire sekunder under kurven stå — det er en hard økt, ikke en feil', () => {
		// 29. mars 2022, målt i arkivet: 7,64 km på 39:01 mot kurvens 39:05.
		expect(blocks(7640, 39 * 60 + 1)).toBe(false);
	});

	it('lar elleve sekunder under kurven stå', () => {
		// 13. november 2018: 8,37 km på 42:53 mot kurvens 43:04.
		expect(blocks(8370, 42 * 60 + 53)).toBe(false);
	});

	it('stopper den som ligger 18 % under kurven', () => {
		// 2. august 2019: 3,83 km på 15:22 mot kurvens 18:49 — den brukeren selv
		// kalte suspekt.
		expect(blocks(3830, 15 * 60 + 22)).toBe(true);
	});

	it('rapporterer likevel de to som slipper gjennom', () => {
		const findings = triageCandidate(
			{
				id: 'x',
				date: '',
				name: null,
				sportType: 'running',
				distanceMeters: 7640,
				elapsedSeconds: 39 * 60 + 1,
				movingSeconds: 39 * 60 + 1
			},
			{ paceReference: PR }
		);
		// Funnet finnes — det er bare ikke blokkerende. Skillet er hele poenget.
		expect(findings.some((f) => f.axis === 'for-rask')).toBe(true);
	});
});

describe('decodeWorkoutFile — grunnen følger med', () => {
	it('sier hva en GPX uten punkter manglet', () => {
		const empty = new TextEncoder().encode('<gpx><trk><trkseg></trkseg></trk></gpx>');
		const { workout, detail } = decodeWorkoutFile('activities/1.gpx', empty);
		expect(workout).toBeNull();
		expect(detail).toBe('ingen punkter i fila');
	});

	it('skiller en tom fil fra en med punkter parseren ikke leste', () => {
		// Punkter uten lat/lon: fila HAR innhold, men ikke posisjon. Det er en
		// annen sak enn en tom fil, og skal ikke leses som det samme.
		const noPos = new TextEncoder().encode(
			'<gpx><trk><trkseg><trkpt><ele>5</ele></trkpt><trkpt><ele>6</ele></trkpt></trkseg></trk></gpx>'
		);
		const { workout, detail } = decodeWorkoutFile('activities/1.gpx', noPos);
		expect(workout).toBeNull();
		expect(detail).toContain('2 punkter i fila');
	});

	it('gir ingen grunn når fila ga en økt', () => {
		const gpx = `<gpx><trk><trkseg>${Array.from(
			{ length: 5 },
			(_, i) =>
				`<trkpt lat="${59.9 + i * 0.001}" lon="10.7"><time>${new Date(
					Date.parse('2020-05-01T10:00:00Z') + i * 30_000
				).toISOString()}</time></trkpt>`
		).join('')}</trkseg></trk></gpx>`;
		const { workout, detail } = decodeWorkoutFile(
			'activities/1.gpx',
			new TextEncoder().encode(gpx)
		);
		expect(workout).not.toBeNull();
		expect(detail).toBeNull();
	});
});
