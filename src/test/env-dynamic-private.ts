// Stub for SvelteKit's $env/dynamic/private virtual module, used in vitest
// (which doesn't run the SvelteKit plugin). Exposes process.env as `env`.
export const env = process.env as Record<string, string | undefined>;
