/**
 * Registrerer et sultnivå brukeren **sier**, fra chatten.
 *
 * ## Hvorfor dette må finnes
 *
 * Nudgens svakeste variant spør «hvor sulten føler du deg nå, på en skala fra 1 til 5?»
 * (`askHunger`, mode `interactive`). Fram til nå hadde svaret ingen plass å landet: sa
 * brukeren «4» i chatten, forsvant det. Da spør vi om noe vi ikke tar imot — og den
 * raskeste måten å få folk til å slutte å svare.
 *
 * ## Transkribering, ikke tolkning
 *
 * Verktøyet tar et **tall brukeren har oppgitt**. Modellen skal ikke gjette at
 * «dritsulten» er en 5: skalaen er kalibrert mot brukerens egne tidligere svar, og et
 * gjettet nivå forurenser nettopp den kalibreringen. Er nivået uklart, skal modellen
 * spørre framfor å anslå.
 *
 * Gapet legges på av `recordHunger`, samme vei som flaten bruker.
 */

import { z } from 'zod';
import { recordHunger } from '$lib/server/nutrition/hunger-log';
import { HUNGER_LABELS, HUNGER_MAX, HUNGER_MIN } from '$lib/domain/nutrition/hunger';

export const logHungerTool = {
	name: 'log_hunger',
	description: `Registrer hvor sulten brukeren er, på skalaen 1–5 (${Object.entries(HUNGER_LABELS)
		.map(([n, label]) => `${n} = ${label.toLowerCase()}`)
		.join(', ')}).

Bruk når brukeren OPPGIR et nivå — «jeg er en 4 nå», «sånn 2», eller som svar på
sultvarselets spørsmål «hvor sulten føler du deg, 1–5?».

IKKE gjett nivået ut fra ordbruk. «Dritsulten» kan være 4 eller 5, og skalaen er
kalibrert mot brukerens egne tidligere svar — et gjettet tall ødelegger kalibreringen.
Er nivået uklart, spør: «på en skala fra 1 til 5?»

Systemet legger selv på det kumulative gapet (forbrent minus spist så langt). Over tid
lærer det hvilket gap som gjør denne brukeren sulten, og varsler før neste gang. Svaret
sier hvor mange meldinger som gjenstår før modellen er klar — det er verdt å nevne, siden
det gjør det tydelig hvorfor det er verdt å svare.

Si aldri noe om blodsukker. Appen måler det ikke.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		level: z
			.number()
			.int()
			.min(HUNGER_MIN)
			.max(HUNGER_MAX)
			.describe('Sultnivået brukeren oppgav, 1–5. Aldri gjettet.'),
		note: z.string().optional().describe('Brukerens egne ord, hvis de sa noe utover tallet.')
	}),

	execute: async (args: { userId: string; level: number; note?: string }) => {
		const result = await recordHunger({
			userId: args.userId,
			level: args.level,
			note: args.note ?? null
		});
		if (!result.ok) return { error: result.error };

		const { prediction } = result;
		return {
			saved: true,
			level: args.level,
			label: HUNGER_LABELS[args.level],
			/** Gapet meldingen ble lagret med. Null uten kroppsprofil. */
			gapKcal: result.gapKcal,
			prediction,
			note:
				result.gapKcal === null
					? 'Lagret, men uten kroppsprofil kan vi ikke regne gapet — og da kan ikke sult forutsies. Kroppsprofilen settes i /settings/profile.'
					: prediction.ready
						? `Modellen er klar: du melder sterk sult rundt ${prediction.thresholdKcal} kcal gap.`
						: prediction.notReadyReason
		};
	}
};
