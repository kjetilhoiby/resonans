import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const accounts = await fetch('/api/economics/accounts')
		.then((r) => r.json())
		.catch(() => []);

	if (accounts.length > 0) {
		redirect(302, `/economics/${encodeURIComponent(accounts[0].accountId)}/saldo`);
	}

	return { accounts: [] };
};
