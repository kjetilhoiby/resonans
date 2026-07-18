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
		linkedChecklistItemId?: string;
		activityType?: string;
		autoChecked?: boolean;
		hasBreakdown?: boolean;
		/** 'livskompass' for kompass-mål ført opp fra livskompass-coachingen. */
		source?: string;
		/** Livskompass-dimensjonen et kompass-mål skal heve (f.eks. 'egentid'). */
		livskompassDimension?: string;
		[key: string]: unknown;
	} | null;
}
