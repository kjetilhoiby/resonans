/**
 * Nettverkslag for FlowSheet — injiseres som mock på /design.
 * (Chat-steg streamer via ChatState og er ikke del av dette laget.)
 */
import type { WeatherData } from './flow-helpers';

export interface FlowSheetApi {
	/** Værdata for dagsplan-flyten. */
	fetchDayWeather(dayIso: string): Promise<WeatherData | null>;
	/** AI-forslag til dagstodos basert på dagnotis og kontekst. */
	fetchDaySuggestions(input: {
		headline: string;
		dayLabel: string;
		carryovers: unknown[];
		weekTasks: unknown[];
		refinementPrompt?: string;
	}): Promise<string[]>;
}

export const flowSheetApi: FlowSheetApi = {
	async fetchDayWeather(dayIso) {
		try {
			const res = await fetch(`/api/day-plan/weather?day=${dayIso}`);
			const data = await res.json();
			return data.error ? null : (data as WeatherData);
		} catch {
			return null;
		}
	},

	async fetchDaySuggestions({ headline, dayLabel, carryovers, weekTasks, refinementPrompt }) {
		const res = await fetch('/api/day-plan/suggestions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				headline,
				dayLabel,
				carryovers,
				weekTasks,
				...(refinementPrompt ? { refinementPrompt } : {})
			})
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { suggestions: string[] };
		return data.suggestions ?? [];
	}
};
