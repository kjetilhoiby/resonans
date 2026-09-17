import { describe, it, expect } from 'vitest';
import {
	LONG_IMAGE_RATIO,
	MAX_SLICES,
	MIN_REGION_HEIGHT,
	padRegion,
	planTicketSlices,
	regionsFromModel,
	regularizeRegions,
	splitByRegions,
	ticketLabel,
	worthSplitting
} from './ticket-image';

describe('planTicketSlices', () => {
	it('lar et vanlig bilde være ett snitt', () => {
		expect(planTicketSlices(1600, 1200)).toEqual([{ top: 0, height: 1 }]);
		expect(planTicketSlices(1000, 1700)).toEqual([{ top: 0, height: 1 }]);
	});

	it('deler et langt skjermbilde', () => {
		const slices = planTicketSlices(1170, 6000);
		expect(slices.length).toBeGreaterThan(1);
		expect(slices.length).toBeLessThanOrEqual(MAX_SLICES);
	});

	it('dekker hele bildet — første snitt på toppen, siste i bunnen', () => {
		const slices = planTicketSlices(1170, 6000);
		expect(slices[0].top).toBe(0);
		const last = slices[slices.length - 1];
		expect(last.top + last.height).toBeCloseTo(1, 4);
	});

	it('etterlater ingen hull: hvert snitt begynner før det forrige slutter', () => {
		for (const [w, h] of [[1170, 6000], [1170, 3000], [800, 9000], [1000, 2000]]) {
			const slices = planTicketSlices(w, h);
			for (let i = 1; i < slices.length; i++) {
				const prevEnd = slices[i - 1].top + slices[i - 1].height;
				expect(slices[i].top).toBeLessThan(prevEnd);
			}
		}
	});

	it('holder seg innenfor bildet', () => {
		for (const [w, h] of [[1170, 6000], [400, 20000], [1000, 1900]]) {
			for (const slice of planTicketSlices(w, h)) {
				expect(slice.top).toBeGreaterThanOrEqual(0);
				expect(slice.top + slice.height).toBeLessThanOrEqual(1.0001);
			}
		}
	});

	it('taket holder for et absurd langt bilde', () => {
		expect(planTicketSlices(400, 40000).length).toBe(MAX_SLICES);
	});

	it('gir ett snitt på mål vi ikke har — vi gjetter ikke på en form vi ikke har målt', () => {
		expect(planTicketSlices(0, 5000)).toEqual([{ top: 0, height: 1 }]);
		expect(planTicketSlices(NaN, NaN)).toEqual([{ top: 0, height: 1 }]);
		expect(planTicketSlices(-10, 100)).toEqual([{ top: 0, height: 1 }]);
	});

	it('terskelen er der den er dokumentert', () => {
		const w = 1000;
		expect(planTicketSlices(w, w * (LONG_IMAGE_RATIO - 0.01))).toHaveLength(1);
		expect(planTicketSlices(w, w * (LONG_IMAGE_RATIO + 0.5)).length).toBeGreaterThan(1);
	});
});

describe('padRegion', () => {
	it('utvider i begge ender', () => {
		expect(padRegion({ top: 0.4, height: 0.2 }, 0.03)).toEqual({ top: 0.37, height: 0.26 });
	});

	it('klipper mot bildekantene', () => {
		expect(padRegion({ top: 0, height: 0.2 }, 0.05)).toEqual({ top: 0, height: 0.25 });
		expect(padRegion({ top: 0.9, height: 0.1 }, 0.05)).toEqual({ top: 0.85, height: 0.15 });
	});
});

describe('regionsFromModel', () => {
	it('leser andeler', () => {
		expect(regionsFromModel([{ top: 0.5, height: 0.2 }])).toEqual([{ top: 0.47, height: 0.26 }]);
	});

	it('leser prosent like godt som andeler', () => {
		expect(regionsFromModel([{ topPct: 50, bottomPct: 70 }])).toEqual([{ top: 0.47, height: 0.26 }]);
	});

	it('enheten avgjøres av HELE lista, ikke av det enkelte tallet', () => {
		// Ett tall over 1 betyr at ingenting kan være en andel: alt er prosent.
		// Ett utsnitt, så regulariseringen holder seg unna og bare enheten måles.
		expect(regionsFromModel([{ top: 10, height: 20 }])).toEqual([{ top: 0.07, height: 0.26 }]);
	});

	it('leser prosent også over flere utsnitt — toppene er det enheten avgjør', () => {
		const regions = regionsFromModel([
			{ top: 10, height: 20 },
			{ top: 40, height: 20 }
		]);
		// Høydene settes av `regularizeRegions` til den gjentakende enheten (0,3),
		// ikke av det modellen oppga. Toppene er det enhetsvalget bestemmer.
		expect(regions.map((r) => r.top)).toEqual([0.07, 0.37]);
	});

	it('sorterer ovenfra og ned', () => {
		const regions = regionsFromModel([
			{ top: 0.6, height: 0.2 },
			{ top: 0.2, height: 0.2 }
		]);
		expect(regions[0].top).toBeLessThan(regions[1].top);
	});

	it('forkaster HELE lista når én rad er tull — et halvt sett er verre enn ingen', () => {
		expect(regionsFromModel([{ top: 0.1, height: 0.2 }, { top: 'tull' }])).toEqual([]);
		expect(regionsFromModel([{ top: 0.1, height: 0.2 }, null])).toEqual([]);
		// 1.5 kan ikke være en andel. Lista leses da som prosent, og et utsnitt
		// på 0,2 % er for lite til å være en billett — så den forkastes.
		expect(regionsFromModel([{ top: 1.5, height: 0.2 }])).toEqual([]);
	});

	it('forkaster utsnitt som er for små til å være en billett', () => {
		expect(regionsFromModel([{ top: 0.1, height: MIN_REGION_HEIGHT / 2 }])).toEqual([]);
	});

	it('klipper et utsnitt som stikker under bildet', () => {
		const [region] = regionsFromModel([{ top: 0.9, height: 0.5 }]);
		expect(region.top + region.height).toBeLessThanOrEqual(1);
	});

	it('tåler at modellen ikke svarte med en liste', () => {
		expect(regionsFromModel(undefined)).toEqual([]);
		expect(regionsFromModel([])).toEqual([]);
		expect(regionsFromModel('tre billetter')).toEqual([]);
	});
});

describe('worthSplitting', () => {
	it('krever mer enn ett utsnitt', () => {
		expect(worthSplitting([{ top: 0, height: 0.3 }])).toBe(false);
		expect(worthSplitting([])).toBe(false);
	});

	it('avviser et utsnitt som i praksis er hele bildet', () => {
		expect(worthSplitting([{ top: 0, height: 0.95 }, { top: 0.5, height: 0.3 }])).toBe(false);
	});

	it('godtar ekte oppdeling', () => {
		expect(worthSplitting([{ top: 0.2, height: 0.25 }, { top: 0.5, height: 0.25 }])).toBe(true);
	});
});

describe('ticketLabel', () => {
	it('nummererer bare når det er flere', () => {
		expect(ticketLabel(0, 3)).toBe('Billett 1 av 3');
		expect(ticketLabel(2, 3)).toBe('Billett 3 av 3');
		expect(ticketLabel(0, 1)).toBeNull();
	});
});

describe('splitByRegions', () => {
	const base = { url: 'https://x/a.jpg', publicId: 'a', region: null, label: null };

	it('gir én oppføring per billett, alle mot samme fil', () => {
		const out = splitByRegions(base, [
			{ top: 0.2, height: 0.25 },
			{ top: 0.5, height: 0.25 }
		]);
		expect(out).toHaveLength(2);
		expect(out.every((t) => t.publicId === 'a')).toBe(true);
		expect(out.map((t) => t.label)).toEqual(['Billett 1 av 2', 'Billett 2 av 2']);
		expect(out[0].region).toEqual({ top: 0.2, height: 0.25 });
	});

	it('returnerer originalen alene når oppdelingen ikke er verdt noe', () => {
		expect(splitByRegions(base, [])).toEqual([base]);
		expect(splitByRegions(base, [{ top: 0, height: 0.3 }])).toEqual([base]);
		// Ett utsnitt som dekker nesten alt er originalen med ny etikett.
		expect(splitByRegions(base, [{ top: 0, height: 0.95 }, { top: 0.1, height: 0.3 }])).toEqual([base]);
	});

	it('muterer ikke originalen', () => {
		splitByRegions(base, [{ top: 0.2, height: 0.25 }, { top: 0.5, height: 0.25 }]);
		expect(base.region).toBeNull();
		expect(base.label).toBeNull();
	});
});

describe('regularizeRegions', () => {
	it('gir alle utsnitt samme høyde som avstanden mellom dem', () => {
		// Den målte feilen, 17. september 2026: tre billetter, riktige topper,
		// men det siste utsnittet var for KORT og endte akkurat der billetten
		// begynte. Høyden hentes derfor fra avstanden, ikke fra anslaget.
		const fixed = regularizeRegions([
			{ top: 0, height: 0.33 },
			{ top: 0.333, height: 0.33 },
			{ top: 0.667, height: 0.2 }
		]);
		expect(fixed.map((r) => r.height)).toEqual([0.3335, 0.3335, 0.3335]);
	});

	it('dekker siden uten hull — et hull er der en billett forsvinner', () => {
		const fixed = regularizeRegions([
			{ top: 0, height: 0.3 },
			{ top: 0.333, height: 0.2 },
			{ top: 0.667, height: 0.15 }
		]);
		for (let i = 1; i < fixed.length; i++) {
			const prevEnd = fixed[i - 1].top + fixed[i - 1].height;
			expect(fixed[i].top).toBeLessThanOrEqual(prevEnd + 0.0001);
		}
	});

	it('holder seg innenfor bildet, og forankrer det siste i bunnen', () => {
		const fixed = regularizeRegions([
			{ top: 0.02, height: 0.3 },
			{ top: 0.35, height: 0.3 },
			{ top: 0.68, height: 0.3 }
		]);
		const last = fixed[fixed.length - 1];
		expect(last.top + last.height).toBeLessThanOrEqual(1.0001);
		expect(fixed.every((r) => r.top >= 0)).toBe(true);
	});

	it('bruker MEDIANEN av ankrene, så én bommet topp ikke drar rutenettet med seg', () => {
		// Midterste topp er 0,05 for lav. De to andre skal vinne.
		const fixed = regularizeRegions([
			{ top: 0.1, height: 0.3 },
			{ top: 0.35, height: 0.3 },
			{ top: 0.7, height: 0.3 }
		]);
		expect(fixed[0].top).toBeCloseTo(0.1, 2);
	});

	it('rører ingenting når siden ikke ER en gjentakelse', () => {
		const uneven = [
			{ top: 0.05, height: 0.1 },
			{ top: 0.2, height: 0.1 },
			{ top: 0.8, height: 0.1 }
		];
		expect(regularizeRegions(uneven)).toEqual(uneven);
	});

	it('rører ikke ett enkelt utsnitt', () => {
		const one = [{ top: 0.3, height: 0.2 }];
		expect(regularizeRegions(one)).toEqual(one);
	});

	it('to billetter regulariseres like godt som tre', () => {
		const fixed = regularizeRegions([
			{ top: 0, height: 0.45 },
			{ top: 0.5, height: 0.2 }
		]);
		expect(fixed.map((r) => r.height)).toEqual([0.5, 0.5]);
		expect(fixed[1].top).toBeCloseTo(0.5, 3);
	});
});

describe('regionsFromModel + regularisering', () => {
	it('retter det avkuttede siste utsnittet ende til ende', () => {
		const regions = regionsFromModel([
			{ topPct: 0, bottomPct: 33 },
			{ topPct: 33.3, bottomPct: 66 },
			{ topPct: 66.7, bottomPct: 87 }
		]);
		expect(regions).toHaveLength(3);
		// Invarianten som betyr noe: INGEN utsnitt er kortere enn den gjentakende
		// enheten (~1/3). Det var nettopp det som gjorde det tredje verdiløst.
		// Høydene er ikke identiske etter polstring, og skal ikke være det —
		// polstringen klippes mot bildekanten, der det ikke finnes mer å ta med.
		for (const region of regions) expect(region.height).toBeGreaterThanOrEqual(0.33);
		// Og det siste når helt ned til bunnen av siden.
		const last = regions[regions.length - 1];
		expect(last.top + last.height).toBeGreaterThan(0.97);
	});
});
