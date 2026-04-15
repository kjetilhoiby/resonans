import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { domainSignals, signalContracts, themeSignalLinks, themes } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

type DomainSignalContractView = {
	signalType: string;
	ownerDomain: string;
	allowedConsumerDomains: string[];
	description: string | null;
	enabled: boolean;
	config: Record<string, unknown>;
	latest: {
		valueNumber: number | null;
		valueText: string | null;
		valueBool: boolean | null;
		severity: string;
		confidence: string;
		observedAt: string;
		context: Record<string, unknown>;
	} | null;
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Tema ikke funnet.' }, { status: 404 });

	const [contracts, links] = await Promise.all([
		db.query.signalContracts.findMany({
			where: eq(signalContracts.status, 'active'),
			orderBy: (t, { asc }) => [asc(t.ownerDomain), asc(t.signalType)]
		}),
		db.query.themeSignalLinks.findMany({
			where: and(eq(themeSignalLinks.themeId, params.id), eq(themeSignalLinks.userId, locals.userId))
		})
	]);

	const latestByType = new Map<string, {
		valueNumber: number | null;
		valueText: string | null;
		valueBool: boolean | null;
		severity: string;
		confidence: string;
		observedAt: string;
		context: Record<string, unknown>;
	}>();

	for (const contract of contracts) {
		const latest = await db.query.domainSignals.findFirst({
			where: and(eq(domainSignals.userId, locals.userId), eq(domainSignals.signalType, contract.signalType)),
			orderBy: [desc(domainSignals.observedAt)]
		});
		if (!latest) continue;
		latestByType.set(contract.signalType, {
			valueNumber: latest.valueNumber !== null ? Number(latest.valueNumber) : null,
			valueText: latest.valueText,
			valueBool: latest.valueBool,
			severity: latest.severity,
			confidence: String(latest.confidence),
			observedAt: latest.observedAt.toISOString(),
			context: (latest.context ?? {}) as Record<string, unknown>
		});
	}

	const linksByType = new Map(links.map((link) => [link.signalType, link]));
	const items: DomainSignalContractView[] = contracts.map((contract) => {
		const linked = linksByType.get(contract.signalType);
		return {
			signalType: contract.signalType,
			ownerDomain: contract.ownerDomain,
			allowedConsumerDomains: contract.allowedConsumerDomains ?? [],
			description: contract.description,
			enabled: linked?.enabled ?? false,
			config: (linked?.config ?? {}) as Record<string, unknown>,
			latest: latestByType.get(contract.signalType) ?? null
		};
	});

	return json({ contracts: items });
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Tema ikke funnet.' }, { status: 404 });

	const body = await request.json().catch(() => null) as {
		signalType?: string;
		enabled?: boolean;
		config?: Record<string, unknown>;
	} | null;

	if (!body?.signalType) return json({ error: 'signalType er påkrevd.' }, { status: 400 });
	if (typeof body.enabled !== 'boolean') return json({ error: 'enabled må være boolean.' }, { status: 400 });

	const contract = await db.query.signalContracts.findFirst({
		where: and(eq(signalContracts.signalType, body.signalType), eq(signalContracts.status, 'active')),
		columns: { signalType: true }
	});
	if (!contract) return json({ error: 'Ugyldig signalType.' }, { status: 400 });

	const existing = await db.query.themeSignalLinks.findFirst({
		where: and(
			eq(themeSignalLinks.themeId, params.id),
			eq(themeSignalLinks.userId, locals.userId),
			eq(themeSignalLinks.signalType, body.signalType)
		)
	});

	if (existing) {
		await db
			.update(themeSignalLinks)
			.set({
				enabled: body.enabled,
				config: body.config ?? existing.config ?? {},
				updatedAt: new Date()
			})
			.where(eq(themeSignalLinks.id, existing.id));
	} else {
		await db.insert(themeSignalLinks).values({
			themeId: params.id,
			userId: locals.userId,
			signalType: body.signalType,
			enabled: body.enabled,
			config: body.config ?? {}
		});
	}

	return json({ success: true });
};
