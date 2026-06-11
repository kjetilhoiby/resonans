/**
 * API-laget for WeekTasks — all nettverks-I/O løftet ut av komponenten.
 * Komponenten tar `api: WeekTasksApi` som prop (default: denne implementasjonen),
 * slik at /design kan injisere en mock og rendre uten nettverk.
 *
 * Merk: deleteTask/updateTaskTitle bruker relative form actions (`?/…`) og
 * fungerer derfor bare på /ukeplan — som er eneste sted real-API-et brukes.
 */
import { goto, invalidateAll } from '$app/navigation';
import type { ProcedureMatch, WeekTask } from './types';

export interface WeekTasksApi {
	/** Finn matchende oppskrift for en oppgavetittel, eller null. */
	matchProcedure(taskTitle: string): Promise<ProcedureMatch | null>;
	/** Hent full oppskrift for sheet-visning, eller null. */
	getProcedure(procedureId: string): Promise<unknown | null>;
	/** Legg oppskriftens punkter inn i en sjekkliste. */
	applyProcedure(procedureId: string, checklistId: string): Promise<void>;
	/** Opprett samtale om oppgaven og naviger til den. */
	startTaskChat(task: Pick<WeekTask, 'id' | 'title'>): Promise<void>;
	deleteTask(taskId: string): Promise<void>;
	updateTaskTitle(taskId: string, title: string): Promise<void>;
}

export const weekTasksApi: WeekTasksApi = {
	async matchProcedure(taskTitle) {
		try {
			const res = await fetch('/api/procedures/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ taskTitle })
			});
			const { matches } = await res.json();
			if (matches?.length > 0) {
				return { procedureId: matches[0].procedureId, title: matches[0].title, emoji: matches[0].emoji };
			}
		} catch {
			/* ignore */
		}
		return null;
	},

	async getProcedure(procedureId) {
		try {
			const res = await fetch(`/api/procedures/${procedureId}`);
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	},

	async applyProcedure(procedureId, checklistId) {
		await fetch(`/api/procedures/${procedureId}/apply`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ checklistId })
		});
		await invalidateAll();
	},

	async startTaskChat(task) {
		try {
			const res = await fetch('/api/conversations/new', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: `Oppgave: ${task.title}`,
					sourceContext: { sourceTaskId: task.id, sourceItemText: task.title }
				})
			});
			if (!res.ok) {
				goto('/samtaler');
				return;
			}
			const { conversationId } = await res.json();
			goto(`/samtaler?conversation=${conversationId}`);
		} catch {
			goto('/samtaler');
		}
	},

	async deleteTask(taskId) {
		const fd = new FormData();
		fd.set('taskId', taskId);
		await fetch('?/deleteTask', { method: 'POST', body: fd });
		await invalidateAll();
	},

	async updateTaskTitle(taskId, title) {
		const fd = new FormData();
		fd.set('taskId', taskId);
		fd.set('title', title);
		await fetch('?/updateTask', { method: 'POST', body: fd });
		await invalidateAll();
	}
};
