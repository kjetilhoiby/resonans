/**
 * Nettverkslag for ProcedureSheet — injiseres som mock på /design.
 */
export interface ProcedureSheetApi {
	/** PATCH mot oppskriften (shared-toggle eller nye steps). */
	updateProcedure(procedureId: string, patch: { shared?: boolean; steps?: string[] }): Promise<void>;
}

export const procedureSheetApi: ProcedureSheetApi = {
	async updateProcedure(procedureId, patch) {
		await fetch(`/api/procedures/${procedureId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
	}
};
