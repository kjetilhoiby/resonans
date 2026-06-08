export async function patchItem(
	checklistId: string,
	itemId: string,
	data: Record<string, unknown>
): Promise<boolean> {
	const res = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	});
	return res.ok;
}

export async function deleteItem(checklistId: string, itemId: string): Promise<boolean> {
	const res = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
		method: 'DELETE',
	});
	return res.ok;
}

export async function addItems(
	checklistId: string,
	text: string,
	sortOrder: number,
	parentId?: string
): Promise<unknown[] | null> {
	const body: Record<string, unknown> = { text, sortOrder };
	if (parentId) body.parentId = parentId;
	const res = await fetch(`/api/checklists/${checklistId}/items`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) return null;
	return res.json();
}
