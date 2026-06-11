/**
 * Nettverkslag for ShareSheet — injiseres som mock på /design.
 */
export type ShareItem = {
	id: string;
	token: string;
	accessMode: 'read' | 'write';
	allowedEmail: string | null;
	label: string | null;
	expiresAt: string | Date | null;
	lastAccessedAt: string | Date | null;
	accessCount: number;
	createdAt: string | Date;
};

export interface ShareApi {
	loadShares(resourceType: string, resourceId: string): Promise<ShareItem[]>;
	createShare(input: {
		resourceType: string;
		resourceId: string;
		accessMode: 'read' | 'write';
		allowedEmail: string | null;
		label: string | null;
		expiresInDays: number | null;
	}): Promise<{ ok: true; token: string } | { ok: false; error: string }>;
	revokeShare(id: string): Promise<boolean>;
}

export const shareApi: ShareApi = {
	async loadShares(resourceType, resourceId) {
		const res = await fetch(`/api/share?resourceType=${resourceType}&resourceId=${resourceId}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	},

	async createShare(input) {
		const res = await fetch('/api/share', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		const data = await res.json();
		if (!res.ok) return { ok: false, error: data.error ?? `Feil: HTTP ${res.status}` };
		return { ok: true, token: data.token };
	},

	async revokeShare(id) {
		const res = await fetch(`/api/share/${id}`, { method: 'DELETE' });
		return res.ok;
	}
};
