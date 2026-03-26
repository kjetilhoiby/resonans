import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const ERROR_MESSAGES: Record<string, string> = {
	InviteOnly: 'Denne appen er invite-only. Kontoen din er ikke gitt tilgang ennå.',
	EmailNotVerified: 'Google-kontoen må ha en verifisert e-postadresse.',
	AuthNotConfigured: 'Google-innlogging er ikke konfigurert i miljøet ennå.',
	AccessDenied: 'Innloggingen ble avvist.'
};

function sanitizeNextPath(value: string | null) {
	if (!value || !value.startsWith('/')) {
		return '/';
	}

	return value;
}

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth();
	const next = sanitizeNextPath(event.url.searchParams.get('next'));

	if (session?.user) {
		throw redirect(303, next);
	}

	const error = event.url.searchParams.get('error');

	return {
		next,
		errorMessage: error ? (ERROR_MESSAGES[error] || 'Innloggingen mislyktes.') : null
	};
};
