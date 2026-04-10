import { db } from '$lib/db';
import {
	recordTypeDefinitions,
	sensors,
	sensorEvents,
	trackingSeries,
	trackingSeriesExamples
} from '$lib/db/schema';
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
	recordTypeKey?: string;
	recordTypeLabel?: string;
	kind?: 'activity' | 'measurement';
	date: string;
	note?: string;
	measurements?: TrackingMeasurementInput[];
	metadata?: Record<string, unknown>;
	sourceImageUrl?: string;
	imageSignature?: ImageSignatureInput | null;
	autoCreateSeries?: boolean;
	title?: string;
	themeId?: string;
	conversationId?: string;
	autoRegister?: boolean;
	confirmationPolicy?: 'always' | 'low_confidence_only' | 'never';
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
	const when = new Date(params.date);
	if (Number.isNaN(when.getTime())) {
		throw new Error('Invalid date format for tracking event');
	}

	const sensor = await getOrCreateAssistantSensor(params.userId);

	let series = params.seriesId
		? await db.query.trackingSeries.findFirst({
			where: and(eq(trackingSeries.id, params.seriesId), eq(trackingSeries.userId, params.userId))
		})
		: null;

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

	if (!series && params.autoCreateSeries !== false) {
		const [createdSeries] = await db
			.insert(trackingSeries)
			.values({
				userId: params.userId,
				recordTypeId: recordType.id,
				themeId: params.themeId,
				createdFromConversationId: params.conversationId,
				title: params.title?.trim() || recordType.label,
				autoRegister: params.autoRegister ?? false,
				confirmationPolicy: params.confirmationPolicy || 'low_confidence_only',
				status: 'active'
			})
			.returning();
		series = createdSeries;
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

	const [saved] = await db
		.insert(sensorEvents)
		.values({
			userId: params.userId,
			sensorId: sensor.id,
			eventType: recordType.defaultEventType || (recordType.kind === 'measurement' ? 'measurement' : 'activity'),
			dataType: recordType.defaultDataType,
			timestamp: when,
			data: eventData,
			metadata: {
				source: 'tracking_event_tool',
				recordTypeKey: recordType.key,
				trackingSeriesId: series?.id || null,
				...params.metadata
			}
		})
		.returning();

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
	}

	return {
		success: true,
		event: saved,
		series,
		recordType
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
