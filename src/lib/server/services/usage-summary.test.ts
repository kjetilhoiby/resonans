import { describe, it, expect } from 'vitest';
import { normalizePath, countSessions, summarizeUsage } from './usage-summary';
import type { UsageEventRow } from './usage-summary';

function event(
	createdAt: string,
	path: string | null = '/',
	eventType = 'page_view',
	metadata: Record<string, unknown> | null = null
): UsageEventRow {
	return { eventType, path, metadata, createdAt: new Date(createdAt) };
}

describe('normalizePath', () => {
	it('beholder statiske stier', () => {
		expect(normalizePath('/ukeplan')).toBe('/ukeplan');
		expect(normalizePath('/')).toBe('/');
	});

	it('erstatter UUID-segmenter med [id]', () => {
		expect(normalizePath('/tema/3f2a1b4c-1234-4abc-9def-001122334455')).toBe('/tema/[id]');
	});

	it('erstatter lange tokens og tall med [id]', () => {
		expect(normalizePath('/live/aBc123xyz456qrs789tuv')).toBe('/live/[id]');
		expect(normalizePath('/samtaler/42')).toBe('/samtaler/[id]');
	});

	it('fjerner query og hash', () => {
		expect(normalizePath('/ukeplan?dag=mandag#topp')).toBe('/ukeplan');
	});
});

describe('countSessions', () => {
	it('gir 0 økter uten hendelser', () => {
		expect(countSessions([])).toBe(0);
	});

	it('teller hendelser innenfor 30 min som én økt', () => {
		expect(
			countSessions([
				new Date('2026-06-09T08:00:00Z'),
				new Date('2026-06-09T08:10:00Z'),
				new Date('2026-06-09T08:25:00Z')
			])
		).toBe(1);
	});

	it('starter ny økt ved gap over 30 min', () => {
		expect(
			countSessions([
				new Date('2026-06-09T08:00:00Z'),
				new Date('2026-06-09T08:45:00Z'),
				new Date('2026-06-09T19:00:00Z')
			])
		).toBe(3);
	});

	it('tåler usortert input', () => {
		expect(
			countSessions([new Date('2026-06-09T19:00:00Z'), new Date('2026-06-09T08:00:00Z')])
		).toBe(2);
	});
});

describe('summarizeUsage', () => {
	it('oppsummerer tom liste', () => {
		const summary = summarizeUsage([]);
		expect(summary.totalEvents).toBe(0);
		expect(summary.activeDays).toBe(0);
		expect(summary.sessions).toBe(0);
		expect(summary.totalAttentionMs).toBe(0);
		expect(summary.byPath).toEqual([]);
		expect(summary.topInteractions).toEqual([]);
	});

	it('teller dager i Oslo-tid, ikke UTC', () => {
		// 23:30 UTC 8. juni = 01:30 Oslo-tid 9. juni (sommertid)
		const summary = summarizeUsage([event('2026-06-08T23:30:00Z')]);
		expect(summary.byDay).toEqual({ '2026-06-09': { events: 1, attentionMs: 0 } });
	});

	it('grupperer like sider med normaliserte stier', () => {
		const summary = summarizeUsage([
			event('2026-06-09T08:00:00Z', '/tema/3f2a1b4c-1234-4abc-9def-001122334455'),
			event('2026-06-09T09:00:00Z', '/tema/aaaa1b4c-1234-4abc-9def-001122334455'),
			event('2026-06-09T10:00:00Z', '/ukeplan')
		]);
		expect(summary.byPath).toEqual([
			{ path: '/tema/[id]', views: 2, attentionMs: 0, lastSeen: '2026-06-09T09:00:00.000Z' },
			{ path: '/ukeplan', views: 1, attentionMs: 0, lastSeen: '2026-06-09T10:00:00.000Z' }
		]);
	});

	it('summerer oppmerksomhetstid per side og dag, og sorterer etter tid', () => {
		const summary = summarizeUsage([
			event('2026-06-09T08:00:00Z', '/ukeplan'),
			event('2026-06-09T08:05:00Z', '/ukeplan', 'attention', { durationMs: 45_000 }),
			event('2026-06-09T08:06:00Z', '/'),
			event('2026-06-09T08:10:00Z', '/', 'attention', { durationMs: 10_000 })
		]);
		expect(summary.totalAttentionMs).toBe(55_000);
		expect(summary.byDay['2026-06-09']).toEqual({ events: 4, attentionMs: 55_000 });
		expect(summary.byPath[0]).toMatchObject({ path: '/ukeplan', views: 1, attentionMs: 45_000 });
		expect(summary.byPath[1]).toMatchObject({ path: '/', views: 1, attentionMs: 10_000 });
	});

	it('teller interaksjoner per label, sortert etter antall', () => {
		const summary = summarizeUsage([
			event('2026-06-09T08:00:00Z', '/', 'interaction', { label: 'sjekkliste-toggle' }),
			event('2026-06-09T08:01:00Z', '/', 'interaction', { label: 'sjekkliste-toggle' }),
			event('2026-06-09T08:02:00Z', '/', 'interaction', { label: 'Åpne chat' })
		]);
		expect(summary.topInteractions).toEqual([
			{ label: 'sjekkliste-toggle', count: 2 },
			{ label: 'Åpne chat', count: 1 }
		]);
	});

	it('holder app_resume utenfor sidestatistikken men med i økt-telling', () => {
		const summary = summarizeUsage([
			event('2026-06-09T08:00:00Z', '/'),
			event('2026-06-09T12:00:00Z', '/', 'app_resume')
		]);
		expect(summary.byPath).toEqual([
			{ path: '/', views: 1, attentionMs: 0, lastSeen: '2026-06-09T08:00:00.000Z' }
		]);
		expect(summary.sessions).toBe(2);
		expect(summary.totalEvents).toBe(2);
	});

	it('fordeler på time i døgnet i Oslo-tid', () => {
		// 06:00 UTC = 08:00 Oslo-tid (sommertid)
		const summary = summarizeUsage([event('2026-06-09T06:00:00Z')]);
		expect(summary.byHour).toEqual({ 8: 1 });
	});
});
