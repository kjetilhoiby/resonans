import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertReflectionForPeriod } from '$lib/server/reflections';

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

	await upsertReflectionForPeriod({
		userId,
		kind: 'salary_report',
		periodKey: salaryMonth,
		content
	});

	return json({ ok: true });
};
