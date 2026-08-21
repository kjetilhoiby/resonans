import { json } from '@sveltejs/kit';
import { getSparebank1Sensor, getValidSparebank1AccessToken } from '$lib/server/integrations/sparebank1-sync';
import { fetchSparebank1Accounts, fetchSparebank1Transactions } from '$lib/server/integrations/sparebank1';
import { normaliserDato } from '$lib/domain/economics/history-probe';
import type { RequestHandler } from './$types';

/**
 * GET /api/sensors/sparebank1/probe?accountKey=xxx[&from=YYYY-MM-DD]
 *
 * Henter transaksjoner for å måle hvor langt tilbake banken faktisk gir oss
 * noe. Returnerer antall, eldste/nyeste dato og rate-limit-headerne.
 *
 * `from` er ikke pynt. Uten den spør vi UTEN datofilter, og mange API-er
 * svarer da med et standardvindu selv om de ville gitt mer hvis man ba
 * eksplisitt. Uten å stille begge spørsmålene kan vi ikke skille «banken har
 * bare 24 måneder» fra «banken gir 24 måneder til den som ikke spør bedre».
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const sensor = await getSparebank1Sensor(userId);
	if (!sensor) return json({ error: 'Ingen SpareBank1-sensor funnet' }, { status: 404 });

	const accessToken = await getValidSparebank1AccessToken(sensor);
	const rateLimitHeaders: Record<string, string> = {};

	const accountKey = url.searchParams.get('accountKey');

	if (!accountKey) {
		// List available accounts so caller knows which key to use
		const accounts = await fetchSparebank1Accounts(accessToken, rateLimitHeaders);
		return json({
			accounts: accounts.map((a: any) => ({
				key: a.key ?? a.accountKey ?? a.id ?? a.accountId,
				name: a.name ?? a.accountName,
				type: a.type ?? a.accountType
			})),
			rateLimitHeaders
		});
	}

	const fra = url.searchParams.get('from');
	const since = fra ? new Date(`${fra}T00:00:00Z`) : undefined;
	if (since && Number.isNaN(since.getTime())) {
		return json({ error: `Ugyldig from-dato: ${fra}` }, { status: 400 });
	}

	const txns = await fetchSparebank1Transactions(accessToken, accountKey, since, undefined, rateLimitHeaders);

	// SpareBank1 sender `date` som epoch-millisekunder (se sparebank1-sync.ts:592).
	// Uten normalisering sorterte vi tall leksikografisk — riktig ved en tilfeldighet
	// så lenge alle er 13-sifrede — og sendte råtallet videre til en klient som
	// forventet en dato.
	const dates = txns
		.map((t: any) => normaliserDato(t.date ?? t.bookingDate ?? t.transactionDate))
		.filter((d): d is string => d !== null)
		.sort();

	return json({
		accountKey,
		requestedFrom: fra ?? null,
		count: txns.length,
		oldestDate: dates[0] ?? null,
		newestDate: dates[dates.length - 1] ?? null,
		rateLimitHeaders,
		likelyCapped: txns.length > 0 && txns.length % 100 === 0
	});
};
