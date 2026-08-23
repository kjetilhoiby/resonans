import { z } from 'zod';
import { createGoal } from '$lib/server/goals';
import { isMetaGoalTitle } from '$lib/domain/goal-validation';

/**
 * Delt AI-verktøy: opprett et nytt mål. Logikken (tidligere inline i `/api/chat`) bor nå her, så
 * både chatten og den server-kjørte assistenten deler én implementasjon. `themeId`-fallback til
 * samtalens tema håndteres av kalleren (chatten sender `args.themeId || conversation.themeId`).
 */
export const createGoalTool = {
	name: 'create_goal',
	description:
		'Opprett et nytt mål for brukeren. VIKTIG: Sjekk ALLTID med check_similar_goals først! Hvis målet er målbart, send også canonical metricId og goal track-feltene slik at dashboardene kan bruke målet direkte. For tidsbegrensede mål (f.eks. "løpe 150 km før 15. juni"): sett startDate til dagens dato og endDate til fristen. VEKTMÅL ("ned til 95 kg innen 15. november"): metricId=weight_change, targetValue=95 (målvekten i kg), startDate og endDate satt — startVerdien hentes fra siste vektmåling, så la startValue stå tom med mindre brukeren oppgir en annen startvekt. Svaret forteller hvilke tall målet faktisk måles mot: bruk DEM i kvitteringen til brukeren, aldri egne anslag. ALDRI opprett mål med meta-titler som "Planlegging" eller "Plan" — kun konkrete livsmål.',

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
			.describe('Canonical metric id når målet er målbart, f.eks. running_distance, weight_change, grocery_spend, category_spend (forbrukstak i en kategori).'),
		spendCategory: z
			.string()
			.optional()
			.describe('Kun for metricId=category_spend: hvilken forbrukskategori taket gjelder (canonical CategoryId, f.eks. kafe_og_restaurant, medier_og_underholdning, barn, reise, klaer_og_utstyr).'),
		childName: z
			.string()
			.optional()
			.describe('Kun for metricId=parent_time: hvilket barn timene gjelder (fornavn). targetValue = timer per uke.'),
		goalKind: z.enum(['level', 'change', 'trajectory']).optional().describe('Hvordan målet evalueres i dashboardet'),
		goalWindow: z
			.enum(['week', 'month', 'quarter', 'year', 'custom'])
			.optional()
			.describe('Hvilken horisont målet gjelder for'),
		targetValue: z
			.number()
			.optional()
			.describe(
				'Målverdien for metrikksporet (f.eks. 20 km/uke). For metricId=weight_change: oppgi MÅLVEKTEN i kg (f.eks. 95 for «ned til 95 kg») — serveren regner endringen selv.'
			),
		startValue: z
			.number()
			.optional()
			.describe(
				'Fraverdi/baseline. Kun for metricId=weight_change: startvekten i kg. Utelat den hvis brukeren ikke har oppgitt en startvekt — serveren bruker siste målte vekt, som er riktigere enn et anslag. IKKE gjett et tall her.'
			),
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
		spendCategory?: string;
		childName?: string;
		goalKind?: 'level' | 'change' | 'trajectory';
		goalWindow?: 'week' | 'month' | 'quarter' | 'year' | 'custom';
		targetValue?: number;
		startValue?: number;
		unit?: string;
		durationDays?: number;
	}) => {
		// Hard guard — «ALDRI meta-titler»-regelen var tidligere kun prompt-tekst og lakk
		if (isMetaGoalTitle(args.title)) {
			return {
				success: false as const,
				error: `«${args.title}» er en meta-tittel, ikke et konkret livsmål. Lag et mål som beskriver hva som faktisk skal oppnås — f.eks. «Løpe 60 km i juli» eller «Redusere vekt til 85 kg» — eller dropp målet hvis det ikke finnes noe konkret.`
			};
		}
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
				spendCategory: args.spendCategory,
				childName: args.childName,
				goalKind: args.goalKind,
				goalWindow: args.goalWindow,
				targetValue: args.targetValue,
				startValue: args.startValue,
				unit: args.unit,
				durationDays: args.durationDays
			});
			// Tallene rapporteres slik de faktisk BLE LAGRET, ikke slik modellen ba om dem.
			// Baselinen fylles serverside fra siste vektmåling, og målverdien tolkes der —
			// et svar bygget på argumentene ville sagt «fraverdi 100 kg» om en bruker som
			// veier 98,2, og brukeren har ingen måte å se at tallet var oppdiktet.
			const meta = (goal.metadata ?? {}) as {
				metricId?: string | null;
				startValue?: number | null;
				goalTrack?: { targetValue?: number; unit?: string } | null;
			};
			const measurement = describeMeasurement(meta);

			return {
				success: true as const,
				goalId: goal.id,
				goalTitle: goal.title,
				...measurement,
				message: `✅ Målet "${goal.title}" er opprettet med ID: ${goal.id}. VIKTIG: Bruk denne eksakte ID-en hvis du skal lage oppgaver for dette målet!${
					measurement.warning ? ` OBS: ${measurement.warning}` : ''
				}`
			};
		} catch (error) {
			console.error('[create_goal] feilet:', error);
			return { success: false as const, error: 'Kunne ikke opprette mål.' };
		}
	}
};

/**
 * Hva målet faktisk kan måles mot etter opprettelsen. Et vektmål uten baseline er
 * umålbart og havner under «Uten måling» på /plan/mal — det skal modellen si til
 * brukeren, ikke oppdage senere.
 */
export function describeMeasurement(meta: {
	metricId?: string | null;
	startValue?: number | null;
	goalTrack?: { targetValue?: number; unit?: string } | null;
}): { measurement?: string; warning?: string } {
	const target = meta.goalTrack?.targetValue;

	if (meta.metricId === 'weight_change') {
		if (typeof meta.startValue !== 'number' || typeof target !== 'number') {
			return {
				warning:
					'målet har ingen målbar startvekt, så det vises uten fremdrift. Be brukeren veie seg (eller oppgi en startvekt), så kan målet måles.'
			};
		}
		const targetWeight = Math.round((meta.startValue + target) * 10) / 10;
		return {
			measurement: `Måles fra ${meta.startValue} kg til ${targetWeight} kg (${
				target > 0 ? '+' : ''
			}${target} kg). Oppgi disse tallene til brukeren — ikke egne anslag.`
		};
	}

	if (!meta.metricId) {
		return {
			warning:
				'målet er ikke koblet til en metrikk, så fremdrift må følges med oppgaver framfor målinger.'
		};
	}
	if (typeof target !== 'number') {
		return { warning: 'målet mangler en målverdi, så fremdrift kan ikke måles automatisk.' };
	}
	return { measurement: `Måles mot ${target} ${meta.goalTrack?.unit ?? ''}`.trim() };
}
