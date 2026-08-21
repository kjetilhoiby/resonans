import { describe, expect, it } from 'vitest';
import {
	dagerMellom,
	finnFellesGulv,
	konkluder,
	normaliserDato,
	vurderEksplisittFra,
	vurderKonto,
	type ProbeRad
} from './history-probe';

const rad = (o: Partial<ProbeRad> = {}): ProbeRad => ({
	accountKey: 'k1',
	name: 'Brukskonto',
	count: 137,
	oldestDate: '2023-01-15',
	newestDate: '2026-08-20',
	...o
});

describe('dagerMellom', () => {
	it('regner hele dager', () => {
		expect(dagerMellom('2026-01-01', '2026-01-31')).toBe(30);
	});

	it('tåler tidsstempler med klokkeslett', () => {
		expect(dagerMellom('2026-01-01T22:00:00Z', '2026-01-02T03:00:00Z')).toBe(1);
	});

	it('returnerer null på søppel framfor NaN', () => {
		expect(dagerMellom('ikke-en-dato', '2026-01-01')).toBeNull();
	});
});

describe('normaliserDato', () => {
	// SpareBank1 sender epoch-millisekunder. Proben antok streng og krasjet med
	// «slice is not a function» første gang knappen ble trykket i produksjon.
	it('tar epoch-millisekunder, slik banken faktisk sender', () => {
		expect(normaliserDato(1_700_000_000_000)).toBe('2023-11-14');
	});

	it('tar epoch-sekunder også', () => {
		expect(normaliserDato(1_700_000_000)).toBe('2023-11-14');
	});

	it('tar et tidsstempel som streng', () => {
		expect(normaliserDato('1700000000000')).toBe('2023-11-14');
	});

	it('tar ISO med og uten klokkeslett', () => {
		expect(normaliserDato('2026-08-21')).toBe('2026-08-21');
		expect(normaliserDato('2026-08-21T13:45:00Z')).toBe('2026-08-21');
	});

	it('tar et Date-objekt', () => {
		expect(normaliserDato(new Date('2024-02-29T12:00:00Z'))).toBe('2024-02-29');
	});

	it('gir null på det den ikke forstår, framfor å kaste', () => {
		for (const søppel of [null, undefined, '', '   ', 'i går', {}, [], NaN, Infinity]) {
			expect(normaliserDato(søppel)).toBeNull();
		}
	});
});

describe('vurderKonto', () => {
	it('kaller et langt, ukappet svar lang historikk', () => {
		const v = vurderKonto(rad());
		expect(v.verdikt).toBe('lang-historikk');
		expect(v.muligKappet).toBe(false);
	});

	it('kaller et kort svar kort historikk', () => {
		const v = vurderKonto(rad({ oldestDate: '2026-05-25', count: 42 }));
		expect(v.verdikt).toBe('kort-historikk');
	});

	it('flagger et antall som treffer en sidegrense', () => {
		expect(vurderKonto(rad({ count: 100 })).verdikt).toBe('kappet');
		expect(vurderKonto(rad({ count: 500 })).verdikt).toBe('kappet');
	});

	it('flagger IKKE et antall som bare er delelig på 100 uten å være en sidegrense', () => {
		// 300 er ikke i lista: en bank som sender 300 gjør det antakelig fordi det
		// er alt som finnes. Å flagge alt delelig på 100 ville gjort verdikten stum.
		expect(vurderKonto(rad({ count: 300 })).verdikt).toBe('lang-historikk');
	});

	it('lar kappet slå ut selv når spennet er langt', () => {
		// Poenget: et kappet svar kan dekke tre år og skjule tjue.
		const v = vurderKonto(rad({ count: 200, oldestDate: '2019-01-01' }));
		expect(v.verdikt).toBe('kappet');
	});

	it('regner spennet riktig når datoene kommer som epoch-ms', () => {
		const v = vurderKonto(
			rad({ oldestDate: 1_600_000_000_000, newestDate: 1_700_000_000_000, count: 137 })
		);
		expect(v.oldestDate).toBe('2020-09-13');
		expect(v.newestDate).toBe('2023-11-14');
		expect(v.spennDager).toBe(1157);
		expect(v.verdikt).toBe('lang-historikk');
	});

	it('skiller tom konto fra kort historikk', () => {
		const v = vurderKonto(rad({ count: 0, oldestDate: null, newestDate: null }));
		expect(v.verdikt).toBe('ingen-data');
		expect(v.spennDager).toBeNull();
	});
});

describe('finnFellesGulv', () => {
	it('finner datoen flere kontoer deler', () => {
		const v = [
			vurderKonto(rad({ accountKey: 'a', oldestDate: '2024-08-21' })),
			vurderKonto(rad({ accountKey: 'b', oldestDate: '2024-08-21' })),
			vurderKonto(rad({ accountKey: 'c', oldestDate: '2025-03-01' }))
		];
		expect(finnFellesGulv(v)).toBe('2024-08-21');
	});

	it('gir null når hver konto har sin egen startdato', () => {
		const v = [
			vurderKonto(rad({ accountKey: 'a', oldestDate: '2024-08-21' })),
			vurderKonto(rad({ accountKey: 'b', oldestDate: '2025-01-02' }))
		];
		expect(finnFellesGulv(v)).toBeNull();
	});

	it('teller ikke tomme kontoer som deltakere i et gulv', () => {
		const v = [
			vurderKonto(rad({ accountKey: 'a', count: 0, oldestDate: null, newestDate: null })),
			vurderKonto(rad({ accountKey: 'b', count: 0, oldestDate: null, newestDate: null }))
		];
		expect(finnFellesGulv(v)).toBeNull();
	});
});

describe('konkluder', () => {
	it('sier ja når banken ga oss flere år ukappet', () => {
		const k = konkluder([vurderKonto(rad())]);
		expect(k.kanHentesIgjen).toBe(true);
		expect(k.eldsteDato).toBe('2023-01-15');
		expect(k.begrunnelse).toMatch(/kan hentes inn igjen/);
	});

	it('kjenner igjen et rullerende vindu framfor å kalle det kort historikk', () => {
		// Ekte måling 21. august 2026: seks kontoer startet alle på 2024-08-21.
		// 729 dager mellom eldste og nyeste lå ÉN dag under terskelen for «lang»,
		// så uten gulv-deteksjonen ble et toårsvindu kalt «kort historikk».
		const felles = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) =>
			vurderKonto(rad({ accountKey: k, oldestDate: '2024-08-21', newestDate: '2026-08-20' }))
		);
		const k = konkluder(felles, '2026-08-21');
		expect(k.fellesGulv).toBe('2024-08-21');
		expect(k.vindusDager).toBe(730);
		expect(k.kanHentesIgjen).toBe(false);
		expect(k.begrunnelse).toMatch(/rullerende vindu på 24 måneder/);
		expect(k.begrunnelse).toMatch(/6 kontoer/);
	});

	it('måler vinduet fra i dag, ikke fra nyeste transaksjon', () => {
		// En konto uten bevegelse på tre uker skal ikke se ut som et kortere vindu.
		const v = [
			vurderKonto(rad({ accountKey: 'a', oldestDate: '2024-08-21', newestDate: '2026-07-30' })),
			vurderKonto(rad({ accountKey: 'b', oldestDate: '2024-08-21', newestDate: '2026-07-30' }))
		];
		expect(konkluder(v, '2026-08-21').vindusDager).toBe(730);
	});

	it('sier nei når historikken er kort', () => {
		const k = konkluder([vurderKonto(rad({ oldestDate: '2026-06-01', count: 30 }))]);
		expect(k.kanHentesIgjen).toBe(false);
		expect(k.begrunnelse).toMatch(/kan ikke gjenskapes/);
	});

	it('sier UVISST når minst én konto er kappet – ikke ja', () => {
		const k = konkluder([
			vurderKonto(rad({ accountKey: 'a', count: 137 })),
			vurderKonto(rad({ accountKey: 'b', count: 100 }))
		]);
		expect(k.kanHentesIgjen).toBeNull();
		expect(k.begrunnelse).toMatch(/gulv/);
	});

	it('velger den eldste datoen på tvers av kontoer', () => {
		const k = konkluder([
			vurderKonto(rad({ accountKey: 'a', oldestDate: '2024-03-01' })),
			vurderKonto(rad({ accountKey: 'b', oldestDate: '2021-11-09' }))
		]);
		expect(k.eldsteDato).toBe('2021-11-09');
	});

	it('holder tomme kontoer utenfor konklusjonen', () => {
		const k = konkluder([
			vurderKonto(rad({ accountKey: 'tom', count: 0, oldestDate: null, newestDate: null })),
			vurderKonto(rad({ accountKey: 'b', oldestDate: '2022-02-02' }))
		]);
		expect(k.kanHentesIgjen).toBe(true);
		expect(k.eldsteDato).toBe('2022-02-02');
	});

	it('sier fra når ingenting kom tilbake i det hele tatt', () => {
		const k = konkluder([vurderKonto(rad({ count: 0, oldestDate: null, newestDate: null }))]);
		expect(k.kanHentesIgjen).toBeNull();
		expect(k.begrunnelse).toMatch(/Ingen transaksjoner/);
	});
});

describe('vurderEksplisittFra', () => {
	it('bekrefter at vinduet er bankens når svaret er likt', () => {
		const r = vurderEksplisittFra('2024-08-21', '2024-08-21', '2015-01-01');
		expect(r.vinduetErBankens).toBe(true);
		expect(r.begrunnelse).toMatch(/Vinduet er bankens/);
	});

	it('avslører at standardvinduet var VÅRT problem når eksplisitt gir mer', () => {
		const r = vurderEksplisittFra('2024-08-21', '2019-03-04', '2015-01-01');
		expect(r.vinduetErBankens).toBe(false);
		expect(r.begrunnelse).toMatch(/2 000 dager MER|dager MER/);
		expect(r.begrunnelse).toMatch(/backfill bør/);
	});

	it('teller nyere svar ved eksplisitt som bekreftelse, ikke som mer', () => {
		// Banken kan aldri gi MINDRE fordi vi ba om mer; skjer det, er det ikke
		// et tegn på skjult historikk.
		const r = vurderEksplisittFra('2024-08-21', '2025-01-01', '2015-01-01');
		expect(r.vinduetErBankens).toBe(true);
	});

	it('tåler at det ikke kom noe tilbake i det hele tatt', () => {
		const r = vurderEksplisittFra('2024-08-21', null, '2015-01-01');
		expect(r.vinduetErBankens).toBe(true);
		expect(r.eldsteVedEksplisitt).toBeNull();
	});
});
