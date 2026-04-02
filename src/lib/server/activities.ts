import { db } from '$lib/db';
import { sensorEvents, sensors, progress, tasks, goals } from '$lib/db/schema';
import { buildCanonicalActivityFeed } from '$lib/server/activity-layer';
import { eq, and } from 'drizzle-orm';

export interface ActivityMetric {
	metricType: string;
	value: number;
	unit?: string;
}

export interface LogActivityParams {
	userId: string;
	type: string;
	completedAt?: Date;
	duration?: number;
	note?: string;
	metadata?: Record<string, any>;
	metrics: ActivityMetric[];
	taskIds?: string[]; // Optional: specify which tasks this counts towards
}

function normalizeLoggedActivity(type: string, baseData: Record<string, any>) {
	if (type.startsWith('workout_')) {
		return {
			dataType: 'workout',
			data: {
				...baseData,
				sportType: type.replace(/^workout_/, ''),
				originalActivityType: type
			}
		};
	}

	return {
		dataType: type,
		data: {
			...baseData,
			originalActivityType: type
		}
	};
}

async function getOrCreateAiSensor(userId: string) {
	let [sensor] = await db
		.select()
		.from(sensors)
		.where(and(eq(sensors.provider, 'ai_assistant'), eq(sensors.userId, userId)))
		.limit(1);

	if (!sensor) {
		[sensor] = await db
			.insert(sensors)
			.values({
				userId,
				provider: 'ai_assistant',
				type: 'manual_log',
				name: 'AI Assistant',
				isActive: true,
				config: { model: 'gpt-4o', source: 'chat' }
			})
			.returning();
	}
	return sensor;
}

/**
 * Registrer en aktivitet med metrics — skriver til sensorEvents (unified lag)
 * og kobler automatisk til relevante tasks via progress-tabellen.
 */
export async function logActivity(params: LogActivityParams) {
	const {
		userId,
		type,
		completedAt = new Date(),
		duration,
		note,
		metadata,
		metrics,
		taskIds
	} = params;

	// Flaten metrics-array til navngitte felter i data-objektet
	const metricsData: Record<string, any> = {};
	for (const m of metrics) {
		metricsData[m.metricType] = m.value;
		if (m.unit) metricsData[`${m.metricType}Unit`] = m.unit;
	}
	if (duration) metricsData.duration = duration;
	if (note) metricsData.note = note;
	const normalizedActivity = normalizeLoggedActivity(type, { ...metricsData, _metrics: metrics, ...(metadata || {}) });

	const sensor = await getOrCreateAiSensor(userId);

	const result = await db.transaction(async (tx) => {
		// 1. Skriv til sensorEvents (unified kilde for all aktivitetsdata)
		const [event] = await tx
			.insert(sensorEvents)
			.values({
				userId,
				sensorId: sensor.id,
				eventType: 'activity',
				dataType: normalizedActivity.dataType,
				timestamp: completedAt,
				data: normalizedActivity.data,
				metadata: { source: 'log_activity_tool' }
			})
			.returning();

		// 2. Finn relevante tasks (eller bruk spesifiserte)
		let relevantTasks;
		if (taskIds && taskIds.length > 0) {
			const allTasks = await tx.query.tasks.findMany({
				where: eq(tasks.status, 'active'),
				with: { goal: true }
			});
			relevantTasks = allTasks.filter((t) => taskIds.includes(t.id));
		} else {
			relevantTasks = await findMatchingTasks(tx, userId, type, metrics);
		}

		// 3. Opprett progress entries tilknyttet tasks
		const progressEntries = [];
		for (const task of relevantTasks) {
			const value = calculateProgressValue(task, metrics);
			const [progressEntry] = await tx
				.insert(progress)
				.values({
					taskId: task.id,
					userId,
					value,
					note,
					completedAt
				})
				.returning();
			progressEntries.push({ ...progressEntry, task });
		}

		return {
			activity: { id: event.id, type, completedAt, note },
			metrics,
			progressEntries
		};
	});

	return result;
}

/**
 * Finn tasks som matcher en gitt aktivitetstype
 */
async function findMatchingTasks(
	tx: any,
	userId: string,
	activityType: string,
	metrics: ActivityMetric[]
) {
	// Hent alle aktive tasks for brukeren
	const allTasks = await tx.query.tasks.findMany({
		where: eq(tasks.status, 'active'),
		with: {
			goal: {
				where: and(eq(goals.userId, userId), eq(goals.status, 'active'))
			}
		}
	});

	// Filter basert på aktivitetstype og metrics
	// Dette er forenklet - kan gjøres smartere med AI senere
	const matchingTasks = allTasks.filter((task: any) => {
		if (!task.goal) return false;

		// Matching logikk basert på type
		const typeCategory = activityType.split('_')[0]; // f.eks. 'workout' fra 'workout_run'

		// Match basert på category eller title keywords
		const taskText = `${task.title} ${task.description || ''} ${task.goal.title}`.toLowerCase();

		// Sjekk om det er relevant basert på type
		if (typeCategory === 'workout' || typeCategory === 'exercise') {
			if (
				taskText.includes('trening') ||
				taskText.includes('løp') ||
				taskText.includes('km') ||
				taskText.includes('workout')
			) {
				return true;
			}
		}

		if (typeCategory === 'relationship') {
			if (
				taskText.includes('deit') ||
				taskText.includes('date') ||
				taskText.includes('parforhold') ||
				taskText.includes('relationship')
			) {
				return true;
			}
		}

		if (typeCategory === 'mental') {
			if (
				taskText.includes('stemning') ||
				taskText.includes('mood') ||
				taskText.includes('mental') ||
				taskText.includes('følelse')
			) {
				return true;
			}
		}

		// Sjekk også om unit matcher
		if (task.unit) {
			const hasMatchingMetric = metrics.some(
				(m) => m.unit?.toLowerCase() === task.unit?.toLowerCase()
			);
			if (hasMatchingMetric) return true;
		}

		return false;
	});

	return matchingTasks;
}

/**
 * Beregn progress-verdi basert på task og metrics
 */
function calculateProgressValue(task: any, metrics: ActivityMetric[]): number | null {
	// Hvis task har en targetValue og unit, prøv å finne matching metric
	if (task.unit) {
		const matchingMetric = metrics.find((m) => m.unit?.toLowerCase() === task.unit?.toLowerCase());
		if (matchingMetric) {
			return Math.round(matchingMetric.value);
		}
	}

	// Hvis task er frequency-basert (f.eks. "3 ganger per uke"), tell som 1
	if (task.frequency) {
		return 1;
	}

	// Default: null (aktiviteten er registrert, men uten spesifikk verdi)
	return null;
}

/**
 * Hent AI-registrerte aktiviteter for en bruker fra sensorEvents
 */
export async function getUserActivities(userId: string, limit = 50) {
	const feed = await buildCanonicalActivityFeed(userId, { limit });

	return feed.map((item) => ({
		id: item.activityId,
		type: item.dataType,
		completedAt: new Date(item.timestamp),
		note:
			typeof item.payload.note === 'string'
				? item.payload.note
				: typeof item.payload.notes === 'string'
					? item.payload.notes
					: item.summary,
		metadata: item.payload,
		metrics: (Array.isArray(item.payload._metrics) ? item.payload._metrics : []) as ActivityMetric[]
	}));
}
