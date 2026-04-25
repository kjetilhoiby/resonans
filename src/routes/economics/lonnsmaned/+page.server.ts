import type { PageServerLoad } from './$types';
import type { SalaryMonthReport } from '$lib/types/salary-report';

export const load: PageServerLoad = async ({ fetch }) => {
	const [reportRes, accountsRes] = await Promise.all([
		fetch('/api/economics/salary-report'),
		fetch('/api/economics/accounts')
	]);

	return {
		report: reportRes.ok ? ((await reportRes.json()) as SalaryMonthReport) : null,
		accounts: accountsRes.ok ? await accountsRes.json() : []
	};
};
