import { env } from '$env/dynamic/private';

export function getGoogleAuthConfig() {
	return {
		secret: env.AUTH_SECRET,
		clientId: env.AUTH_GOOGLE_ID || env.GOOGLE_CLIENT_ID,
		clientSecret: env.AUTH_GOOGLE_SECRET || env.GOOGLE_CLIENT_SECRET,
		allowedEmails: env.AUTH_ALLOWED_EMAILS || ''
	};
}

export function isGoogleAuthConfigured() {
	const config = getGoogleAuthConfig();
	return Boolean(config.secret && config.clientId && config.clientSecret);
}

export function getAllowedEmailsFromEnv() {
	const { allowedEmails } = getGoogleAuthConfig();
	return allowedEmails
		.split(',')
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean);
}
