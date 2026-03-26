import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { isEmailAllowed, touchAllowedEmail } from '$lib/server/auth-allowlist';
import { getGoogleAuthConfig, isGoogleAuthConfigured } from '$lib/server/auth-config';
import { canBootstrapFirstAdmin, hasExistingGoogleAccess, syncGoogleUser } from '$lib/server/auth-users';

export const { handle, signIn, signOut } = SvelteKitAuth(async () => {
	const authConfig = getGoogleAuthConfig();
	const authEnabled = isGoogleAuthConfigured();

	return {
		trustHost: true,
		secret: authConfig.secret,
		providers: authEnabled
			? [
					Google({
						clientId: authConfig.clientId!,
						clientSecret: authConfig.clientSecret!
					})
			  ]
			: [],
		session: {
			strategy: 'jwt'
		},
		pages: {
			signIn: '/auth',
			error: '/auth'
		},
		callbacks: {
			async signIn({ account, profile }) {
				if (!authEnabled) {
					return '/auth?error=AuthNotConfigured';
				}

				if (account?.provider !== 'google') {
					return false;
				}

				const email = typeof profile?.email === 'string' ? profile.email : null;
				const emailVerified = Boolean(profile?.email_verified);
				const providerAccountId = typeof profile?.sub === 'string' ? profile.sub : null;

				if (!email || !emailVerified || !providerAccountId) {
					return '/auth?error=EmailNotVerified';
				}

				if (await hasExistingGoogleAccess({
					provider: 'google',
					providerAccountId,
					email
				})) {
					await touchAllowedEmail(email);
					return true;
				}

				if (await isEmailAllowed(email)) {
					await touchAllowedEmail(email);
					return true;
				}

				if (!(await canBootstrapFirstAdmin())) {
					return '/auth?error=InviteOnly';
				}

				return true;
			},
			async jwt({ token, account, profile }) {
				if (account?.provider === 'google') {
					const email = typeof profile?.email === 'string' ? profile.email : null;
					const providerAccountId = profile?.sub;

					if (email && typeof providerAccountId === 'string') {
						const user = await syncGoogleUser({
							provider: 'google',
							providerAccountId,
							email,
							emailVerified: Boolean(profile?.email_verified),
							name: typeof profile?.name === 'string' ? profile.name : null,
							image: typeof profile?.picture === 'string' ? profile.picture : null
						});

						token.userId = user.id;
						token.email = user.email;
						token.name = user.name;
					}
				}

				return token;
			},
			async session({ session, token }) {
				if (session.user && token.userId) {
					session.user.id = token.userId;
				}

				return session;
			}
		}
	};
});
