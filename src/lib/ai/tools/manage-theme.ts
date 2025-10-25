import { z } from 'zod';
import { db } from '$lib/db';
import { themes, goals, conversations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const manageThemeTool = {
	name: 'manage_theme',
	description: `Manage themes (topic areas) for organizing goals and conversations.
	
Use this tool to:
- Suggest creating a new theme when user discusses goals that don't fit existing themes
- Create a theme after user approves
- Suggest merging similar themes
- Archive unused themes

Examples of when to suggest new themes:
- User: "I want to work on my friendship with Jonas" → Suggest "Vennskap" under "Samliv"
- User: "I need to focus on running" → Suggest "Løping" under "Helse"
- User: "Work on relationship with parents" → Suggest "Familie" under "Samliv"

Be conversational and explain why a theme makes sense.`,

	parameters: z.object({
		action: z.enum(['suggest_create', 'create', 'list', 'archive']).describe(
			'suggest_create: Ask user if they want a new theme. create: Actually create it. list: Show existing themes. archive: Mark as archived.'
		),
		userId: z.string().describe('User ID'),
		name: z.string().optional().describe('Theme name (e.g., "Vennskap", "Løping")'),
		emoji: z.string().optional().describe('Emoji representing the theme (e.g., "🤝", "🏃‍♂️")'),
		parentTheme: z.string().optional().describe('Parent category (e.g., "Samliv", "Helse", "Foreldreliv", "Karriere")'),
		description: z.string().optional().describe('Brief description of what this theme covers'),
		reason: z.string().optional().describe('Explanation for why this theme is suggested (for user-facing messages)'),
		themeId: z.string().optional().describe('Theme ID (required for archive action)')
	}),

	execute: async (args: {
		action: 'suggest_create' | 'create' | 'list' | 'archive';
		userId: string;
		name?: string;
		emoji?: string;
		parentTheme?: string;
		description?: string;
		reason?: string;
		themeId?: string;
	}) => {
		const { action, userId, name, emoji, parentTheme, description, reason, themeId } = args;

		try {
			// List existing themes
			if (action === 'list') {
				const userThemes = await db.query.themes.findMany({
					where: and(
						eq(themes.userId, userId),
						eq(themes.archived, false)
					),
					orderBy: (themes, { desc }) => [desc(themes.createdAt)]
				});

				return {
					success: true,
					themes: userThemes.map(t => ({
						id: t.id,
						name: t.name,
						emoji: t.emoji,
						parentTheme: t.parentTheme,
						goalsCount: 0 // TODO: Count goals
					})),
					message: `Found ${userThemes.length} active themes`
				};
			}

			// Suggest creating a new theme (just returns suggestion, doesn't create)
			if (action === 'suggest_create') {
				if (!name) {
					return {
						success: false,
						error: 'Theme name is required for suggestions'
					};
				}

				return {
					success: true,
					suggestion: {
						name,
						emoji: emoji || '📁',
						parentTheme,
						description,
						reason: reason || `This will help organize your goals related to ${name.toLowerCase()}`
					},
					message: `Suggested theme: ${emoji || '📁'} ${name}${parentTheme ? ` (under ${parentTheme})` : ''}`
				};
			}

			// Create a new theme
			if (action === 'create') {
				if (!name) {
					return {
						success: false,
						error: 'Theme name is required'
					};
				}

				// Check if theme with same name already exists
				const existingTheme = await db.query.themes.findFirst({
					where: and(
						eq(themes.userId, userId),
						eq(themes.name, name),
						eq(themes.archived, false)
					)
				});

				if (existingTheme) {
					return {
						success: false,
						error: `Theme "${name}" already exists`,
						themeId: existingTheme.id
					};
				}

				// Create a conversation for this theme
				const [newConversation] = await db.insert(conversations).values({
					userId,
					title: `${emoji || '📁'} ${name}`
				}).returning();

				// Create the theme
				const [newTheme] = await db.insert(themes).values({
					userId,
					name,
					emoji: emoji || '📁',
					parentTheme,
					description,
					aiSuggested: true,
					conversationId: newConversation.id,
					archived: false
				}).returning();

				return {
					success: true,
					theme: {
						id: newTheme.id,
						name: newTheme.name,
						emoji: newTheme.emoji,
						parentTheme: newTheme.parentTheme,
						conversationId: newTheme.conversationId
					},
					message: `Created theme: ${newTheme.emoji} ${newTheme.name}${parentTheme ? ` under ${parentTheme}` : ''}`
				};
			}

			// Archive a theme
			if (action === 'archive') {
				if (!themeId) {
					return {
						success: false,
						error: 'Theme ID is required for archiving'
					};
				}

				const theme = await db.query.themes.findFirst({
					where: and(
						eq(themes.id, themeId),
						eq(themes.userId, userId)
					)
				});

				if (!theme) {
					return {
						success: false,
						error: 'Theme not found'
					};
				}

				// Check if theme has active goals
				const activeGoals = await db.query.goals.findMany({
					where: and(
						eq(goals.themeId, themeId),
						eq(goals.status, 'active')
					)
				});

				if (activeGoals.length > 0) {
					return {
						success: false,
						error: `Cannot archive theme with ${activeGoals.length} active goals. Complete or reassign them first.`,
						activeGoalsCount: activeGoals.length
					};
				}

				// Archive the theme
				await db.update(themes)
					.set({ archived: true, updatedAt: new Date() })
					.where(eq(themes.id, themeId));

				return {
					success: true,
					message: `Archived theme: ${theme.emoji} ${theme.name}`
				};
			}

			return {
				success: false,
				error: 'Invalid action'
			};

		} catch (error) {
			console.error('Error in manage_theme tool:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error occurred'
			};
		}
	}
};
