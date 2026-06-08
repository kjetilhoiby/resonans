export interface ChecklistItemLike {
	id: string;
	text: string;
	checked: boolean;
	sortOrder?: number;
	parentId?: string | null;
	skippedAt?: string | null;
	metadata?: {
		timeHour?: number;
		timeMinute?: number;
		kind?: string;
		locationName?: string;
		travelMode?: 'drive' | 'boat' | 'flight';
		destination?: string;
		linkedTaskId?: string;
		linkedTaskTitle?: string;
		activityType?: string;
		autoChecked?: boolean;
		hasBreakdown?: boolean;
		[key: string]: unknown;
	} | null;
}
