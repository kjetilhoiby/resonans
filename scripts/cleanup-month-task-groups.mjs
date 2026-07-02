// Rydd opp i eksisterende månedsplan-grupper som ble laget før taket på antall
// slots (MAX_MONTH_TASK_SLOTS). En gruppe som «En runde i flere rom (20 ganger)»
// med 20 barn kappes ned til maks, og foreldre-labelen omskrives til riktig antall.
//
// Trygt å kjøre: tørrkjøring som standard. Skriver ingenting uten --apply.
// Idempotent: kjør på nytt uten effekt når alt er under taket.
//
// Bruk:
//   node scripts/cleanup-month-task-groups.mjs --email=deg@eksempel.no
//   node scripts/cleanup-month-task-groups.mjs --email=deg@eksempel.no --month=2026-07
//   node scripts/cleanup-month-task-groups.mjs --email=deg@eksempel.no --month=2026-07 --apply
//
// Flagg:
//   --email=<e-post>   Hvilken bruker (alternativt --user=<userId>)
//   --user=<userId>    Bruker-ID direkte
//   --month=YYYY-MM    Kun denne måneden (default: alle month:*-lister)
//   --max=<n>          Tak på antall barn per gruppe (default 12)
//   --apply            Utfør endringene (uten dette: kun tørrkjøring)

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, like, inArray } from 'drizzle-orm';
import dotenv from 'dotenv';
import { checklists, checklistItems, users } from './src/lib/db/schema.ts';

dotenv.config();

const DEFAULT_MAX = 12;

function parseArgs(argv) {
	const args = { apply: false, max: DEFAULT_MAX };
	for (const raw of argv.slice(2)) {
		const [key, value] = raw.replace(/^--/, '').split('=');
		if (key === 'apply') args.apply = true;
		else if (key === 'max') args.max = Number(value) || DEFAULT_MAX;
		else args[key] = value;
	}
	return args;
}

// Fjerner et avsluttende «(N ganger)» / «(N dager)» / «(N uker)» og gir tilbake
// { base, unit } slik at vi kan bygge labelen på nytt med riktig antall.
const COUNT_SUFFIX = /^(.*?)\s*\((\d+)\s+(ganger|dager|uker|ukedager|helger|arbeidsdager)\)\s*$/;

function relabel(parentText, newCount) {
	const m = parentText.match(COUNT_SUFFIX);
	if (!m) return null; // Ukjent format — la labelen stå urørt.
	return `${m[1].trim()} (${newCount} ${m[3]})`;
}

async function main() {
	const args = parseArgs(process.argv);
	if (!process.env.DATABASE_URL) {
		console.error('❌ DATABASE_URL mangler i miljøet (.env).');
		process.exit(1);
	}
	if (!args.email && !args.user) {
		console.error('❌ Oppgi --email=<e-post> eller --user=<userId>.');
		process.exit(1);
	}

	const sql = postgres(process.env.DATABASE_URL);
	const db = drizzle(sql);

	try {
		let userId = args.user;
		if (!userId) {
			const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, args.email));
			if (!u) {
				console.error(`❌ Fant ingen bruker med e-post ${args.email}.`);
				process.exit(1);
			}
			userId = u.id;
		}

		const contextFilter = args.month
			? eq(checklists.context, `month:${args.month}`)
			: like(checklists.context, 'month:%');

		const lists = await db
			.select({ id: checklists.id, context: checklists.context, title: checklists.title })
			.from(checklists)
			.where(and(eq(checklists.userId, userId), contextFilter));

		if (lists.length === 0) {
			console.log('Ingen månedslister å sjekke. Ferdig.');
			return;
		}

		const idsToDelete = [];
		const relabels = []; // { id, from, to }
		const warnings = [];

		for (const list of lists) {
			const items = await db
				.select({
					id: checklistItems.id,
					text: checklistItems.text,
					checked: checklistItems.checked,
					parentId: checklistItems.parentId,
					sortOrder: checklistItems.sortOrder
				})
				.from(checklistItems)
				.where(eq(checklistItems.checklistId, list.id));

			const parents = items.filter((i) => !i.parentId);
			const baseLabels = new Set();

			for (const parent of parents) {
				const children = items
					.filter((c) => c.parentId === parent.id)
					.sort((a, b) => a.sortOrder - b.sortOrder);

				if (children.length === 0) continue;

				const baseLabel = (parent.text.match(COUNT_SUFFIX)?.[1] ?? parent.text).trim().toLowerCase();
				baseLabels.add(baseLabel);

				if (children.length <= args.max) continue;

				// Behold avkryssede først, deretter uavkryssede etter rekkefølge, opp til max.
				const keep = [...children.filter((c) => c.checked), ...children.filter((c) => !c.checked)].slice(0, args.max);
				const keepIds = new Set(keep.map((c) => c.id));
				const remove = children.filter((c) => !keepIds.has(c.id));

				idsToDelete.push(...remove.map((c) => c.id));

				const newText = relabel(parent.text, args.max);
				if (newText && newText !== parent.text) {
					relabels.push({ id: parent.id, from: parent.text, to: newText });
				}

				console.log(
					`[${list.context}] «${parent.text}» → ${children.length} barn, kapper til ${args.max} (fjerner ${remove.length})`
				);
			}

			// Advar om flate enkeltpunkter som duplikerer en gruppe (ikke slettet automatisk).
			for (const item of parents) {
				const children = items.filter((c) => c.parentId === item.id);
				if (children.length > 0) continue;
				if (baseLabels.has(item.text.trim().toLowerCase())) {
					warnings.push(`[${list.context}] Flat «${item.text}» duplikerer en gruppe — vurder å slette manuelt.`);
				}
			}
		}

		console.log('');
		console.log(`Oppsummering: ${idsToDelete.length} barn å fjerne, ${relabels.length} foreldre-labels å omskrive.`);
		for (const r of relabels) console.log(`  omskriv: «${r.from}» → «${r.to}»`);
		if (warnings.length) {
			console.log('\nAdvarsler (ikke rørt automatisk):');
			for (const w of warnings) console.log(`  ⚠️  ${w}`);
		}

		if (idsToDelete.length === 0 && relabels.length === 0) {
			console.log('\n✅ Ingenting å rydde — alt er allerede under taket.');
			return;
		}

		if (!args.apply) {
			console.log('\nTørrkjøring. Kjør på nytt med --apply for å utføre endringene.');
			return;
		}

		await db.transaction(async (tx) => {
			if (idsToDelete.length > 0) {
				await tx.delete(checklistItems).where(inArray(checklistItems.id, idsToDelete));
			}
			for (const r of relabels) {
				await tx.update(checklistItems).set({ text: r.to }).where(eq(checklistItems.id, r.id));
			}
		});

		console.log('\n✅ Ryddet.');
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
