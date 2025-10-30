import { z } from 'zod';
import { db } from '$lib/db';
import { sensorEvents, sensorAggregates } from '$lib/db/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

export const querySensorDataTool = {
	name: 'query_sensor_data',
	description: `Query sensor data (health metrics from Withings) to answer questions about user's health patterns.

Use this tool when user asks about:
- Weight trends: "How's my weight doing?", "Have I lost weight this month?"
- Activity patterns: "How many steps did I take last week?", "Am I exercising enough?"
- Sleep quality: "How am I sleeping?", "Did I sleep well last night?"
- Intense exercise: "Am I getting enough intense exercise?"
- Workouts: "What workouts did I do?", "How many kilometers did I run this month?"
- General health: "Show me my health summary", "How am I doing?"

Query types:
- 'latest': Get most recent week's metrics (e.g., "How's my weight?")
- 'trend': Compare multiple periods - USE THIS for questions like "last 3 months", "this year", etc.
- 'period_summary': Get ONE specific period (requires periodKey like "2025M10")
- 'raw_events': Get individual measurements (detailed data, workouts with GPS/pace/etc.)

The tool returns actual data from Withings sensors that the user can trust.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		queryType: z.enum(['latest', 'period_summary', 'trend', 'raw_events']).describe(
			'latest: Get most recent metrics. period_summary: Get aggregates for a period. trend: Compare multiple periods. raw_events: Get individual measurements or workouts.'
		),
		period: z.enum(['week', 'month', 'year']).optional().describe('Time period for aggregates'),
		periodKey: z.string().optional().describe('Specific period (e.g., "2025W43", "2025M10", "2025")'),
		metric: z.enum(['weight', 'steps', 'sleep', 'intense_minutes', 'heartrate', 'workouts', 'all']).optional().describe('Which metric to focus on'),
		limit: z.number().optional().describe('Max number of results (for raw_events or trend)'),
		startDate: z.string().optional().describe('Start date for raw events (ISO format)'),
		endDate: z.string().optional().describe('End date for raw events (ISO format)')
	}),

	execute: async (args: {
		userId: string;
		queryType: 'latest' | 'period_summary' | 'trend' | 'raw_events';
		period?: 'week' | 'month' | 'year';
		periodKey?: string;
		metric?: 'weight' | 'steps' | 'sleep' | 'intense_minutes' | 'heartrate' | 'workouts' | 'all';
		limit?: number;
		startDate?: string;
		endDate?: string;
	}) => {
		let { userId, queryType, period, periodKey, metric, limit, startDate, endDate } = args;

		try {
			// Get latest metrics from most recent aggregates
			if (queryType === 'latest') {
				const weeklyAggregates = await db.query.sensorAggregates.findMany({
					where: and(
						eq(sensorAggregates.userId, userId),
						eq(sensorAggregates.period, 'week')
					),
					orderBy: [desc(sensorAggregates.year), desc(sensorAggregates.periodKey)],
					limit: 1
				});

				if (weeklyAggregates.length === 0) {
					return {
						success: false,
						message: 'No sensor data found. User may need to sync Withings data.'
					};
				}

				const latest = weeklyAggregates[0];
				const metrics = latest.metrics as any;

				return {
					success: true,
					data: {
						period: latest.periodKey,
						weight: {
							current: metrics?.weight?.latest,
							avg: metrics?.weight?.avg,
							change: metrics?.weight?.change
						},
						steps: {
							avg: metrics?.steps?.avg,
							total: metrics?.steps?.sum
						},
						sleep: {
							avg: metrics?.sleep?.avg
						},
						intenseMinutes: {
							avg: metrics?.intenseMinutes?.avg,
							total: metrics?.intenseMinutes?.sum
						},
						heartRate: {
							avg: metrics?.heartRate?.avg,
							min: metrics?.heartRate?.min,
							max: metrics?.heartRate?.max
						}
					},
					message: `Latest data from ${latest.periodKey} with ${latest.eventCount} measurements`
				};
			}

			// Get summary for a specific period
			if (queryType === 'period_summary') {
				if (!period) {
					return {
						success: false,
						message: 'period required for period_summary'
					};
				}

				// If no periodKey specified, get the latest period
				if (!periodKey) {
					const latestAggregate = await db.query.sensorAggregates.findFirst({
						where: and(
							eq(sensorAggregates.userId, userId),
							eq(sensorAggregates.period, period)
						),
						orderBy: [desc(sensorAggregates.year), desc(sensorAggregates.periodKey)]
					});

					if (!latestAggregate) {
						return {
							success: false,
							message: `No ${period} data found`
						};
					}

					periodKey = latestAggregate.periodKey;
				}

				const aggregate = await db.query.sensorAggregates.findFirst({
					where: and(
						eq(sensorAggregates.userId, userId),
						eq(sensorAggregates.period, period),
						eq(sensorAggregates.periodKey, periodKey)
					)
				});

				if (!aggregate) {
					return {
						success: false,
						message: `No data found for ${periodKey}`
					};
				}

				const metrics = aggregate.metrics as any;

				return {
					success: true,
					data: {
						period: aggregate.periodKey,
						eventCount: aggregate.eventCount,
						weight: metrics?.weight,
						steps: metrics?.steps,
						sleep: metrics?.sleep,
						intenseMinutes: metrics?.intenseMinutes,
						heartRate: metrics?.heartRate,
						calories: metrics?.calories,
						distance: metrics?.distance
					},
					message: `Summary for ${periodKey} based on ${aggregate.eventCount} measurements`
				};
			}

			// Get trend across multiple periods
			if (queryType === 'trend') {
				if (!period) {
					return {
						success: false,
						message: 'period required for trend query'
					};
				}

				const aggregates = await db.query.sensorAggregates.findMany({
					where: and(
						eq(sensorAggregates.userId, userId),
						eq(sensorAggregates.period, period)
					),
					orderBy: [desc(sensorAggregates.year), desc(sensorAggregates.periodKey)],
					limit: limit || 12 // Default to last 12 periods
				});

				console.log(`   Found ${aggregates.length} aggregates, showing top 5 periods:`, 
					aggregates.slice(0, 5).map(a => a.periodKey));

				if (aggregates.length === 0) {
					return {
						success: false,
						message: 'No aggregate data found'
					};
				}

				const trendData = aggregates.map(agg => {
					const metrics = agg.metrics as any;
					return {
						period: agg.periodKey,
						weight: metrics?.weight?.avg,
						weightChange: metrics?.weight?.change,
						steps: metrics?.steps?.avg,
						sleep: metrics?.sleep?.avg,
						intenseMinutes: metrics?.intenseMinutes?.sum,
						heartRate: metrics?.heartRate?.avg,
						eventCount: agg.eventCount
					};
				});

				return {
					success: true,
					data: trendData,
					message: `Trend data for last ${aggregates.length} ${period}s`
				};
			}

			// Get raw sensor events
			if (queryType === 'raw_events') {
				const conditions = [eq(sensorEvents.userId, userId)];

				// Default to last 90 days if no date range specified
				if (!startDate && !endDate) {
					const ninetyDaysAgo = new Date();
					ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
					conditions.push(gte(sensorEvents.timestamp, ninetyDaysAgo));
				} else {
					if (startDate) {
						conditions.push(gte(sensorEvents.timestamp, new Date(startDate)));
					}
					if (endDate) {
						conditions.push(lte(sensorEvents.timestamp, new Date(endDate)));
					}
				}

				// Filter by dataType if metric specified  
				if (metric && metric !== 'all') {
					if (metric === 'weight') {
						conditions.push(eq(sensorEvents.dataType, 'weight'));
					} else if (metric === 'steps' || metric === 'intense_minutes') {
						conditions.push(eq(sensorEvents.dataType, 'activity'));
					} else if (metric === 'sleep' || metric === 'heartrate') {
						// Both sleep and heartrate come from sleep measurements
						conditions.push(eq(sensorEvents.dataType, 'sleep'));
					} else if (metric === 'workouts') {
						conditions.push(eq(sensorEvents.dataType, 'workout'));
					}
				}

				const events = await db.query.sensorEvents.findMany({
					where: and(...conditions),
					orderBy: [desc(sensorEvents.timestamp)],
					limit: limit || 100
				});

				console.log(`   Found ${events.length} raw events (metric: ${metric || 'all'})`);

				if (events.length === 0) {
					return {
						success: false,
						message: 'No raw events found for the specified criteria'
					};
				}

				return {
					success: true,
					data: events.map(e => ({
						timestamp: e.timestamp,
						eventType: e.eventType,
						dataType: e.dataType,
						data: e.data
					})),
					message: `Found ${events.length} raw ${metric || 'sensor'} events`
				};
			}

			return {
				success: false,
				message: 'Invalid queryType'
			};

		} catch (error) {
			console.error('Error querying sensor data:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}
};
