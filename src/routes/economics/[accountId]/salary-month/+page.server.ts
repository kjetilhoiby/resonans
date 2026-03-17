import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	const { accountId } = params;

	const [accountsRes, salaryRes] = await Promise.all([
		fetch('/api/economics/accounts'),
		fetch(`/api/economics/salary-month?accountId=${encodeURIComponent(accountId)}`)
	]);

	if (!accountsRes.ok) throw error(500, 'Kunne ikke laste kontoer');
	if (!salaryRes.ok) throw error(500, 'Kunne ikke laste lønnsdata');

	const accounts = await accountsRes.json();
	const salaryData = await salaryRes.json();

	const account = accounts.find((a: { accountId: string }) => a.accountId === accountId);
	if (!account) throw error(404, 'Konto ikke funnet');

	return {
		account,
		accounts,
		periods: salaryData.periods ?? [],
		medianCurve: salaryData.medianCurve ?? [],
		detectedPaydayDom: salaryData.detectedPaydayDom ?? null,
		paydaySourceAccountId: salaryData.paydaySourceAccountId ?? null
	};
};
