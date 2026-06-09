import { describe, it, expect } from 'vitest';
import { parseUsagePayload } from './usage-events';

const NOW = new Date('2026-06-09T12:00:00Z');

describe('parseUsagePayload', () => {
	it('godtar én enkelt hendelse uten events-array', () => {
		const parsed = parseUsagePayload({ type: 'page_view', path: '/ukeplan' }, NOW);
		expect(parsed).toEqual([
			{ eventType: 'page_view', path: '/ukeplan', metadata: null, createdAt: null }
		]);
	});

	it('godtar batch med events-array', () => {
		const parsed = parseUsagePayload(
			{
				events: [
					{ type: 'page_view', path: '/' },
					{ type: 'app_resume', path: '/' }
				]
			},
			NOW
		);
		expect(parsed).toHaveLength(2);
	});

	it('dropper ukjente hendelsestyper og søppel', () => {
		const parsed = parseUsagePayload(
			{ events: [{ type: 'hacking' }, null, 42, { path: '/' }] },
			NOW
		);
		expect(parsed).toEqual([]);
	});

	it('krever positiv durationMs for attention og klamper mot tak', () => {
		const parsed = parseUsagePayload(
			{
				events: [
					{ type: 'attention', path: '/', metadata: { durationMs: 45_000 } },
					{ type: 'attention', path: '/', metadata: { durationMs: -5 } },
					{ type: 'attention', path: '/', metadata: { durationMs: 99 * 60 * 60 * 1000 } },
					{ type: 'attention', path: '/' }
				]
			},
			NOW
		);
		expect(parsed).toHaveLength(2);
		expect(parsed[0].metadata).toEqual({ durationMs: 45_000 });
		expect(parsed[1].metadata).toEqual({ durationMs: 6 * 60 * 60 * 1000 });
	});

	it('krever label for interaction og kutter lange verdier', () => {
		const parsed = parseUsagePayload(
			{
				events: [
					{ type: 'interaction', path: '/', metadata: { label: 'x'.repeat(200), tag: 'button' } },
					{ type: 'interaction', path: '/', metadata: {} }
				]
			},
			NOW
		);
		expect(parsed).toHaveLength(1);
		expect((parsed[0].metadata?.label as string).length).toBe(120);
		expect(parsed[0].metadata?.tag).toBe('button');
	});

	it('godtar ferske klient-tidsstempler og avviser gamle eller fremtidige', () => {
		const parsed = parseUsagePayload(
			{
				events: [
					{ type: 'page_view', path: '/', at: '2026-06-09T11:59:30Z' },
					{ type: 'page_view', path: '/', at: '2026-06-01T00:00:00Z' },
					{ type: 'page_view', path: '/', at: '2026-06-09T13:00:00Z' },
					{ type: 'page_view', path: '/', at: 'ikke-en-dato' }
				]
			},
			NOW
		);
		expect(parsed[0].createdAt).toEqual(new Date('2026-06-09T11:59:30Z'));
		expect(parsed[1].createdAt).toBeNull();
		expect(parsed[2].createdAt).toBeNull();
		expect(parsed[3].createdAt).toBeNull();
	});

	it('begrenser batch-størrelse til 100', () => {
		const events = Array.from({ length: 150 }, () => ({ type: 'page_view', path: '/' }));
		expect(parseUsagePayload({ events }, NOW)).toHaveLength(100);
	});

	it('kutter lange stier til 500 tegn', () => {
		const parsed = parseUsagePayload({ type: 'page_view', path: '/' + 'a'.repeat(600) }, NOW);
		expect(parsed[0].path?.length).toBe(500);
	});
});
