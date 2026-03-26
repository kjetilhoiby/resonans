import { isGoogleAuthConfigured } from '$lib/server/auth-config';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	return {
		session: await event.locals.auth(),
		authConfigured: isGoogleAuthConfigured()
	};
};
