import { z } from 'zod';
import { logParentTime } from '$lib/server/services/parent-time-service';

/**
 * Delt AI-verktøy: logg fokusert tid med ett barn. Grunnlaget for foreldretid-mål
 * (timer per uke per barn) og ukesoversikten coachen speiler.
 */
export const logParentTimeTool = {
	name: 'log_parent_time',
	description:
		'Logg fokusert tid med ett barn — «leste en halvtime med Emma», «spilte fotball med Noah i to timer», «bakte med Liv». Kall verktøyet én gang per barn (tid med flere barn = ett kall per barn). Brukes til foreldretid-mål og ukesoversikt.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		childName: z.string().describe('Barnets navn, f.eks. «Emma»'),
		minutes: z.number().describe('Antall minutter fokusert tid'),
		activity: z.string().optional().describe('Kort hva dere gjorde, f.eks. «lesing», «fotball» (valgfritt)')
	}),

	execute: async (args: { userId: string; childName: string; minutes: number; activity?: string }) => {
		const childName = args.childName?.trim();
		if (!childName) return { success: false as const, error: 'Mangler barnets navn.' };
		if (!Number.isFinite(args.minutes) || args.minutes <= 0) {
			return { success: false as const, error: 'Varighet må være over 0 minutter.' };
		}

		try {
			await logParentTime(args.userId, { childName, minutes: args.minutes, activity: args.activity });
			return {
				success: true as const,
				message: `👨‍👧 Registrert ${Math.round(args.minutes)} min med ${childName}. Teller mot foreldretiden denne uka.`
			};
		} catch (error) {
			console.error('[log_parent_time] feilet:', error);
			return { success: false as const, error: 'Kunne ikke logge foreldretiden.' };
		}
	}
};
