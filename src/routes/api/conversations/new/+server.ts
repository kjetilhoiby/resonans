import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { ensureDefaultUser, DEFAULT_USER_ID } from '$lib/server/users';

export const POST: RequestHandler = async () => {
	try {
		await ensureDefaultUser();

		// Opprett ny samtale
		const [newConversation] = await db.insert(conversations).values({
			userId: DEFAULT_USER_ID,
			title: `Ny samtale - ${new Date().toLocaleDateString('no-NO')}`
		}).returning();

		return json({ 
			success: true,
			conversationId: newConversation.id 
		});
	} catch (error) {
		console.error('Error creating new conversation:', error);
		return json(
			{ error: 'Failed to create new conversation' },
			{ status: 500 }
		);
	}
};
