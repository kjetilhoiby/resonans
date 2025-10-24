import { db } from '$lib/db';
import { activities, activityMetrics, progress, tasks } from '$lib/db/schema';
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

/**
 * Registrer en aktivitet med metrics og automatisk kobling til relevante tasks
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

	// Start en transaksjon
	const result = await db.transaction(async (tx) => {
		// 1. Opprett aktiviteten
		const [activity] = await tx
			.insert(activities)
			.values({
				userId,
				type,
				completedAt,
				duration,
				note,
				metadata: metadata || {}
			})
			.returning();

		// 2. Opprett alle metrics
		if (metrics.length > 0) {
			await tx.insert(activityMetrics).values(
				metrics.map((metric) => ({
					activityId: activity.id,
					metricType: metric.metricType,
					value: metric.value.toString(), // decimal lagres som string
					unit: metric.unit
				}))
			);
		}

		// 3. Finn relevante tasks (eller bruk spesifiserte)
		let relevantTasks;
		if (taskIds && taskIds.length > 0) {
			// Bruk spesifiserte tasks
			relevantTasks = await tx.query.tasks.findMany({
				where: and(
					eq(tasks.status, 'active'),
					// Match på taskIds - dette krever litt mer kompleks logikk
				)
			});
			// For nå: hent alle aktive tasks og filtrer
			const allTasks = await tx.query.tasks.findMany({
				where: eq(tasks.status, 'active'),
				with: {
					goal: true
				}
			});
			relevantTasks = allTasks.filter((t) => taskIds.includes(t.id));
		} else {
			// Auto-match basert på type
			relevantTasks = await findMatchingTasks(tx, userId, type, metrics);
		}

		// 4. Opprett progress entries for hver relevant task
		const progressEntries = [];
		for (const task of relevantTasks) {
			// Beregn value basert på task og metrics
			const value = calculateProgressValue(task, metrics);

			const [progressEntry] = await tx
				.insert(progress)
				.values({
					activityId: activity.id,
					taskId: task.id,
					userId,
					value,
					note,
					completedAt
				})
				.returning();

			progressEntries.push({
				...progressEntry,
				task
			});
		}

		return {
			activity,
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
				where: and(eq(tasks.status, 'active'))
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
 * Hent aktiviteter for en bruker med alle metrics og progress
 */
export async function getUserActivities(userId: string, limit = 50) {
	return await db.query.activities.findMany({
		where: eq(activities.userId, userId),
		with: {
			metrics: true,
			progress: {
				with: {
					task: {
						with: {
							goal: true
						}
					}
				}
			}
		},
		orderBy: (activities, { desc }) => [desc(activities.completedAt)],
		limit
	});
}
