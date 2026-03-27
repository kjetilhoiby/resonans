import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const VALID_TYPES = ['weight', 'sleep', 'steps', 'running'] as const;
type SensorType = (typeof VALID_TYPES)[number];

export const load: PageServerLoad = async ({ params, fetch }) => {
	const type = params.type as SensorType;

	if (!VALID_TYPES.includes(type)) {
		error(404, `Ukjent sensor-type: ${type}`);
	}

	const res = await fetch('/api/sensor-summary');
	if (!res.ok) {
		error(502, 'Kunne ikke hente sensor-data');
	}

	const summary = await res.json();

	return { type, summary };
};
