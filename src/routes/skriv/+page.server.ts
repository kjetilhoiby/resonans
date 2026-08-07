import type { PageServerLoad } from './$types';
import { listProjects } from '$lib/server/writing/projects';

export const load: PageServerLoad = async ({ locals }) => {
	const projects = await listProjects(locals.userId);
	return {
		projects: projects.map((p) => ({
			id: p.id,
			title: p.title,
			genre: p.genre,
			summary: p.summary,
			status: p.status,
			updatedAt: p.updatedAt.toISOString()
		}))
	};
};
