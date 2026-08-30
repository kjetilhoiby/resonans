import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { classificationOverrides } from '$lib/db/schema';
import {
	buildTaskFingerprint,
	buildTransactionFingerprint,
	upsertClassificationOverride,
	type ClassificationDomain
} from '$lib/server/classification-overrides';
import { syncAllCategorizedEvents } from '$lib/server/integrations/categorized-events';
import { runInBackground } from '$lib/server/run-in-background';
import { and, desc, eq } from 'drizzle-orm';
import { CATEGORIES, normalizeCategoryId } from '$lib/integrations/transaction-categories-client';
import type { RequestHandler } from './$types';

type OverrideRequest = {
	domain?: ClassificationDomain;
	correctedCategory?: string;
	correctedSubcategory?: string | null;
	source?: string;
	fingerprint?: string;
	description?: string | null;
	typeText?: string | null;
	amount?: number;
	activityType?: string;
	metrics?: Array<{ unit?: string }>;
};

function isDomain(value: unknown): value is ClassificationDomain {
	return value === 'transaction' || value === 'task';
}

function resolveFingerprint(body: OverrideRequest): string | null {
	if (body.fingerprint && body.fingerprint.trim()) {
		return body.fingerprint.trim();
	}

	if (body.domain === 'transaction') {
		if (typeof body.amount !== 'number') return null;
		return buildTransactionFingerprint(body.description ?? null, body.typeText ?? null, body.amount);
	}

	if (body.domain === 'task') {
		if (!body.activityType || !Array.isArray(body.metrics)) return null;
		return buildTaskFingerprint(body.activityType, body.metrics);
	}

	return null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	let body: OverrideRequest;

	try {
		body = (await request.json()) as OverrideRequest;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!isDomain(body.domain)) {
		return json({ error: 'domain must be transaction or task' }, { status: 400 });
	}

	const rawCategory = body.correctedCategory?.trim();
	if (!rawCategory) {
		return json({ error: 'correctedCategory is required' }, { status: 400 });
	}

	// **Valideres for transaksjoner.** En manuell overstyring har HØYESTE prioritet i
	// `categorizeTransaction` — høyere enn merchant-mappings og reglene — så en ugyldig verdi
	// her er verre enn den samme feilen noe annet sted. Det var nettopp uvalidert skriving
	// som gjorde at «OpenAI» sto som en kategori på 15 153 kr i prod. Se
	// `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`.
	//
	// Aliaser godtas og normaliseres; et ukjent navn avvises med en melding som SIER hva som
	// er gyldig, framfor å bli lagret og dukke opp som en oppdiktet kategori på flaten.
	let correctedCategory = rawCategory;
	if (body.domain === 'transaction') {
		const normalized = normalizeCategoryId(rawCategory);
		const isKnown = rawCategory.toLowerCase() in CATEGORIES || normalized !== 'ukategorisert';
		if (!isKnown && rawCategory.toLowerCase() !== 'ukategorisert') {
			return json(
				{
					error: `Ukjent kategori «${rawCategory}». Gyldige: ${Object.keys(CATEGORIES).join(', ')}`
				},
				{ status: 400 }
			);
		}
		correctedCategory = normalized;
	}

	const fingerprint = resolveFingerprint(body);
	if (!fingerprint) {
		return json({ error: 'Could not derive fingerprint from payload' }, { status: 400 });
	}

	const saved = await upsertClassificationOverride({
		userId,
		domain: body.domain,
		fingerprint,
		correctedCategory,
		correctedSubcategory: body.correctedSubcategory ?? null,
		source: body.source ?? 'manual_ui'
	});

	// Resync categorized_events if this is a transaction override
	// This ensures tema pages and other views see the updated category immediately
	if (body.domain === 'transaction') {
		runInBackground(syncAllCategorizedEvents(userId));
	}

	return json({
		id: saved.id,
		domain: saved.domain,
		fingerprint: saved.fingerprint,
		correctedCategory: saved.correctedCategory,
		correctedSubcategory: saved.correctedSubcategory,
		weight: saved.weight,
		source: saved.source,
		updatedAt: saved.updatedAt
	});
};

export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	const domainParam = url.searchParams.get('domain');

	if (domainParam && !isDomain(domainParam)) {
		return json({ error: 'domain must be transaction or task' }, { status: 400 });
	}

	const rows = await db.query.classificationOverrides.findMany({
		where: domainParam
			? and(
				eq(classificationOverrides.userId, userId),
				eq(classificationOverrides.domain, domainParam)
			)
			: eq(classificationOverrides.userId, userId),
		orderBy: [desc(classificationOverrides.updatedAt)],
		limit: 200
	});

	return json({ overrides: rows });
};
