import { z } from 'zod';
import { createGoal } from '$lib/server/goals';

/**
 * Delt AI-verktøy: opprett et nytt mål. Logikken (tidligere inline i `/api/chat`) bor nå her, så
 * både chatten og den server-kjørte assistenten deler én implementasjon. `themeId`-fallback til
 * samtalens tema håndteres av kalleren (chatten sender `args.themeId || conversation.themeId`).
 */
export const createGoalTool = {
	name: 'create_goal',
	description:
		'Opprett et nytt mål for brukeren. VIKTIG: Sjekk ALLTID med check_similar_goals først! Hvis målet er målbart, send også canonical metricId og goal track-feltene slik at dashboardene kan bruke målet direkte. For tidsbegrensede mål (f.eks. "løpe 150 km før 15. juni"): sett startDate til dagens dato og endDate til fristen. ALDRI opprett mål med meta-titler som "Planlegging" eller "Plan" — kun konkrete livsmål.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		categoryName: z
			.enum(['Trening', 'Parforhold', 'Mental helse', 'Karriere', 'Økonomi', 'Hobby', 'Annet'])
			.describe('Kategori for målet'),
		themeId: z.string().optional().describe('Valgfritt tema-ID hvis målet skal kobles til et eksisterende tema'),
		title: z.string().describe('Kort, konkret tittel for målet (f.eks: "Løpe 5 km uten pause")'),
		description: z.string().describe('Detaljert beskrivelse av målet, inkludert hvorfor det er viktig'),
		targetDate: z.string().optional().describe('Måldato i ISO format (YYYY-MM-DD)'),
		startDate: z.string().optional().describe('Startdato (YYYY-MM-DD). Sett til dagens dato for tidsbegrensede mål.'),
		endDate: z.string().optional().describe('Sluttdato (YYYY-MM-DD) når brukeren har oppgitt en eksplisitt frist'),
		metricId: z
			.string()
			.optional()
			.describe('Canonical metric id når målet er målbart, f.eks. running_distance, weight_change, grocery_spend.'),
		goalKind: z.enum(['level', 'change', 'trajectory']).optional().describe('Hvordan målet evalueres i dashboardet'),
		goalWindow: z
			.enum(['week', 'month', 'quarter', 'year', 'custom'])
			.optional()
			.describe('Hvilken horisont målet gjelder for'),
		targetValue: z.number().optional().describe('Målverdien for metrikksporet (f.eks. 20 km/uke, -3 kg)'),
		unit: z.string().optional().describe('Enhet for målverdien, f.eks. km, kg eller kr'),
		durationDays: z.number().optional().describe('Brukes kun når goalWindow er custom (f.eks. 60)')
	}),

	execute: async (args: {
		userId: string;
		categoryName: string;
		title: string;
		description: string;
		themeId?: string;
		targetDate?: string;
		startDate?: string;
		endDate?: string;
		metricId?: string;
		goalKind?: 'level' | 'change' | 'trajectory';
		goalWindow?: 'week' | 'month' | 'quarter' | 'year' | 'custom';
		targetValue?: number;
		unit?: string;
		durationDays?: number;
	}) => {
		try {
			const goal = await createGoal({
				userId: args.userId,
				categoryName: args.categoryName,
				title: args.title,
				description: args.description,
				themeId: args.themeId || undefined,
				targetDate: args.targetDate,
				startDate: args.startDate,
				endDate: args.endDate,
				metricId: args.metricId,
				goalKind: args.goalKind,
				goalWindow: args.goalWindow,
				targetValue: args.targetValue,
				unit: args.unit,
				durationDays: args.durationDays
			});
			return {
				success: true as const,
				goalId: goal.id,
				goalTitle: goal.title,
				message: `✅ Målet "${goal.title}" er opprettet med ID: ${goal.id}. VIKTIG: Bruk denne eksakte ID-en hvis du skal lage oppgaver for dette målet!`
			};
		} catch (error) {
			console.error('[create_goal] feilet:', error);
			return { success: false as const, error: 'Kunne ikke opprette mål.' };
		}
	}
};
