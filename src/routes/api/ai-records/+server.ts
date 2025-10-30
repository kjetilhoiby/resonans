import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { DEFAULT_USER_ID } from '$lib/server/users';
import { eq, and } from 'drizzle-orm';

/**
 * API for AI-genererte registreringer
 * POST /api/ai-records
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { type, data, date, metadata } = await request.json();

		// Valider required fields
		if (!type || !data || !date) {
			return json({ error: 'Missing required fields: type, data, date' }, { status: 400 });
		}

		// Parse date
		const timestamp = new Date(date);
		if (isNaN(timestamp.getTime())) {
			return json({ error: 'Invalid date format' }, { status: 400 });
		}

		// Sjekk for duplikater basert på type og dato
		const startOfDay = new Date(timestamp);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(timestamp);
		endOfDay.setHours(23, 59, 59, 999);

		const existingEvent = await db.query.sensorEvents.findFirst({
			where: and(
				eq(sensorEvents.userId, DEFAULT_USER_ID),
				eq(sensorEvents.dataType, type),
				// Check if timestamp is within the same day
			)
		});

		if (existingEvent) {
			// Check if it's the same day
			const existingDate = new Date(existingEvent.timestamp);
			if (
				existingDate.getFullYear() === timestamp.getFullYear() &&
				existingDate.getMonth() === timestamp.getMonth() &&
				existingDate.getDate() === timestamp.getDate()
			) {
				return json(
					{
						error: 'Duplicate record',
						message: `Det finnes allerede en registrering for ${type} den ${timestamp.toLocaleDateString('no-NO')}`,
						existingRecord: {
							id: existingEvent.id,
							date: existingEvent.timestamp,
							data: existingEvent.data
						}
					},
					{ status: 409 }
				);
			}
		}

		// Lag sensorEvent med AI-metadata embedded in data
		const eventData = {
			...data,
			// Add AI metadata
			_ai_generated: true,
			_ai_source: 'chat',
			_ai_confidence: metadata?.confidence || 'high',
			_ai_verified: false,
			...metadata
		};

		// Get AI sensor (create if not exists)
		const { sensors } = await import('$lib/db/schema');
		let [aiSensor] = await db
			.select()
			.from(sensors)
			.where(eq(sensors.provider, 'ai_assistant'))
			.limit(1);

		if (!aiSensor) {
			[aiSensor] = await db
				.insert(sensors)
				.values({
					userId: DEFAULT_USER_ID,
					provider: 'ai_assistant',
					type: 'manual_log',
					name: 'AI Assistant',
					isActive: true,
					config: {
						model: 'gpt-4o',
						source: 'chat'
					}
				})
				.returning();
		}

		// Lagre til database
		const [newEvent] = await db
			.insert(sensorEvents)
			.values({
				userId: DEFAULT_USER_ID,
				sensorId: aiSensor.id,
				eventType: 'measurement',
				dataType: type,
				timestamp,
				data: eventData
			})
			.returning();

		return json({
			success: true,
			message: `Registrert ${type} for ${timestamp.toLocaleDateString('no-NO')}`,
			record: {
				id: newEvent.id,
				type,
				date: newEvent.timestamp,
				data: newEvent.data
			}
		});
	} catch (error) {
		console.error('Failed to create AI record:', error);
		return json({ error: 'Failed to create record' }, { status: 500 });
	}
};
