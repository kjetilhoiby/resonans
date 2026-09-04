import { describe, it, expect } from 'vitest';
import {
	parseCsvRows,
	parseStravaManifest,
	resolveColumns,
	skipReasonFor,
	sportTypeFromNorwegian,
	StravaManifestError,
	stripGzip,
	triageCandidateFromRow,
	type StravaManifestRow
} from './strava-export';

const HEADER =
	'Aktivitets-ID,Aktivitetsdato,Aktivitetsnavn,Aktivitetstype,Totaltid,Distanse,Filnavn,Totaltid,Bevegelsestid,Distanse';

function csv(...lines: string[]): string {
	return [HEADER, ...lines].join('\n');
}

describe('parseCsvRows', () => {
	it('respekterer komma inni siterte felt', () => {
		const rows = parseCsvRows('a,"b,c",d');
		expect(rows[0]).toEqual(['a', 'b,c', 'd']);
	});

	it('leser doble anførselstegn som ett', () => {
		expect(parseCsvRows('"si ""hei"""')[0]).toEqual(['si "hei"']);
	});

	it('takler linjeskift inni et sitert felt', () => {
		const rows = parseCsvRows('a,"to\nlinjer",c');
		expect(rows).toHaveLength(1);
		expect(rows[0][1]).toBe('to\nlinjer');
	});
});

describe('kolonneoppslag', () => {
	it('tar SISTE forekomst av Totaltid og Distanse — råverdiene', () => {
		const index = resolveColumns(HEADER.split(','));
		expect(index.elapsed).toBe(7);
		expect(index.distance).toBe(9);
		// Visningskolonnene ligger på 4 og 5 og skal IKKE velges.
		expect(index.elapsed).not.toBe(4);
		expect(index.distance).not.toBe(5);
	});

	it('sier hvilken kolonne som mangler framfor å gi tom import', () => {
		expect(() => resolveColumns(['Aktivitets-ID', 'Aktivitetsdato'])).toThrow(StravaManifestError);
		expect(() => resolveColumns(['Aktivitets-ID'])).toThrow(/Aktivitetsdato/);
	});
});

describe('sportTypeFromNorwegian', () => {
	it('mapper de typene arkivet faktisk inneholder', () => {
		expect(sportTypeFromNorwegian('Løpetur')).toBe('running');
		expect(sportTypeFromNorwegian('Sykkeltur')).toBe('cycling');
		expect(sportTypeFromNorwegian('El-sykkeltur')).toBe('e_bike');
		expect(sportTypeFromNorwegian('Gåtur')).toBe('walking');
		expect(sportTypeFromNorwegian('Fottur')).toBe('hiking');
		expect(sportTypeFromNorwegian('Langrenn')).toBe('skiing');
		expect(sportTypeFromNorwegian('Svømming')).toBe('swimming');
	});

	it('skiller elsykkel fra sykkel — de har ulik effort-faktor', () => {
		expect(sportTypeFromNorwegian('El-sykkeltur')).not.toBe(sportTypeFromNorwegian('Sykkeltur'));
	});

	it('gir null for ukjent type framfor å gjette løping', () => {
		expect(sportTypeFromNorwegian('Kajakkpadling')).toBeNull();
		expect(sportTypeFromNorwegian('')).toBeNull();
	});
});

describe('parseStravaManifest', () => {
	it('leser metadata fra RÅkolonnene, ikke visningskolonnene', () => {
		const rows = parseStravaManifest(
			csv('123,"1. mai 2020, 08.00.00",Morgentur,Sykkeltur,"0:45","12,5",activities/123.fit.gz,2700,2400,12500')
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: '123',
			sportType: 'cycling',
			distanceMeters: 12500,
			elapsedSeconds: 2700,
			movingSeconds: 2400,
			filePath: 'activities/123.fit.gz'
		});
	});

	it('beholder den rå typen så en ukjent sport kan navngis', () => {
		const rows = parseStravaManifest(
			csv('9,"1. mai 2020",Tur,Kajakkpadling,"0:30","3",activities/9.gpx,1800,1700,3000')
		);
		expect(rows[0].sportType).toBeNull();
		expect(rows[0].rawType).toBe('Kajakkpadling');
	});

	it('gir null filePath for manuelle økter uten fil', () => {
		const rows = parseStravaManifest(csv('7,"1. mai 2020",Tur,Løpetur,"0:30","5",,1800,1700,5000'));
		expect(rows[0].filePath).toBeNull();
	});

	it('hopper over avkortede rader framfor å lese dem halvveis', () => {
		expect(parseStravaManifest(csv('8,"1. mai"'))).toEqual([]);
	});

	it('krever en id — en rad uten er ikke en aktivitet', () => {
		expect(parseStravaManifest(csv(',"1. mai 2020",Tur,Løpetur,"0:30","5",a.gpx,1800,1700,5000'))).toEqual([]);
	});
});

describe('skipReasonFor', () => {
	const base: StravaManifestRow = {
		id: '1',
		dateText: '1. mai 2020',
		name: 'Tur',
		sportType: 'running',
		rawType: 'Løpetur',
		distanceMeters: 5000,
		elapsedSeconds: 1800,
		movingSeconds: 1700,
		filePath: 'activities/1.gpx'
	};

	it('er null for en rad som kan importeres', () => {
		expect(skipReasonFor(base)).toBeNull();
	});

	it('melder manglende fil før ukjent sport — en manuell økt er forventet', () => {
		expect(skipReasonFor({ ...base, filePath: null, sportType: null })).toBe('ingen-fil');
	});

	it('melder ukjent sport når fila finnes', () => {
		expect(skipReasonFor({ ...base, sportType: null })).toBe('ukjent-sport');
	});
});

describe('stripGzip', () => {
	it('avdekker endelsen under .gz så parseren kan velges', () => {
		expect(stripGzip('activities/1.gpx.gz')).toEqual({ path: 'activities/1.gpx', gzipped: true });
		expect(stripGzip('activities/1.fit.gz')).toEqual({ path: 'activities/1.fit', gzipped: true });
		expect(stripGzip('activities/1.gpx')).toEqual({ path: 'activities/1.gpx', gzipped: false });
	});
});

describe('triageCandidateFromRow', () => {
	it('gir triagen manifestets tall, ikke sporets', () => {
		const rows = parseStravaManifest(
			csv('5,"2. aug. 2019",Run,Løpetur,"0:15","3,83",activities/5.fit.gz,922,922,3830')
		);
		expect(triageCandidateFromRow(rows[0])).toEqual({
			id: '5',
			date: '2. aug. 2019',
			name: 'Run',
			sportType: 'running',
			distanceMeters: 3830,
			elapsedSeconds: 922,
			movingSeconds: 922
		});
	});
});
