import { describe, it, expect, vi } from 'vitest';
import { geocodeDiaryImages, type DiaryImage } from './trip-api';

describe('geocodeDiaryImages', () => {
	const geo = { lat: 60.5, lon: 10.2 };
	const geocode = vi.fn(async () => geo);

	it('geokoder bilder med nytt sted', async () => {
		geocode.mockClear();
		const out = await geocodeDiaryImages([{ url: 'a.jpg', place: 'Dovre' }], undefined, geocode);
		expect(geocode).toHaveBeenCalledWith('Dovre');
		expect(out[0]).toMatchObject({ url: 'a.jpg', place: 'Dovre', geo });
	});

	it('gjenbruker lagret koordinat når stedet er uendret', async () => {
		geocode.mockClear();
		const existing: DiaryImage[] = [{ url: 'a.jpg', place: 'Dovre', geo: { lat: 62, lon: 9 } }];
		const out = await geocodeDiaryImages(
			[{ url: 'a.jpg', place: 'Dovre', geo: { lat: 62, lon: 9 } }],
			existing,
			geocode
		);
		expect(geocode).not.toHaveBeenCalled();
		expect(out[0].geo).toEqual({ lat: 62, lon: 9 });
	});

	it('re-geokoder når stedet er endret', async () => {
		geocode.mockClear();
		const existing: DiaryImage[] = [{ url: 'a.jpg', place: 'Dovre', geo: { lat: 62, lon: 9 } }];
		const out = await geocodeDiaryImages([{ url: 'a.jpg', place: 'Hamar' }], existing, geocode);
		expect(geocode).toHaveBeenCalledWith('Hamar');
		expect(out[0].geo).toEqual(geo);
	});

	it('tomt sted fjerner koordinatet', async () => {
		geocode.mockClear();
		const existing: DiaryImage[] = [{ url: 'a.jpg', place: 'Dovre', geo: { lat: 62, lon: 9 } }];
		const out = await geocodeDiaryImages([{ url: 'a.jpg', place: '  ' }], existing, geocode);
		expect(geocode).not.toHaveBeenCalled();
		expect(out[0].geo).toBeUndefined();
		expect(out[0].place).toBeUndefined();
	});

	it('manuell nål (geoManual) røres aldri av geokodingen', async () => {
		geocode.mockClear();
		const manual: DiaryImage = {
			url: 'a.jpg',
			place: 'Igltjønna',
			geo: { lat: 62.6, lon: 11.4 },
			geoManual: true
		};
		// Selv med endret sted skal manuelt koordinat bestå.
		const out = await geocodeDiaryImages(
			[{ ...manual, place: 'Helt annet sted' }],
			[manual],
			geocode
		);
		expect(geocode).not.toHaveBeenCalled();
		expect(out[0]).toMatchObject({
			geo: { lat: 62.6, lon: 11.4 },
			geoManual: true,
			place: 'Helt annet sted'
		});
	});

	it('manuell nål består også uten stedstekst', async () => {
		geocode.mockClear();
		const out = await geocodeDiaryImages(
			[{ url: 'a.jpg', geo: { lat: 62.6, lon: 11.4 }, geoManual: true }],
			undefined,
			geocode
		);
		expect(out[0].geo).toEqual({ lat: 62.6, lon: 11.4 });
		expect(out[0].geoManual).toBe(true);
	});

	it('mislykket geokoding gir bilde uten koordinat (stedet beholdes som tekst)', async () => {
		const failing = vi.fn(async () => null);
		const out = await geocodeDiaryImages([{ url: 'a.jpg', place: 'Ukjentstad' }], undefined, failing);
		expect(out[0]).toMatchObject({ place: 'Ukjentstad' });
		expect(out[0].geo).toBeUndefined();
	});
});
