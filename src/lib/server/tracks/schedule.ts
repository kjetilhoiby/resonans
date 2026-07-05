import type { SessionSuggestion } from './types';
import { DEFAULT_SCHEDULE } from './constants';
import { isoWeekday } from './curve';

/**
 * Velger hvilket løp som "eier" en gitt dag — Ekko-kontrakten er én økt per
 * dag. Planens schedule overstyrer default (man/ons/fre styrke, tir/tor/lør
 * utholdenhet, søn hvile). Hvis eierens motor ikke foreslår noe (f.eks. uken
 * er i mål), er dagen hviledag.
 */
export function suggestSessionForDate(
	date: string,
	schedule: Record<string, 'styrke' | 'utholdenhet' | 'hvile'> | undefined,
	strengthSuggestion: SessionSuggestion | null,
	enduranceSuggestion: SessionSuggestion | null
): { owner: 'styrke' | 'utholdenhet' | 'hvile'; suggestion: SessionSuggestion | null } {
	const weekday = isoWeekday(date);
	const owner = schedule?.[String(weekday)] ?? DEFAULT_SCHEDULE[weekday] ?? 'hvile';

	if (owner === 'hvile') return { owner, suggestion: null };
	if (owner === 'styrke') return { owner, suggestion: strengthSuggestion };
	return { owner, suggestion: enduranceSuggestion };
}
