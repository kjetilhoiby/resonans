// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { DefaultSession } from '@auth/sveltekit';
import type { ApiSecretAuthContext } from '$lib/server/api-secrets';

declare global {
	namespace App {
		interface Error {
			message: string;
			/**
			 * Kort id som også står i serverloggen (`[500] id=…`), slik at en
			 * skjermdump kan kobles til loggraden. Se `hooks.server.ts`.
			 */
			errorId?: string;
		}
		interface Locals {
			userId: string;
			apiSecretAuth?: ApiSecretAuthContext;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module '@auth/sveltekit' {
	interface Session {
		user: DefaultSession['user'] & {
			id: string;
		};
	}
}

declare module '@auth/core/jwt' {
	interface JWT {
		userId?: string;
	}
}

export {};
