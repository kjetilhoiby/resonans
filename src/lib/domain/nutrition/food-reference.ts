/**
 * Norsk referansetabell for inntaksestimering.
 *
 * Hvorfor denne finnes: en ren LLM-gjetning på «knekkebrød» spriker fra 25 til
 * 90 kcal per stykk, avhengig av om modellen tenker på et tynt Wasa-blad eller
 * et grovt Ryvita. Samme problem for brunost, kaviar, matpakkeskiver og andre
 * varer som er dagligdagse i Norge og perifere i treningsdataene modellen er
 * trent på. Tabellen sendes med som grunnlag, og modellen får beskjed om å bruke
 * den framfor egne tall når en vare matcher.
 *
 * Verdiene er per *naturlig enhet* — én skive, ett stykk, én dl — ikke per 100 g.
 * Det er slik man faktisk logger mat («to knekkebrød med egg»), og det fjerner et
 * regnesteg der modellen ellers gjør feil.
 *
 * Tallene er avrundede bransjesnitt, ikke merkevarespesifikke. Et estimat er et
 * estimat: `confidence` skal aldri late som noe annet.
 */

export interface ReferenceFood {
	/** Stabil nøkkel. Brukes i `NutritionItem.referenceKey` for sporbarhet. */
	key: string;
	/** Visningsnavn på norsk. */
	name: string;
	/** Enheten tallene gjelder for, f.eks. «stykk», «skive», «dl». */
	unit: string;
	/** Omtrentlig vekt per enhet, når det er meningsfullt. Kun til prompt-hjelp. */
	gramsPerUnit?: number;
	kcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	/** Alternative navn brukeren kan skrive. Små bokstaver. */
	aliases?: string[];
}

/**
 * NB: hold listen kort og dagligdags. Poenget er ikke å være en matvaretabell —
 * det er å dekke det man logger ofte og som modellen gjetter dårlig på. Varer
 * modellen håndterer greit (biff, brokkoli, egg) er med fordi de opptrer sammen
 * med de andre i samme måltid, og blandede kilder gir inkonsistente summer.
 */
export const REFERENCE_FOODS: ReferenceFood[] = [
	// ── Brød og knekkebrød ─────────────────────────────────
	{ key: 'knekkebrod', name: 'Knekkebrød', unit: 'stykk', gramsPerUnit: 11, kcal: 40, proteinG: 1.2, carbsG: 6.5, fatG: 0.6, aliases: ['knekkebrød', 'wasa', 'sprøbrød'] },
	{ key: 'brodskive_grov', name: 'Brødskive, grov', unit: 'skive', gramsPerUnit: 35, kcal: 85, proteinG: 3.2, carbsG: 14, fatG: 1.2, aliases: ['brødskive', 'grovbrød', 'skive brød', 'matpakkeskive'] },
	{ key: 'brodskive_fin', name: 'Brødskive, loff', unit: 'skive', gramsPerUnit: 30, kcal: 80, proteinG: 2.4, carbsG: 15, fatG: 0.8, aliases: ['loff', 'loffskive'] },
	{ key: 'rundstykke_grovt', name: 'Rundstykke, grovt', unit: 'stykk', gramsPerUnit: 70, kcal: 175, proteinG: 6.5, carbsG: 29, fatG: 2.5, aliases: ['rundstykke'] },
	{ key: 'lefse_taco', name: 'Tacolefse, hvete', unit: 'stykk', gramsPerUnit: 40, kcal: 130, proteinG: 3.5, carbsG: 21, fatG: 3, aliases: ['tortilla', 'lefse', 'tacolefse'] },

	// ── Pålegg ─────────────────────────────────────────────
	{ key: 'egg', name: 'Egg, kokt eller stekt uten fett', unit: 'stykk', gramsPerUnit: 55, kcal: 78, proteinG: 6.5, carbsG: 0.6, fatG: 5.3, aliases: ['egg', 'kokt egg', 'eggeskive'] },
	{ key: 'brunost', name: 'Brunost', unit: 'skive', gramsPerUnit: 15, kcal: 50, proteinG: 1.4, carbsG: 2, fatG: 4.1, aliases: ['brunost', 'geitost', 'gudbrandsdalsost'] },
	{ key: 'gulost', name: 'Gulost', unit: 'skive', gramsPerUnit: 15, kcal: 55, proteinG: 3.8, carbsG: 0, fatG: 4.2, aliases: ['gulost', 'hvitost', 'norvegia', 'ost'] },
	{ key: 'kaviar', name: 'Kaviar (tubepålegg)', unit: 'porsjon', gramsPerUnit: 15, kcal: 30, proteinG: 1.6, carbsG: 1.4, fatG: 2, aliases: ['kaviar'] },
	{ key: 'makrell_i_tomat', name: 'Makrell i tomat', unit: 'porsjon', gramsPerUnit: 40, kcal: 75, proteinG: 4.4, carbsG: 1.6, fatG: 5.6, aliases: ['makrell i tomat', 'makrell'] },
	{ key: 'leverpostei', name: 'Leverpostei', unit: 'porsjon', gramsPerUnit: 20, kcal: 50, proteinG: 1.9, carbsG: 1, fatG: 4.2, aliases: ['leverpostei'] },
	{ key: 'skinke', name: 'Kokt skinke', unit: 'skive', gramsPerUnit: 12, kcal: 15, proteinG: 2.4, carbsG: 0.2, fatG: 0.5, aliases: ['skinke', 'kokt skinke'] },
	{ key: 'salami', name: 'Salami', unit: 'skive', gramsPerUnit: 8, kcal: 30, proteinG: 1.4, carbsG: 0.1, fatG: 2.6, aliases: ['salami', 'spekeskinke'] },
	{ key: 'peanottsmor', name: 'Peanøttsmør', unit: 'spiseskje', gramsPerUnit: 15, kcal: 95, proteinG: 3.6, carbsG: 2.4, fatG: 8, aliases: ['peanøttsmør', 'peanottsmor'] },
	{ key: 'syltetoy', name: 'Syltetøy', unit: 'teskje', gramsPerUnit: 10, kcal: 25, proteinG: 0, carbsG: 6, fatG: 0, aliases: ['syltetøy', 'jordbærsyltetøy'] },
	{ key: 'smor', name: 'Smør eller margarin på én skive', unit: 'porsjon', gramsPerUnit: 5, kcal: 35, proteinG: 0, carbsG: 0, fatG: 3.9, aliases: ['smør', 'margarin', 'meierismør'] },
	{ key: 'majones', name: 'Majones', unit: 'spiseskje', gramsPerUnit: 14, kcal: 100, proteinG: 0.2, carbsG: 0.3, fatG: 11, aliases: ['majones'] },

	// ── Meieri ─────────────────────────────────────────────
	{ key: 'melk_lett', name: 'Lettmelk', unit: 'dl', kcal: 37, proteinG: 3.5, carbsG: 4.5, fatG: 0.5, aliases: ['lettmelk', 'melk'] },
	{ key: 'melk_hel', name: 'Helmelk', unit: 'dl', kcal: 63, proteinG: 3.4, carbsG: 4.5, fatG: 3.5, aliases: ['helmelk'] },
	{ key: 'skyr', name: 'Skyr, naturell', unit: 'dl', gramsPerUnit: 100, kcal: 63, proteinG: 11, carbsG: 4, fatG: 0.2, aliases: ['skyr'] },
	{ key: 'gresk_yoghurt', name: 'Gresk yoghurt, 2 %', unit: 'dl', gramsPerUnit: 100, kcal: 73, proteinG: 9, carbsG: 3.6, fatG: 2, aliases: ['gresk yoghurt'] },
	{ key: 'yoghurt_naturell', name: 'Yoghurt naturell', unit: 'beger', gramsPerUnit: 150, kcal: 90, proteinG: 7, carbsG: 9, fatG: 2.5, aliases: ['yoghurt'] },
	{ key: 'cottage_cheese', name: 'Cottage cheese', unit: 'dl', gramsPerUnit: 100, kcal: 80, proteinG: 12, carbsG: 3, fatG: 2, aliases: ['cottage cheese', 'kesam'] },
	{ key: 'kremfloete', name: 'Kremfløte', unit: 'dl', kcal: 350, proteinG: 2, carbsG: 3, fatG: 37, aliases: ['kremfløte', 'fløte'] },

	// ── Korn, poteter, pasta, ris ──────────────────────────
	{ key: 'havregryn', name: 'Havregryn, tørre', unit: 'dl', gramsPerUnit: 35, kcal: 130, proteinG: 4.7, carbsG: 20, fatG: 2.6, aliases: ['havregryn', 'havregrøt', 'oatmeal'] },
	{ key: 'potet_kokt', name: 'Kokt potet', unit: 'stykk', gramsPerUnit: 100, kcal: 78, proteinG: 2, carbsG: 17, fatG: 0.1, aliases: ['potet', 'kokte poteter'] },
	{ key: 'ris_kokt', name: 'Kokt ris', unit: 'dl', gramsPerUnit: 80, kcal: 105, proteinG: 2.2, carbsG: 23, fatG: 0.2, aliases: ['ris'] },
	{ key: 'pasta_kokt', name: 'Kokt pasta', unit: 'dl', gramsPerUnit: 60, kcal: 95, proteinG: 3.3, carbsG: 19, fatG: 0.5, aliases: ['pasta', 'spaghetti'] },

	// ── Kjøtt og fisk ──────────────────────────────────────
	{ key: 'kyllingfilet', name: 'Kyllingfilet, rå vekt', unit: '100 g', gramsPerUnit: 100, kcal: 110, proteinG: 23, carbsG: 0, fatG: 1.8, aliases: ['kylling', 'kyllingfilet'] },
	{ key: 'kjottdeig_14', name: 'Kjøttdeig 14 %, rå vekt', unit: '100 g', gramsPerUnit: 100, kcal: 200, proteinG: 18, carbsG: 0, fatG: 14, aliases: ['kjøttdeig', 'karbonadedeig'] },
	{ key: 'laks', name: 'Laks, rå vekt', unit: '100 g', gramsPerUnit: 100, kcal: 208, proteinG: 20, carbsG: 0, fatG: 13, aliases: ['laks'] },
	{ key: 'torsk', name: 'Torsk, rå vekt', unit: '100 g', gramsPerUnit: 100, kcal: 82, proteinG: 18, carbsG: 0, fatG: 0.7, aliases: ['torsk', 'hvit fisk'] },
	{ key: 'grillpolse', name: 'Grillpølse', unit: 'stykk', gramsPerUnit: 80, kcal: 180, proteinG: 8, carbsG: 3, fatG: 15, aliases: ['pølse', 'grillpølse', 'wienerpølse'] },
	{ key: 'kjottkaker', name: 'Kjøttkaker', unit: 'stykk', gramsPerUnit: 60, kcal: 130, proteinG: 7, carbsG: 4, fatG: 9, aliases: ['kjøttkake', 'kjøttkaker'] },

	// ── Frukt og grønt ─────────────────────────────────────
	{ key: 'banan', name: 'Banan', unit: 'stykk', gramsPerUnit: 120, kcal: 105, proteinG: 1.3, carbsG: 24, fatG: 0.4, aliases: ['banan'] },
	{ key: 'eple', name: 'Eple', unit: 'stykk', gramsPerUnit: 150, kcal: 78, proteinG: 0.4, carbsG: 18, fatG: 0.3, aliases: ['eple'] },
	{ key: 'appelsin', name: 'Appelsin', unit: 'stykk', gramsPerUnit: 150, kcal: 62, proteinG: 1.2, carbsG: 14, fatG: 0.2, aliases: ['appelsin', 'klementin'] },
	{ key: 'avokado', name: 'Avokado, halv', unit: 'porsjon', gramsPerUnit: 70, kcal: 115, proteinG: 1.4, carbsG: 1.2, fatG: 11, aliases: ['avokado'] },
	{ key: 'tomat', name: 'Tomat', unit: 'stykk', gramsPerUnit: 85, kcal: 18, proteinG: 0.8, carbsG: 3, fatG: 0.2, aliases: ['tomat'] },
	{ key: 'agurk', name: 'Agurkskiver', unit: 'porsjon', gramsPerUnit: 40, kcal: 6, proteinG: 0.3, carbsG: 1, fatG: 0, aliases: ['agurk'] },
	{ key: 'gulrot', name: 'Gulrot', unit: 'stykk', gramsPerUnit: 70, kcal: 30, proteinG: 0.6, carbsG: 5.5, fatG: 0.1, aliases: ['gulrot'] },
	{ key: 'brokkoli', name: 'Brokkoli, kokt', unit: '100 g', gramsPerUnit: 100, kcal: 34, proteinG: 2.8, carbsG: 3, fatG: 0.4, aliases: ['brokkoli'] },
	{ key: 'salatblanding', name: 'Bladsalat', unit: 'porsjon', gramsPerUnit: 60, kcal: 12, proteinG: 0.9, carbsG: 1, fatG: 0.2, aliases: ['salat', 'bladsalat'] },

	// ── Snacks og søtt ─────────────────────────────────────
	{ key: 'kvikk_lunsj', name: 'Kvikk Lunsj', unit: 'stykk', gramsPerUnit: 47, kcal: 240, proteinG: 2.9, carbsG: 28, fatG: 13, aliases: ['kvikk lunsj', 'sjokolade turbit'] },
	{ key: 'melkesjokolade', name: 'Melkesjokolade', unit: '100 g', gramsPerUnit: 100, kcal: 535, proteinG: 7, carbsG: 57, fatG: 30, aliases: ['sjokolade', 'melkesjokolade', 'firkløver'] },
	{ key: 'potetgull', name: 'Potetgull', unit: 'dl', gramsPerUnit: 15, kcal: 80, proteinG: 1, carbsG: 8, fatG: 5, aliases: ['potetgull', 'chips'] },
	{ key: 'notter', name: 'Nøtter, blandede', unit: 'håndfull', gramsPerUnit: 25, kcal: 155, proteinG: 5, carbsG: 4, fatG: 14, aliases: ['nøtter', 'mandler', 'cashew'] },
	{ key: 'bolle', name: 'Skolebolle eller hvetebolle', unit: 'stykk', gramsPerUnit: 90, kcal: 280, proteinG: 6, carbsG: 42, fatG: 9, aliases: ['bolle', 'skolebolle', 'kanelbolle'] },
	{ key: 'vaffel', name: 'Vaffelhjerte', unit: 'stykk', gramsPerUnit: 35, kcal: 90, proteinG: 2.3, carbsG: 12, fatG: 3.5, aliases: ['vaffel', 'vaffelhjerte'] },
	{ key: 'is_pinne', name: 'Ispinne', unit: 'stykk', kcal: 200, proteinG: 2.5, carbsG: 22, fatG: 11, aliases: ['is', 'ispinne', 'iskrem'] },

	// ── Ferdigmat ──────────────────────────────────────────
	{ key: 'frossenpizza_kvart', name: 'Frossenpizza, kvart plate', unit: 'porsjon', gramsPerUnit: 145, kcal: 300, proteinG: 12, carbsG: 36, fatG: 11, aliases: ['grandiosa', 'frossenpizza', 'pizza'] },
	{ key: 'hamburger_gatekjokken', name: 'Hamburger, gatekjøkken', unit: 'stykk', kcal: 500, proteinG: 25, carbsG: 40, fatG: 26, aliases: ['hamburger', 'burger'] },
	{ key: 'pommes_frites', name: 'Pommes frites', unit: 'porsjon', gramsPerUnit: 150, kcal: 340, proteinG: 4, carbsG: 44, fatG: 16, aliases: ['pommes frites', 'fries'] },
	{ key: 'sushi_maki', name: 'Sushi, maki', unit: 'stykk', gramsPerUnit: 25, kcal: 40, proteinG: 1.5, carbsG: 7, fatG: 0.5, aliases: ['sushi', 'maki'] },

	// ── Drikke ─────────────────────────────────────────────
	{ key: 'kaffe_svart', name: 'Kaffe, svart', unit: 'kopp', kcal: 2, proteinG: 0.2, carbsG: 0, fatG: 0, aliases: ['kaffe', 'svart kaffe', 'americano'] },
	{ key: 'kaffe_latte', name: 'Kaffe latte', unit: 'kopp', kcal: 110, proteinG: 6, carbsG: 10, fatG: 4, aliases: ['latte', 'cappuccino', 'kaffe med melk'] },
	{ key: 'juice_appelsin', name: 'Appelsinjuice', unit: 'dl', kcal: 45, proteinG: 0.7, carbsG: 10, fatG: 0.1, aliases: ['juice', 'appelsinjuice'] },
	{ key: 'brus_sukker', name: 'Brus med sukker', unit: 'dl', kcal: 42, proteinG: 0, carbsG: 10.6, fatG: 0, aliases: ['brus', 'cola'] },
	{ key: 'brus_lett', name: 'Brus, sukkerfri', unit: 'dl', kcal: 1, proteinG: 0, carbsG: 0, fatG: 0, aliases: ['cola zero', 'sukkerfri brus', 'pepsi max'] },
	{ key: 'ol_pils', name: 'Pils', unit: 'dl', kcal: 42, proteinG: 0.4, carbsG: 3, fatG: 0, aliases: ['øl', 'pils'] },
	{ key: 'vin_rod', name: 'Rødvin', unit: 'glass', gramsPerUnit: 150, kcal: 120, proteinG: 0.1, carbsG: 3.8, fatG: 0, aliases: ['vin', 'rødvin', 'hvitvin'] },
	{ key: 'proteinpulver', name: 'Proteinpulver', unit: 'skje', gramsPerUnit: 30, kcal: 115, proteinG: 24, carbsG: 2, fatG: 1.5, aliases: ['proteinpulver', 'whey', 'proteinshake'] }
];

const BY_KEY = new Map(REFERENCE_FOODS.map((food) => [food.key, food]));

export function referenceFoodByKey(key: string): ReferenceFood | null {
	return BY_KEY.get(key) ?? null;
}

/** Alle søkbare navn for en vare, i små bokstaver. */
function searchTerms(food: ReferenceFood): string[] {
	return [food.name.toLowerCase(), ...(food.aliases ?? [])];
}

/**
 * Korte navn må matche som helt ord.
 *
 * Samme vakt som i `theme-hues.ts`, og av samme grunn: aliaset «is» traff
 * «rakfisk» som delstreng, og «vin» ville truffet «vindruer». Grensen er satt
 * over «is»/«vin» og under «egg», som er trygt nok som delstreng («eggeskive»).
 */
const WHOLE_WORD_MAX_LENGTH = 3;

/**
 * Slår opp en vare på fritekst.
 *
 * Brukes ikke til å erstatte modellen — den håndterer sammensatte måltid og
 * mengder. Dette er for å verifisere at tabellen faktisk er søkbar, og for
 * `referenceKey`-oppslag når modellen svarer med et navn i stedet for en nøkkel.
 *
 * Lengste treff vinner: «gresk yoghurt» skal ikke matche «yoghurt» først.
 */
export function findReferenceFood(query: string): ReferenceFood | null {
	const q = query.trim().toLowerCase();
	if (!q) return null;
	const words = q.split(/[\s,.-]+/).filter(Boolean);

	let best: { food: ReferenceFood; length: number } | null = null;
	for (const food of REFERENCE_FOODS) {
		for (const term of searchTerms(food)) {
			if (term === q) return food;
			const hit =
				term.length <= WHOLE_WORD_MAX_LENGTH ? words.includes(term) : q.includes(term);
			if (hit && (!best || term.length > best.length)) {
				best = { food, length: term.length };
			}
		}
	}
	return best?.food ?? null;
}

/**
 * Tabellen som kompakte linjer til systemprompten.
 *
 * Formatet er bevisst tett — én linje per vare, ingen JSON — fordi det er
 * lettere for modellen å lese av og billigere i tokens enn strukturert data.
 */
export function referenceTableForPrompt(): string {
	return REFERENCE_FOODS.map(
		(f) =>
			`${f.key} | ${f.name} | per ${f.unit}${f.gramsPerUnit ? ` (~${f.gramsPerUnit} g)` : ''} | ${f.kcal} kcal, ${f.proteinG} g protein, ${f.carbsG} g karbo, ${f.fatG} g fett`
	).join('\n');
}
