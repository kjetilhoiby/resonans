import { describe, it, expect } from 'vitest';
import { createChatPerf, formatChatPerfLine } from './chat-perf';

describe('createChatPerf', () => {
	it('måler faser med injisert klokke, også når fasen kaster', async () => {
		let t = 0;
		const perf = createChatPerf(() => t);

		t = 10;
		await perf.timed('a', async () => {
			t = 40;
		});

		await expect(
			perf.timed('b', async () => {
				t = 100;
				throw new Error('boom');
			})
		).rejects.toThrow('boom');

		expect(perf.phases).toEqual([
			{ name: 'a', ms: 30 },
			{ name: 'b', ms: 60 }
		]);
		expect(perf.wallMs()).toBe(100);
	});
});

describe('formatChatPerfLine', () => {
	it('sorterer tyngste fase først og summerer', () => {
		const line = formatChatPerfLine({
			wallMs: 180,
			phases: [
				{ name: 'minne', ms: 90 },
				{ name: 'helse', ms: 214 },
				{ name: 'ruting', ms: 8 }
			]
		});
		expect(line).toBe('[chat-perf] kontekst wall=180ms sum=312ms helse=214ms minne=90ms ruting=8ms');
	});
});
