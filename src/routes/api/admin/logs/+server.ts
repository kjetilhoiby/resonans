import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/admin-auth';
import { readCapturedLogs, type LogLevel } from '$lib/server/log-buffer';

/**
 * GET /api/admin/logs?grep=chat-perf&limit=100&level=error
 *
 * Leser prosessens logg-ringbuffer (se log-buffer.ts). Admin-gatet fordi
 * logglinjer kan inneholde hva som helst; virker med session, med
 * `x-resonans-user-id` + `x-resonans-secret`, og med API-secret
 * (`Authorization: Bearer rsn_…` fra /settings/external-apps) — det siste er
 * veien for en Claude-økt som følger opp en deploy uten Coolify-tilgang.
 *
 * Svaret er per INSTANS (den Traefik ruter til) og flyktig (tømmes ved
 * restart) — `instanceStartedAt` sier hvem og hvor lenge.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const levelParam = url.searchParams.get('level');
	const level: LogLevel | undefined =
		levelParam === 'log' || levelParam === 'info' || levelParam === 'warn' || levelParam === 'error'
			? levelParam
			: undefined;

	const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);

	const result = readCapturedLogs({
		grep: url.searchParams.get('grep') ?? undefined,
		level,
		limit: Number.isFinite(limitRaw) ? limitRaw : undefined
	});

	return json(result);
};
