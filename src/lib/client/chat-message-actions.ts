/**
 * Klient-hjelpere for å redigere/slette en lagret chat-melding. Deles av
 * hjem-chatten og /samtaler slik at logikken ikke dupliseres.
 */

export async function patchMessageContent(
	conversationId: string,
	messageId: string,
	content: string
): Promise<boolean> {
	const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ content })
	});
	return res.ok;
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<boolean> {
	const res = await fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
		method: 'DELETE'
	});
	return res.ok;
}
