/**
 * search_metrics AI-tool
 *
 * Lar KI-en søke i metrikkregisteret for å finne riktig metricKey
 * før den kaller propose_widget.
 */

import { searchMetrics, getAllMetrics, type MetricDomain } from '$lib/server/services/metric-definition-service';

export interface SearchMetricsArgs {
	query: string;
	domain?: 'health' | 'spending' | 'income' | 'all';
	limit?: number;
}

export async function executeSearchMetrics(args: SearchMetricsArgs) {
	const domain = args.domain === 'all' || !args.domain ? undefined : (args.domain as MetricDomain);
	const limit = Math.min(args.limit ?? 8, 20);

	const results = searchMetrics(args.query, domain, limit);

	if (results.length === 0) {
		// Ingen treff — returner de mest relevante kategoriene innen domenet som hint
		const fallback = getAllMetrics(domain).slice(0, 5).map((d) => ({
			key: d.key,
			label: d.label,
			domain: d.domain,
			defaultAggregation: d.defaultAggregation,
			defaultRange: d.defaultRange,
			defaultUnit: d.defaultUnit,
			filterCategory: d.filterCategory,
			filterSubcategory: d.filterSubcategory,
			direction: d.direction,
			score: 0,
		}));
		return {
			success: true,
			query: args.query,
			results: fallback,
			hint: 'Ingen direkte treff. Viser de første tilgjengelige metrikkene. Prøv et bredere søkeord.',
		};
	}

	return {
		success: true,
		query: args.query,
		results,
	};
}

/** OpenAI function schema for registrering i chat/+server.ts */
export const searchMetricsToolSchema = {
	type: 'function' as const,
	function: {
		name: 'search_metrics',
		description: `Søk i metrikkregisteret for å finne riktig metricKey til widgets.
Bruk ALLTID dette FØR propose_widget når brukeren ber om widget for:
- Økonomi/forbruk (transport, mat, elbil, strøm, osv.)
- En kategori du ikke er sikker på nøkkelnavnet til
- Helse-metrikker der du er usikker

Returnerer en liste med key, label, defaultAggregation, defaultUnit og filterCategory.
Bruk key-feltet direkte som metricKey i propose_widget.`,
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Fritekst søk, f.eks. "elbil lading transport", "dagligvarer mat", "søvn", "trening"',
				},
				domain: {
					type: 'string',
					enum: ['health', 'spending', 'income', 'all'],
					description: 'Begrens til domene. Utelat eller bruk "all" for å søke i alt.',
				},
				limit: {
					type: 'number',
					description: 'Maks antall resultater (standard: 8)',
				},
			},
			required: ['query'],
		},
	},
};
