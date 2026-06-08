export type GoalTrackMeta = {
	kind?: string | null;
	window?: string | null;
	targetValue?: number | null;
	unit?: string | null;
	durationDays?: number | null;
};

export type GoalItem = {
	id: string;
	title: string;
	description: string | null;
	status: string;
	targetDate: Date | null;
	metadata: {
		metricId?: string | null;
		startDate?: string | null;
		endDate?: string | null;
		goalTrack?: GoalTrackMeta | null;
		intentStatus?: 'pending' | 'parsed' | 'failed' | null;
		intentError?: string | null;
		intentEvaluation?: {
			signalType?: string;
			window?: string;
			windowStart?: string;
			windowEnd?: string;
			currentValue?: number;
			targetValue?: number;
			comparator?: string;
			met?: boolean;
			lastEvaluatedAt?: string;
		} | null;
	} | null;
	createdAt: Date;
	category: {
		name: string;
		icon: string | null;
	} | null;
	tasks: Array<{
		id: string;
		title: string;
		frequency: string | null;
		status: string;
		targetValue: number | null;
		unit: string | null;
		progress: Array<{
			id: string;
			value: number | null;
			note: string | null;
			completedAt: Date;
			activity: {
				id: string;
				type: string;
				completedAt: Date;
				duration: number | null;
				note: string | null;
				metadata: any;
				metrics: Array<{
					id: string;
					metricType: string;
					value: string;
					unit: string | null;
				}>;
			} | null;
		}>;
	}>;
};

export type SensorProgress = {
	currentKm: number;
	targetKm: number;
	startDate: string;
	endDate: string;
	dailyKm: { date: string; km: number }[];
};

export type WeightProgress = {
	startDate: string;
	endDate: string;
	currentWeight: number;
	startWeight: number;
	targetWeight: number;
	points: { date: string; weight: number }[];
	pct: number;
};

export type PaceEstimate = {
	diffLabel: string;
	diffTone: 'ahead' | 'behind' | 'neutral';
	estimateLabel: string;
	estimateTone: 'ahead' | 'behind' | 'neutral';
};
