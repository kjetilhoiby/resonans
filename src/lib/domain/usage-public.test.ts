import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	DEFAULT_USAGE_DAYS,
	MAX_USAGE_DAYS,
	PAGE_ROUTE_PATTERNS,
	USAGE_NOTE,
	buildPublicUsage,
	daysInWindow,
	resolveUsageWindow,
	themeNameFromSlug,
	themeSegmentOf,
	toPublicChatSource,
	toPublicConversationKind,
	toPublicInteractionLabel,
	toPublicPathPattern,
	toPublicTag,
	toPublicThemeKind,
	type PublicUsageInput
} from './usage-public';

const NOW = new Date('2026-10-05T10:00:00Z');
const THEME_ID = '3f2a1b4c-1111-4222-8333-444455556666';
const OTHER_THEME_ID = '9e8d7c6b-aaaa-4bbb-8ccc-ddddeeeeffff';

describe('resolveUsageWindow', () => {
	it('bruker 30 dager som standard', () => {
		const w = resolveUsageWindow(null, NOW);
		expect(w.days).toBe(DEFAULT_USAGE_DAYS);
		expect(w.toMs - w.fromMs).toBe(30 * 86_400_000);
		expect(w.clamped).toBe(false);
	});

	it('kapper på 180 dager og sier fra', () => {
		const w = resolveUsageWindow('9999', NOW);
		expect(w.days).toBe(MAX_USAGE_DAYS);
		expect(w.clamped).toBe(true);
	});

	it('faller til standarden på tull framfor å kaste', () => {
		expect(resolveUsageWindow('abc', NOW).days).toBe(DEFAULT_USAGE_DAYS);
		expect(resolveUsageWindow('-4', NOW).days).toBe(DEFAULT_USAGE_DAYS);
		expect(resolveUsageWindow('0', NOW).days).toBe(DEFAULT_USAGE_DAYS);
		expect(resolveUsageWindow('7', NOW).days).toBe(7);
	});
});

describe('toPublicPathPattern', () => {
	it('gir rutemønsteret for en kjent side', () => {
		expect(toPublicPathPattern('/')).toBe('/');
		expect(toPublicPathPattern('/ukeplan')).toBe('/ukeplan');
		expect(toPublicPathPattern(`/tema/${THEME_ID}`)).toBe('/tema/[id]');
		expect(toPublicPathPattern('/settings/sources')).toBe('/settings/sources');
	});

	it('kollapser et temanavn i adressen like mye som en uuid', () => {
		expect(toPublicPathPattern('/tema/helse')).toBe('/tema/[id]');
		expect(toPublicPathPattern('/tema/Skilsmisse%20og%20sånt')).toBe('/tema/[id]');
	});

	it('kaster spørrestreng og hash', () => {
		expect(toPublicPathPattern('/ukeplan?dag=2026-10-05&q=tannlege')).toBe('/ukeplan');
		expect(toPublicPathPattern(`/tema/${THEME_ID}?workout=abc#notat`)).toBe('/tema/[id]');
	});

	it('fjerner matcheren fra mønsteret, og respekterer den', () => {
		expect(toPublicPathPattern(`/helse/sykdom/${THEME_ID}`)).toBe('/helse/sykdom/[id]');
		// Ikke en uuid → matcher ikke ruta → fallback kollapser segmentet
		expect(toPublicPathPattern('/helse/sykdom/influensa-i-mars')).toBe('/helse/sykdom/[param]');
	});

	it('foretrekker et statisk segment framfor en parameter', () => {
		expect(toPublicPathPattern('/treningsprogram/ny')).toBe('/treningsprogram/ny');
		expect(toPublicPathPattern('/treningsprogram/123')).toBe('/treningsprogram/[id]');
		expect(toPublicPathPattern('/economics/abc/salary-month')).toBe('/economics/[accountId]/salary-month');
		expect(toPublicPathPattern('/economics/abc/oversikt')).toBe('/economics/[accountId]/[tab]');
		expect(toPublicPathPattern(`/skriv/${THEME_ID}`)).toBe('/skriv/[id]');
	});

	it('kollapser tokens i delingslenker', () => {
		expect(toPublicPathPattern('/share/hemmelig-token-123')).toBe('/share/[token]');
		expect(toPublicPathPattern('/partner-invite/abcDEF')).toBe('/partner-invite/[token]');
	});

	it('beholder bare kjente statiske segmenter på en ukjent sti', () => {
		expect(toPublicPathPattern('/settings/ola-nordmann')).toBe('/settings/[param]');
		expect(toPublicPathPattern('/kjetils-hemmelige-side')).toBe('/[param]');
		expect(toPublicPathPattern('/plan/mal/ekstra/noe')).toBe('/plan/mal/[param]/[param]');
	});

	it('kapper dybden på en ukjent sti', () => {
		const deep = '/' + Array.from({ length: 20 }, (_, i) => `s${i}`).join('/');
		expect(toPublicPathPattern(deep)).toBe('/' + Array(8).fill('[param]').join('/') + '/…');
	});

	it('tåler tom og manglende sti', () => {
		expect(toPublicPathPattern('')).toBe('/');
		expect(toPublicPathPattern(null)).toBe('/');
		expect(toPublicPathPattern('/?x=1')).toBe('/');
	});
});

describe('PAGE_ROUTE_PATTERNS', () => {
	// Drift-vakt: lista er sjekket inn (en glob ville dratt alle sidene inn i
	// endepunktets modulgraf). Mangler en side her, kollapses besøkene til
	// [param] — trygt, men statistikken blir dårligere. Derfor feiler testen.
	it('er nøyaktig sidene i src/routes', () => {
		const routesDir = fileURLToPath(new URL('../../routes', import.meta.url));
		const found: string[] = [];
		const walk = (dir: string, prefix: string) => {
			for (const name of readdirSync(dir)) {
				const full = join(dir, name);
				if (statSync(full).isDirectory()) {
					if (prefix === '' && name === 'api') continue;
					// Rutegrupper «(navn)» bidrar ikke til stien
					const segment = /^\(.*\)$/.test(name) ? '' : `/${name}`;
					walk(full, prefix + segment);
				} else if (name === '+page.svelte') {
					found.push(prefix === '' ? '/' : prefix);
				}
			}
		};
		walk(routesDir, '');
		const listed = new Set(PAGE_ROUTE_PATTERNS);
		const onDisk = new Set(found);
		const missing = [...onDisk].filter((p) => !listed.has(p)).sort();
		const stale = [...listed].filter((p) => !onDisk.has(p)).sort();
		expect({ leggTilIPageRoutePatterns: missing, fjernFraPageRoutePatterns: stale }).toEqual({
			leggTilIPageRoutePatterns: [],
			fjernFraPageRoutePatterns: []
		});
	});
});

describe('themeSegmentOf', () => {
	it('gir uuid i små bokstaver, og dekoder et navn', () => {
		expect(themeSegmentOf(`/tema/${THEME_ID.toUpperCase()}?x=1`)).toBe(THEME_ID);
		expect(themeSegmentOf('/tema/s%C3%B8vn')).toBe('søvn');
		expect(themeSegmentOf('/tema/helse/kapplister/skriv-ut')).toBe('helse');
	});

	it('gir null utenfor /tema og på ødelagt koding', () => {
		expect(themeSegmentOf('/ukeplan')).toBeNull();
		expect(themeSegmentOf('/tema')).toBeNull();
		expect(themeSegmentOf('/tema/%E0%A4%A')).toBeNull();
	});

	it('navnet slås opp med stor forbokstav, som sideruta gjør', () => {
		expect(themeNameFromSlug('helse')).toBe('Helse');
	});
});

describe('toPublicThemeKind', () => {
	it('slipper gjennom kjente typer og none', () => {
		expect(toPublicThemeKind('training')).toBe('training');
		expect(toPublicThemeKind('none')).toBe('none');
	});

	it('alt annet blir ukjent — også et temanavn som har sneket seg inn', () => {
		expect(toPublicThemeKind('Skilsmisse')).toBe('ukjent');
		expect(toPublicThemeKind('toString')).toBe('ukjent');
		expect(toPublicThemeKind(undefined)).toBe('ukjent');
	});
});

describe('toPublicInteractionLabel', () => {
	it('slipper gjennom data-track-formen', () => {
		expect(toPublicInteractionLabel('tema-oppgaver:slett')).toBe('tema-oppgaver:slett');
		expect(toPublicInteractionLabel('prosjekter:nytt-prosjekt-navn')).toBe('prosjekter:nytt-prosjekt-navn');
		expect(toPublicInteractionLabel('ernæring:logg-måltid')).toBe('ernæring:logg-måltid');
	});

	it('slipper gjennom generiske knappeord, i fast form', () => {
		expect(toPublicInteractionLabel('lagre')).toBe('Lagre');
		expect(toPublicInteractionLabel('  Legg   til ')).toBe('Legg til');
		expect(toPublicInteractionLabel('PRØV IGJEN')).toBe('Prøv igjen');
	});

	it('knappetekst og aria-label med innhold blir anonyme', () => {
		expect(toPublicInteractionLabel('Ring tannlegen')).toBeNull();
		expect(toPublicInteractionLabel('Slett oppgave «kjøpe melk»')).toBeNull();
		expect(toPublicInteractionLabel('✕')).toBeNull();
		expect(toPublicInteractionLabel('input[text]:navn')).toBeNull();
		expect(toPublicInteractionLabel('<div>')).toBeNull();
		// Nesten data-track, men med mellomrom eller store bokstaver
		expect(toPublicInteractionLabel('Tema: Helse')).toBeNull();
		expect(toPublicInteractionLabel('tema:slett ting')).toBeNull();
		expect(toPublicInteractionLabel('a:b:c')).toBeNull();
		expect(toPublicInteractionLabel('')).toBeNull();
		expect(toPublicInteractionLabel(null)).toBeNull();
	});
});

describe('små hvitelister', () => {
	it('tagg, kilde og trådtype har lukkede vokabularer', () => {
		expect(toPublicTag('button')).toBe('button');
		expect(toPublicTag('marquee')).toBe('annet');
		expect(toPublicTag(null)).toBe('annet');
		expect(toPublicChatSource('ekko')).toBe('ekko');
		expect(toPublicChatSource('noe-nytt')).toBe('annet');
		expect(toPublicConversationKind({ canonical: true, themeId: THEME_ID })).toBe('dagbok');
		expect(toPublicConversationKind({ canonical: false, themeId: THEME_ID })).toBe('tema');
		expect(toPublicConversationKind({ canonical: false, themeId: null })).toBe('annen');
	});
});

describe('daysInWindow', () => {
	it('dekker alle Oslo-dager i vinduet', () => {
		const days = daysInWindow(resolveUsageWindow('3', NOW));
		expect(days).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
	});
});

function input(overrides: Partial<PublicUsageInput> = {}): PublicUsageInput {
	return {
		window: resolveUsageWindow('3', NOW),
		userCount: 2,
		dayHourRows: [
			{ day: '2026-10-04', hour: 7, events: 10, pageViews: 4, attentionMs: 120_000, appResumes: 1, interactions: 5 },
			{ day: '2026-10-04', hour: 21, events: 3, pageViews: 2, attentionMs: 60_000, appResumes: 0, interactions: 1 },
			{ day: '2026-10-05', hour: 7, events: 2, pageViews: 1, attentionMs: 0, appResumes: 1, interactions: 0 }
		],
		sessionRows: [
			{ day: '2026-10-04', sessions: 2 },
			{ day: '2026-10-05', sessions: 1 }
		],
		pathDayRows: [
			{ path: `/tema/${THEME_ID}`, day: '2026-10-04', pageViews: 2, attentionMs: 90_000 },
			{ path: '/tema/helse', day: '2026-10-05', pageViews: 1, attentionMs: 0 },
			{ path: '/tema/Hemmelig prosjekt', day: '2026-10-04', pageViews: 1, attentionMs: 0 },
			{ path: '/ukeplan?dag=2026-10-04', day: '2026-10-04', pageViews: 3, attentionMs: 90_000 }
		],
		interactionRows: [
			{ path: '/ukeplan?dag=x', label: 'ukeplan:hak-av', tag: 'button', count: 3 },
			{ path: '/ukeplan', label: 'Ring tannlegen', tag: 'button', count: 2 },
			{ path: `/tema/${THEME_ID}`, label: 'Lagre', tag: 'button', count: 1 }
		],
		chatRows: [
			{ day: '2026-10-04', source: 'web', themeId: THEME_ID, canonical: false, userMessages: 4, conversations: 1 },
			{ day: '2026-10-04', source: 'web', themeId: null, canonical: true, userMessages: 2, conversations: 1 },
			{ day: '2026-10-05', source: 'ekko', themeId: null, canonical: false, userMessages: 1, conversations: 1 }
		],
		chatUserCount: 1,
		themeKinds: new Map([
			[THEME_ID, 'training'],
			['helse', 'health']
		]),
		truncated: { paths: false, interactions: false, chat: false },
		...overrides
	};
}

describe('buildPublicUsage', () => {
	it('summerer dager, timer og økter', () => {
		const out = buildPublicUsage(input());
		expect(out.userCount).toBe(2);
		expect(out.activeDays).toBe(2);
		expect(out.sessions).toBe(3);
		expect(out.pageViews).toBe(7);
		expect(out.appResumes).toBe(2);
		expect(out.totalAttentionMinutes).toBe(3);
		expect(out.byDay.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
		expect(out.byDay[0]).toEqual({
			date: '2026-10-02',
			weekday: 'fre',
			pageViews: 0,
			attentionMinutes: 0,
			sessions: 0,
			appResumes: 0,
			interactions: 0
		});
		expect(out.byHour).toHaveLength(24);
		expect(out.byHour[7]).toEqual({ hour: 7, pageViews: 5, attentionMinutes: 2 });
		const sunday = out.byWeekday.find((w) => w.weekday === 'søn');
		expect(sunday).toEqual({
			weekday: 'søn',
			isoWeekday: 7,
			daysInWindow: 1,
			activeDays: 1,
			pageViews: 6,
			attentionMinutes: 3,
			sessions: 2
		});
	});

	it('gir rutemønstre og tematyper, aldri navn eller id', () => {
		const out = buildPublicUsage(input());
		expect(out.byPath).toEqual([
			{ pattern: '/tema/[id]', views: 4, attentionMinutes: 1.5, distinctDays: 2 },
			{ pattern: '/ukeplan', views: 3, attentionMinutes: 1.5, distinctDays: 1 }
		]);
		expect(out.themeKinds).toEqual([
			{ kind: 'training', views: 2, attentionMinutes: 1.5, distinctDays: 1 },
			{ kind: 'health', views: 1, attentionMinutes: 0, distinctDays: 1 },
			{ kind: 'ukjent', views: 1, attentionMinutes: 0, distinctDays: 1 }
		]);
	});

	it('teller innholdsbærende klikk som anonyme', () => {
		const out = buildPublicUsage(input());
		expect(out.interactions.total).toBe(6);
		expect(out.interactions.anonymous).toBe(2);
		expect(out.interactions.anonymousByTag).toEqual([{ tag: 'button', count: 2 }]);
		expect(out.interactions.top).toEqual([
			{ label: 'ukeplan:hak-av', count: 3 },
			{ label: 'Lagre', count: 1 }
		]);
		expect(out.interactions.byPath).toEqual([
			{ pattern: '/ukeplan', total: 5, anonymous: 2, top: [{ label: 'ukeplan:hak-av', count: 3 }] },
			{ pattern: '/tema/[id]', total: 1, anonymous: 0, top: [{ label: 'Lagre', count: 1 }] }
		]);
	});

	it('teller chat per dag, kilde, trådtype og tematype', () => {
		const { chat } = buildPublicUsage(input());
		expect(chat.userCount).toBe(1);
		expect(chat.userMessages).toBe(7);
		expect(chat.activeDays).toBe(2);
		expect(chat.byDay.find((d) => d.date === '2026-10-04')).toEqual({
			date: '2026-10-04',
			userMessages: 6,
			conversations: 2
		});
		expect(chat.bySource).toEqual([
			{ key: 'web', userMessages: 6, conversationDays: 2 },
			{ key: 'ekko', userMessages: 1, conversationDays: 1 }
		]);
		expect(chat.byConversationKind.map((k) => k.key)).toEqual(['tema', 'dagbok', 'annen']);
		expect(chat.byThemeKind).toEqual([{ key: 'training', userMessages: 4, conversationDays: 1 }]);
	});

	// Selve garantien: ingenting av det rå finnes noe sted i svaret.
	it('lekker ingen rå sti, etikett, temanavn, tema-id eller spørrestreng', () => {
		const text = JSON.stringify(buildPublicUsage(input()));
		for (const secret of [THEME_ID, 'helse', 'Hemmelig', 'Ring tannlegen', 'dag=', '?', 'tannlege']) {
			expect(text).not.toContain(secret);
		}
	});

	it('sier fra om kapping og har alltid forklaringen med', () => {
		const out = buildPublicUsage(input({ truncated: { paths: true, interactions: false, chat: false } }));
		expect(out.truncated).toEqual({ paths: true, interactions: false, chat: false });
		expect(out.note).toBe(USAGE_NOTE);
		expect(out.window.timeZone).toBe('Europe/Oslo');
	});

	it('har nøyaktig de hvitelistede toppnivåfeltene', () => {
		expect(Object.keys(buildPublicUsage(input())).sort()).toEqual([
			'activeDays',
			'appResumes',
			'byDay',
			'byHour',
			'byPath',
			'byWeekday',
			'chat',
			'interactions',
			'note',
			'pageViews',
			'sessions',
			'themeKinds',
			'totalAttentionMinutes',
			'truncated',
			'userCount',
			'window'
		]);
	});

	it('en ukjent tema-id i chatten blir ukjent, ikke id-en', () => {
		const out = buildPublicUsage(
			input({
				chatRows: [
					{ day: '2026-10-04', source: 'web', themeId: OTHER_THEME_ID, canonical: false, userMessages: 1, conversations: 1 }
				]
			})
		);
		expect(out.chat.byThemeKind).toEqual([{ key: 'ukjent', userMessages: 1, conversationDays: 1 }]);
		expect(JSON.stringify(out)).not.toContain(OTHER_THEME_ID);
	});
});
