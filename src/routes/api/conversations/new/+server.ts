import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { ensureUser } from '$lib/server/users';

export const POST: RequestHandler = async ({ locals }) => {
	try {
		await ensureUser(locals.userId);

		// Opprett ny samtale
		const [newConversation] = await db.insert(conversations).values({
			userId: locals.userId,
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
