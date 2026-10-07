import { describe, expect, it } from 'vitest';
import { allInMainlandNorway, isInMainlandNorway } from './norway-coverage';

describe('isInMainlandNorway', () => {
	it.each([
		['Oslo', 59.91, 10.75],
		['Halden', 59.12, 11.39],
		['Kristiansand', 58.15, 7.99],
		['Bergen', 60.39, 5.32],
		['Trondheim', 63.43, 10.39],
		['Røros', 62.57, 11.38],
		['Bodø', 67.28, 14.4],
		['Narvik', 68.44, 17.43],
		['Tromsø', 69.65, 18.96],
		['Kautokeino', 69.01, 23.04],
		['Hammerfest', 70.66, 23.68],
		['Kirkenes', 69.73, 30.05]
	])('%s ligger i Norge', (_navn, lat, lon) => {
		expect(isInMainlandNorway(lat, lon)).toBe(true);
	});

	it.each([
		['Strömstad', 58.94, 11.17],
		['Stockholm', 59.33, 18.06],
		['Storlien', 63.32, 12.1],
		['Kiruna', 67.86, 20.23],
		['Kilpisjärvi', 69.05, 20.8],
		['Karigasniemi', 69.4, 25.85],
		['København', 55.68, 12.57],
		['Longyearbyen', 78.22, 15.65]
	])('%s ligger ikke i Norge', (_navn, lat, lon) => {
		expect(isInMainlandNorway(lat, lon)).toBe(false);
	});

	it('avviser tall som ikke er tall', () => {
		expect(isInMainlandNorway(Number.NaN, 10)).toBe(false);
	});
});

describe('allInMainlandNorway', () => {
	it('er usann uten punkter', () => {
		expect(allInMainlandNorway([])).toBe(false);
	});

	it('er usann når turen krysser grensa', () => {
		expect(
			allInMainlandNorway([
				[59.91, 10.75],
				[58.94, 11.17]
			])
		).toBe(false);
	});

	it('sjekker siste punkt også når sporet tynnes ut', () => {
		const spor: [number, number][] = Array.from({ length: 1001 }, () => [59.91, 10.75]);
		spor.push([58.94, 11.17]);
		expect(allInMainlandNorway(spor)).toBe(false);
	});
});
