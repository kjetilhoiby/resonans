import { describe, expect, it } from 'vitest';
import { FRESH_MS, MAX_STALE_MS, ogCacheDecision } from './live-og-cache';

describe('ogCacheDecision', () => {
	const now = 1_000_000_000;

	it('tegner når det ikke finnes noe bilde', () => {
		expect(ogCacheDecision(undefined, now, null)).toBe('miss');
	});

	it('leverer et ferskt bilde uten videre', () => {
		expect(ogCacheDecision({ renderedAt: now - FRESH_MS + 1 }, now, null)).toBe('fresh');
	});

	it('leverer et litt gammelt bilde med det samme og fornyer i bakgrunnen', () => {
		expect(ogCacheDecision({ renderedAt: now - FRESH_MS - 1 }, now, null)).toBe('stale');
	});

	it('tegner på nytt før svar når bildet er for gammelt', () => {
		expect(ogCacheDecision({ renderedAt: now - MAX_STALE_MS - 1 }, now, null)).toBe('miss');
	});

	it('en avsluttet tur: bildet tegnet før slutten er feil, etter slutten for alltid riktig', () => {
		const endedAt = now - 10 * MAX_STALE_MS;
		expect(ogCacheDecision({ renderedAt: endedAt - 1 }, now, endedAt)).toBe('miss');
		expect(ogCacheDecision({ renderedAt: endedAt + 1 }, now, endedAt)).toBe('fresh');
	});
});
