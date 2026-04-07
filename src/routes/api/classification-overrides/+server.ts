import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { classificationOverrides } from '$lib/db/schema';
import {
	buildTaskFingerprint,
	buildTransactionFingerprint,
	upsertClassificationOverride,
	type ClassificationDomain
} from '$lib/server/classification-overrides';
import { and, desc, eq } from 'drizzle-orm';
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

	const correctedCategory = body.correctedCategory?.trim();
	if (!correctedCategory) {
		return json({ error: 'correctedCategory is required' }, { status: 400 });
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
