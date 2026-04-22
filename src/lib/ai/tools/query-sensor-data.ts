import { z } from 'zod';
import { db } from '$lib/db';
import { sensorEvents, sensorAggregates } from '$lib/db/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';

type SensorMetric = 'weight' | 'steps' | 'sleep' | 'intense_minutes' | 'heartrate' | 'workouts' | 'relationship' | 'all';

function metricToDataType(metric?: SensorMetric): string | null {
	if (!metric || metric === 'all') return null;
	if (metric === 'weight') return 'weight';
	if (metric === 'steps' || metric === 'intense_minutes') return 'activity';
	if (metric === 'sleep' || metric === 'heartrate') return 'sleep';
	if (metric === 'workouts') return 'workout';
	if (metric === 'relationship') return 'relationship_checkin';
	return null;
}

function startForPeriod(period: 'week' | 'month' | 'year', limit: number): Date {
	const now = new Date();
	if (period === 'week') {
		const d = new Date(now);
		d.setDate(d.getDate() - 7 * Math.max(1, limit));
		return d;
	}
	if (period === 'month') {
		const d = new Date(now);
		d.setMonth(d.getMonth() - Math.max(1, limit));
		return d;
	}
	const d = new Date(now);
	d.setFullYear(d.getFullYear() - Math.max(1, limit));
	return d;
}

function isoWeekStart(year: number, week: number): Date {
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const mondayWeek1 = new Date(jan4);
	mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
	const start = new Date(mondayWeek1);
	start.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
	return start;
}

function normalizePeriodKey(period: 'week' | 'month' | 'year', periodKey: string): string[] {
	const raw = periodKey.trim();
	const candidates = new Set<string>([raw]);

	if (period === 'month') {
		const compact = raw.match(/^(\d{4})M(\d{1,2})$/i);
		if (compact) {
			const m = compact[2].padStart(2, '0');
			candidates.add(`${compact[1]}M${m}`);
			candidates.add(`${compact[1]}-${m}`);
		}

		const dashed = raw.match(/^(\d{4})[-/](\d{1,2})$/);
		if (dashed) {
			const m = dashed[2].padStart(2, '0');
			candidates.add(`${dashed[1]}M${m}`);
			candidates.add(`${dashed[1]}-${m}`);
		}
	}

	if (period === 'week') {
		const compact = raw.match(/^(\d{4})W(\d{1,2})$/i);
		if (compact) {
			const w = compact[2].padStart(2, '0');
			candidates.add(`${compact[1]}W${w}`);
			candidates.add(`${compact[1]}-W${w}`);
		}

		const dashed = raw.match(/^(\d{4})[-/]?W?(\d{1,2})$/i);
		if (dashed) {
			const w = dashed[2].padStart(2, '0');
			candidates.add(`${dashed[1]}W${w}`);
			candidates.add(`${dashed[1]}-W${w}`);
		}
	}

	if (period === 'year') {
		const year = raw.match(/^(\d{4})$/);
		if (year) candidates.add(year[1]);
	}

	return Array.from(candidates);
}

function normalizeTrendStartKey(period: 'week' | 'month' | 'year', periodKey?: string): string | null {
	if (!periodKey) return null;
	const raw = periodKey.trim();

	if (period === 'year') {
		const year = raw.match(/^(\d{4})$/);
		return year ? year[1] : null;
	}

	if (period === 'month') {
		const yearOnly = raw.match(/^(\d{4})$/);
		if (yearOnly) return `${yearOnly[1]}M01`;
		const normalized = normalizePeriodKey('month', raw).find((k) => /^\d{4}M\d{2}$/.test(k));
		return normalized ?? null;
	}

	const yearOnly = raw.match(/^(\d{4})$/);
	if (yearOnly) return `${yearOnly[1]}W01`;
	const normalized = normalizePeriodKey('week', raw).find((k) => /^\d{4}W\d{2}$/.test(k));
	return normalized ?? null;
}

function defaultTrendLimit(period: 'week' | 'month' | 'year'): number {
	if (period === 'month') return 120;
	if (period === 'week') return 104;
	return 20;
}

function rangeForPeriodKey(period: 'week' | 'month' | 'year', periodKey?: string): { startDate: string; endDate: string; label: string } {
	if (!periodKey) {
		const now = new Date();
		if (period === 'month') {
			const y = now.getFullYear();
			const m = now.getMonth();
			const start = new Date(Date.UTC(y, m, 1, 0, 0, 0));
			const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59));
			return {
				startDate: start.toISOString(),
				endDate: end.toISOString(),
				label: `${y}M${String(m + 1).padStart(2, '0')}`
			};
		}
		if (period === 'year') {
			const y = now.getFullYear();
			const start = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
			const end = new Date(Date.UTC(y, 11, 31, 23, 59, 59));
			return {
				startDate: start.toISOString(),
				endDate: end.toISOString(),
				label: String(y)
			};
		}

		const tmp = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
		const day = tmp.getUTCDay() || 7;
		tmp.setUTCDate(tmp.getUTCDate() - (day - 1));
		const start = new Date(tmp);
		const end = new Date(tmp);
		end.setUTCDate(start.getUTCDate() + 6);
		end.setUTCHours(23, 59, 59, 0);
		const year = start.getUTCFullYear();
		const week = Math.ceil((((start.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7);
		return {
			startDate: start.toISOString(),
			endDate: end.toISOString(),
			label: `${year}W${String(week).padStart(2, '0')}`
		};
	}

	if (period === 'month') {
		const normalized = normalizePeriodKey('month', periodKey).find((k) => /^\d{4}M\d{2}$/.test(k));
		if (normalized) {
			const year = Number.parseInt(normalized.slice(0, 4), 10);
			const month = Number.parseInt(normalized.slice(5, 7), 10);
			const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
			const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
			return { startDate: start.toISOString(), endDate: end.toISOString(), label: normalized };
		}
	}

	if (period === 'week') {
		const normalized = normalizePeriodKey('week', periodKey).find((k) => /^\d{4}W\d{2}$/.test(k));
		if (normalized) {
			const year = Number.parseInt(normalized.slice(0, 4), 10);
			const week = Number.parseInt(normalized.slice(5, 7), 10);
			const start = isoWeekStart(year, week);
			const end = new Date(start);
			end.setUTCDate(start.getUTCDate() + 6);
			end.setUTCHours(23, 59, 59, 0);
			return { startDate: start.toISOString(), endDate: end.toISOString(), label: normalized };
		}
	}

	if (period === 'year') {
		const year = Number.parseInt(periodKey.slice(0, 4), 10);
		if (Number.isFinite(year)) {
			const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
			const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
			return { startDate: start.toISOString(), endDate: end.toISOString(), label: String(year) };
		}
	}

	const fallbackStart = startForPeriod(period, 1);
	return {
		startDate: fallbackStart.toISOString(),
		endDate: new Date().toISOString(),
		label: periodKey
	};
}

function summarizeRawEvents(events: Array<{ timestamp: Date; dataType: string; data: any }>, metric?: SensorMetric) {
	const safeMetric = metric ?? 'all';

	const weightValues = events
		.map((e) => (typeof e.data?.weight === 'number' ? e.data.weight as number : null))
		.filter((v): v is number => v !== null)
		.reverse();

	const stepsValues = events
		.map((e) => (typeof e.data?.steps === 'number' ? e.data.steps as number : null))
		.filter((v): v is number => v !== null);

	const sleepValues = events
		.map((e) => (typeof e.data?.sleepDuration === 'number' ? (e.data.sleepDuration as number) / 3600 : null))
		.filter((v): v is number => v !== null);

	const intenseValues = events
		.map((e) => (typeof e.data?.intenseMinutes === 'number' ? e.data.intenseMinutes as number : null))
		.filter((v): v is number => v !== null);

	const heartValues = events
		.map((e) => {
			if (typeof e.data?.heartRate === 'number') return e.data.heartRate as number;
			if (typeof e.data?.hr === 'number') return e.data.hr as number;
			return null;
		})
		.filter((v): v is number => v !== null);

	const workouts = events.filter((e) => e.dataType === 'workout');
	let workoutDistanceKm = 0;
	for (const w of workouts) {
		const distance = typeof w.data?.distanceMeters === 'number'
			? (w.data.distanceMeters as number) / 1000
			: typeof w.data?.distance === 'number'
				? ((w.data.distance as number) > 100 ? (w.data.distance as number) / 1000 : (w.data.distance as number))
				: 0;
		workoutDistanceKm += distance;
	}

	const avg = (vals: number[]) => vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;

	const relationshipValues = events
		.filter((e) => e.dataType === 'relationship_checkin')
		.map((e) => {
			if (typeof e.data?.score !== 'number') return null;
			return {
				day: typeof e.data?.day === 'string' ? e.data.day : e.timestamp.toISOString().slice(0, 10),
				score: e.data.score as number,
				note: typeof e.data?.note === 'string' ? e.data.note : null
			};
		})
		.filter((row): row is { day: string; score: number; note: string | null } => row !== null)
		.reverse();

	const response: Record<string, unknown> = {
		eventCount: events.length
	};

	if (safeMetric === 'all' || safeMetric === 'weight') {
		response.weight = weightValues.length
			? {
				latest: weightValues[weightValues.length - 1],
				avg: avg(weightValues),
				min: Math.min(...weightValues),
				max: Math.max(...weightValues),
				change: weightValues.length > 1 ? weightValues[weightValues.length - 1] - weightValues[0] : 0
			}
			: undefined;
	}

	if (safeMetric === 'all' || safeMetric === 'steps') {
		response.steps = stepsValues.length
			? {
				sum: stepsValues.reduce((s, v) => s + v, 0),
				avg: avg(stepsValues),
				max: Math.max(...stepsValues)
			}
			: undefined;
	}

	if (safeMetric === 'all' || safeMetric === 'sleep') {
		response.sleep = sleepValues.length
			? {
				avg: avg(sleepValues),
				min: Math.min(...sleepValues),
				max: Math.max(...sleepValues)
			}
			: undefined;
	}

	if (safeMetric === 'all' || safeMetric === 'intense_minutes') {
		response.intenseMinutes = intenseValues.length
			? {
				sum: intenseValues.reduce((s, v) => s + v, 0),
				avg: avg(intenseValues)
			}
			: undefined;
	}

	if (safeMetric === 'all' || safeMetric === 'heartrate') {
		response.heartRate = heartValues.length
			? {
				avg: avg(heartValues),
				min: Math.min(...heartValues),
				max: Math.max(...heartValues)
			}
			: undefined;
	}

	if (safeMetric === 'all' || safeMetric === 'workouts') {
		response.workouts = workouts.length
			? {
				count: workouts.length,
				totalDistance: workoutDistanceKm
			}
			: undefined;
	}

	if (safeMetric === 'all' || safeMetric === 'relationship') {
		response.relationship = relationshipValues.length
			? {
				latest: relationshipValues[relationshipValues.length - 1],
				avg: avg(relationshipValues.map((row) => row.score)),
				min: Math.min(...relationshipValues.map((row) => row.score)),
				max: Math.max(...relationshipValues.map((row) => row.score)),
				eventCount: relationshipValues.length
			}
			: undefined;
	}

	return response;
}

async function loadRawEventsFallback(args: {
	userId: string;
	metric?: SensorMetric;
	startDate?: string;
	endDate?: string;
	limit?: number;
}) {
	const conditions = [eq(sensorEvents.userId, args.userId)];

	if (args.startDate) {
		conditions.push(gte(sensorEvents.timestamp, new Date(args.startDate)));
	}
	if (args.endDate) {
		conditions.push(lte(sensorEvents.timestamp, new Date(args.endDate)));
	}

	const dataType = metricToDataType(args.metric);
	if (dataType) {
		conditions.push(eq(sensorEvents.dataType, dataType));
	}

	const events = await db.query.sensorEvents.findMany({
		where: and(...conditions),
		orderBy: [desc(sensorEvents.timestamp)],
		limit: args.limit ?? 200
	});

	return events.filter(
		(event): event is typeof event & { dataType: string; data: Record<string, unknown> } =>
			typeof event.dataType === 'string' && event.data !== null
	);
}

export const querySensorDataTool = {
	name: 'query_sensor_data',
	description: `Query sensor data (health metrics from Withings) to answer questions about user's health patterns.

Use this tool when user asks about:
- Weight trends: "How's my weight doing?", "Have I lost weight this month?"
- Activity patterns: "How many steps did I take last week?", "Am I exercising enough?"
- Sleep quality: "How am I sleeping?", "Did I sleep well last night?"
- Intense exercise: "Am I getting enough intense exercise?"
- Workouts: "What workouts did I do?", "How many kilometers did I run this month?"
- Relationship check-ins: "Hvordan har vi hatt det den siste uka?", "Vis parsjekk-score"
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
		periodKey: z.string().optional().describe('Specific period (e.g., "2025W43" or "2025-W43", "2025M10" or "2025-10", "2025")'),
		metric: z.enum(['weight', 'steps', 'sleep', 'intense_minutes', 'heartrate', 'workouts', 'relationship', 'all']).optional().describe('Which metric to focus on'),
		limit: z.number().optional().describe('Max number of results (for raw_events or trend)'),
		startDate: z.string().optional().describe('Start date for raw events (ISO format)'),
		endDate: z.string().optional().describe('End date for raw events (ISO format)')
	}),

	execute: async (args: {
		userId: string;
		queryType: 'latest' | 'period_summary' | 'trend' | 'raw_events';
		period?: 'week' | 'month' | 'year';
		periodKey?: string;
			metric?: SensorMetric;
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
					const fallbackEvents = await loadRawEventsFallback({
						userId,
						metric,
						startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
						limit: 50
					});

					if (fallbackEvents.length === 0) {
						return {
							success: false,
							message:
								'Fant ingen sensordata i verken sensor_aggregates eller sensor_events. Bruker må sannsynligvis synke Withings-data.'
						};
					}

					const latestEvent = fallbackEvents[0];
					const latestWeight = typeof latestEvent.data?.weight === 'number' ? latestEvent.data.weight : null;

					return {
						success: true,
						data: {
							source: 'sensor_events_fallback',
							latestTimestamp: latestEvent.timestamp,
							latestWeight,
							eventCount: fallbackEvents.length,
							items: fallbackEvents.slice(0, 10).map((e) => ({
								timestamp: e.timestamp,
								dataType: e.dataType,
								data: e.data
							}))
						},
						message:
							'Mangler pre-aggregerte data, men fant rå sensordata i sensor_events. Svar er basert på fallback.'
					};
				}

				const latest = weeklyAggregates[0];
				const metrics = latest.metrics as any;

				// Build response based on requested metric (default: all)
				const allMetrics = {
					weight: metrics?.weight ? {
						current: metrics.weight.latest,
						avg: metrics.weight.avg,
						change: metrics.weight.change
					} : undefined,
					steps: metrics?.steps ? {
						avg: metrics.steps.avg,
						total: metrics.steps.sum
					} : undefined,
					sleep: metrics?.sleep ? {
						avg: metrics.sleep.avg
					} : undefined,
					intenseMinutes: metrics?.intenseMinutes ? {
						avg: metrics.intenseMinutes.avg,
						total: metrics.intenseMinutes.sum
					} : undefined,
					heartRate: metrics?.heartRate ? {
						avg: metrics.heartRate.avg,
						min: metrics.heartRate.min,
						max: metrics.heartRate.max
					} : undefined,
					workouts: metrics?.workouts ? {
						count: metrics.workouts.count,
						totalDistance: metrics.workouts.totalDistance,
						totalDuration: metrics.workouts.totalDuration
					} : undefined,
					distance: metrics?.distance ? {
						total: metrics.distance.sum,
						avg: metrics.distance.avg
					} : undefined
				};

				// Filter by metric if specified
				let responseData: any = { period: latest.periodKey };
				if (metric && metric !== 'all') {
					// Return only the requested metric
					if (metric === 'workouts') {
						// For workouts, include both workouts count and distance data
						if (allMetrics.workouts) {
							responseData.workouts = allMetrics.workouts;
						}
						if (allMetrics.distance) {
							responseData.distance = allMetrics.distance;
						}
						if (!allMetrics.workouts && !allMetrics.distance) {
							return {
								success: false,
								message: `No workout or distance data found for ${latest.periodKey}`
							};
						}
					} else {
						const metricMap: Partial<Record<SensorMetric, unknown>> = {
							weight: allMetrics.weight,
							steps: allMetrics.steps,
							sleep: allMetrics.sleep,
							intense_minutes: allMetrics.intenseMinutes,
							heartrate: allMetrics.heartRate
						} as const;

						const selectedMetric = metricMap[metric];
						if (!selectedMetric) {
							return {
								success: false,
								message: `No ${metric} data found for ${latest.periodKey}`
							};
						}

						responseData[metric] = selectedMetric;
					}
				} else {
					// Return all available metrics
					responseData = { period: latest.periodKey, ...allMetrics };
				}

				return {
					success: true,
					data: responseData,
					message: metric && metric !== 'all' 
						? `Latest ${metric} data from ${latest.periodKey}` 
						: `Latest data from ${latest.periodKey} with ${latest.eventCount} measurements`
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

				const candidateKeys = normalizePeriodKey(period, periodKey);
				let aggregate: Awaited<ReturnType<typeof db.query.sensorAggregates.findFirst>> | null = null;

				for (const key of candidateKeys) {
					aggregate = await db.query.sensorAggregates.findFirst({
						where: and(
							eq(sensorAggregates.userId, userId),
							eq(sensorAggregates.period, period),
							eq(sensorAggregates.periodKey, key)
						)
					});
					if (aggregate) break;
				}

				if (!aggregate) {
					const range = rangeForPeriodKey(period, periodKey);
					const fallbackEvents = await loadRawEventsFallback({
						userId,
						metric,
						startDate: range.startDate,
						endDate: range.endDate,
						limit: 1500
					});

					if (fallbackEvents.length === 0) {
						return {
							success: false,
							message: `No data found for ${periodKey}`
						};
					}

					const summary = summarizeRawEvents(fallbackEvents, metric);
					return {
						success: true,
						data: {
							period: range.label,
							...summary
						},
						message: `Summary for ${range.label} from raw sensor events (${fallbackEvents.length} measurements)`
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

				const requestedStartKey = normalizeTrendStartKey(period, periodKey);
				const trendLimit = limit ?? (requestedStartKey ? 240 : defaultTrendLimit(period));

				const aggregates = await db.query.sensorAggregates.findMany({
					where: and(
						eq(sensorAggregates.userId, userId),
						eq(sensorAggregates.period, period)
					),
					orderBy: [desc(sensorAggregates.year), desc(sensorAggregates.periodKey)],
					limit: trendLimit
				});

				const filteredAggregates = requestedStartKey
					? aggregates.filter((a) => a.periodKey >= requestedStartKey)
					: aggregates;

				console.log(
					`   Found ${filteredAggregates.length}/${aggregates.length} aggregates, showing top 5 periods:`,
					filteredAggregates.slice(0, 5).map((a) => a.periodKey)
				);

				if (filteredAggregates.length === 0) {
					const fallbackStart = requestedStartKey
						? new Date(rangeForPeriodKey(period, requestedStartKey).startDate)
						: startForPeriod(period, trendLimit);
					const fallbackEvents = await loadRawEventsFallback({
						userId,
						metric,
						startDate: fallbackStart.toISOString(),
						limit: requestedStartKey ? 3000 : 600
					});

					if (fallbackEvents.length === 0) {
						return {
							success: false,
							message: 'Ingen trenddata funnet i sensor_aggregates eller sensor_events'
						};
					}

					if (metric === 'weight' || !metric || metric === 'all') {
						const weightPoints = fallbackEvents
							.filter((e) => typeof e.data?.weight === 'number')
							.map((e) => ({
								timestamp: e.timestamp,
								weight: e.data!.weight as number
							}))
							.reverse();

						return {
							success: true,
							data: {
								source: 'sensor_events_fallback',
								metric: 'weight',
								points: weightPoints,
								eventCount: weightPoints.length
							},
							message:
								`Fant ingen aggregerte ${period}-perioder; returnerer ${weightPoints.length} rå vektmålinger fra sensor_events.`
						};
					}

					return {
						success: true,
						data: {
							source: 'sensor_events_fallback',
							metric: metric ?? 'all',
							events: fallbackEvents.map((e) => ({
								timestamp: e.timestamp,
								dataType: e.dataType,
								data: e.data
							}))
						},
						message:
							`Fant ingen aggregerte ${period}-perioder; returnerer rå hendelser fra sensor_events i stedet.`
					};
				}

				const trendData = filteredAggregates.map((agg) => {
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
					message: requestedStartKey
						? `Trend data for ${trendData.length} ${period}s from ${requestedStartKey}`
						: `Trend data for last ${trendData.length} ${period}s`
				};
			}

			// Get raw sensor events
			if (queryType === 'raw_events') {
				const conditions = [eq(sensorEvents.userId, userId)];
				let appliedRangeLabel: string | null = null;

				// Priority: explicit start/end -> period/periodKey -> last 90 days
				if (startDate || endDate) {
					if (startDate) {
						conditions.push(gte(sensorEvents.timestamp, new Date(startDate)));
					}
					if (endDate) {
						conditions.push(lte(sensorEvents.timestamp, new Date(endDate)));
					}
					appliedRangeLabel = startDate && endDate ? `${startDate}..${endDate}` : startDate ?? endDate ?? null;
				} else if (period) {
					const range = rangeForPeriodKey(period, periodKey);
					conditions.push(gte(sensorEvents.timestamp, new Date(range.startDate)));
					conditions.push(lte(sensorEvents.timestamp, new Date(range.endDate)));
					appliedRangeLabel = range.label;
				} else {
					const ninetyDaysAgo = new Date();
					ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
					conditions.push(gte(sensorEvents.timestamp, ninetyDaysAgo));
					appliedRangeLabel = 'last_90_days';
				}

				const dataType = metricToDataType(metric);
				if (dataType) {
					conditions.push(eq(sensorEvents.dataType, dataType));
				}

				const events = await db.query.sensorEvents.findMany({
					where: and(...conditions),
					orderBy: [desc(sensorEvents.timestamp)],
					limit: limit || (period ? 1500 : 100)
				});

				console.log(`   Found ${events.length} raw events (metric: ${metric || 'all'}, range: ${appliedRangeLabel || 'default'})`);

				if (events.length === 0) {
					return {
						success: false,
						message: 'No raw events found for the specified criteria'
					};
				}

				return {
					success: true,
					data: {
						range: appliedRangeLabel,
						events: events.map(e => ({
							timestamp: e.timestamp,
							eventType: e.eventType,
							dataType: e.dataType,
							data: e.data
						}))
					},
					message: `Found ${events.length} raw ${metric || 'sensor'} events${appliedRangeLabel ? ` for ${appliedRangeLabel}` : ''}`
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
