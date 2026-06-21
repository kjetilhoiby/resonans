import { describe, it, expect } from 'vitest';
import { selectContextWindow, COACH_CONTEXT_WINDOW, type CoachTurn } from './coach-conversation';

function makeTurns(n: number): CoachTurn[] {
	return Array.from({ length: n }, (_, i) => ({
		role: i % 2 === 0 ? 'user' : 'assistant',
		text: `tur ${i}`,
		timestamp: new Date(2026, 5, 20, 12, i)
	}));
}

describe('selectContextWindow', () => {
	it('beholder alt ordrett når tråden er kortere enn vinduet', () => {
		const turns = makeTurns(4);
		const result = selectContextWindow(turns, 20);
		expect(result.turns).toHaveLength(4);
		expect(result.droppedCount).toBe(0);
		expect(result.turns).toBe(turns);
	});

	it('beholder alt når tråden er nøyaktig like lang som vinduet', () => {
		const result = selectContextWindow(makeTurns(20), 20);
		expect(result.turns).toHaveLength(20);
		expect(result.droppedCount).toBe(0);
	});

	it('beholder de nyeste turene og rapporterer hvor mange som ble droppet', () => {
		const turns = makeTurns(25);
		const result = selectContextWindow(turns, 20);
		expect(result.turns).toHaveLength(20);
		expect(result.droppedCount).toBe(5);
		// Nyeste tur skal være med, eldste skal være droppet.
		expect(result.turns.at(-1)?.text).toBe('tur 24');
		expect(result.turns[0]?.text).toBe('tur 5');
	});

	it('bruker standardvinduet når ingen grense er gitt', () => {
		const turns = makeTurns(COACH_CONTEXT_WINDOW + 3);
		const result = selectContextWindow(turns);
		expect(result.turns).toHaveLength(COACH_CONTEXT_WINDOW);
		expect(result.droppedCount).toBe(3);
	});

	it('dropper alt når grensen er null eller negativ', () => {
		const turns = makeTurns(5);
		const result = selectContextWindow(turns, 0);
		expect(result.turns).toHaveLength(0);
		expect(result.droppedCount).toBe(5);
	});

	it('håndterer tom tråd', () => {
		const result = selectContextWindow([], 20);
		expect(result.turns).toHaveLength(0);
		expect(result.droppedCount).toBe(0);
	});
});
