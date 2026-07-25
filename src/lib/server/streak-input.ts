/**
 * streak-input.ts — Validering av streak-definisjoner fra API/AI.
 *
 * Returnerer et resultat i stedet for å kaste, så logikken kan enhetstestes uten
 * HTTP-lag. Rutene oversetter feilmeldingen til error(400).
 */
import type { StreakDefinitionInput } from '$lib/server/services/streak-service';
import type { StreakRule, StreakSource } from '$lib/domain/streaks';

const RULES: StreakRule[] = ['consecutive_days', 'count_per_window', 'max_interval'];

export type ParseResult =
	| { ok: true; input: StreakDefinitionInput }
	| { ok: false; error: string };

function parseSource(raw: unknown): { source: StreakSource } | { error: string } {
	if (!raw || typeof raw !== 'object') return { error: 'source er påkrevd' };
	const s = raw as Record<string, unknown>;

	switch (s.kind) {
		case 'workout': {
			const sportFamily = typeof s.sportFamily === 'string' ? s.sportFamily.trim() : '';
			if (!sportFamily) return { error: 'source.sportFamily er påkrevd for workout' };
			return { source: { kind: 'workout', sportFamily } };
		}
		case 'sensor_event': {
			const dataType = typeof s.dataType === 'string' ? s.dataType.trim() : '';
			if (!dataType) return { error: 'source.dataType er påkrevd for sensor_event' };
			const textMatch = typeof s.textMatch === 'string' ? s.textMatch.trim() : '';
			return {
				source: { kind: 'sensor_event', dataType, ...(textMatch ? { textMatch } : {}) }
			};
		}
		case 'manual':
			return { source: { kind: 'manual' } };
		default:
			return { error: 'source.kind må være workout, sensor_event eller manual' };
	}
}

function positiveInt(value: unknown): number | null {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1) return null;
	return n;
}

export function parseStreakInput(body: unknown, id?: string): ParseResult {
	if (!body || typeof body !== 'object') return { ok: false, error: 'ugyldig body' };
	const b = body as Record<string, unknown>;

	const title = typeof b.title === 'string' ? b.title.trim() : '';
	if (!title) return { ok: false, error: 'title er påkrevd' };

	const rule = b.rule as StreakRule;
	if (!RULES.includes(rule)) return { ok: false, error: `rule må være en av ${RULES.join(', ')}` };

	const sourceResult = parseSource(b.source);
	if ('error' in sourceResult) return { ok: false, error: sourceResult.error };

	const rawConfig = (b.config ?? {}) as Record<string, unknown>;
	const config: StreakDefinitionInput['config'] = {};

	if (rule === 'count_per_window') {
		const windowDays = rawConfig.windowDays === undefined ? 7 : positiveInt(rawConfig.windowDays);
		if (windowDays === null) return { ok: false, error: 'config.windowDays må være et positivt heltall' };
		const threshold = rawConfig.threshold === undefined ? 1 : positiveInt(rawConfig.threshold);
		if (threshold === null) return { ok: false, error: 'config.threshold må være et positivt heltall' };
		config.windowDays = windowDays;
		config.threshold = threshold;
	}

	if (rule === 'max_interval') {
		const intervalDays = positiveInt(rawConfig.intervalDays);
		if (intervalDays === null) {
			return { ok: false, error: 'config.intervalDays er påkrevd for max_interval' };
		}
		config.intervalDays = intervalDays;
		if (rawConfig.dueSoonDays !== undefined) {
			const dueSoonDays = positiveInt(rawConfig.dueSoonDays);
			if (dueSoonDays === null) {
				return { ok: false, error: 'config.dueSoonDays må være et positivt heltall' };
			}
			config.dueSoonDays = dueSoonDays;
		}
	}

	return {
		ok: true,
		input: {
			...(id ? { id } : {}),
			title,
			rule,
			source: sourceResult.source,
			config,
			...(typeof b.emoji === 'string' && b.emoji.trim() ? { emoji: b.emoji.trim() } : {}),
			...(typeof b.active === 'boolean' ? { active: b.active } : {}),
			...(typeof b.sortOrder === 'number' ? { sortOrder: b.sortOrder } : {}),
			...(typeof b.themeId === 'string' ? { themeId: b.themeId } : {})
		}
	};
}
