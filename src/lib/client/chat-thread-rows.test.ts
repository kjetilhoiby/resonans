import { describe, it, expect } from 'vitest';
import {
	threadRowToMessage,
	displayRows,
	oldestCursor,
	dedupePrepend,
	type ThreadRow
} from './chat-thread-rows';
import type { ChatMessage } from './chat-state.svelte';

function row(over: Partial<ThreadRow> = {}): ThreadRow {
	return { id: 'r1', role: 'user', content: 'hei', timestamp: '2026-08-10T10:00:00.000Z', ...over };
}

describe('threadRowToMessage', () => {
	it('beholder DB-id-en som id, så samme rad får samme id hver gang', () => {
		const a = threadRowToMessage(row());
		const b = threadRowToMessage(row());
		expect(a.id).toBe('r1');
		expect(b.id).toBe(a.id);
		expect(a.dbId).toBe('r1');
	});

	it('faller tilbake til en uuid når raden mangler id', () => {
		const m = threadRowToMessage(row({ id: undefined }));
		expect(m.id).toMatch(/[0-9a-f-]{36}/);
		expect(m.dbId).toBeNull();
	});

	it('bærer tidsstempel og bilde videre', () => {
		const m = threadRowToMessage(row({ imageUrl: 'https://x/y.jpg' }));
		expect(m.createdAt).toBe('2026-08-10T10:00:00.000Z');
		expect(m.imageUrl).toBe('https://x/y.jpg');
	});

	it('setter rike felt til null når raden ikke har dem', () => {
		const m = threadRowToMessage(row());
		expect(m.statusWidget).toBeNull();
		expect(m.researchCard).toBeNull();
		expect(m.eventCard).toBeNull();
	});

	it('lar stjernemerket følge med når det finnes', () => {
		expect(threadRowToMessage(row({ starred: true })).starred).toBe(true);
		expect(threadRowToMessage(row()).starred).toBe(false);
	});
});

describe('displayRows', () => {
	it('filtrerer bort system-meldinger', () => {
		const rows = [row({ id: 'a', role: 'system' }), row({ id: 'b', role: 'user' })];
		expect(displayRows(rows).map((r) => r.id)).toEqual(['b']);
	});
});

describe('oldestCursor', () => {
	it('er tidsstempelet til den FØRSTE raden, også når den er en system-melding', () => {
		// Dette er hele poenget: markøren regnes før filtreringen, ellers hentes
		// system-meldingene om igjen i hver runde.
		const rows = [
			row({ id: 'sys', role: 'system', timestamp: '2026-08-01T00:00:00.000Z' }),
			row({ id: 'b', timestamp: '2026-08-02T00:00:00.000Z' })
		];
		expect(oldestCursor(rows)).toBe('2026-08-01T00:00:00.000Z');
		expect(oldestCursor(displayRows(rows))).toBe('2026-08-02T00:00:00.000Z');
	});

	it('er null for en tom tråd', () => {
		expect(oldestCursor([])).toBeNull();
	});
});

describe('dedupePrepend', () => {
	const msg = (id: string): ChatMessage => ({ id, role: 'user', text: id, starred: false });

	it('slipper gjennom rader vi ikke har fra før', () => {
		expect(dedupePrepend([msg('b')], [msg('a')]).map((m) => m.id)).toEqual(['a']);
	});

	it('stopper rader vi alt viser', () => {
		expect(dedupePrepend([msg('a'), msg('b')], [msg('a')])).toEqual([]);
	});

	it('takler overlapp mellom sider', () => {
		const result = dedupePrepend([msg('c')], [msg('a'), msg('b'), msg('c')]);
		expect(result.map((m) => m.id)).toEqual(['a', 'b']);
	});
});
