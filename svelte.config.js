import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	compilerOptions: {
		warningFilter: (w) => {
			if (w.code === 'state_referenced_locally') return false;
			if (w.code === 'css_unused_selector') return false;
			return true;
		}
	},

	kit: {
		adapter: adapter(),
		// Gjenskapt i hooks.server.ts (`csrfHandle`, `$lib/server/csrf.ts`) med unntak
		// for OAuth-token-endepunktet, som må ta imot skjema-POST fra Claude og
		// ChatGPT uten Origin-header. SvelteKits egen sjekk kan ikke unntas per rute.
		csrf: { checkOrigin: false },
		version: {
			// Poll _app/version.json så `updated` (i $app/state) oppdager nye deploys
			// i kjørende økter — rotlayouten gjør full reload ved neste navigasjon.
			pollInterval: 60_000
		}
	}
};

export default config;
