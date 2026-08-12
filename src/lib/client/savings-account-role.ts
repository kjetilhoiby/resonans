/**
 * Én skrivevei for «denne kontoen er / er ikke bufferen min».
 *
 * Ligger her og ikke i komponenten fordi valget etter hvert skal kunne settes fra flere
 * steder — kontovelgeren nå, chatten senere — og to kallesteder med hver sin validering er
 * mønsteret fase 4 rettet opp i (`saveCategoryOverride`).
 */

import { extractApiErrorMessage } from '$lib/client/api-error';

export type SavingsRole = 'auto' | 'buffer' | 'ignore';

/**
 * Lagrer rollen for én konto.
 *
 * Kaster med **serverens** melding ved feil. Den vanligste feilen er konkret og
 * handlingsrettet — en ugyldig rolle — og en generisk «prøv igjen» ville skjult den.
 */
export async function saveSavingsRole(accountId: string, role: SavingsRole): Promise<void> {
	const res = await fetch('/api/economics/sparing/kontoer', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ accountId, role })
	});

	if (!res.ok) {
		throw new Error(extractApiErrorMessage(res.status, await res.text()));
	}
}

/** Hva valget betyr, i én setning. Delt så flatene ikke finner sine egne ord. */
export const ROLE_LABEL: Record<SavingsRole, string> = {
	auto: 'Automatisk',
	buffer: 'Med i bufferen',
	ignore: 'Utenfor'
};
