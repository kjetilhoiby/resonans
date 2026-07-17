import { redirect } from '@sveltejs/kit';

// Retning/drømmer bor nå som fane i Plan-flaten (samme mønster som /maal).
// Gamle lenker (hendelseskort i dagboken, bokmerker) skal fortsette å virke.
export const load = () => {
	throw redirect(302, '/plan/drommer');
};
