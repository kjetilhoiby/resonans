import { z } from 'zod';
import { logActivity, type ActivityMetric } from '$lib/server/activities';

/**
 * Delt AI-verktøy: registrer en gjennomført aktivitet/trening med målbare verdier. Logikken
 * (tidligere inline i `/api/chat`) bor nå her, så chatten og assistenten deler én implementasjon.
 */
export const logActivityTool = {
	name: 'log_activity',
	description:
		'Registrer en tradisjonell aktivitet/trening med målbare verdier (løp, styrketrening, date osv). IKKE bruk denne for vaner koblet til tracking series (f.eks. mikroyoga, skjermtid) — bruk record_tracking_event for disse. Aktiviteten kobles automatisk til relevante oppgaver.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		type: z
			.string()
			.describe('Type aktivitet. Format: kategori_spesifikk (f.eks: workout_run, workout_strength, relationship_date)'),
		duration: z.number().optional().describe('Varighet i minutter (hvis relevant)'),
		note: z.string().optional().describe('Brukerens notat om aktiviteten'),
		metrics: z
			.array(
				z.object({
					metricType: z.string().describe('Type måling (f.eks: distance, quality_rating, energy_level)'),
					value: z.number().describe('Verdien som ble målt'),
					unit: z.string().optional().describe('Enhet for målingen (f.eks: km, rating_1_10, minutes)')
				})
			)
			.describe('Målbare verdier fra aktiviteten'),
		taskIds: z
			.array(z.string())
			.optional()
			.describe('Valgfritt: Spesifikke task IDs aktiviteten skal telle mot. Ellers matcher systemet automatisk.')
	}),

	execute: async (args: {
		userId: string;
		type: string;
		metrics: ActivityMetric[];
		duration?: number;
		note?: string;
		taskIds?: string[];
	}) => {
		try {
			const result = await logActivity({
				userId: args.userId,
				type: args.type,
				metrics: args.metrics,
				duration: args.duration,
				note: args.note,
				taskIds: args.taskIds
			});

			const taskSummary = result.progressEntries
				.map((p) => `• ${p.task.title}${p.value ? ` (+${p.value} ${p.task.unit || ''})` : ''}`)
				.join('\n');

			return {
				success: true as const,
				activityId: result.activity.id,
				tasksUpdated: result.progressEntries.length,
				message: `✅ Aktivitet registrert!\n\nTeller mot:\n${taskSummary || '(Ingen matchende oppgaver funnet)'}`
			};
		} catch (error) {
			console.error('[log_activity] feilet:', error);
			return { success: false as const, error: 'Kunne ikke registrere aktivitet.' };
		}
	}
};
