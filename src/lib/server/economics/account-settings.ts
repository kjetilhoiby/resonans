/**
 * Per-konto innstillinger for bankkontoer — lesing og skriving på ett sted.
 *
 * Én skrivevei, som `saveNutritionTargets`: både endepunktet og enhver framtidig
 * chat-inngang skal gjennom `setSavingsRole`, så valideringen ikke kan gå fra hverandre.
 * Se `docs/changelog/2026-08-12-velge-bufferkontoer.md`.
 */

import { db } from '$lib/db';
import { bankAccountSettings, persons } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { isSavingsRole, type SavingsRole } from '$lib/domain/economics/savings-buffer';
import { nameTokensForAll } from '$lib/domain/economics/person-name-tokens';

/** accountId → lagret rolle. Kontoer uten rad er `auto` og mangler her. */
export async function readSavingsRoles(userId: string): Promise<Map<string, SavingsRole>> {
	const rows = await db
		.select({
			accountId: bankAccountSettings.accountId,
			savingsRole: bankAccountSettings.savingsRole
		})
		.from(bankAccountSettings)
		.where(eq(bankAccountSettings.userId, userId));

	const roles = new Map<string, SavingsRole>();
	for (const row of rows) {
		// En ukjent verdi i basen leses som `auto` framfor å kaste: en rad skrevet av en
		// framtidig versjon skal ikke gjøre flaten utilgjengelig.
		if (isSavingsRole(row.savingsRole)) roles.set(row.accountId, row.savingsRole);
	}
	return roles;
}

/**
 * Navnetokens for barna i husholdningen.
 *
 * Brukes til å la barnas kontoer være utenfor husholdningens buffer som STANDARD — det er en
 * `auto`-avgjørelse, ikke en lås, så kontoen kan velges inn og valget står.
 *
 * Navnene leses fra `persons`, aldri hardkodet: samme regel som overføringsflaten følger.
 */
export async function readChildNameTokens(userId: string): Promise<string[]> {
	const rows = await db
		.select({ name: persons.name, fullName: persons.fullName, aliases: persons.aliases })
		.from(persons)
		.where(
			and(eq(persons.userId, userId), eq(persons.kind, 'child'), eq(persons.archived, false))
		);

	return nameTokensForAll(rows);
}

export type SetSavingsRoleResult =
	| { ok: true; accountId: string; role: SavingsRole }
	| { ok: false; error: string };

/**
 * Setter rollen for én konto.
 *
 * `auto` **sletter raden** framfor å lagre strengen. Da er «ingen rad» og «auto» samme
 * tilstand, og det finnes ikke to måter å uttrykke standarden på — ellers ville en endring i
 * heuristikken virket ulikt på kontoer som var rørt og urørt.
 */
export async function setSavingsRole(
	userId: string,
	accountId: string,
	role: unknown
): Promise<SetSavingsRoleResult> {
	const trimmed = typeof accountId === 'string' ? accountId.trim() : '';
	if (!trimmed) return { ok: false, error: 'Mangler accountId.' };
	if (!isSavingsRole(role)) {
		return { ok: false, error: 'Ukjent verdi. Gyldige er «auto», «buffer» og «ignore».' };
	}

	if (role === 'auto') {
		await db
			.delete(bankAccountSettings)
			.where(
				and(eq(bankAccountSettings.userId, userId), eq(bankAccountSettings.accountId, trimmed))
			);
		return { ok: true, accountId: trimmed, role };
	}

	await db
		.insert(bankAccountSettings)
		.values({ userId, accountId: trimmed, savingsRole: role })
		.onConflictDoUpdate({
			target: [bankAccountSettings.userId, bankAccountSettings.accountId],
			set: { savingsRole: role, updatedAt: sql`now()` }
		});

	return { ok: true, accountId: trimmed, role };
}
