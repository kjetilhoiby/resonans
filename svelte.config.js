import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Adapteren velges av miljøet, og BEGGE beholdes med vilje.
 *
 * Flyttingen fra Vercel til egen plattform er sekvensert slik at Vercel står som
 * fallback til den nye stacken er verifisert. Da må samme `main` kunne bygges
 * begge steder — ellers finnes rullbacken bare på papiret, og «kjør parallelt»
 * blir «velg én og håp».
 *
 * `VERCEL=1` settes av Vercel selv, så ingen variabel må huskes der.
 * `DEPLOY_TARGET` overstyrer for hånd (`vercel` eller `node`).
 */
const target = process.env.DEPLOY_TARGET ?? (process.env.VERCEL ? 'vercel' : 'node');

if (!['vercel', 'node'].includes(target)) {
	throw new Error(`DEPLOY_TARGET="${target}" er ukjent. Gyldige verdier: vercel, node.`);
}

console.log(`[svelte.config] adapter=${target}`);

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
		adapter: target === 'vercel' ? adapterVercel({ runtime: 'nodejs22.x' }) : adapterNode(),
		version: {
			// Poll _app/version.json så `updated` (i $app/state) oppdager nye deploys
			// i kjørende økter — rotlayouten gjør full reload ved neste navigasjon.
			pollInterval: 60_000
		}
	}
};

export default config;
