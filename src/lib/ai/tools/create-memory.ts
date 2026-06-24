import { z } from 'zod';
import { createMemory } from '$lib/server/memories';
import { isFutureVisionText, seedThemeInstructionFromFutureVision } from '$lib/server/theme-instructions';

/**
 * Delt AI-verktøy: lagre viktig informasjon om brukeren permanent. Logikken (tidligere inline i
 * `/api/chat`) bor nå her — inkludert å så en tema-instruks fra en framtidsvisjon — så chatten og
 * assistenten deler én implementasjon. `source` settes av kalleren (samtale-id i chat,
 * assistent-kilde i assistenten).
 */
export const createMemoryTool = {
	name: 'create_memory',
	description:
		'Lagre viktig informasjon om brukeren som skal huskes permanent. Kan være generelt eller tema-spesifikt. Skriv content som en kort, faktisk påstand.',

	parameters: z.object({
		userId: z.string().describe('User ID'),
		category: z
			.enum(['personal', 'relationship', 'fitness', 'mental_health', 'preferences', 'other'])
			.describe('Kategori for minnet'),
		content: z.string().describe('Selve minnet — en kort, faktisk påstand (f.eks: "Brukeren heter Kjetil")'),
		importance: z.enum(['high', 'medium', 'low']).optional().describe('Hvor viktig er dette minnet?'),
		themeId: z.string().optional().describe('Valgfritt: Tema-ID for tema-spesifikke memories')
	}),

	execute: async (args: {
		userId: string;
		category: 'personal' | 'relationship' | 'fitness' | 'mental_health' | 'preferences' | 'other';
		content: string;
		importance?: 'high' | 'medium' | 'low';
		themeId?: string;
		/** Settes av kalleren (samtale-id / assistent-kilde), ikke av modellen. */
		source?: string;
	}) => {
		try {
			const memory = await createMemory({
				userId: args.userId,
				themeId: args.themeId || null,
				category: args.category,
				content: args.content,
				importance: args.importance || 'medium',
				source: args.source
			});

			if (args.themeId && typeof args.content === 'string' && isFutureVisionText(args.content)) {
				await seedThemeInstructionFromFutureVision(args.userId, args.themeId, args.content);
			}

			return {
				success: true as const,
				memoryId: memory.id,
				themeSpecific: !!args.themeId,
				message: `Memory lagret${args.themeId ? ' (tema-spesifikk)' : ''}: ${args.content}`
			};
		} catch (error) {
			console.error('[create_memory] feilet:', error);
			return { success: false as const, error: 'Kunne ikke lagre minne.' };
		}
	}
};
