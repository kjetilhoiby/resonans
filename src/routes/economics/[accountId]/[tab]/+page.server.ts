import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const VALID_TABS = ['saldo', 'utgifter', 'innsikt', 'pengestrom', 'variabelt', 'akkumulert'] as const;
type TabSlug = (typeof VALID_TABS)[number];

export const load: PageServerLoad = async ({ params }) => {
	const { accountId, tab } = params;

	if (!VALID_TABS.includes(tab as TabSlug)) {
		redirect(302, `/economics/${encodeURIComponent(accountId)}/saldo`);
	}

	return { accountId, tab: tab as TabSlug };
};
