/**
 * Ren utvelgelse av nylig fullførte økter — fri for DB/LLM, så den er testbar.
 * Filtrer til økter med fullføring, sorter nyeste fullføring først, klipp til `limit`.
 */

export interface CompletableSession {
	completion?: { completedAt: string } | null;
}

export function pickRecentCompletedSessions<T extends CompletableSession>(
	sessions: T[],
	limit: number
): T[] {
	if (limit <= 0) return [];
	return sessions
		.filter((s) => s.completion)
		.sort((a, b) => b.completion!.completedAt.localeCompare(a.completion!.completedAt))
		.slice(0, limit);
}
