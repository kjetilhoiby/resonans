import type { PageServerLoad } from './$types';
import { listEvents } from '$lib/server/events/event-store';

export const load: PageServerLoad = async ({ locals }) => {
	return { events: await listEvents(locals.userId) };
};
