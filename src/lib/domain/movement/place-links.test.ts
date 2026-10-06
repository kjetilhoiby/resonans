import { describe, it, expect } from 'vitest';
import { distanceMeters, inferCategoryFromName, proposePlaceLinks, type LinkablePlace } from './place-links';

/** Et sted `north` meter nord for et fast punkt. */
function place(id: string, name: string, overrides: Partial<LinkablePlace> = {}, north = 0): LinkablePlace {
	return {
		externalId: id,
		name,
		category: 'unknown',
		named: true,
		archived: false,
		latitude: 59.9 + north / 111_320,
		longitude: 10.7,
		radiusMeters: 150,
		...overrides
	};
}

describe('inferCategoryFromName', () => {
	it('kjenner hjem, jobb og familie i vanlige former', () => {
		expect(inferCategoryFromName('Hjemme')).toBe('home');
		expect(inferCategoryFromName('Jobben')).toBe('work');
		expect(inferCategoryFromName('Hos svigers')).toBe('family');
	});

	it('gjetter ikke på et navn som ikke sier noe', () => {
		expect(inferCategoryFromName('Barnehagen')).toBe('unknown');
		expect(inferCategoryFromName('Morten')).toBe('unknown');
	});
});

describe('distanceMeters', () => {
	it('måler hundre meter som hundre meter', () => {
		expect(Math.round(distanceMeters(place('a', 'A'), place('b', 'B', {}, 100)))).toBe(100);
	});
});

describe('proposePlaceLinks', () => {
	const akserHome = place('A-home', 'Hjemme', { category: 'home' });
	const ekkoHome = place('E-home', 'Hjem', {}, 40);

	it('kobler automatisk når kategorien er den samme', () => {
		expect(proposePlaceLinks([akserHome], [ekkoHome])).toEqual([
			{ akserId: 'A-home', ekkoId: 'E-home', status: 'auto', distanceMeters: 40 }
		]);
	});

	it('kobler automatisk på likt navn', () => {
		const links = proposePlaceLinks([place('A', 'Hytta', { category: 'recreation' })], [place('E', 'hytta', {}, 30)]);
		expect(links[0].status).toBe('auto');
	});

	it('foreslår når stedene overlapper men ikke sier det samme', () => {
		const links = proposePlaceLinks([place('A', 'Nytt sted', { named: false })], [place('E', 'Barnehagen', {}, 60)]);
		expect(links).toEqual([{ akserId: 'A', ekkoId: 'E', status: 'suggested', distanceMeters: 60 }]);
	});

	it('kobler ikke steder som ikke overlapper', () => {
		expect(proposePlaceLinks([akserHome], [place('E', 'Hjem', {}, 400)])).toEqual([]);
	});

	it('gir ett forslag, ikke ett per automatisk sted rundt hjemmet', () => {
		const autos = [10, 50, 90, 130].map((m, i) => place(`auto-${i}`, 'Nytt sted', { named: false }, m));
		const links = proposePlaceLinks([...autos, akserHome], [ekkoHome]);
		expect(links).toEqual([{ akserId: 'A-home', ekkoId: 'E-home', status: 'auto', distanceMeters: 40 }]);
	});

	it('nærmeste vinner når ingen er automatiske', () => {
		const far = place('far', 'Nytt sted', { named: false }, 120);
		const near = place('near', 'Nytt sted', { named: false }, 20);
		expect(proposePlaceLinks([far, near], [place('E', 'Barnehagen')])[0].akserId).toBe('near');
	});

	it('foreslår aldri en avvist kobling på nytt', () => {
		const links = proposePlaceLinks([akserHome], [ekkoHome], [{ akserId: 'A-home', ekkoId: 'E-home', status: 'rejected' }]);
		expect(links).toEqual([]);
	});

	it('et sted med en bekreftet kobling får ikke en til', () => {
		const other = place('A-2', 'Nytt sted', { named: false }, 10);
		const links = proposePlaceLinks([akserHome, other], [ekkoHome], [{ akserId: 'A-home', ekkoId: 'E-home', status: 'confirmed' }]);
		expect(links).toEqual([]);
	});

	it('hopper over arkiverte steder', () => {
		expect(proposePlaceLinks([{ ...akserHome, archived: true }], [ekkoHome])).toEqual([]);
	});
});
