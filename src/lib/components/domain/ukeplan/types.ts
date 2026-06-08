export type SaveState = 'idle' | 'saving' | 'saved';

export interface WeekDay {
	isoDate: string;
	label: string;
	day: string;
}

export interface WeekInfo {
	year: number;
	week: string;
	compactKey: string;
	dashedKey: string;
	contextKey: string;
	days: WeekDay[];
}

export interface ChecklistItem {
	id: string;
	text: string;
	checked: boolean;
	parentId?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	skippedAt?: string | null;
	snoozedToDate?: string | null;
	domain?: 'health' | 'economics' | 'food' | null;
	metadata?: {
		linkedTaskId?: string;
		linkedTaskTitle?: string;
		activityType?: string;
		durationMinutes?: number;
		distanceKm?: number;
		autoChecked?: boolean;
		timeHour?: number;
		timeMinute?: number;
		hasBreakdown?: boolean;
		kind?: 'location' | 'travel' | string;
		locationName?: string;
		travelMode?: 'drive' | 'boat' | 'flight';
		destination?: string;
	} | null;
}

export interface WeekChecklist {
	id: string;
	title: string;
	emoji: string;
	completedAt: string | null;
	planConversationId?: string | null;
	items: ChecklistItem[];
}

export interface WeekTask {
	id: string;
	title: string;
	frequency: string | null;
	targetValue: number | null;
	unit: string | null;
	metadata: any;
	repeatCount: number;
	completedCount: number;
	goalTitle: string | null;
	themeName: string | null;
}

export interface GoalReminder {
	id: string;
	title: string;
	targetDate: string | null;
	metadata: any;
	sensorProgress:
		| {
				kind: 'running_distance';
				currentKm: number;
				expectedKm: number;
				targetKm: number;
				status: 'green' | 'yellow' | 'red';
		  }
		| {
				kind: 'weight_change';
				startDate: string;
				endDate: string;
				startWeight: number;
				currentWeight: number;
				expectedWeight: number;
				targetWeight: number;
				status: 'green' | 'yellow' | 'red';
				points: { date: string; weight: number }[];
		  }
		| null;
}

export interface DayChecklist {
	id: string;
	title: string;
	completedAt: string | null;
	items: ChecklistItem[];
}

export interface EditingItem {
	checklistId: string;
	itemId: string;
	text: string;
}

export interface EditingTask {
	taskId: string;
	title: string;
	originalTitle: string;
}

export interface ProcedureMatch {
	procedureId: string;
	title: string;
	emoji: string | null;
}

export interface SpondEvent {
	id: string;
	name: string;
	startTimestamp: string;
	endTimestamp: string;
	cancelled: boolean;
	groupName: string | null;
	location: { name: string | null; address: string | null } | null;
	rsvp: 'accepted' | 'declined' | 'unanswered' | 'unknown';
	spondEventId: string | null;
}

export interface DayRoutine {
	definitionId: string;
	checklistId: string;
	title: string;
	emoji: string;
	slot: string;
	completedAt: string | null;
	items: Array<{
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		estimateMinutes: number | null;
	}>;
}

export interface ActiveTrip {
	id: string;
	name: string;
	emoji: string | null;
	destination: string | null;
	startDate: string;
	endDate: string;
}
