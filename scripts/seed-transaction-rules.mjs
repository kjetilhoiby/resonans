// Seed default transaction matching rules
// These replace the hardcoded RULES array from transaction-categories.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { transactionMatchingRules } from './src/lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const rules = [
	// Priority 1: Inntekter
	{
		category: 'lønn',
		keywords: ['lønn', 'lonn', 'salary', 'arbeidsgiver', 'folktrygd', 'nav '],
		fixed: null,
		description: 'Lønn og inntekt',
		displayOrder: 1
	},

	// Priority 2: Lån og avdrag (must come before bolig/transport)
	{
		category: 'lån',
		keywords: [
			'terminkrav', 'avdrag laan', 'avdrag lån', 'lånerenter', 'lånekasse',
			'statens lånekasse', 'husbanken', 'bufetat lån', 'refinansier',
			'huslån', 'billån', 'boliglån', 'forbrukslån', 'rammelån',
			'annuitetslån', 'serielån'
		],
		fixed: true,
		description: 'Lån og avdrag',
		displayOrder: 2
	},

	// Priority 3: Sparing og investering
	{
		category: 'sparing',
		keywords: ['sparekonto', 'spareavtale', 'aksjesparekonto', 'ask ', 'fond', 'nordnet', 'kron.no', 'kron '],
		fixed: true,
		description: 'Sparing og investering',
		displayOrder: 3
	},

	// Priority 4: Bolig
	{
		category: 'bolig',
		keywords: [
			'husleie', 'leie av', 'borettslag', 'sameie', 'obos', 'usbl ',
			'felleskostnader', 'felleskostn', 'strøm', 'fjernvarme', 'nettleie',
			'eiendomsskatt', 'kommunale', 'renovasjon', 'vann og avløp',
			'lys og varme', 'hafslund', 'lyse nett', 'agder energi', 'tibber', 'fortum'
		],
		fixed: true,
		description: 'Bolig - husleie, strøm, felleskostnader',
		displayOrder: 4
	},

	// Priority 5: Forsikring
	{
		category: 'forsikring',
		keywords: ['forsikring', 'gjensidige', 'tryg ', 'if forsikring', 'storebrand forsikring', 'fremtind', 'codan', 'frende', 'sb1 forsikring', 'sparebank 1 forsikring'],
		fixed: true,
		description: 'Forsikring',
		displayOrder: 5
	},

	// Priority 6: Abonnementer (faste)
	{
		category: 'abonnement',
		keywords: ['netflix', 'spotify', 'viaplay', 'tv 2 play', 'tv2 play', 'discovery+', 'hbo', 'max ', 'disney+', 'nrk', 'apple.com', 'itunes', 'google play', 'youtube premium', 'microsoft 365', 'adobe', 'telia ', 'telenor', 'ice.net', 'chili mobil', 'onlyfans', 'dropbox', 'github'],
		fixed: true,
		description: 'Abonnementer (streaming, mobiltelefon, software)',
		displayOrder: 6
	},

	// Priority 7: Barn og familie (faste utgifter)
	{
		category: 'barn',
		keywords: [
			'barnehage', 'bhg ', ' bhg', 'barnehageplass',
			'aktivitetsskole', ' aks ', 'aks-', '-aks', 'aks etter',
			' sfo ', 'skolefritidsordning',
			'svømmekurs', 'svømmeopplæring', 'svømmeskole', 'svømmeklubben',
			'korpsavgift', 'fotballavgift', 'håndballavgift', 'treningsavgift',
			'idrettslag', 'musikkorps', 'kulturskole',
			'skolepenger', 'lekesett', 'leker', 'toys',
			'klær barn', 'barneklær', 'jollyroom', 'babyworld', 'mothercare', 'babysam'
		],
		fixed: true,
		description: 'Barn og familie - barnehage, AKS, aktiviteter',
		displayOrder: 7
	},

	// Priority 8: Dagligvare
	{
		category: 'dagligvare',
		keywords: [
			'rema 1000', 'rema1000', 'kiwi ', 'coop ', 'meny ', 'spar ', 'bunnpris',
			'extra ', 'joker ', 'obs ', 'aldi ', 'lidl ', 'nærbutikk', 'kolonial',
			'marked ', 'dagligvare', 'matbutikk', 'matvarer', 'grocery',
			'willys', 'ica ', 'hakon gruppen',
			'oda ', 'oda.com', 'oda as',
			'adams matkasse', 'adamsmatkasse',
			'godtlevert',
			'hverdagsmat',
			'matmesteren'
		],
		fixed: null,
		description: 'Dagligvare - matbutikker',
		displayOrder: 8
	},

	// Priority 9: Mat ute og take-away
	{
		category: 'mat',
		keywords: ['mcdonalds', 'mcdonald', 'burger king', 'kfc ', 'pizza', 'sushi', 'thai ', 'indian ', 'restaurant', 'café', 'cafe ', 'kafe ', 'kafé', 'bar ', ' pub ', 'foodora', 'wolt', 'just eat', 'dominos', 'subway ', 'starbucks', 'waynes coffee', 'espresso house', 'deli', 'bakeri', 'kantine', 'kebab', 'pølse'],
		fixed: null,
		description: 'Mat ute - restaurant, kafe, take-away',
		displayOrder: 9
	},

	// Priority 10: Transport (kollektiv, fly)
	{
		category: 'transport',
		keywords: ['ruter ', 'vy ', 'nsb ', 'flytoget', 'norwegian.no', 'norwegian air', 'sas ', 'widerøe', 'flyr ', 'tripcom', 'booking.com', 'parkering', 'apcoa', 'europark', 'bompenger', 'autopass', 'passeringsgebyr', 'ferjeleie', 'atb ', 'kolumbus', 'skyss ', 'uber ', 'bolt ', 'taxi', 'cabonline', 'norgesbuss', 'valdresekspressen'],
		fixed: null,
		description: 'Transport - kollektiv, fly, taxi',
		displayOrder: 10
	},

	// Priority 11: Bil (drivstoff, verksted)
	{
		category: 'transport',
		keywords: ['bensinstasjon', 'circle k', 'uno-x', 'esso ', 'shell ', 'st1 ', 'neste ', 'drivstoff', 'elbil', 'lading', 'recharge ', 'mer charging', 'tesla ', 'bilverksted', 'dekk', 'bilservice', 'biltema', 'bil service', 'verksted', 'elbilforeningen', 'naf ', 'vianett', 'autopass'],
		fixed: false,
		description: 'Transport - bil, drivstoff, verksted',
		displayOrder: 11
	},

	// Priority 12: Helse
	{
		category: 'helse',
		keywords: ['apotek', 'vitusapotek', 'boots apotek', 'apotek1', 'lege ', 'fastlege', 'tannlege', 'sykehus', 'legevakt', 'helsestasjon', 'fysioterapi', 'kiropraktor', 'psykolog', 'psykiater', 'optiker', 'brilleland', 'synsam', 'specsavers'],
		fixed: null,
		description: 'Helse - lege, apotek, fysioterapi',
		displayOrder: 12
	},

	// Priority 13: Trening / underholdning
	{
		category: 'underholdning',
		keywords: ['sats ', 'elixia', 'evo fitness', 'treningssenter', 'gym ', 'svømmehall', 'kino ', 'oslo kino', 'nordisk film kino', 'billetservice', 'ticketmaster', 'konsert', 'teater', 'museum', 'steam ', 'playstation', 'xbox', 'nintendo', 'gaming', 'sport 1', 'g-sport', 'intersport'],
		fixed: null,
		description: 'Underholdning - trening, kino, konserter, gaming',
		displayOrder: 13
	},

	// Priority 14: Shopping / klær
	{
		category: 'shopping',
		keywords: ['h&m ', 'hm.com', 'zara ', 'cubus ', 'dressman', 'lindex ', 'mango ', 'weekday', 'zalando', 'boozt', 'nelly.com', 'nike ', 'adidas ', 'stadium ', 'xxl ', 'jula ', 'elkjøp', 'apple store', 'power ', 'komplett.no', 'amazon', 'ebay ', 'wish ', 'temu ', 'ikea', 'jysk', 'biltema', 'byggmakker', 'obs bygg', 'maxbo'],
		fixed: null,
		description: 'Shopping - klær, elektronikk, møbler',
		displayOrder: 14
	},

	// Priority 15: Overføringer
	{
		category: 'overføring',
		keywords: ['vipps', 'overføring', 'betaling til', 'betaling fra', 'ovf.', 'til konto', 'fra konto', 'portefølje', 'internoverføring'],
		fixed: null,
		description: 'Overføringer - Vipps, kontooverføringer',
		displayOrder: 15
	}
];

async function seed() {
	console.log('🌱 Seeding transaction matching rules...');

	const sql = postgres(process.env.DATABASE_URL);
	const db = drizzle(sql);

	try {
		for (const rule of rules) {
			const existing = await db
				.select()
				.from(transactionMatchingRules)
				.where(eq(transactionMatchingRules.category, rule.category))
				.where(eq(transactionMatchingRules.description, rule.description))
				.limit(1);

			if (existing.length === 0) {
				await db.insert(transactionMatchingRules).values(rule);
				console.log(`✅ Inserted rule: ${rule.category} - ${rule.description}`);
			} else {
				console.log(`⏭️  Skipped (already exists): ${rule.category} - ${rule.description}`);
			}
		}

		console.log('✅ Seeding complete!');
		await sql.end();
		process.exit(0);
	} catch (err) {
		console.error('❌ Seeding failed:', err);
		await sql.end();
		process.exit(1);
	}
}

seed();
