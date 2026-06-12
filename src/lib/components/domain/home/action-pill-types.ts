/**
 * Minimumstype for pills i ActionPillRow.
 * Sonen kan sende rikere objekter (f.eks. HomeContext.ActionItem) —
 * komponenten er generisk over T extends ActionPillItem.
 */
export interface ActionPillItem {
	id: string;
	icon: string;
	label: string;
	value?: string | number;
	done: boolean;
}
