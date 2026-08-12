/**
 * Lasting av per-bruker merchant-mappings (LLM-klassifiserte butikker).
 *
 * Bor for seg selv fordi den har **to** slags konsumenter: den delte transaksjonsleseren
 * som kategoriserer, og `spending-analyzer.ts` som *produserer* mappingene. Lå den hos
 * produsenten, ville leseren og analysatoren importert hverandre — og en sirkulær import
 * mellom to moduler som begge kalles fra en synk er den typen feil som viser seg i prod
 * som `undefined is not a function`, ikke i typesjekken.
 */

import { db } from '$lib/db';
import { merchantMappings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export type MerchantMapping = {
	category: string;
	subcategory: string | null;
	label: string;
	emoji: string | null;
	isFixed: boolean;
};

export type MerchantMappingCache = Map<string, MerchantMapping>;

const MERCHANT_MAPPINGS_CACHE_TTL_MS = 60 * 1000;

const merchantMappingsCache = new Map<
	string,
	{ cachedAt: number; data: MerchantMappingCache }
>();

/** Tømmer cachen for én bruker. Kalles etter at mappings er skrevet. */
export function invalidateMerchantMappings(userId: string): void {
	merchantMappingsCache.delete(userId);
}

export async function loadMerchantMappings(userId: string): Promise<MerchantMappingCache> {
	const cached = merchantMappingsCache.get(userId);
	if (cached && Date.now() - cached.cachedAt < MERCHANT_MAPPINGS_CACHE_TTL_MS) {
		return new Map(cached.data);
	}

	const rows = await db
		.select({
			merchantKey: merchantMappings.merchantKey,
			category: merchantMappings.category,
			subcategory: merchantMappings.subcategory,
			label: merchantMappings.label,
			emoji: merchantMappings.emoji,
			isFixed: merchantMappings.isFixed
		})
		.from(merchantMappings)
		.where(eq(merchantMappings.userId, userId));

	const mapped: MerchantMappingCache = new Map(
		rows.map((r) => [
			r.merchantKey,
			{
				category: r.category,
				subcategory: r.subcategory,
				label: r.label,
				emoji: r.emoji,
				isFixed: r.isFixed
			}
		])
	);

	merchantMappingsCache.set(userId, { cachedAt: Date.now(), data: mapped });
	return new Map(mapped);
}
