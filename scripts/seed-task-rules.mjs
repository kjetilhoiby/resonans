// Seed default task classification rules
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { taskClassificationRules } from './src/lib/db/schema.ts';
import { eq } from 'drizzle-orm';
import dotenv from 'dotenv';

dotenv.config();

const rules = [
	{
		category: 'workout',
		keywords: ['trening', 'løp', 'km', 'workout', 'exercise'],
		priority: 2,
		active: true,
		description: 'Matches workout and exercise activities'
	},
	{
		category: 'relationship',
		keywords: ['deit', 'date', 'parforhold', 'relationship'],
		priority: 2,
		active: true,
		description: 'Matches relationship and dating activities'
	},
	{
		category: 'mental',
		keywords: ['stemning', 'mood', 'mental', 'følelse'],
		priority: 2,
		active: true,
		description: 'Matches mental health and mood tracking'
	}
];

async function seed() {
	console.log('🌱 Seeding task classification rules...');

	const sql = postgres(process.env.DATABASE_URL);
	const db = drizzle(sql);

	try {
		for (const rule of rules) {
			const existing = await db
				.select()
				.from(taskClassificationRules)
				.where(eq(taskClassificationRules.category, rule.category))
				.limit(1);

			if (existing.length === 0) {
				await db.insert(taskClassificationRules).values(rule);
				console.log(`✅ Inserted rule: ${rule.category}`);
			} else {
				console.log(`⏭️  Skipped (already exists): ${rule.category}`);
			}
		}

		console.log('✅ Seeding complete!');
		await sql.end();
		process.exit(0);
	} catch (err) {
		console.error('❌ Seeding failed:', err);
		await sql.end();
		process.exit(1);
	}
}

seed();
