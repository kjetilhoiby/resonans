/**
 * Dommen over cron-dispatcheren, i ord — for statuskortet på /settings/jobs.
 *
 * Bor i domenelaget fordi setningene bærer forbeholdene (samme prinsipp som
 * `effort-standing.ts`): rå tellinger ville tvunget flaten til å formulere
 * dommen selv, og «GitHub tok 3 slots» kan bety både «dispatcheren var nede»
 * og «containeren redeployet» — teksten skal si hva man skal SE ETTER, ikke
 * bare tallet.
 */

export type ClaimantCounts = {
	/** Krav tatt av in-app-dispatcheren (claimed_by 'dispatcher-…'). */
	internal: number;
	/** Krav tatt av GitHub Actions-sikkerhetsnettet ('github-actions'). */
	github: number;
	/** Alt annet (manuelle kall, gamle rader uten claimed_by). */
	other: number;
};

export function summarizeClaimants(
	rows: Array<{ claimedBy: string | null; count: number }>
): ClaimantCounts {
	const counts: ClaimantCounts = { internal: 0, github: 0, other: 0 };
	for (const row of rows) {
		if (row.claimedBy?.startsWith('dispatcher-')) counts.internal += row.count;
		else if (row.claimedBy === 'github-actions') counts.github += row.count;
		else counts.other += row.count;
	}
	return counts;
}

export type DispatchVerdict = {
	tone: 'ok' | 'warn' | 'off';
	text: string;
};

/**
 * `enabled` er denne instansens miljøflagg, `lockHeld` er om NOEN sesjon i
 * basen holder lederlåsen (pg_locks) — de kan peke hver sin vei under en
 * rullende oppdatering, og det er derfor begge er med.
 */
export function describeDispatchStatus(input: {
	enabled: boolean;
	lockHeld: boolean;
	counts: ClaimantCounts;
}): DispatchVerdict {
	const { enabled, lockHeld, counts } = input;
	const total = counts.internal + counts.github + counts.other;

	if (!enabled && !lockHeld) {
		return {
			tone: 'off',
			text: 'Dispatcheren er ikke skrudd på (ENABLE_CRON_DISPATCHER). GitHub Actions er klokka.'
		};
	}

	if (!lockHeld) {
		return {
			tone: 'warn',
			text:
				'Ingen instans holder lederlåsen — klokka tikker ikke. Sjekk containerloggen for ' +
				'[cron-dispatch]; GitHub Actions-sikkerhetsnettet tar slotene i mellomtiden.'
		};
	}

	if (total === 0) {
		return {
			tone: 'warn',
			text:
				'Lederlåsen holdes, men ingen dispatch-krav er tatt siste døgn — jobber kjøres hvert ' +
				'5. minutt, så dette skal ikke skje. Sjekk containerloggen for [cron-dispatch].'
		};
	}

	if (counts.github > 0) {
		return {
			tone: 'warn',
			text:
				`GitHub Actions tok ${counts.github} av ${total} slots siste døgn — dispatcheren har ` +
				'hengt etter eller vært nede i perioder. Enkelttilfeller rundt en redeploy er normalt.'
		};
	}

	return {
		tone: 'ok',
		text:
			`Dispatcheren har tatt alle ${counts.internal} slots siste døgn — ` +
			'GitHub Actions-sikkerhetsnettet har ingenting å gjøre.'
	};
}
