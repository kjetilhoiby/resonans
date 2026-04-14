/**
 * Manual sync script: Re-categorize all transactions to populate subcategory field
 * 
 * This bypasses SvelteKit's $env and $lib aliases by setting up everything manually.
 */
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql, and, eq, asc } from 'drizzle-orm';
import { categorizedEvents, sensorEvents } from '../src/lib/db/schema.js';

config();

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

console.log('Fetching user from categorized_events...');

// Get the user ID
const users = await db.execute(sql`SELECT DISTINCT user_id FROM categorized_events LIMIT 1`);
if (users.length === 0) {
	console.log('No users found with categorized events');
	await client.end();
	process.exit(0);
}

const userId = users[0].user_id as string;
console.log(`Found user ${userId}`);

// Now import and patch the categorized-events module to use our db instance
console.log('Rekalkulerer alle transaksjoner...\n');

// Get all transactions for this user
const allTransactions = await db
	.select({
		sensorEventId: sql<string>`id`,
		amount: sql<string>`data->>'amount'`,
		description: sql<string>`data->>'description'`,
		typeText: sql<string>`COALESCE(data->>'typeText', data->>'category')`,
		timestamp: sensorEvents.timestamp
	})
	.from(sensorEvents)
	.where(
		and(
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'bank_transaction')
		)
	)
	.orderBy(asc(sensorEvents.timestamp));

console.log(`Found ${allTransactions.length} bank transactions`);

// Load classification caches
const { loadMerchantMappings } = await import('../.svelte-kit/output/server/chunks/spending-analyzer.js');
const { loadClassificationOverrides, loadTransactionMatchingRules } = await import('../.svelte-kit/output/server/chunks/classification-overrides.js');
const { categorizeTransaction } = await import('../.svelte-kit/output/server/chunks/transaction-categories.js');

const [merchantMappings, overrideCache, rules] = await Promise.all([
	loadMerchantMappings(userId),
	loadClassificationOverrides(userId, 'transaction'),
	loadTransactionMatchingRules()
]);

console.log('Classification caches loaded');
console.log('Upserting categorized events...');

const CHUNK_SIZE = 500;
const CLASSIFIER_VERSION = 3;
let synced = 0;

for (let i = 0; i < allTransactions.length; i += CHUNK_SIZE) {
	const chunk = allTransactions.slice(i, i + CHUNK_SIZE);
	const now = new Date();

	await db
		.insert(categorizedEvents)
		.values(
			chunk.map((row) => {
				const amount = Number(row.amount) || 0;
				const classified = categorizeTransaction(
					row.description,
					row.typeText,
					amount,
					merchantMappings,
					overrideCache,
					rules
				);

				return {
					userId,
					sensorEventId: row.sensorEventId,
					timestamp: row.timestamp,
					accountId: null,
					amount: amount.toString(),
					description: row.description,
					typeText: row.typeText,
					resolvedCategory: classified.category,
					resolvedSubcategory: classified.subcategory ?? null,
					resolvedLabel: classified.label,
					resolvedEmoji: classified.emoji,
					isFixed: classified.isFixed,
					source: 'pipeline',
					classifierVersion: CLASSIFIER_VERSION,
					categorizedAt: now,
					updatedAt: now
				};
			})
		)
		.onConflictDoUpdate({
			target: [categorizedEvents.sensorEventId],
			set: {
				timestamp: sql`excluded.timestamp`,
				accountId: sql`excluded.account_id`,
				amount: sql`excluded.amount`,
				description: sql`excluded.description`,
				typeText: sql`excluded.type_text`,
				resolvedCategory: sql`excluded.resolved_category`,
				resolvedSubcategory: sql`excluded.resolved_subcategory`,
				resolvedLabel: sql`excluded.resolved_label`,
				resolvedEmoji: sql`excluded.resolved_emoji`,
				isFixed: sql`excluded.is_fixed`,
				source: sql`excluded.source`,
				classifierVersion: sql`excluded.classifier_version`,
				categorizedAt: sql`excluded.categorized_at`,
				updatedAt: sql`excluded.updated_at`
			}
		});

	synced += chunk.length;
	console.log(`  Processed ${synced}/${allTransactions.length}...`);
}

console.log(`\n✅ Ferdig!`);
console.log(`   Behandlet: ${allTransactions.length} transaksjoner`);
console.log(`   Synkronisert: ${synced} transaksjoner`);

await client.end();
