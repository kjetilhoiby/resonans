/**
 * Slot-sjekkin: fullskjerm «Hvordan gikk natta/morgenen/arbeidsdagen/…?»
 * som vises når appen åpnes innenfor slottets tidsvindu.
 *
 * Bygges per slot (tittelen er selve spørsmålet), derfor en fabrikk
 * i stedet for en statisk entry i FLOWS-registeret.
 */

import type { Flow } from './types';
import {
	localIsoDay,
	PERIOD_SLOT_LEVEL_LABELS,
	type PeriodSlot
} from '$lib/domains/egenfrekvens/period-slots';

export function buildEgenfrekvensSlotFlow(slot: PeriodSlot): Flow {
	return {
		id: 'egenfrekvens_slot',
		name: 'Sjekk inn',
		description: `En rask 1-5 på hvordan ${slot.label} gikk`,
		icon: '✨',
		domain: 'self',
		trigger: 'auto_suggest',
		estimatedMinutes: 1,
		focus: true,
		parentTheme: 'Egenfrekvens',
		steps: [
			{
				id: 'step_level',
				type: 'form',
				title: slot.question,
				prompt: '1 er tungt, 5 er strålende.',
				autoAdvance: true,
				fields: [
					{
						id: 'level',
						type: 'slider',
						label: 'Nivå',
						min: 1,
						max: 5,
						step: 1,
						defaultValue: 3,
						helperLabels: PERIOD_SLOT_LEVEL_LABELS
					}
				],
				validation: (d) => Number.isInteger(d.level)
			},
			{
				id: 'step_note',
				type: 'form',
				title: 'Vil du si noe kort?',
				prompt: 'Valgfritt — hopp over om det ikke trengs.',
				fields: [
					{
						id: 'note',
						type: 'textarea',
						label: 'Setning',
						placeholder: 'Én setning om det?',
						required: false
					}
				],
				secondaryAction: {
					id: 'continue-chat',
					icon: '💬',
					label: 'Fortsett i chat'
				}
			}
		],
		onComplete: async (data) => {
			const level = Number.isInteger(data.level) ? Number(data.level) : 3;
			const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null;
			await fetch('/api/egenfrekvens/checkin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ level, slot: slot.id, note, day: localIsoDay() })
			});
		}
	};
}
