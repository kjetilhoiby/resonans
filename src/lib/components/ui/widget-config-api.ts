/**
 * Nettverkslag for WidgetConfigSheet — treff-preview for beløpsfilter.
 * Injiseres som mock på /design.
 */
export interface FilterPreview {
	totalSpendTxCountInRange: number;
	categorizedMatchCount: number;
	keywordMatchCount: number;
	sampleMatches: Array<{ date: string; description: string; amount: number }>;
	sensorEventsTxCount: number;
}

export type LoadFilterPreview = (
	widgetId: string,
	params: { filterCategory: string; filterSubcategory?: string; range: string }
) => Promise<FilterPreview | null>;

export const loadFilterPreview: LoadFilterPreview = async (widgetId, { filterCategory, filterSubcategory, range }) => {
	const search = new URLSearchParams({ debug: '1', filterCategory, range });
	if (filterSubcategory) search.set('filterSubcategory', filterSubcategory);
	const res = await fetch(`/api/widget-data/${widgetId}?${search.toString()}`);
	if (!res.ok) throw new Error('Klarte ikke hente treff-preview');
	const data = await res.json();
	const amountFilter = data?.debug?.amountFilter;
	if (!amountFilter) return null;
	return {
		totalSpendTxCountInRange: amountFilter.totalSpendTxCountInRange ?? 0,
		categorizedMatchCount: amountFilter.categorizedMatchCount ?? 0,
		keywordMatchCount: amountFilter.keywordMatchCount ?? 0,
		sampleMatches: Array.isArray(amountFilter.sampleMatches) ? amountFilter.sampleMatches : [],
		sensorEventsTxCount: amountFilter.sensorEventsTxCount ?? 0
	};
};
