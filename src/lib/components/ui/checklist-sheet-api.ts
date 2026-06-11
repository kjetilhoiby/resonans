/**
 * Nettverks- og enhets-IO for ChecklistSheet — samlet bak ett interface
 * slik at /design kan injisere en mock og rendre sheeten uten nettverk,
 * geolokasjon eller værkall.
 */
import { patchItem, deleteItem, addItems } from '$lib/utils/checklist-api';
import { readCacheEntry, fetchRawTimeseries } from '$lib/utils/weather';
import { resolvePlace, geocodePlace } from '$lib/utils/geocode';

export interface ChecklistSheetApi {
	patchItem: typeof patchItem;
	deleteItem: typeof deleteItem;
	addItems: typeof addItems;
	/** Oppretter selve sjekklisten (virtuelle dag-lister får backing først ved første mutasjon). */
	createChecklist(input: { title: string; emoji: string; context?: string }): Promise<{ id: string } | null>;
	/** Oppretter toppnivå-punkt(er), evt. med koordinater fra stedsoppslag. */
	createItems(
		checklistId: string,
		input: { text: string; sortOrder: number; coords?: { lat: number; lon: number; label?: string } }
	): Promise<unknown[] | null>;
	snoozeItem(checklistId: string, itemId: string, targetDate: string): Promise<boolean>;
	saveBreakdown(input: {
		parentItemId: string;
		subtasks: string[];
		breakdownPrompt: string;
	}): Promise<unknown[] | null>;
	deleteChecklist(checklistId: string): Promise<void>;
	// Sted og vær
	resolvePlace: typeof resolvePlace;
	geocodePlace: typeof geocodePlace;
	getDeviceCoords(): Promise<{ lat: number; lon: number }>;
	readWeatherCache: typeof readCacheEntry;
	fetchWeatherTimeseries: typeof fetchRawTimeseries;
}

export const checklistSheetApi: ChecklistSheetApi = {
	patchItem,
	deleteItem,
	addItems,

	async createChecklist({ title, emoji, context }) {
		const res = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title, emoji, context })
		});
		if (!res.ok) return null;
		return (await res.json()) as { id: string };
	},

	async createItems(checklistId, { text, sortOrder, coords }) {
		const res = await fetch(`/api/checklists/${checklistId}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, sortOrder, ...(coords && { coords }) })
		});
		if (!res.ok) return null;
		return (await res.json()) as unknown[];
	},

	async snoozeItem(checklistId, itemId, targetDate) {
		const res = await fetch(`/api/checklists/${checklistId}/items/${itemId}/snooze`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetDate })
		});
		return res.ok;
	},

	async saveBreakdown({ parentItemId, subtasks, breakdownPrompt }) {
		const res = await fetch('/api/breakdown/save', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ parentItemId, subtasks, breakdownPrompt })
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { success: boolean; subtasks: unknown[] };
		return data.success ? data.subtasks : null;
	},

	async deleteChecklist(checklistId) {
		await fetch(`/api/checklists/${checklistId}`, { method: 'DELETE' });
	},

	resolvePlace,
	geocodePlace,

	getDeviceCoords() {
		return new Promise((resolve) => {
			if (!navigator.geolocation) return resolve({ lat: 59.9139, lon: 10.7522 });
			navigator.geolocation.getCurrentPosition(
				(pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
				() => resolve({ lat: 59.9139, lon: 10.7522 }),
				{ timeout: 4000, maximumAge: 300_000 }
			);
		});
	},

	readWeatherCache: readCacheEntry,
	fetchWeatherTimeseries: fetchRawTimeseries
};
