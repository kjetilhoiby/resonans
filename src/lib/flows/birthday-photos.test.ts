import { describe, expect, it } from 'vitest';
import { parseBirthdayPhotos, serializeBirthdayPhotos } from './birthday-photos';

const photo = (url: string, caption = '', publicId = 'pid') => ({ url, publicId, caption });

describe('serializeBirthdayPhotos + parseBirthdayPhotos', () => {
	it('runder tur-retur og trimmer bildetekst', () => {
		const photos = [photo('https://a/1.jpg', '  Gaustatoppen  '), photo('https://a/2.jpg', 'Bonfire')];
		const parsed = parseBirthdayPhotos(serializeBirthdayPhotos(photos));
		expect(parsed).toEqual([
			{ url: 'https://a/1.jpg', publicId: 'pid', caption: 'Gaustatoppen' },
			{ url: 'https://a/2.jpg', publicId: 'pid', caption: 'Bonfire' }
		]);
	});

	it('dropper bilder uten url', () => {
		const out = parseBirthdayPhotos(serializeBirthdayPhotos([photo(''), photo('https://a/1.jpg', 'ok')]));
		expect(out).toHaveLength(1);
		expect(out[0].url).toBe('https://a/1.jpg');
	});

	it('begrenser til seks bilder', () => {
		const many = Array.from({ length: 9 }, (_, i) => photo(`https://a/${i}.jpg`));
		expect(parseBirthdayPhotos(serializeBirthdayPhotos(many))).toHaveLength(6);
	});

	it('gir tom liste ved søppel eller tomt', () => {
		expect(parseBirthdayPhotos('ikke json')).toEqual([]);
		expect(parseBirthdayPhotos('{"url":"x"}')).toEqual([]); // ikke array
		expect(parseBirthdayPhotos(null)).toEqual([]);
		expect(parseBirthdayPhotos('')).toEqual([]);
	});
});
