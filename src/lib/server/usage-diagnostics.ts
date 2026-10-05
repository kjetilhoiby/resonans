import { inArray, sql } from 'drizzle-orm';
import { db, rowsOf } from '$lib/db';
import { themes } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import {
	buildPublicUsage,
	isUuid,
	themeNameFromSlug,
	themeSegmentOf,
	type ChatDayRow,
	type PublicUsage,
	type UsageDayHourRow,
	type UsageInteractionRow,
	type UsagePathDayRow,
	type UsageSessionRow,
	type UsageWindow
} from '$lib/domain/usage-public';

/**
 * Datainnhentingen bak `/api/diagnostikk/bruk`. Utvelgelsen bor i
 * `$lib/domain/usage-public.ts` — her er det bare spørringene.
 *
 * **Aggregeres i SQL.** `usage_events` vokser med hvert klikk, og et åpent
 * endepunkt skal ikke hente rå rader inn i prosessen. Spørringene grupperer
 * på (dag, time), (sti, dag) og (sti, etikett), og hver av dem har et
 * radtak; treffes taket, sier `truncated` det.
 *
 * **Kolonnene velges eksplisitt.** `metadata` leses bare som de to feltene
 * som trengs (`durationMs`, `label`/`tag`), og `messages.content` røres
 * aldri — det er telling, ikke lesing. Samme to-skanser-regel som
 * `$lib/server/diagnostics.ts`.
 *
 * Tidsstemplene er `timestamp` uten sone, skrevet i UTC. Oslo-dag og -time
 * regnes derfor med `AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Oslo'` — én
 * `AT TIME ZONE` alene ville tolket UTC-verdien som Oslo-tid.
 *
 * Vindusgrensa sendes som ISO-STRENG, ikke `Date`: drizzle setter
 * dato-serializerne på sin klient til identiteten (se CLAUDE.md, «Del ALDRI
 * en postgres-js-klient …»).
 */

const MAX_PATH_DAY_ROWS = 20_000;
const MAX_INTERACTION_ROWS = 5_000;
const MAX_CHAT_ROWS = 20_000;
const MAX_THEME_LOOKUPS = 500;

const OSLO = sql.raw(`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Oslo'`);

function num(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? n : 0;
}

export async function loadPublicUsage(window: UsageWindow): Promise<PublicUsage> {
	const since = sql`(${new Date(window.fromMs).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
	// Ingen øvre grense: vinduet slutter alltid «nå», og klienten kan stemple en
	// hendelse inntil 5 min fram i tid (`MAX_CLOCK_SKEW_MS` i usage-events.ts).
	// En `<= nå` ville droppet nettopp de ferskeste radene — samme felle som
	// `NOW_SLACK_MS` i diagnostics.ts.
	const inWindow = sql`created_at >= ${since}`;
	const durationMs = sql`CASE WHEN event_type = 'attention' AND jsonb_typeof(metadata->'durationMs') = 'number'
		THEN (metadata->>'durationMs')::numeric ELSE 0 END`;
	const cleanPath = sql`split_part(split_part(path, '?', 1), '#', 1)`;

	const [userRows, dayHourResult, sessionResult, pathDayResult, interactionResult, chatResult, chatUserResult] =
		await Promise.all([
			db.execute(sql`SELECT count(DISTINCT user_id) AS n FROM usage_events WHERE ${inWindow}`),
			db.execute(sql`
				SELECT
					to_char(created_at ${OSLO}, 'YYYY-MM-DD') AS day,
					extract(hour FROM created_at ${OSLO})::int AS hour,
					count(*) AS events,
					count(*) FILTER (WHERE event_type = 'page_view') AS page_views,
					coalesce(sum(${durationMs}), 0) AS attention_ms,
					count(*) FILTER (WHERE event_type = 'app_resume') AS app_resumes,
					count(*) FILTER (WHERE event_type = 'interaction') AS interactions
				FROM usage_events
				WHERE ${inWindow}
				GROUP BY 1, 2
			`),
			// Økter: ny økt når det har gått mer enn 30 min siden brukerens forrige
			// hendelse — samme regel som `countSessions`, men per bruker.
			db.execute(sql`
				WITH ev AS (
					SELECT created_at,
						lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS prev
					FROM usage_events
					WHERE ${inWindow}
				)
				SELECT to_char(created_at ${OSLO}, 'YYYY-MM-DD') AS day, count(*) AS sessions
				FROM ev
				WHERE prev IS NULL OR created_at - prev > interval '30 minutes'
				GROUP BY 1
			`),
			db.execute(sql`
				SELECT
					${cleanPath} AS path,
					to_char(created_at ${OSLO}, 'YYYY-MM-DD') AS day,
					count(*) FILTER (WHERE event_type = 'page_view') AS page_views,
					coalesce(sum(${durationMs}), 0) AS attention_ms
				FROM usage_events
				WHERE ${inWindow} AND path IS NOT NULL AND event_type IN ('page_view', 'attention')
				GROUP BY 1, 2
				LIMIT ${sql.raw(String(MAX_PATH_DAY_ROWS + 1))}
			`),
			db.execute(sql`
				SELECT
					${cleanPath} AS path,
					metadata->>'label' AS label,
					metadata->>'tag' AS tag,
					count(*) AS n
				FROM usage_events
				WHERE ${inWindow} AND path IS NOT NULL AND event_type = 'interaction'
				GROUP BY 1, 2, 3
				ORDER BY 4 DESC
				LIMIT ${sql.raw(String(MAX_INTERACTION_ROWS + 1))}
			`),
			// Bare TELLING av brukermeldinger. `content` er ikke i spørringen.
			db.execute(sql`
				SELECT
					to_char(m.created_at ${OSLO}, 'YYYY-MM-DD') AS day,
					c.source AS source,
					c.theme_id AS theme_id,
					coalesce(c.metadata->>'canonical', '') = 'true' AS canonical,
					count(*) AS user_messages,
					count(DISTINCT m.conversation_id) AS conversations
				FROM messages m
				JOIN conversations c ON c.id = m.conversation_id
				WHERE m.role = 'user' AND m.created_at >= ${since}
				GROUP BY 1, 2, 3, 4
				LIMIT ${sql.raw(String(MAX_CHAT_ROWS + 1))}
			`),
			db.execute(sql`
				SELECT count(DISTINCT c.user_id) AS n
				FROM messages m
				JOIN conversations c ON c.id = m.conversation_id
				WHERE m.role = 'user' AND m.created_at >= ${since}
			`)
		]);

	const dayHourRows: UsageDayHourRow[] = rowsOf<Record<string, unknown>>(dayHourResult).map((r) => ({
		day: String(r.day),
		hour: num(r.hour),
		events: num(r.events),
		pageViews: num(r.page_views),
		attentionMs: num(r.attention_ms),
		appResumes: num(r.app_resumes),
		interactions: num(r.interactions)
	}));
	const sessionRows: UsageSessionRow[] = rowsOf<Record<string, unknown>>(sessionResult).map((r) => ({
		day: String(r.day),
		sessions: num(r.sessions)
	}));

	const rawPathRows = rowsOf<Record<string, unknown>>(pathDayResult);
	const pathDayRows: UsagePathDayRow[] = rawPathRows.slice(0, MAX_PATH_DAY_ROWS).map((r) => ({
		path: String(r.path ?? ''),
		day: String(r.day),
		pageViews: num(r.page_views),
		attentionMs: num(r.attention_ms)
	}));

	const rawInteractionRows = rowsOf<Record<string, unknown>>(interactionResult);
	const interactionRows: UsageInteractionRow[] = rawInteractionRows.slice(0, MAX_INTERACTION_ROWS).map((r) => ({
		path: String(r.path ?? ''),
		label: typeof r.label === 'string' ? r.label : null,
		tag: typeof r.tag === 'string' ? r.tag : null,
		count: num(r.n)
	}));

	const rawChatRows = rowsOf<Record<string, unknown>>(chatResult);
	const chatRows: ChatDayRow[] = rawChatRows.slice(0, MAX_CHAT_ROWS).map((r) => ({
		day: String(r.day),
		source: typeof r.source === 'string' ? r.source : null,
		themeId: typeof r.theme_id === 'string' ? r.theme_id.toLowerCase() : null,
		canonical: r.canonical === true,
		userMessages: num(r.user_messages),
		conversations: num(r.conversations)
	}));

	const themeKinds = await loadThemeKinds(
		pathDayRows.map((r) => themeSegmentOf(r.path)),
		chatRows.map((r) => r.themeId)
	);

	return buildPublicUsage({
		window,
		userCount: num(rowsOf<Record<string, unknown>>(userRows)[0]?.n),
		dayHourRows,
		sessionRows,
		pathDayRows,
		interactionRows,
		chatRows,
		chatUserCount: num(rowsOf<Record<string, unknown>>(chatUserResult)[0]?.n),
		themeKinds,
		truncated: {
			paths: rawPathRows.length > MAX_PATH_DAY_ROWS,
			interactions: rawInteractionRows.length > MAX_INTERACTION_ROWS,
			chat: rawChatRows.length > MAX_CHAT_ROWS
		}
	});
}

/**
 * Temasegment/tema-id → dashboardtype. Navnet leses her og forlater aldri
 * funksjonen: det som returneres er typen (`training`, …) eller `none`.
 *
 * Et navn-segment (`/tema/helse`) slås opp slik sideruta gjør det — stor
 * forbokstav, eksakt navn — så typen blir den samme som siden viste. Et tema
 * som ikke finnes (slettet, eller en adresse som ga 404) får ingen nøkkel og
 * blir `ukjent` i domenelaget.
 */
async function loadThemeKinds(
	segments: Array<string | null>,
	themeIds: Array<string | null>
): Promise<Map<string, string>> {
	const ids = new Set<string>();
	const slugs = new Set<string>();
	for (const segment of segments) {
		if (!segment) continue;
		if (isUuid(segment)) ids.add(segment);
		else slugs.add(segment);
	}
	for (const id of themeIds) if (id && isUuid(id)) ids.add(id);

	const idList = [...ids].slice(0, MAX_THEME_LOOKUPS);
	const slugList = [...slugs].slice(0, MAX_THEME_LOOKUPS);
	const nameBySlug = new Map(slugList.map((slug) => [themeNameFromSlug(slug), slug]));

	const [byId, byName] = await Promise.all([
		idList.length > 0
			? db.select({ id: themes.id, name: themes.name }).from(themes).where(inArray(themes.id, idList))
			: Promise.resolve([]),
		nameBySlug.size > 0
			? db.select({ name: themes.name }).from(themes).where(inArray(themes.name, [...nameBySlug.keys()]))
			: Promise.resolve([])
	]);

	const kinds = new Map<string, string>();
	for (const row of byId) kinds.set(row.id.toLowerCase(), resolveThemeDashboardKind(row.name) ?? 'none');
	for (const row of byName) {
		const slug = nameBySlug.get(row.name);
		if (slug) kinds.set(slug, resolveThemeDashboardKind(row.name) ?? 'none');
	}
	return kinds;
}
