import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

const ALLOWED_KEYS = [
	'distance',
	'sleep',
	'sleepLag',
	'steps',
	'activeMinutes',
	'weight',
	'maxHr'
] as const;
const ALLOWED_FIELDS = ['goal', 'thresholdWarn', 'thresholdSuccess'] as const;

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { metricSettings: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });
	return json(theme.metricSettings ?? {});
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	// Bygg de nøklene arket eier, fra kroppen.
	const managed: Record<string, Record<string, number>> = {};
	for (const key of ALLOWED_KEYS) {
		if (key in body && body[key] && typeof body[key] === 'object') {
			const entry: Record<string, number> = {};
			for (const field of ALLOWED_FIELDS) {
				const val = body[key][field];
				if (val != null && typeof val === 'number') entry[field] = val;
			}
			if (Object.keys(entry).length > 0) managed[key] = entry;
		}
	}

	// Behold nøkler arket IKKE eier.
	//
	// Denne funksjonen bygget tidligere hele objektet fra whitelisten og skrev det
	// over. Da ernæringsloggeren begynte å lagre dagsmål i
	// `metricSettings.nutrition`, betydde det at målene ble slettet i det øyeblikket
	// noen lagret terskler i dette arket — en stille sletting av data brukeren
	// hadde satt et helt annet sted.
	const existing = await db.query.themes.findFirst({
		columns: { metricSettings: true },
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	const preserved: Record<string, unknown> = {};
	for (const [key, value] of Object.entries((existing.metricSettings ?? {}) as Record<string, unknown>)) {
		if (!(ALLOWED_KEYS as readonly string[]).includes(key)) preserved[key] = value;
	}

	await db
		.update(themes)
		.set({ metricSettings: { ...preserved, ...managed }, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({ success: true });
};
