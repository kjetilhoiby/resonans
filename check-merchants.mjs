import { db } from './src/lib/db/index';
import { merchantMappings, sensorEvents } from './src/lib/db/schema';
import { sql, eq } from 'drizzle-orm';
import { DEFAULT_USER_ID } from './src/lib/server/users';

console.log('Starting merchant check...');

async function checkMerchants() {
	try {
		// Count total merchants
		const total = await db
			.select({ count: sql<number>`COUNT(*)::int` })
			.from(merchantMappings);
		
		console.log('Total merchant mappings:', total[0]?.count || 0);

		// Group by source
		const bySource = await db
			.select({
				source: merchantMappings.source,
				count: sql<number>`COUNT(*)::int`,
				users: sql<number>`COUNT(DISTINCT ${merchantMappings.userId})::int`
			})
			.from(merchantMappings)
			.groupBy(merchantMappings.source);

		console.log('\nBy source:');
		bySource.forEach(row => {
			console.log(`  ${row.source}: ${row.count} mappings, ${row.users} users`);
		});

		// Sample first 5
		const sample = await db
			.select()
			.from(merchantMappings)
			.limit(5);

		console.log('\nSample mappings (first 5):');
		sample.forEach((m, i) => {
			console.log(`  ${i + 1}. ${m.label} (${m.merchantKey}) → ${m.category} [${m.source}]`);
		});

		// Check transactions
		const txCount = await db
			.select({ count: sql<number>`COUNT(*)::int` })
			.from(sensorEvents)
			.where(eq(sensorEvents.dataType, 'bank_transaction'));
		
		console.log('\nTotal bank transactions in sensorEvents:', txCount[0]?.count || 0);

		const userTxCount = await db
			.select({ count: sql<number>`COUNT(*)::int` })
			.from(sensorEvents)
			.where(
				sql`${sensorEvents.dataType} = 'bank_transaction' AND ${sensorEvents.userId} = ${DEFAULT_USER_ID}`
			);
		
		console.log(`Transactions for DEFAULT_USER (${DEFAULT_USER_ID}):`, userTxCount[0]?.count || 0);

		process.exit(0);
	} catch (error) {
		console.error('Error:', error);
		process.exit(1);
	}
}

checkMerchants();
