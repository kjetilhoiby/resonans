import { db } from '$lib/db';
import { sensorEvents, sensors, users } from '$lib/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

export class RelationshipCheckinError extends Error {}

export function toIsoDay(date: Date = new Date()) {
	return date.toISOString().slice(0, 10);
}

async function getOrCreateRelationshipSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'relationship_checkin'))
	});

	if (existing) return existing;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'relationship_checkin',
			type: 'manual_log',
			subtype: 'relationship_daily',
			name: 'Parsjekk',
			isActive: true,
			config: { scale: 'likert_1_7', revealPolicy: 'both_must_answer' }
		})
		.returning();

	return created;
}

async function getPartnerUserId(userId: string) {
	const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
	return user?.partnerUserId || null;
}

export async function getRelationshipCheckinStatus(userId: string, day: string = toIsoDay()) {
	const partnerUserId = await getPartnerUserId(userId);

	if (!partnerUserId) {
		return {
			day,
			hasPartner: false,
			submitted: false,
			partnerSubmitted: false,
			revealed: false,
			myScore: null,
			myNote: null,
			partnerScore: null,
			partnerNote: null,
			mismatch: false,
			bothNegative: false,
			followUpRecommended: false
		};
	}

	const rows = await db
		.select({
			id: sensorEvents.id,
			userId: sensorEvents.userId,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.dataType, 'relationship_checkin'),
				inArray(sensorEvents.userId, [userId, partnerUserId]),
				sql`${sensorEvents.data}->>'day' = ${day}`
			)
		)
		.orderBy(desc(sensorEvents.timestamp));

	const mine = rows.find((row) => row.userId === userId) || null;
	const partners = rows.find((row) => row.userId === partnerUserId) || null;

	const myScore = typeof mine?.data?.score === 'number' ? mine.data.score : null;
	const partnerScore = typeof partners?.data?.score === 'number' ? partners.data.score : null;
	const myNote = typeof mine?.data?.note === 'string' ? mine.data.note : null;
	const partnerNote = typeof partners?.data?.note === 'string' ? partners.data.note : null;

	const submitted = myScore !== null;
	const partnerSubmitted = partnerScore !== null;
	const revealed = submitted && partnerSubmitted;
	const mismatch = revealed ? Math.abs((myScore || 0) - (partnerScore || 0)) >= 2 : false;
	const bothNegative = revealed ? (myScore || 0) <= 3 && (partnerScore || 0) <= 3 : false;

	return {
		day,
		hasPartner: true,
		submitted,
		partnerSubmitted,
		revealed,
		myScore,
		myNote,
		partnerScore: revealed ? partnerScore : null,
		partnerNote: revealed ? partnerNote : null,
		mismatch,
		bothNegative,
		followUpRecommended: mismatch || bothNegative
	};
}

export async function submitRelationshipCheckin(params: {
	userId: string;
	score: number;
	note?: string | null;
	day?: string;
}) {
	const day = params.day || toIsoDay();
	const partnerUserId = await getPartnerUserId(params.userId);

	if (!partnerUserId) {
		throw new RelationshipCheckinError('Parsjekk krever at du er koblet til en partner.');
	}

	if (!Number.isInteger(params.score) || params.score < 1 || params.score > 7) {
		throw new RelationshipCheckinError('Score må være et heltall fra 1 til 7.');
	}

	const sensor = await getOrCreateRelationshipSensor(params.userId);

	const existing = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, params.userId),
				eq(sensorEvents.dataType, 'relationship_checkin'),
				sql`${sensorEvents.data}->>'day' = ${day}`
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);

	const cleanNote = params.note?.trim() || null;
	const payload = {
		...(existing[0]?.data || {}),
		day,
		score: params.score,
		note: cleanNote,
		partnerUserId
	};

	if (existing[0]) {
		await db
			.update(sensorEvents)
			.set({
				timestamp: new Date(),
				data: payload,
				metadata: {
					source: 'relationship_checkin_ui',
					updated: true
				}
			})
			.where(eq(sensorEvents.id, existing[0].id));
	} else {
		await db.insert(sensorEvents).values({
			userId: params.userId,
			sensorId: sensor.id,
			eventType: 'measurement',
			dataType: 'relationship_checkin',
			timestamp: new Date(),
			data: payload,
			metadata: {
				source: 'relationship_checkin_ui'
			}
		});
	}

	return getRelationshipCheckinStatus(params.userId, day);
}
