/**
 * Dagsmålene, satt fra chatten.
 *
 * «Sett proteinmålet til 180 gram» er en setning man sier, ikke et skjema man vil
 * åpne. Men målet skal *vises* der man styrer etter det, så kortet på Ernæring viser
 * og justerer de samme fem tallene — samme lagring gjennom `saveNutritionTargets`.
 *
 * ## Hvorfor verktøyet leser før det skriver
 *
 * `get` finnes som egen handling fordi «hva er kalorimålet mitt?» er et spørsmål i
 * seg selv, og fordi en modell som skal endre *ett* mål må se de andre først: setter
 * man proteinandelen til 40 uten å vite at karbo står på 55, lager man en umulig
 * kombinasjon. Svaret bærer derfor alltid hele settet og advarselen.
 *
 * ## Proteinmål i gram per kilo
 *
 * `proteinPerKg` er med fordi det er måten protein faktisk settes — 1,6–2,0 g/kg for
 * den som trener. Verktøyet regner om med brukerens siste vekt. Uten vekt i basen
 * avvises det framfor å gange med et gjettet tall.
 */

import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { loadNutritionTargets } from '$lib/server/nutrition/targets';
import { saveNutritionTargets, type TargetPatch } from '$lib/server/nutrition/save-targets';
import {
	DEFAULT_MACRO_SPLIT,
	TARGET_LIMITS
} from '$lib/domain/nutrition/target-settings';
import {
	PROTEIN_G_PER_KG_MAX,
	PROTEIN_G_PER_KG_MIN,
	suggestedProteinTarget
} from '$lib/domain/nutrition/macro-targets';

export interface ManageNutritionTargetsArgs {
	userId: string;
	action: 'get' | 'set';
	kcalTarget?: number | null;
	proteinTarget?: number | null;
	proteinPerKg?: number | null;
	proteinPct?: number | null;
	carbsPct?: number | null;
	fatPct?: number | null;
	/** Setter 30/40/30 for den som ikke har en mening om fordelingen. */
	useDefaultMacroSplit?: boolean;
}

/** Siste vektmåling, til omregning av g/kg. Null når Withings ikke har levert. */
async function latestWeightKg(userId: string): Promise<number | null> {
	const row = await db.query.sensorEvents.findFirst({
		columns: { data: true },
		where: and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'weight')),
		orderBy: [desc(sensorEvents.timestamp)]
	});
	const value = (row?.data as { weight?: unknown } | null)?.weight;
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export const manageNutritionTargetsTool = {
	name: 'manage_nutrition_targets',
	description: `Les eller sett brukerens dagsmål for kalorier, protein og makrofordeling.

Bruk 'get' når brukeren spør hva målene er, eller FØR du endrer ett av dem — du må se
de andre for ikke å lage en umulig kombinasjon.

Bruk 'set' når brukeren sier hva de vil ha: «sett kalorimålet til 2600», «jeg vil ha
180 g protein», «2 gram protein per kilo», «60/20/20 fordeling». Bare feltene du
sender endres; resten står.

Protein: send proteinTarget for gram, eller proteinPerKg (${PROTEIN_G_PER_KG_MIN}–${PROTEIN_G_PER_KG_MAX} er
vanlig for den som trener) og la verktøyet regne om med siste vekt. Et absolutt
gram-mål vinner over proteinPct.

Andelene (proteinPct/carbsPct/fatPct) er prosent av energien og trenger ikke summere
til 100 — de er tre uavhengige mål. Summerer de langt fra 100, får du en warning
tilbake; SI den til brukeren.

Send null for å fjerne et mål. Uten kcal-mål kan ikke andelene regnes om til gram, og
sultvarslene slutter å virke — nevn det hvis brukeren fjerner det.

Målene vises og kan justeres i Ernæring-temaet, så du trenger ikke lese dem tilbake
for å bekrefte; si hva du satte.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		action: z.enum(['get', 'set']),
		kcalTarget: z
			.number()
			.nullable()
			.optional()
			.describe(
				`Dagsmål for energi, ${TARGET_LIMITS.kcalTarget[0]}–${TARGET_LIMITS.kcalTarget[1]} kcal. null fjerner målet.`
			),
		proteinTarget: z
			.number()
			.nullable()
			.optional()
			.describe(
				`Proteinmål i gram, ${TARGET_LIMITS.proteinTarget[0]}–${TARGET_LIMITS.proteinTarget[1]}. null fjerner målet.`
			),
		proteinPerKg: z
			.number()
			.optional()
			.describe(
				'Gram protein per kilo kroppsvekt. Regnes om med brukerens siste vekt. Bruk denne når brukeren sier «2 gram per kilo».'
			),
		proteinPct: z.number().nullable().optional().describe('Proteinandel av energien, i prosent.'),
		carbsPct: z.number().nullable().optional().describe('Karboandel av energien, i prosent.'),
		fatPct: z.number().nullable().optional().describe('Fettandel av energien, i prosent.'),
		useDefaultMacroSplit: z
			.boolean()
			.optional()
			.describe(
				'Setter 30/40/30 protein/karbo/fett. Bruk når brukeren vil ha en fordeling men ikke har en mening om tallene.'
			)
	}),

	execute: async (args: ManageNutritionTargetsArgs) => {
		const { userId, action } = args;

		if (action === 'get') {
			const targets = await loadNutritionTargets(userId);
			const weightKg = await latestWeightKg(userId);
			return {
				targets,
				/** Hva et proteinmål ville blitt ut fra vekta, som sammenligning. */
				suggestedProteinG: suggestedProteinTarget(weightKg),
				weightKg,
				noTargetsSet:
					targets.kcal === null && targets.proteinG === null && targets.proteinPct === null
			};
		}

		const patch: TargetPatch = {};
		if ('kcalTarget' in args) patch.kcalTarget = args.kcalTarget ?? null;
		if ('proteinTarget' in args) patch.proteinTarget = args.proteinTarget ?? null;
		if ('proteinPct' in args) patch.proteinPct = args.proteinPct ?? null;
		if ('carbsPct' in args) patch.carbsPct = args.carbsPct ?? null;
		if ('fatPct' in args) patch.fatPct = args.fatPct ?? null;

		if (args.useDefaultMacroSplit) {
			patch.proteinPct = DEFAULT_MACRO_SPLIT.proteinPct;
			patch.carbsPct = DEFAULT_MACRO_SPLIT.carbsPct;
			patch.fatPct = DEFAULT_MACRO_SPLIT.fatPct;
		}

		// g/kg regnes om her, ikke i domenelaget: omregningen trenger en vekt fra
		// basen, og et proteinmål bygget på en gjettet vekt er verre enn ingen.
		let usedWeightKg: number | null = null;
		if (typeof args.proteinPerKg === 'number' && Number.isFinite(args.proteinPerKg)) {
			usedWeightKg = await latestWeightKg(userId);
			if (usedWeightKg === null) {
				return {
					error:
						'Fant ingen vektmåling å regne gram per kilo fra. Spør brukeren om et proteinmål i gram i stedet.'
				};
			}
			patch.proteinTarget = Math.round(args.proteinPerKg * usedWeightKg);
		}

		if (Object.keys(patch).length === 0) {
			return { error: 'Ingen mål oppgitt. Send minst ett felt, eller bruk action get.' };
		}

		const result = await saveNutritionTargets(userId, patch);
		if (!result.ok) return { error: result.error };

		return {
			saved: true,
			targets: result.targets,
			warning: result.warning,
			...(usedWeightKg !== null
				? { note: `Regnet ut fra ${usedWeightKg} kg: ${patch.proteinTarget} g protein.` }
				: {}),
			// Uten kcal-mål slutter pacing og sultvarsler å virke — det er en
			// konsekvens brukeren skal få høre, ikke oppdage.
			...(result.targets.kcal === null
				? {
						note2:
							'Uten kalorimål kan ikke andelene regnes om til gram, og sultvarslene er avslått.'
					}
				: {})
		};
	}
};
