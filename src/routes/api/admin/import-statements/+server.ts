import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, sql, inArray } from 'drizzle-orm';
import { requireAdmin } from '$lib/server/admin-auth';
import { parseSparebank1Pdf, normaliseAccountNumber } from '$lib/server/integrations/sparebank1-pdf-parser';
import type { RequestHandler } from './$types';

// Vercel: allow up to 60 s for a ZIP with many PDFs
export const config = { maxDuration: 60 };

/**
 * GET /api/admin/import-statements
 * Returns a summary of stored balance anchors per account.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals.userId);
	const userId = locals.userId;

	const rows = await db
		.select({
			accountId:     sql<string>`data->>'accountId'`,
			accountNumber: sql<string>`COALESCE(data->>'accountNumber', data->>'accountId')`,
			source:        sql<string>`COALESCE(metadata->>'source', 'api')`,
			count:         sql<number>`count(*)::int`,
			earliest:      sql<string>`min(timestamp)::date`,
			latest:        sql<string>`max(timestamp)::date`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'bank_balance')
			)
		)
		.groupBy(
			sql`data->>'accountId'`,
			sql`COALESCE(data->>'accountNumber', data->>'accountId')`,
			sql`COALESCE(metadata->>'source', 'api')`
		)
		.orderBy(sql`data->>'accountId'`, sql`COALESCE(metadata->>'source', 'api')`);

	// Merge rows for same account across sources
	const byAccount = new Map<string, {
		accountId: string;
		accountNumber: string;
		earliest: string;
		latest: string;
		totalAnchors: number;
		sources: string[];
	}>();

	for (const r of rows) {
		const key = r.accountId;
		if (!byAccount.has(key)) {
			byAccount.set(key, {
				accountId: r.accountId,
				accountNumber: r.accountNumber,
				earliest: r.earliest,
				latest: r.latest,
				totalAnchors: 0,
				sources: []
			});
		}
		const entry = byAccount.get(key)!;
		entry.totalAnchors += r.count;
		entry.sources.push(r.source);
		if (r.earliest < entry.earliest) entry.earliest = r.earliest;
		if (r.latest   > entry.latest)   entry.latest   = r.latest;
	}

	return json({ accounts: [...byAccount.values()] });
};

/**
 * POST /api/admin/import-statements
 *
 * Accepts multipart/form-data with a field named "zip" containing a ZIP
 * archive of SpareBank 1 kontoutskrift PDF files.
 *
 * Returns a summary of imported / skipped records.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		await requireAdmin(locals.userId);
		const formData = await request.formData();
		const file = formData.get('zip');
		if (!(file instanceof File)) {
			return json({ error: 'Mangler zip-fil (felt: zip)' }, { status: 400 });
		}

		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// ── Dynamic imports (avoid Vite SSR bundling issues) ──────────────────
		const JSZip = (await import('jszip')).default;

		const zip = await JSZip.loadAsync(buffer);

		// ── Collect all PDF entries ───────────────────────────────────────────
		const pdfEntries: { name: string; buf: Buffer }[] = [];
		for (const [name, entry] of Object.entries(zip.files)) {
			if (entry.dir) continue;
			if (!name.toLowerCase().endsWith('.pdf')) continue;
			const buf = Buffer.from(await entry.async('arraybuffer'));
			pdfEntries.push({ name, buf });
		}

		if (pdfEntries.length === 0) {
			return json({ error: 'Ingen PDF-filer funnet i ZIP-arkivet' }, { status: 400 });
		}

		// ── Get or create a "pdf_import" sensor ──────────────────────────────
		const userId = locals.userId;
		let sensor = await db.query.sensors.findFirst({
			where: and(eq(sensors.userId, userId), eq(sensors.provider, 'sparebank1_pdf'))
		});
		if (!sensor) {
			[sensor] = await db
				.insert(sensors)
				.values({
					userId,
					provider: 'sparebank1_pdf',
					type: 'bank_api',
					subtype: 'pdf_import',
					name: 'SpareBank 1 kontoutskrift',
					isActive: true
				})
				.returning();
		}
		const sensorId = sensor!.id;

		// ── Build accountNumber → accountId lookup from existing balance data ─
		const existingBalances = await db
			.select({
				accountId: sql<string>`data->>'accountId'`,
				accountNumber: sql<string>`data->>'accountNumber'`
			})
			.from(sensorEvents)
			.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'bank_balance')));

		const accountNumberToId = new Map<string, string>();
		for (const row of existingBalances) {
			if (row.accountNumber && row.accountId) {
				const norm = normaliseAccountNumber(row.accountNumber);
				if (!accountNumberToId.has(norm)) {
					accountNumberToId.set(norm, row.accountId);
				}
			}
		}

		// ── Fetch existing source hashes to dedup ─────────────────────────────
		const existingHashRows = await db
			.select({ h: sql<string>`metadata->>'sourceHash'` })
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, userId),
					eq(sensorEvents.dataType, 'bank_transaction'),
					sql`metadata->>'source' = 'pdf_import'`
				)
			);
		const existingHashes = new Set(existingHashRows.map((r) => r.h).filter(Boolean));

		// ── Process each PDF ──────────────────────────────────────────────────
		let totalTransactions = 0;
		let totalSkipped = 0;
		let totalBalanceAnchors = 0;
		const filesProcessed: string[] = [];
		const warnings: string[] = [];
		// Track which accountIds have had their old pdf_import anchors purged
		// so we do it at most once per account per ZIP upload.
		const purgedAccounts = new Set<string>();

		for (const { name, buf } of pdfEntries) {
			let statement: Awaited<ReturnType<typeof parseSparebank1Pdf>>;
			try {
				statement = await parseSparebank1Pdf(buf);
			} catch (err) {
				warnings.push(`Kunne ikke lese ${name}: ${err}`);
				continue;
			}

			if (!statement.accountNumber) {
				warnings.push(`Fant ikke kontonummer i ${name} — hopper over`);
				continue;
			}

			// Resolve accountId (use existing mapping or fall back to account number)
			const accountId =
				accountNumberToId.get(statement.accountNumber) ?? statement.accountNumber;

			// If this PDF gives us a new mapping (pdf account number not yet in DB),
			// remember it for later PDFs in the same ZIP.
			if (!accountNumberToId.has(statement.accountNumber)) {
				accountNumberToId.set(statement.accountNumber, accountId);
			}

			// Insert balance snapshots (anchors).
			// First time we see this account in this upload: delete stale pdf_import
			// anchors so a re-import fully replaces (no duplicate / conflicting rows).
			if (!purgedAccounts.has(accountId)) {
				await db
					.delete(sensorEvents)
					.where(
						and(
							eq(sensorEvents.userId, userId),
							eq(sensorEvents.dataType, 'bank_balance'),
							sql`data->>'accountId' = ${accountId}`,
							sql`metadata->>'source' = 'pdf_import'`
						)
					);
				purgedAccounts.add(accountId);
			}

			for (const snap of statement.balanceSnapshots) {
				await db
					.insert(sensorEvents)
					.values({
						userId,
						sensorId,
						eventType: 'measurement',
						dataType: 'bank_balance',
						timestamp: snap.date,
						data: {
							accountId,
							accountNumber: statement.accountNumber,
							balance: snap.balance,
							currency: 'NOK'
						},
						metadata: { source: 'pdf_import', file: name }
					})
					.onConflictDoNothing();
				totalBalanceAnchors++;
			}

			// Insert transactions (deduped by content hash)
			const newTxEvents = [];
			for (const tx of statement.transactions) {
				const dateStr = tx.date.toISOString().split('T')[0];
				const hash = `${statement.accountNumber}:${dateStr}:${tx.description}:${Math.round(Math.abs(tx.amount) * 100)}`;

				if (existingHashes.has(hash)) {
					totalSkipped++;
					continue;
				}

				existingHashes.add(hash);
				newTxEvents.push({
					userId,
					sensorId,
					eventType: 'activity' as const,
					dataType: 'bank_transaction',
					timestamp: tx.date,
					data: {
						accountId,
						amount: tx.amount,
						currency: 'NOK',
						description: tx.description,
						merchant: tx.description,
						category: null,
						isFixedExpense: false
					},
					metadata: {
						source: 'pdf_import',
						sourceHash: hash,
						file: name
					}
				});
			}

			if (newTxEvents.length > 0) {
				const batchSize = 200;
				for (let i = 0; i < newTxEvents.length; i += batchSize) {
					await db.insert(sensorEvents).values(newTxEvents.slice(i, i + batchSize)).onConflictDoNothing();
				}
			}

			totalTransactions += newTxEvents.length;
			totalSkipped += statement.transactions.length - newTxEvents.length;
			filesProcessed.push(name);
		}

		return json({
			success: true,
			filesProcessed: filesProcessed.length,
			totalTransactions,
			totalBalanceAnchors,
			totalSkipped,
			warnings
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('PDF import error:', err);
		return json({ error: message }, { status: 500 });
	}
};
