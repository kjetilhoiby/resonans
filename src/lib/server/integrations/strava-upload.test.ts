import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadActivity, isIndoorSportType, mapSportType } from './strava';

afterEach(() => vi.unstubAllGlobals());

function captureUpload() {
	const calls: FormData[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			calls.push(init.body as FormData);
			return new Response(JSON.stringify({ id: 1, status: 'Your activity is still being processed.' }), {
				status: 201
			});
		})
	);
	return calls;
}

describe('uploadActivity', () => {
	it('sender TCX som tcx, med trainer-flagget for innendørs', async () => {
		const calls = captureUpload();
		await uploadActivity('token', {
			file: { content: '\n  <?xml version="1.0"?><TrainingCenterDatabase/>', format: 'tcx' },
			externalId: 'ekko-abc',
			sportType: 'Run',
			trainer: true
		});
		const form = calls[0];
		expect(form.get('data_type')).toBe('tcx');
		expect(form.get('trainer')).toBe('1');
		const file = form.get('file') as File;
		expect(file.name).toBe('ekko-abc.tcx');
		// Strava avviser blanktegn før XML-deklarasjonen.
		expect((await file.text()).startsWith('<?xml')).toBe(true);
	});

	it('GPX uten trainer er som før', async () => {
		const calls = captureUpload();
		await uploadActivity('token', {
			file: { content: '<gpx/>', format: 'gpx' },
			externalId: 'ekko-def'
		});
		const form = calls[0];
		expect(form.get('data_type')).toBe('gpx');
		expect(form.get('trainer')).toBeNull();
		expect((form.get('file') as File).name).toBe('ekko-def.gpx');
	});
});

describe('isIndoorSportType', () => {
	it('kjenner igjen indoor_-typene, og mølla går til Strava som løping', () => {
		expect(isIndoorSportType('indoor_running')).toBe(true);
		expect(isIndoorSportType('running')).toBe(false);
		expect(isIndoorSportType(null)).toBe(false);
		expect(mapSportType('indoor_running')).toBe('Run');
	});
});
