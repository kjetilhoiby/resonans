/**
 * Ren input-normalisering for `add_to_week_plan`.
 *
 * Verktøyet aksepterer både gamle strengpunkter («Skjermfri 16–19 tre kvelder»)
 * og objektpunkter med livskompass-dimensjon ({ text, dimension: 'egentid' }).
 * Dimensjonen valideres mot dimensjonslisten — ukjente ids droppes stille så et
 * hallusinert id-navn ikke lager falske kompass-mål.
 */

import { LIVSKOMPASS_DIMENSION_IDS } from '$lib/domains/livskompass/dimensions';

export interface NormalizedWeekPlanItem {
	text: string;
	/** Gyldig livskompass-dimensjons-id, eller null for vanlige punkter. */
	dimension: string | null;
}

export type WeekPlanItemInput = string | { text?: unknown; dimension?: unknown } | null | undefined;

export function normalizeWeekPlanItems(items: WeekPlanItemInput[] | null | undefined): NormalizedWeekPlanItem[] {
	const result: NormalizedWeekPlanItem[] = [];
	for (const raw of items ?? []) {
		if (typeof raw === 'string') {
			const text = raw.trim();
			if (text) result.push({ text, dimension: null });
			continue;
		}
		if (!raw || typeof raw !== 'object') continue;
		const text = typeof raw.text === 'string' ? raw.text.trim() : '';
		if (!text) continue;
		const dimension =
			typeof raw.dimension === 'string' && LIVSKOMPASS_DIMENSION_IDS.includes(raw.dimension)
				? raw.dimension
				: null;
		result.push({ text, dimension });
	}
	return result;
}
