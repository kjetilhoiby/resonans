import type { Handle } from '@sveltejs/kit';
import { startScheduler } from '$lib/server/scheduler';

// Start scheduler when server starts
startScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};
