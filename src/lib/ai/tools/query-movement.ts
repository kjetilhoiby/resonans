/**
 * Leseverktøy over Akser-tidslinjen: opphold, reiser og transportform.
 *
 * Svarer på «når kom jeg på jobb», «hvordan kom jeg dit», «når var jeg sist på
 * hytta» og «hva gjorde jeg i går». Reglene i `$lib/domain/movement/movement-summary.ts`.
 *
 * Svaret bærer ALDRI koordinater — bare stedsnavn, kategorier, klokkeslett og
 * kilometer. Et sted uten navn heter «et sted uten navn».
 */

import { z } from 'zod';
import { osloDayKey } from '$lib/domain/oslo-time';
import {
	matchPlaces,
	summarizeArrivals,
	summarizeDay,
	summarizeLastVisit,
	summarizePlaces
} from '$lib/domain/movement/movement-summary';
import { readMovement } from '$lib/server/movement/movement-read';

export type MovementQueryType = 'day' | 'arrivals' | 'last_visit' | 'places';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: string, days: number): string {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

function clamp(value: number | undefined, fallback: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(Math.max(Math.round(value), 1), max);
}

export const queryMovementTool = {
	name: 'query_movement',
	description: `Les brukerens bevegelser fra Akser-appen: opphold på steder, reiser mellom dem og transportform per etappe (gange, løping, sykkel, elsykkel, bil, kollektivt). Bygget fra GPS på telefonen.

Bruk denne når brukeren spør NÅR de var et sted, HVORDAN de kom seg dit, eller HVA de gjorde i løpet av en dag: «når kom jeg på jobb i dag/i går», «syklet jeg til jobben denne uka», «når var jeg sist på hytta», «hvor var jeg på lørdag», «hvor lenge var jeg på kontoret». Ikke for trening (løpeturer og økter → query_training): en Akser-reise er forflytning, ikke en økt.

queryType:
- 'day': hele dagen i rekkefølge — opphold med sted, reiser med transportform og km. date = YYYY-MM-DD (default i går).
- 'arrivals': når brukeren kom til et sted hver dag, med hva og når hen dro. place = stedets navn eller «jobb»/«hjem». days = vindu (default 14, maks 90).
- 'last_visit': siste dag på et sted, og hvor mange dager i vinduet. place påkrevd. days default 365.
- 'places': stedene brukeren har navngitt, mest besøkt først.

Om tallene:
- Akser sender bare FERDIGE dager. I dag finnes ikke før i morgen — si det framfor å si at brukeren ikke har vært noe sted.
- Et opphold fra 00:00 er natta som fortsetter, ikke en ankomst.
- source 'rettet' betyr at brukeren selv har satt transportformen; uten source er den gjettet av appen fra GPS-fart.
- Treffer ikke place noe sted, svarer verktøyet med stedene som finnes. Spør brukeren eller velg et av dem — ikke gjett.
- connected false betyr at Akser ikke er koblet til. Da finnes ingen bevegelsesdata, og det skal sies.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z
			.enum(['day', 'arrivals', 'last_visit', 'places'])
			.describe('Hvilket utsnitt.'),
		date: z.string().optional().describe("YYYY-MM-DD for 'day'. Default i går."),
		place: z.string().optional().describe("Stedets navn, eller «jobb»/«hjem», for 'arrivals' og 'last_visit'."),
		days: z.number().optional().describe('Vindu bakover fra i går, i dager.')
	}),

	execute: async (args: { userId: string; queryType: MovementQueryType; date?: string; place?: string; days?: number }) => {
		const today = osloDayKey(new Date());
		const yesterday = addDays(today, -1);

		if (args.queryType === 'day') {
			const date = args.date && DATE_RE.test(args.date) ? args.date : yesterday;
			if (date >= today) {
				return { date, message: 'Akser sender bare ferdige dager. Dagens tidslinje kommer i morgen.' };
			}
			const read = await readMovement(args.userId, date, date);
			if (!read.connected) return notConnected();
			const day = summarizeDay(date, read.data);
			if (day.entries.length === 0) {
				return { ...day, message: `Ingen tidslinje fra Akser for ${date}.`, dataFrom: read.firstDate };
			}
			return day;
		}

		const window = args.queryType === 'arrivals' ? clamp(args.days, 14, 90) : clamp(args.days, 365, 400);
		const from = addDays(yesterday, -(window - 1));
		const read = await readMovement(args.userId, from, yesterday);
		if (!read.connected) return notConnected();

		if (args.queryType === 'places') {
			return { from, to: yesterday, ...summarizePlaces(read.data), dataFrom: read.firstDate };
		}

		if (!args.place) return { error: 'place er påkrevd for denne queryType.' };
		const match = matchPlaces(args.place, read.data.places);
		if (match.kind === 'none' || match.places.length === 0) {
			return {
				found: false,
				message: `Fant ikke noe sted som heter «${args.place}» blant stedene i Akser.`,
				places: summarizePlaces(read.data).places.map((p) => p.name)
			};
		}
		const ids = new Set(match.places.map((p) => p.id));
		const label = match.places.filter((p) => p.named).map((p) => p.name).join(' / ') || args.place;

		if (args.queryType === 'arrivals') {
			return { from, to: yesterday, ...summarizeArrivals(ids, label, read.data), dataFrom: read.firstDate };
		}
		return { from, to: yesterday, ...summarizeLastVisit(ids, label, read.data, today), dataFrom: read.firstDate };
	}
};

function notConnected() {
	return {
		connected: false,
		message: 'Akser er ikke koblet til Resonans, så det finnes ingen bevegelsesdata. Koblingen gjøres i Akser-appen under Innstillinger.'
	};
}
