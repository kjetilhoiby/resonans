import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import { readBodyProfile } from '$lib/server/health/body-profile';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await ensureUser(locals.userId);

	// Kroppsprofilen er med her fordi en manglende profil ellers er *stille*: uten
	// høyde, kjønn og alder faller energibalansen tilbake på Withings' eget tall, og
	// flaten ser like ferdig ut. Oversikten skal si at noe mangler.
	const [user, bodyProfile] = await Promise.all([
		db.query.users.findFirst({ where: eq(users.id, locals.userId) }),
		readBodyProfile(locals.userId)
	]);

	return {
		user: user || null,
		bodyProfileComplete: bodyProfile.complete
	};
};
