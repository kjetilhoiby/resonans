import { db } from '$lib/db';
import {
	goals,
	progress,
	recordTypeDefinitions,
	sensors,
	sensorEvents,
	tasks,
	trackingSeries,
	trackingSeriesExamples
} from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import {
	TASK_PROGRESS_SKIP_REASON_PERIOD_TARGET,
	TaskExecutionService
} from '$lib/server/services/task-execution-service';
import { and, desc, eq, gte, lte } from 'drizzle-orm';

export interface TrackingMeasurementInput {
	key: string;
	value: number | string | boolean;
	unit?: string;
}

export interface ImageSignatureInput {
	version?: number;
	byteHash?: string;
	layoutPattern?: string;
	dominantColors?: string[];
	markerDensity?: 'low' | 'medium' | 'high';
	structuralTokens?: string[];
	sparseSemantics?: boolean;
}

export interface RecordTrackingEventInput {
	userId: string;
	seriesId?: string;
	taskId?: string;
	taskTitle?: string;
	recordTypeKey?: string;
	recordTypeLabel?: string;
	kind?: 'activity' | 'measurement';
	date?: string;
	note?: string;
	measurements?: TrackingMeasurementInput[];
	metadata?: Record<string, unknown>;
	sourceImageUrl?: string;
	imageSignature?: ImageSignatureInput | null;
	autoCreateSeries?: boolean;
	createSeriesOnly?: boolean;
	title?: string;
	themeId?: string;
	conversationId?: string;
	autoRegister?: boolean;
	confirmationPolicy?: 'always' | 'low_confidence_only' | 'never';
}

function normalizeTaskTitle(value: string) {
	return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function getOrCreateAssistantSensor(userId: string) {
	let [sensor] = await db
		.select()
		.from(sensors)
		.where(and(eq(sensors.userId, userId), eq(sensors.provider, 'ai_assistant')))
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
				config: { source: 'tracking_series' }
			})
			.returning();
	}

	return sensor;
}

export async function ensureRecordTypeDefinition(params: {
	key: string;
	label?: string;
	description?: string;
	kind?: 'activity' | 'measurement';
	defaultDataType?: string;
	defaultEventType?: 'activity' | 'measurement';
	dedupePolicy?: 'none' | 'one_per_day' | 'one_per_hour';
}) {
	const key = params.key.trim().toLowerCase();
	const existing = await db.query.recordTypeDefinitions.findFirst({
		where: eq(recordTypeDefinitions.key, key)
	});
	if (existing) return existing;

	const [created] = await db
		.insert(recordTypeDefinitions)
		.values({
			key,
			label: params.label?.trim() || key,
			description: params.description,
			kind: params.kind || 'activity',
			defaultEventType: params.defaultEventType || params.kind || 'activity',
			defaultDataType: params.defaultDataType || key,
			dedupePolicy: params.dedupePolicy || 'one_per_day'
		})
		.returning();

	return created;
}

async function maybeFindDuplicateEvent(userId: string, dataType: string, when: Date, dedupePolicy: string) {
	if (dedupePolicy === 'none') return null;
	const start = new Date(when);
	const end = new Date(when);
	if (dedupePolicy === 'one_per_hour') {
		start.setMinutes(0, 0, 0);
		end.setMinutes(59, 59, 999);
	} else {
		start.setHours(0, 0, 0, 0);
		end.setHours(23, 59, 59, 999);
	}

	return db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, dataType),
			gte(sensorEvents.timestamp, start),
			lte(sensorEvents.timestamp, end)
		)
	});
}

export async function recordTrackingEvent(params: RecordTrackingEventInput) {
	const when = new Date(params.date ?? new Date().toISOString().slice(0, 10));
	if (Number.isNaN(when.getTime())) {
		throw new Error('Invalid date format for tracking event');
	}

	let resolvedTask: { id: string; title: string } | null = null;
	let resolvedTaskId = params.taskId;

	if (!resolvedTaskId && params.taskTitle?.trim()) {
		const normalizedTarget = normalizeTaskTitle(params.taskTitle);
		const candidateTasks = await db.query.tasks.findMany({
			where: eq(tasks.status, 'active'),
			with: {
				goal: {
					columns: { id: true, userId: true, status: true }
				}
			},
			columns: { id: true, title: true }
		});

		const matchedTask = candidateTasks.find(
			(task) =>
				normalizeTaskTitle(task.title) === normalizedTarget &&
				task.goal?.userId === params.userId &&
				task.goal?.status === 'active'
		);
		if (matchedTask) {
			resolvedTaskId = matchedTask.id;
			resolvedTask = { id: matchedTask.id, title: matchedTask.title };
		}
	}

	const sensor = await getOrCreateAssistantSensor(params.userId);

	let series = params.seriesId
		? await db.query.trackingSeries.findFirst({
			where: and(eq(trackingSeries.id, params.seriesId), eq(trackingSeries.userId, params.userId))
		})
		: null;

	// Look up series by taskId if no seriesId provided
	if (!series && resolvedTaskId) {
		series = await db.query.trackingSeries.findFirst({
			where: and(
				eq(trackingSeries.userId, params.userId),
				eq(trackingSeries.taskId, resolvedTaskId),
				eq(trackingSeries.status, 'active')
			)
		});
	}

	let recordType = series
		? await db.query.recordTypeDefinitions.findFirst({
			where: eq(recordTypeDefinitions.id, series.recordTypeId)
		})
		: null;

	if (!recordType) {
		if (!params.recordTypeKey) {
			throw new Error('recordTypeKey or seriesId is required');
		}
		recordType = await ensureRecordTypeDefinition({
			key: params.recordTypeKey,
			label: params.recordTypeLabel,
			kind: params.kind || 'activity',
			defaultDataType: params.recordTypeKey,
			defaultEventType: params.kind || 'activity',
			dedupePolicy: 'one_per_day'
		});
	}

	// Look up existing active series by recordTypeKey if still not found
	if (!series && recordType) {
		series = await db.query.trackingSeries.findFirst({
			where: and(
				eq(trackingSeries.userId, params.userId),
				eq(trackingSeries.recordTypeId, recordType.id),
				eq(trackingSeries.status, 'active')
			)
		});
	}

	if (!series && params.autoCreateSeries !== false) {
		const [createdSeries] = await db
			.insert(trackingSeries)
			.values({
				userId: params.userId,
				recordTypeId: recordType.id,
				themeId: params.themeId,
				taskId: resolvedTaskId ?? null,
				createdFromConversationId: params.conversationId,
				title: params.title?.trim() || recordType.label,
				autoRegister: params.autoRegister ?? false,
				confirmationPolicy: params.confirmationPolicy || 'low_confidence_only',
				status: 'active'
			})
			.returning();
		series = createdSeries;
	}

	if (params.createSeriesOnly) {
		if (series) {
			await db
				.update(trackingSeries)
				.set({
					lastUsedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(trackingSeries.id, series.id));
		}

		return {
			success: true,
			createdOnly: true,
			event: null,
			series,
			recordType,
			linkedTask: resolvedTask
		};
	}

	const dedupePolicy = recordType.dedupePolicy || 'none';
	const duplicate = await maybeFindDuplicateEvent(params.userId, recordType.defaultDataType, when, dedupePolicy);
	if (duplicate) {
		return {
			success: false,
			duplicate: true,
			event: duplicate,
			series,
			recordType
		};
	}

	const measurementMap: Record<string, unknown> = {};
	for (const measurement of params.measurements ?? []) {
		measurementMap[measurement.key] = measurement.value;
		if (measurement.unit) {
			measurementMap[`${measurement.key}Unit`] = measurement.unit;
		}
	}

	const eventData: Record<string, unknown> = {
		...measurementMap,
		note: params.note,
		measurements: params.measurements ?? [],
		recordTypeKey: recordType.key,
		trackingSeriesId: series?.id || null,
		sourceImageUrl: params.sourceImageUrl || undefined
	};

	const { event: saved } = await SensorEventService.write({
		userId: params.userId,
		sensorId: sensor.id,
		eventType: recordType.defaultEventType || (recordType.kind === 'measurement' ? 'measurement' : 'activity'),
		dataType: recordType.defaultDataType,
		timestamp: when,
		data: eventData,
		metadata: {
			recordTypeKey: recordType.key,
			trackingSeriesId: series?.id || null,
			...params.metadata
		},
		source: 'tracking_event_tool'
	});

	if (series) {
		await db
			.update(trackingSeries)
			.set({
				lastUsedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(trackingSeries.id, series.id));

		if (params.sourceImageUrl && params.imageSignature) {
			await db.insert(trackingSeriesExamples).values({
				trackingSeriesId: series.id,
				userId: params.userId,
				attachmentUrl: params.sourceImageUrl,
				attachmentKind: 'image',
				imageSignature: params.imageSignature,
				parsedPayload: {
					date: params.date,
					note: params.note,
					measurements: params.measurements ?? []
				},
				confirmed: true
			});
		}

		// Write a progress row if series is linked to a task — this drives the ukeplan slot UI
		if (series.taskId) {
			const result = await TaskExecutionService.ensureTaskProgress({
				taskId: series.taskId,
				userId: params.userId,
				value: 1,
				dedupeNote: `tracking_event:${saved.id}:task:${series.taskId}`,
				enforcePeriodTarget: true,
				note: params.note ?? null,
				completedAt: when
			});

			if (result.skippedByPeriod) {
				console.log(
					`[tracking-series] user=${params.userId} skipped task=${series.taskId} event=${saved.id} reason=${result.skipReason ?? TASK_PROGRESS_SKIP_REASON_PERIOD_TARGET}`
				);
			}
		}
	}

	return {
		success: true,
		event: saved,
		series,
		recordType,
		linkedTask: resolvedTask
	};
}

export async function listTrackingSeriesForUser(userId: string) {
	return db.query.trackingSeries.findMany({
		where: and(eq(trackingSeries.userId, userId), eq(trackingSeries.status, 'active')),
		with: {
			recordType: true
		},
		orderBy: [desc(trackingSeries.updatedAt)]
	});
}
