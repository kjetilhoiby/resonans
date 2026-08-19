import { describe, it, expect } from 'vitest';
import { hasFormatPrefix, merchantKeyFromDescription } from './merchant-key';

const key = merchantKeyFromDescription;

describe('merchantKeyFromDescription — uendret oppførsel', () => {
	// Disse dekker funksjonen slik den var privat i sparebank1-sync.ts. De står først fordi
	// utflyttingen ikke skal endre noe for radene som alt finnes.
	it('normaliserer mellomrom, store bokstaver og unicode', () => {
		expect(key('  kiwi   bølerl  ')).toBe('KIWI BØLERL');
		expect(key(null)).toBe('');
		expect(key(undefined)).toBe('');
		expect(key('   ')).toBe('');
	});

	it('trunkerer kjeder til kjede + sted', () => {
		expect(key('KIWI BØLERL BØLERLIA OSLO')).toBe('KIWI BØLERL');
		expect(key('REMA 1000 TORGET OSLO')).toBe('REMA 1000');
		expect(key('COOP MEGA STORO OSLO')).toBe('COOP MEGA STORO');
		expect(key('NARVESEN OSLO S SENTRUM')).toBe('NARVESEN OSLO');
	});

	it('samler Oda uansett ordrereferanse', () => {
		expect(key('Oda.com - a6uafe')).toBe('ODA.COM');
		expect(key('Oda.com - zz99xy')).toBe('ODA.COM');
	});

	it('fjerner SB1s flertekst-prefikser', () => {
		expect(key('Fra: Marie Helene Nygaard Betalt:')).toBe('MARIE HELENE NYGAARD');
		expect(key('Nettgiro til: Fjordkraft Betalt:')).toBe('FJORDKRAFT');
		expect(key('Til: Betalt:')).toBe('OVERØRSEL');
		expect(key('Overørsel mellom egne konti 1234')).toBe('OVERØRSEL');
	});

	it('lar en vanlig beskrivelse stå', () => {
		expect(key('DANSK CAMPING UNION')).toBe('DANSK CAMPING UNION');
	});
});

describe('valutaprefiks — feilen fra 23. juni 2026', () => {
	// De faktiske parene fra prod. Poenget med hver: de to skal gi SAMME nøkkel, altså
	// havne i samme rad, altså ikke telles to ganger.
	const målt: Array<[string, string]> = [
		['DKK DANSK CAMPING UNION', 'DANSK CAMPING UNION'],
		['USD OPENAI CHATGPT SUBSCR', 'OPENAI CHATGPT SUBSCR'],
		['SEK TYCHO BRAHE', 'TYCHO BRAHE'],
		['EUR The New York Times', 'The New York Times'],
		['USD NEON.TECH', 'NEON.TECH'],
		['DKK CIRCLE K NORDHOJ, KOGE', 'CIRCLE K NORDHOJ, KOGE']
	];

	for (const [prefixed, plain] of målt) {
		it(`«${prefixed}» og «${plain}» gir samme bøtte`, () => {
			expect(key(prefixed)).toBe(key(plain));
		});
	}

	// Rekkefølgen i funksjonen: format strippes FØR kjedereglene. Uten det havner
	// «SEK ICA NARA HAGA» utenfor enhver regel og får sin egen bøtte.
	it('stripper format før kjedereglene', () => {
		expect(key('DKK KIWI BØLERL BØLERLIA OSLO')).toBe('KIWI BØLERL');
		expect(key('SEK ICA NARA HAGA')).toBe('ICA NARA HAGA');
	});

	it('rører ikke et førsteord som bare LIKNER en valutakode', () => {
		expect(key('USDA KJØTT')).toBe('USDA KJØTT');
		expect(key('EURO SKO LILLESTRØM')).toBe('EURO SKO LILLESTRØM');
	});

	// En kode som ER hele teksten er et navn, ikke et prefiks. Returnerte vi '' her, ville
	// ALLE slike rader kollapset i én bøtte — mye verre enn å la dem stå.
	it('stripper ikke når koden er hele teksten', () => {
		expect(key('USD')).toBe('USD');
		expect(key('DKK ')).toBe('DKK');
	});
});

describe('datoprefiks', () => {
	it('gir samme bøtte som uten dato', () => {
		expect(key('02.07 SPORT 1 RINDAL RINDALSVEGEN RINDAL')).toBe(
			key('SPORT 1 RINDAL RINDALSVEGEN RINDAL')
		);
		expect(key('07.06 YX 7-ELEVEN 754 SJØSKOGENVEI')).toBe(key('YX 7-ELEVEN 754 SJØSKOGENVEI'));
	});

	it('godtar både 7.6 og 07.06, med og uten avsluttende punktum', () => {
		expect(key('7.6 BUTIKK')).toBe('BUTIKK');
		expect(key('07.06. BUTIKK')).toBe('BUTIKK');
	});

	it('rører ikke et beløp eller versjonsnummer inni teksten', () => {
		expect(key('BUTIKK 02.07')).toBe('BUTIKK 02.07');
		expect(key('02.07.2026 BUTIKK')).toBe('02.07.2026 BUTIKK');
	});
});

describe('«Til:» var glemt mens «Fra:» fantes', () => {
	// 2 000 kr sto som to rader i prod. Jeg klassifiserte det først som et personnavn-prefiks
	// vi ikke kunne gjøre noe med; det var et manglende motstykke til en regel som alt fantes.
	it('gir samme bøtte som uten prefikset', () => {
		expect(key('Til: Påmelding for Kjetil Høiby')).toBe(key('Påmelding for Kjetil Høiby'));
	});

	it('er symmetrisk med «Fra:»', () => {
		expect(key('Til: Marie Helene Nygaard Betalt:')).toBe(
			key('Fra: Marie Helene Nygaard Betalt:')
		);
	});

	it('faller tilbake på en generisk nøkkel uten navn', () => {
		expect(key('Til: ')).toBe('TIL:');
		expect(key('Fra: Betalt:')).toBe('OVERØRSEL');
	});
});

describe('hasFormatPrefix', () => {
	it('kjenner igjen prefiksene bøttenøkkelen stripper', () => {
		expect(hasFormatPrefix('USD OPENAI')).toBe(true);
		expect(hasFormatPrefix('02.07 SPORT 1 RINDAL')).toBe(true);
	});

	it('er falsk for en ren beskrivelse', () => {
		expect(hasFormatPrefix('OPENAI')).toBe(false);
		expect(hasFormatPrefix('USDA KJØTT')).toBe(false);
		expect(hasFormatPrefix('')).toBe(false);
		expect(hasFormatPrefix(null)).toBe(false);
	});

	// Kontrakten mellom de to: er det et format-prefiks, skal nøkkelen faktisk endre seg.
	it('stemmer med at nøkkelen endrer seg', () => {
		for (const text of ['USD OPENAI', '02.07 BUTIKK', 'OPENAI', 'KIWI BØLERL']) {
			const stripped = hasFormatPrefix(text);
			const changed = key(text) !== key(text.replace(/^\S+\s+/, ''));
			// Enten strippes prefikset (og nøkkelen er lik uten det), eller det gjør ikke det.
			expect(stripped ? !changed : true).toBe(true);
		}
	});
});
