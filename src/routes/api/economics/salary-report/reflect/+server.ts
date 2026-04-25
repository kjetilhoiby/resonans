import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { memories } from '$lib/db/schema';
import type { RequestHandler } from './$types';

interface StepReflection {
	insightId: string;
	title: string;
	messages: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;

	const body = await request.json();
	const { salaryMonth, reflection } = body as {
		salaryMonth: string;
		reflection: StepReflection[];
	};

	if (!salaryMonth || !Array.isArray(reflection)) {
		return json({ error: 'Invalid payload' }, { status: 400 });
	}

	const source = `salary_reflection_${salaryMonth}`;

	const lines: string[] = [`Lønnsrefleksjon for ${salaryMonth}:`];
	for (const step of reflection) {
		const userMsgs = step.messages.filter((m) => m.role === 'user');
		if (userMsgs.length === 0) continue;
		lines.push(`\n### ${step.title}`);
		for (const m of userMsgs) {
			lines.push(`- ${m.text}`);
		}
	}
	const content = lines.join('\n');

	const existing = await db.query.memories.findFirst({
		where: and(eq(memories.userId, userId), eq(memories.source, source)),
		columns: { id: true }
	});

	if (existing) {
		await db
			.update(memories)
			.set({ content, updatedAt: new Date(), lastAccessedAt: new Date() })
			.where(eq(memories.id, existing.id));
	} else {
		await db.insert(memories).values({
			userId,
			category: 'economics',
			content,
			importance: 'medium',
			source
		});
	}

	return json({ ok: true });
};
