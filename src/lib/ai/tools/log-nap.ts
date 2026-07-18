import { z } from 'zod';
import { logNap } from '$lib/server/integrations/sleep-goals';
import { todayAtLocalTime } from '$lib/domain/sleep-goals';

/**
 * Delt AI-verktøy: registrer en powernap/hvil manuelt. Withings fanger bare
 * søvn utstyret måler — hvileøkter på sofaen registreres her og flyter inn i
 * nap-tellingen på Mål-fanen (og holdes ute av nattsnittet).
 */
export const logNapTool = {
	name: 'log_nap',
	description:
		'Registrer en powernap/hvil på dagtid — «tok en powernap», «hvilte en halvtime i ettermiddag», «la meg nedpå i stad». Kall verktøyet én gang per hvil (to hvileøkter = to kall). Bruk time-parameteren når brukeren oppgir omtrentlig tidspunkt; utelat den hvis hvilen nettopp ble avsluttet.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		durationMinutes: z
			.number()
			.describe('Varighet i minutter (5–180). Anslå 20 hvis brukeren ikke sier noe, f.eks. «en powernap».'),
		time: z
			.string()
			.optional()
			.describe('Starttidspunkt i dag som HH:MM lokal tid (f.eks. "14:30"). Utelat hvis hvilen nettopp ble avsluttet.'),
		note: z.string().optional().describe('Kort notat, f.eks. hvorfor («sliten etter dårlig natt»)')
	}),

	execute: async (args: { userId: string; durationMinutes: number; time?: string; note?: string }) => {
		if (!Number.isFinite(args.durationMinutes) || args.durationMinutes < 5 || args.durationMinutes > 180) {
			return { success: false as const, error: 'Varighet må være 5–180 minutter.' };
		}

		let at: Date | undefined;
		if (args.time) {
			const parsed = todayAtLocalTime(args.time);
			if (!parsed) {
				return { success: false as const, error: `Ugyldig tidspunkt «${args.time}» — bruk HH:MM.` };
			}
			at = parsed;
		}

		try {
			const nap = await logNap(args.userId, {
				durationMinutes: args.durationMinutes,
				at,
				note: args.note
			});
			const when = nap.start.toLocaleTimeString('no-NO', {
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Europe/Oslo'
			});
			return {
				success: true as const,
				napId: nap.id,
				message: `💤 Powernap registrert: ${nap.durationMinutes} min fra kl. ${when}. Telles i powernap-oversikten på Mål-fanen.`
			};
		} catch (error) {
			console.error('[log_nap] feilet:', error);
			return { success: false as const, error: 'Kunne ikke registrere powernap.' };
		}
	}
};
