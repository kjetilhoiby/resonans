/**
 * Én skrivevei for «denne transaksjonen hører i en annen kategori».
 *
 * Fram til august 2026 lå kallet duplisert i `TransactionList.svelte` og
 * `TransactionExplorer.svelte`, og de to gjorde ikke det samme: Explorer sendte `typeText` og
 * underkategori, lista gjorde ikke. Konsekvensen var stille og traff nøkkelen selv —
 * `buildTransactionFingerprint` faller tilbake på `typeText` når beskrivelsen er tom, så en
 * retting fra lista på en tom beskrivelse fikk fingerprint `ukjent|out` og ville overstyrt
 * ALLE transaksjoner uten beskrivelse. Et duplikat arver ikke rettelser.
 *
 * **Overstyringen gjelder stedet, ikke beløpet.** Fingerprinten er
 * `merchantKey|retning` — beløpet brukes bare til å utlede inn/ut. Én retting virker derfor
 * på alle framtidige kjøp fra samme sted, som er nettopp det brukeren ba om. Kallere skal si
 * det med ord; ellers vet han ikke at det skjedde.
 */

import { extractApiErrorMessage } from '$lib/client/api-error';
import { CATEGORIES, type CategoryId } from '$lib/integrations/transaction-categories-client';

export type CategoryOverrideInput = {
	description: string | null;
	/** SB1s kategoritekst. **Må sendes** — den er fingerprint-fallback for tomme beskrivelser. */
	typeText?: string | null;
	amount: number;
	category: CategoryId;
	subcategory?: string | null;
};

export type CategoryOverrideResult = {
	category: CategoryId;
	label: string;
	emoji: string;
	subcategory: string | null;
	/** Klar til visning: hva rettingen kommer til å gjelde for framover. */
	appliesTo: string;
};

/**
 * Lagrer en manuell kategori-overstyring.
 *
 * Kaster med **serverens** melding ved feil. En generisk «prøv igjen» gjør en prod-feil
 * uløselig, og her er den vanligste feilen konkret og handlingsrettet: en ugyldig kategori.
 */
export async function saveCategoryOverride(
	input: CategoryOverrideInput
): Promise<CategoryOverrideResult> {
	const res = await fetch('/api/classification-overrides', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			domain: 'transaction',
			description: input.description,
			typeText: input.typeText ?? null,
			amount: input.amount,
			correctedCategory: input.category,
			correctedSubcategory: input.subcategory ?? null
		})
	});

	if (!res.ok) {
		throw new Error(extractApiErrorMessage(res.status, await res.text()));
	}

	const cat = CATEGORIES[input.category];
	const merchant = (input.description ?? input.typeText ?? '').trim();

	return {
		category: cat.id,
		label: cat.label,
		emoji: cat.emoji,
		subcategory: input.subcategory ?? null,
		appliesTo: merchant
			? `Gjelder alle kjøp fra ${merchant} framover`
			: 'Gjelder tilsvarende transaksjoner framover'
	};
}
