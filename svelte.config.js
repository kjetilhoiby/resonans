import adapter from '@sveltejs/adapter-vercel';
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
		adapter: adapter({
			runtime: 'nodejs22.x'
		}),
		version: {
			// Poll _app/version.json så `updated` (i $app/state) oppdager nye deploys
			// i kjørende økter — rotlayouten gjør full reload ved neste navigasjon.
			pollInterval: 60_000
		}
	}
};

export default config;
