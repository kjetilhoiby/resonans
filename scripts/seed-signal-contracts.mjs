/**
 * Seeds v1 domain signal contracts.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = ['.env.local', '.env']
	.map((f) => resolve(__dirname, '..', f))
	.find((p) => {
		try {
			readFileSync(p);
			return true;
		} catch {
			return false;
		}
	});

if (!envPath) {
	console.error('No .env or .env.local found');
	process.exit(1);
}

readFileSync(envPath, 'utf8')
	.split('\n')
	.forEach((line) => {
		const [k, ...v] = line.split('=');
		if (!k || process.env[k]) return;
		process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
	});

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL missing');
	process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });

const contracts = [
	{
		signalType: 'activity_run_pr_week',
		ownerDomain: 'health',
		allowedConsumerDomains: ['health', 'home', 'relationship'],
		description: 'Number of running workouts this ISO week for weekly running-goal tracking.'
	},
	{
		signalType: 'task_completion_weekly',
		ownerDomain: 'home',
		allowedConsumerDomains: ['home', 'relationship', 'health'],
		description: 'Weekly completion ratio for active weekly tasks with explicit targets.'
	},
	{
		signalType: 'economics_budget_pressure_7d',
		ownerDomain: 'economics',
		allowedConsumerDomains: ['home', 'relationship'],
		description: 'Short-term budget pressure from spending vs baseline.'
	},
	{
		signalType: 'economics_variable_spend_spike_14d',
		ownerDomain: 'economics',
		allowedConsumerDomains: ['home', 'relationship'],
		description: 'Unusual variable spend increase over the last 14 days.'
	},
	{
		signalType: 'economics_fixed_cost_burden_30d',
		ownerDomain: 'economics',
		allowedConsumerDomains: ['home', 'relationship'],
		description: 'Fixed-cost burden level over 30 days.'
	},
	{
		signalType: 'home_task_load_imbalance_14d',
		ownerDomain: 'home',
		allowedConsumerDomains: ['relationship'],
		description: 'Task load imbalance indicator over 14 days.'
	},
	{
		signalType: 'home_planning_reliability_14d',
		ownerDomain: 'home',
		allowedConsumerDomains: ['relationship'],
		description: 'How reliably daily plans are completed in home routines.'
	},
	{
		signalType: 'home_overdue_shared_tasks_7d',
		ownerDomain: 'home',
		allowedConsumerDomains: ['relationship'],
		description: 'Count of overdue shared home tasks over 7 days.'
	},
	{
		signalType: 'relationship_coordination_readiness_today',
		ownerDomain: 'relationship',
		allowedConsumerDomains: ['home'],
		description: 'Recommended coordination complexity for today.'
	},
	{
		signalType: 'relationship_logistics_stress_index_14d',
		ownerDomain: 'relationship',
		allowedConsumerDomains: ['home'],
		description: 'Composite practical stress index over 14 days.'
	}
];

try {
	for (const contract of contracts) {
		await sql`
			INSERT INTO signal_contracts (signal_type, owner_domain, allowed_consumer_domains, schema_version, status, description)
			VALUES (${contract.signalType}, ${contract.ownerDomain}, ${contract.allowedConsumerDomains}, 1, 'active', ${contract.description})
			ON CONFLICT (signal_type)
			DO UPDATE SET
				owner_domain = EXCLUDED.owner_domain,
				allowed_consumer_domains = EXCLUDED.allowed_consumer_domains,
				schema_version = EXCLUDED.schema_version,
				status = EXCLUDED.status,
				description = EXCLUDED.description,
				updated_at = NOW()
		`;
	}

	const [countRow] = await sql`SELECT COUNT(*)::int AS count FROM signal_contracts`;
	console.log(`Seeded signal contracts. Total contracts now: ${countRow?.count ?? 0}`);
} catch (error) {
	console.error('Failed to seed signal contracts:', error);
	process.exit(1);
} finally {
	await sql.end();
}
