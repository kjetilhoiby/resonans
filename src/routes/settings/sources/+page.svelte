<script lang="ts">
	import { AppPage, Button, Input, PageHeader, Radio, Select } from '$lib/components/ui';
	import { invalidateDashboardKind } from '$lib/client/dashboard-cache';
	import { onDestroy, onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let webhook = $state(data.user?.googleChatWebhook || '');
	let timezone = $state(data.user?.timezone || 'Europe/Oslo');
	let savingSourceConfig = $state(false);
	let sourceConfigResult = $state<{ success: boolean; message: string } | null>(null);

	// ── E-post som kilde ────────────────────────────────────────────────────────
	let emailScriptCopied = $state(false);
	let emailEndpointCopied = $state(false);
	let emailTestRunning = $state(false);
	let emailTestResult = $state<{ ok: boolean; message: string } | null>(null);
	let emailGuideOpen = $state(false);

	async function copyToClipboard(text: string): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	async function copyAppsScript() {
		if (!data.emailAppsScriptSource) return;
		const ok = await copyToClipboard(data.emailAppsScriptSource);
		if (ok) {
			emailScriptCopied = true;
			setTimeout(() => (emailScriptCopied = false), 2000);
		}
	}

	async function copyEmailEndpoint() {
		const ok = await copyToClipboard(data.emailEndpoint);
		if (ok) {
			emailEndpointCopied = true;
			setTimeout(() => (emailEndpointCopied = false), 2000);
		}
	}

	async function runEmailTest() {
		if (!data.user?.email) {
			emailTestResult = { ok: false, message: 'Mangler bruker-e-post.' };
			return;
		}
		emailTestRunning = true;
		emailTestResult = null;
		try {
			const dueDate = new Date();
			dueDate.setDate(dueDate.getDate() + 7);
			const dd = String(dueDate.getDate()).padStart(2, '0');
			const mm = String(dueDate.getMonth() + 1).padStart(2, '0');
			const yyyy = dueDate.getFullYear();

			const res = await fetch('/api/settings/email-test', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					gmailMessageId: `test-${Date.now()}`,
					gmailThreadId: `test-thread-${Date.now()}`,
					internalDate: Date.now(),
					from: 'no-reply@bibliotek.no',
					to: data.user.email,
					subject: 'Lånefrist nærmer seg',
					bodyText: `Hei!\n\nDu må levere boken "Resonans testbok" innen ${dd}.${mm}.${yyyy}.\n\nVennlig hilsen,\nBiblioteket`,
					label: 'Resonans/Bibliotek',
					attachments: []
				})
			});
			const body = await res.json();
			if (res.ok) {
				emailTestResult = {
					ok: true,
					message: `Test-respons: ${JSON.stringify(body)}`
				};
			} else {
				emailTestResult = {
					ok: false,
					message: `Status ${res.status}: ${JSON.stringify(body)}`
				};
			}
		} catch (err) {
			emailTestResult = {
				ok: false,
				message: err instanceof Error ? err.message : String(err)
			};
		} finally {
			emailTestRunning = false;
		}
	}

	let withingsStatus = $state<any>(null);
	let loadingWithings = $state(false);
	let syncingWithings = $state(false);
	let withingsResult = $state<{ success: boolean; message: string } | null>(null);
	let withingsImportMode = $state<'days' | 'from2017'>('days');
	let withingsImportDays = $state(30);

	type WithingsDebugWorkout = {
		category: number;
		sportType: string;
		mapped: boolean;
		startdate: number;
		enddate: number;
		durationSeconds: number;
		distance?: number;
		calories?: number;
		steps?: number;
		modified?: number;
		deviceid?: string;
		model?: string;
	};
	let showWithingsDebug = $state(false);
	let loadingWithingsDebug = $state(false);
	let withingsDebug = $state<{
		windowDays: number;
		totalFetched: number;
		returned: number;
		workouts: WithingsDebugWorkout[];
	} | null>(null);
	let withingsDebugError = $state<string | null>(null);
	let withingsDebugDays = $state(30);
	let withingsDebugLimit = $state(10);

	type SleepDebugEvent = {
		id: string;
		timestamp: string;
		hr_average: number | null;
		duration: number | null;
		dataKeys: string[];
	};
	type SleepSummaryNight = {
		date: string;
		hr_average: number | null;
		hr_min: number | null;
		hr_max: number | null;
		rr_average: number | null;
		duration: number | null;
		dataKeys: string[];
	};
	type SleepDetailNight = {
		date: string;
		segments: number;
		hrSamples: number;
		rrSamples: number;
		snoringSegments: number;
		sampleKeys: string[];
	};
	type SleepSampleSegment = {
		startdate: string;
		state: number;
		hr: number | null;
		rr: number | null;
		snoring: number | null;
		allKeys: string[];
	};
	let showSleepDebug = $state(false);
	let loadingSleepDebug = $state(false);
	let sleepDebug = $state<{
		db: { totalEvents: number; eventsWithHr: number; events: SleepDebugEvent[] };
		summary: { status: number; totalNights: number; nightsWithHr: number; nights: SleepSummaryNight[] };
		detail: { status: number; totalSegments: number; nights: SleepDetailNight[]; sampleSegments: SleepSampleSegment[] };
	} | null>(null);
	let sleepDebugError = $state<string | null>(null);

	// ── Withings batch backfill ──────────────────────────────────────────────────
	type WithingsBatchStats = { weight: number; activity: number; sleep: number; workouts: number; total: number };
	let withingsBatchJobId = $state<string | null>(null);
	let withingsBatchRunning = $state(false);
	let withingsBatchProgress = $state<{
		done: boolean;
		processedDays: number;
		totalDays: number;
		progressPct: number;
		nextDate: string | null;
		stats: WithingsBatchStats;
		error: string | null;
	} | null>(null);

	// ── Sleep HR backfill ────────────────────────────────────────────────────────
	type BatchStats = { found: number; updated: number; daysWithHr: number };
	let sleepBackfillJobId = $state<string | null>(null);
	let sleepBackfillRunning = $state(false);
	let sleepBackfillProgress = $state<{
		done: boolean;
		processedDays: number;
		totalDays: number;
		progressPct: number;
		nextDate: string | null;
		stats: BatchStats;
		error: string | null;
	} | null>(null);
	let sleepBackfillFromDate = $state('2020-01-01');
	let sleepBackfillToDate = $state(new Date().toISOString().split('T')[0]);
	let sleepBackfillReaggregating = $state(false);

	// ── Salary profile ──────────────────────────────────────────────────────────
	type SalaryProfileData = {
		userId: string;
		sourceAccountId: string;
		descriptionFingerprint: string;
		amountMin: number;
		amountMax: number;
		typicalDom: number;
		typicalDow: number;
	};
	type PaycheckRow = {
		id: string;
		canonicalDate: string;
		amount: string;
		description: string | null;
		paycheckType: string;
	};

	let salaryProfile = $state<SalaryProfileData | null>(null);
	let salaryProfileNextPayday = $state<string | null>(null);
	let salaryProfilePaychecks = $state<PaycheckRow[]>([]);
	let loadingSalaryProfile = $state(false);
	let showSalaryProfile = $state(false);
	let rebuildingProfile = $state(false);
	let rebuildProfileResult = $state<{ success: boolean; message: string } | null>(null);
	let backfillingPaychecks = $state(false);
	let backfillResult = $state<{ success: boolean; message: string } | null>(null);
	let editingProfile = $state(false);
	let profileEditFingerprint = $state('');
	let profileEditAmountMin = $state(0);
	let profileEditAmountMax = $state(0);
	let profileEditDom = $state(0);

	// Diagnostics
	type DiagAccountRow = { accountId: string; txCount: number; incomeCount: number; minDate: string; maxDate: string };
	type DiagInflowRow = {
		id: string; accountId: string; date: string; amount: number;
		merchantKey: string | null; descriptionDisplay: string | null;
		paycheckType: string | null; latestBookingStatus: string | null;
		paycheckResult: string | null; score: number | null;
		scoreComponents: {
			fingerprintMatch: boolean; hasKeyword: boolean; inAmountRange: boolean;
			isWorkday: boolean; domOnTime: boolean; domCloseness: number;
			descNorm: string; profileFingerprint: string;
			profileAmountMin: number; profileAmountMax: number; profileTypicalDom: number;
		} | null;
	};
	type DiagData = { accountSummary: DiagAccountRow[]; bigInflows: DiagInflowRow[] };
	let loadingDiag = $state(false);
	let diagData = $state<DiagData | null>(null);
	let savingProfileEdit = $state(false);
	let profileEditResult = $state<{ success: boolean; message: string } | null>(null);

	// Manual salary setup: account + transaction picker
	type AccountRow = { accountId: string; accountName: string | null; accountType: string | null };
	type IncomeTx = { id: string; canonicalDate: string; amount: string; description: string };
	let salaryAccounts = $state<AccountRow[]>([]);
	let manualAccountId = $state('');
	let accountTransactions = $state<IncomeTx[]>([]);
	let loadingAccountTxs = $state(false);
	let selectedTxId = $state('');
	let buildingFromTx = $state(false);
	let buildFromTxResult = $state<{ success: boolean; message: string } | null>(null);

	let sparebank1Status = $state<any>(null);
	let loadingSparebank1 = $state(false);
	let syncingSparebank1 = $state(false);
	type Sparebank1DebugTransaction = {
		accountId: string;
		timestamp: string;
		description: string;
		amount: number;
		bookingStatus: string | null;
		decision: string;
		reason: string;
		semanticKey: string;
		transactionId?: string | null;
	};

	type Sparebank1SyncDebug = {
		since: string | null;
		rawTransactionCount: number;
		uniqueTransactionCount: number;
		queuedForInsertCount: number;
		skippedExistingCount: number;
		duplicateInBatchCount: number;
		replacedByBookedInBatchCount: number;
		transactions: Sparebank1DebugTransaction[];
	};

	type BackgroundJobStatus = 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';
	type Sparebank1QueuedJob = {
		id: string;
		status: BackgroundJobStatus;
		createdAt?: string;
		updatedAt?: string;
		startedAt?: string | null;
		finishedAt?: string | null;
		error?: string | null;
		result?: Record<string, unknown> | null;
	};

	let sparebank1Result = $state<{
		success: boolean;
		message: string;
		debug?: Sparebank1SyncDebug;
		queued?: boolean;
		job?: Sparebank1QueuedJob;
	} | null>(null);
	let showSparebank1Details = $state(false);
	let sparebank1ImportMode = $state<'days' | 'from2020'>('days');
	let sparebank1ImportDays = $state(30);
	let sparebank1JobPollError = $state<string | null>(null);
	let sparebank1Polling = $state(false);
	let sparebank1PollTimer: ReturnType<typeof setInterval> | null = null;
	let resettingEconomics = $state(false);
	let resetEconomicsResult = $state<{ success: boolean; message: string } | null>(null);

	// ── SpareBank1 batch backfill ────────────────────────────────────────────
	type Sparebank1BatchStats = {
		transactionsInserted: number;
		chunksWritten: number;
		totalChunks: number;
		accountOffsets?: Record<string, number>;
		rateLimitRemaining?: string | null;
	};
	let sparebank1BatchJobId = $state<string | null>(null);
	let sparebank1BatchRunning = $state(false);
	let sparebank1BatchProgress = $state<{
		done: boolean;
		processedDays: number;
		totalDays: number;
		progressPct: number;
		nextDate: string | null;
		stats: Sparebank1BatchStats;
		error: string | null;
	} | null>(null);

	let googleSheetsStatus = $state<any>(null);
	let loadingGoogleSheets = $state(false);

	let spondStatus = $state<any>(null);
	let loadingSpond = $state(false);
	let syncingSpond = $state(false);
	let spondResult = $state<{ success: boolean; message: string } | null>(null);
	let spondEmail = $state('');
	let spondPassword = $state('');
	let connectingSpond = $state(false);

	let importingStatements = $state(false);
	let importResult: any = $state(null);
	let anchorAccounts = $state<{
		accountId: string;
		accountNumber: string;
		earliest: string;
		latest: string;
		totalAnchors: number;
		sources: string[];
	}[]>([]);

	// ── E-postregler ────────────────────────────────────────────────────────
	type EmailRule = {
		id: string;
		name: string;
		labelPattern: string | null;
		senderPattern: string | null;
		subjectPattern: string | null;
		processingType: string;
		extractionPrompt: string | null;
		eventType: string;
		dataType: string;
		isActive: boolean;
		lastMatchedAt: string | null;
		matchCount: number;
	};
	let emailRulesData = $state<EmailRule[]>([]);
	let loadingEmailRules = $state(false);
	let showEmailRuleForm = $state(false);
	let editingRuleId = $state<string | null>(null);
	let ruleForm = $state({
		name: '',
		labelPattern: '',
		senderPattern: '',
		subjectPattern: '',
		processingType: 'ai_extraction' as string,
		extractionPrompt: '',
		eventType: 'email_content',
		dataType: 'email',
	});
	let savingRule = $state(false);
	let ruleResult = $state<{ success: boolean; message: string } | null>(null);

	async function loadEmailRules() {
		loadingEmailRules = true;
		try {
			const res = await fetch('/api/settings/email-rules');
			if (res.ok) emailRulesData = await res.json();
		} finally {
			loadingEmailRules = false;
		}
	}

	function resetRuleForm() {
		ruleForm = {
			name: '', labelPattern: '', senderPattern: '', subjectPattern: '',
			processingType: 'ai_extraction', extractionPrompt: '',
			eventType: 'email_content', dataType: 'email',
		};
		editingRuleId = null;
		showEmailRuleForm = false;
		ruleResult = null;
	}

	function editRule(rule: EmailRule) {
		ruleForm = {
			name: rule.name,
			labelPattern: rule.labelPattern ?? '',
			senderPattern: rule.senderPattern ?? '',
			subjectPattern: rule.subjectPattern ?? '',
			processingType: rule.processingType,
			extractionPrompt: rule.extractionPrompt ?? '',
			eventType: rule.eventType,
			dataType: rule.dataType,
		};
		editingRuleId = rule.id;
		showEmailRuleForm = true;
		ruleResult = null;
	}

	async function saveEmailRule() {
		savingRule = true;
		ruleResult = null;
		try {
			const method = editingRuleId ? 'PATCH' : 'POST';
			const body = editingRuleId
				? { id: editingRuleId, ...ruleForm }
				: ruleForm;
			const res = await fetch('/api/settings/email-rules', {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Kunne ikke lagre regel');
			}
			ruleResult = { success: true, message: editingRuleId ? 'Regel oppdatert' : 'Regel opprettet' };
			resetRuleForm();
			await loadEmailRules();
		} catch (error) {
			ruleResult = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			savingRule = false;
		}
	}

	async function toggleRule(rule: EmailRule) {
		await fetch('/api/settings/email-rules', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: rule.id, isActive: !rule.isActive })
		});
		await loadEmailRules();
	}

	async function deleteRule(rule: EmailRule) {
		if (!confirm(`Slett regelen "${rule.name}"?`)) return;
		await fetch('/api/settings/email-rules', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: rule.id })
		});
		await loadEmailRules();
	}

	const connectedCount = $derived(
		(withingsStatus?.connected ? 1 : 0) +
		(sparebank1Status?.connected ? 1 : 0) +
		(googleSheetsStatus?.connected ? 1 : 0) +
		(spondStatus?.connected ? 1 : 0) +
		(webhook.trim().length > 0 ? 1 : 0)
	);

	onMount(async () => {
		await Promise.all([
			loadWithingsStatus(),
			loadSparebank1Status(),
			loadGoogleSheetsStatus(),
			loadSpondStatus(),
			loadAnchorAccounts(),
			loadSalaryProfileData(),
			loadEmailRules()
		]);
	});

	onDestroy(() => {
		if (sparebank1PollTimer) clearInterval(sparebank1PollTimer);
	});

	function clearSparebank1Polling() {
		if (sparebank1PollTimer) {
			clearInterval(sparebank1PollTimer);
			sparebank1PollTimer = null;
		}
		sparebank1Polling = false;
	}

	function isTerminalJobStatus(status?: string): boolean {
		return status === 'completed' || status === 'failed' || status === 'canceled';
	}

	function formatJobStatus(status?: string): string {
		switch (status) {
			case 'queued': return 'Køet';
			case 'running': return 'Kjører';
			case 'retry': return 'Forsøker igjen';
			case 'completed': return 'Fullført';
			case 'failed': return 'Feilet';
			case 'canceled': return 'Avbrutt';
			default: return status || 'Ukjent';
		}
	}

	async function kickJobProcessor() {
		try {
			await fetch('/api/admin/jobs/process', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 1 })
			});
		} catch { /* best-effort */ }
	}

	async function pollSparebank1Job(jobId: string) {
		try {
			const res = await fetch(`/api/admin/jobs/${jobId}`);
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(payload?.error || 'Kunne ikke hente jobbstatus');
			}
			const job = payload?.job as Sparebank1QueuedJob | undefined;
			if (!job) throw new Error('Mangler jobbdata i responsen');

			if (sparebank1Result?.success) {
				sparebank1Result = {
					...sparebank1Result,
					job
				};
			}

			if (job.status === 'queued') {
				void kickJobProcessor();
			} else if (isTerminalJobStatus(job.status)) {
				clearSparebank1Polling();
				await loadSparebank1Status();
			}
			sparebank1JobPollError = null;
		} catch (error) {
			sparebank1JobPollError = error instanceof Error ? error.message : 'Polling feilet';
		}
	}

	function startSparebank1JobPolling(jobId: string) {
		clearSparebank1Polling();
		sparebank1Polling = true;
		void pollSparebank1Job(jobId);
		sparebank1PollTimer = setInterval(() => {
			void pollSparebank1Job(jobId);
		}, 5000);
	}

	async function loadAnchorAccounts() {
		try {
			const res = await fetch('/api/admin/import-statements');
			if (res.ok) {
				const payload = await res.json();
				anchorAccounts = payload.accounts ?? [];
			}
		} catch { /* ignore */ }
	}

	async function importStatements(event: Event) {
		const input = (event.target as HTMLInputElement);
		const file = input.files?.[0];
		if (!file) return;

		importingStatements = true;
		importResult = null;
		try {
			const fd = new FormData();
			fd.append('zip', file);
			const res = await fetch('/api/admin/import-statements', { method: 'POST', body: fd });
			importResult = await res.json();
			await loadAnchorAccounts();
		} catch (err) {
			importResult = { error: String(err) };
		} finally {
			importingStatements = false;
			input.value = '';
		}
	}

	async function saveSourceConfig() {
		savingSourceConfig = true;
		sourceConfigResult = null;
		try {
			const res = await fetch('/api/settings/sources', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					googleChatWebhook: webhook.trim() || null,
					timezone
				})
			});
			if (!res.ok) throw new Error('Kunne ikke lagre kildeinnstillinger');
			sourceConfigResult = { success: true, message: 'Kildeinnstillinger lagret.' };
		} catch (error) {
			sourceConfigResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Ukjent feil'
			};
		} finally {
			savingSourceConfig = false;
		}
	}

	async function loadWithingsStatus() {
		loadingWithings = true;
		try {
			const res = await fetch('/api/sensors/withings/status');
			if (res.ok) withingsStatus = await res.json();
		} finally {
			loadingWithings = false;
		}
	}

	async function syncWithings(mode: 'default' | 'days' | 'from2017' = 'default') {
		syncingWithings = true;
		withingsResult = null;
		try {
			let url = '/api/sensors/withings/sync';
			if (mode === 'from2017') {
				const ok = confirm('Dette sletter all eksisterende Withings-data og reimporterer hele historikken fra 2017. Fortsette?');
				if (!ok) { syncingWithings = false; return; }
				url = '/api/sensors/withings/sync?from2017=true';
			} else if (mode === 'days') {
				const safeDays = Math.max(1, Math.min(365, Math.floor(Number(withingsImportDays) || 1)));
				withingsImportDays = safeDays;
				url = `/api/sensors/withings/sync?days=${safeDays}`;
			}

			const res = await fetch(url, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Sync feilet');
			withingsResult = {
				success: true,
				message: payload.message || (mode === 'from2017' ? 'Withings historikk importert fra 2017.' : 'Withings synkronisert.')
			};
			await loadWithingsStatus();
		} catch (error) {
			withingsResult = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			syncingWithings = false;
		}
	}

	async function importWithingsBatch() {
		const today = new Date().toISOString().split('T')[0];
		let fromDate: string;

		if (withingsImportMode === 'from2017') {
			fromDate = '2017-09-01';
		} else {
			const safeDays = Math.max(1, Math.min(365, Math.floor(Number(withingsImportDays) || 30)));
			withingsImportDays = safeDays;
			const d = new Date();
			d.setDate(d.getDate() - safeDays);
			fromDate = d.toISOString().split('T')[0];
		}

		withingsBatchRunning = true;
		withingsBatchProgress = null;
		withingsBatchJobId = null;
		withingsResult = null;

		try {
			const res = await fetch('/api/admin/batch/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'withings_backfill', fromDate, toDate: today })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke starte import');
			withingsBatchJobId = payload.jobId;
			await runWithingsBatchLoop();
		} catch (error) {
			withingsBatchProgress = {
				done: true, processedDays: 0, totalDays: 0, progressPct: 0,
				nextDate: null, stats: { weight: 0, activity: 0, sleep: 0, workouts: 0, total: 0 },
				error: error instanceof Error ? error.message : 'Ukjent feil'
			};
			withingsBatchRunning = false;
		}
	}

	async function runWithingsBatchLoop() {
		if (!withingsBatchJobId) return;
		try {
			while (true) {
				const res = await fetch('/api/admin/batch/step', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ jobId: withingsBatchJobId })
				});
				const progress = await res.json();
				withingsBatchProgress = progress;
				if (progress.done || progress.error) break;
				if (progress.waitMs > 0) await new Promise(r => setTimeout(r, progress.waitMs));
			}
		} finally {
			withingsBatchRunning = false;
		}
	}

	async function disconnectWithings() {
		if (!confirm('Koble fra Withings?')) return;
		await fetch('/api/sensors/withings/disconnect', { method: 'POST' });
		await loadWithingsStatus();
	}

	async function loadSleepDebug() {
		loadingSleepDebug = true;
		sleepDebugError = null;
		try {
			const res = await fetch('/api/admin/debug-sleep');
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke hente søvndata');
			sleepDebug = payload;
		} catch (error) {
			sleepDebugError = error instanceof Error ? error.message : 'Ukjent feil';
			sleepDebug = null;
		} finally {
			loadingSleepDebug = false;
		}
	}

	async function startSleepBackfill() {
		sleepBackfillRunning = true;
		sleepBackfillProgress = null;
		sleepBackfillJobId = null;
		try {
			const res = await fetch('/api/admin/batch/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					type: 'withings_sleep_hr',
					fromDate: sleepBackfillFromDate,
					toDate: sleepBackfillToDate
				})
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke starte backfill');
			sleepBackfillJobId = payload.jobId;
			await runSleepBackfillLoop();
		} catch (error) {
			sleepBackfillProgress = {
				done: true, processedDays: 0, totalDays: 0, progressPct: 0,
				nextDate: null, stats: { found: 0, updated: 0, daysWithHr: 0 },
				error: error instanceof Error ? error.message : 'Ukjent feil'
			};
			sleepBackfillRunning = false;
		}
	}

	async function runSleepBackfillLoop() {
		if (!sleepBackfillJobId) return;
		try {
			while (true) {
				const res = await fetch('/api/admin/batch/step', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ jobId: sleepBackfillJobId })
				});
				const progress = await res.json();
				sleepBackfillProgress = progress;
				if (progress.done || progress.error) break;
				if (progress.waitMs > 0) await new Promise(r => setTimeout(r, progress.waitMs));
			}
			if (sleepBackfillProgress?.done && !sleepBackfillProgress?.error) {
				sleepBackfillReaggregating = true;
				await fetch('/api/sensors/aggregate', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ fromDate: sleepBackfillFromDate })
				});
				invalidateDashboardKind('health');
				sleepBackfillReaggregating = false;
			}
		} finally {
			sleepBackfillRunning = false;
		}
	}

	async function loadWithingsDebug() {
		loadingWithingsDebug = true;
		withingsDebugError = null;
		try {
			const days = Math.max(1, Math.min(365, Math.floor(Number(withingsDebugDays) || 30)));
			const limit = Math.max(1, Math.min(100, Math.floor(Number(withingsDebugLimit) || 10)));
			withingsDebugDays = days;
			withingsDebugLimit = limit;
			const res = await fetch(
				`/api/sensors/withings/debug/recent-workouts?days=${days}&limit=${limit}`
			);
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke hente aktiviteter');
			withingsDebug = payload;
		} catch (error) {
			withingsDebugError = error instanceof Error ? error.message : 'Ukjent feil';
			withingsDebug = null;
		} finally {
			loadingWithingsDebug = false;
		}
	}

	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}t ${m % 60}m ${s}s`;
		return `${m}m ${s}s`;
	}

	async function loadSpondStatus() {
		loadingSpond = true;
		try {
			const res = await fetch('/api/sensors/spond/status');
			if (res.ok) spondStatus = await res.json();
		} finally {
			loadingSpond = false;
		}
	}

	async function connectSpond() {
		connectingSpond = true;
		spondResult = null;
		try {
			const res = await fetch('/api/sensors/spond/connect', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: spondEmail.trim(), password: spondPassword })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.message || 'Tilkobling feilet');
			spondResult = { success: true, message: payload.message };
			spondEmail = '';
			spondPassword = '';
			await loadSpondStatus();
		} catch (err) {
			spondResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			connectingSpond = false;
		}
	}

	async function syncSpond() {
		syncingSpond = true;
		spondResult = null;
		try {
			const res = await fetch('/api/sensors/spond/sync', { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.message || 'Sync feilet');
			spondResult = { success: true, message: payload.message };
			await loadSpondStatus();
		} catch (err) {
			spondResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			syncingSpond = false;
		}
	}

	async function disconnectSpond() {
		if (!confirm('Koble fra Spond? Dette sletter alle importerte hendelser.')) return;
		await fetch('/api/sensors/spond/disconnect', { method: 'POST' });
		await loadSpondStatus();
	}

	async function loadSalaryProfileData() {
		loadingSalaryProfile = true;
		try {
			const res = await fetch('/api/admin/salary-profile');
			if (res.ok) {
				const payload = await res.json();
				salaryProfile = payload.profile ?? null;
				salaryProfileNextPayday = payload.predictedNextPayday ?? null;
				salaryProfilePaychecks = payload.paychecks ?? [];
			}
		} finally {
			loadingSalaryProfile = false;
		}
	}

	async function loadSalaryAccounts() {
		if (salaryAccounts.length > 0) return;
		try {
			const res = await fetch('/api/economics/accounts');
			if (res.ok) salaryAccounts = await res.json();
		} catch {
			// non-critical
		}
	}

	async function loadAccountTransactions() {
		if (!manualAccountId) { accountTransactions = []; return; }
		loadingAccountTxs = true;
		accountTransactions = [];
		selectedTxId = '';
		buildFromTxResult = null;
		try {
			const res = await fetch(`/api/admin/salary-profile/account-transactions?accountId=${encodeURIComponent(manualAccountId)}`);
			if (res.ok) accountTransactions = await res.json();
		} finally {
			loadingAccountTxs = false;
		}
	}

	async function buildProfileFromTransaction() {
		if (!selectedTxId) return;
		buildingFromTx = true;
		buildFromTxResult = null;
		try {
			const res = await fetch('/api/admin/salary-profile/from-transaction', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ transactionId: selectedTxId })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Bygging feilet');
			buildFromTxResult = { success: true, message: 'Profil bygget fra valgt transaksjon.' };
			await loadSalaryProfileData();
		} catch (err) {
			buildFromTxResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			buildingFromTx = false;
		}
	}

	async function loadDiagnostics() {
		loadingDiag = true;
		diagData = null;
		try {
			const res = await fetch('/api/admin/salary-profile/diagnostics');
			if (res.ok) diagData = await res.json();
		} finally {
			loadingDiag = false;
		}
	}

	async function rebuildSalaryProfile() {
		rebuildingProfile = true;
		rebuildProfileResult = null;
		try {
			const res = await fetch('/api/admin/salary-profile/rebuild', { method: 'POST' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Bygging feilet');
			rebuildProfileResult = { success: true, message: 'Lønnsprofile bygget.' };
			await loadSalaryProfileData();
		} catch (err) {
			rebuildProfileResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			rebuildingProfile = false;
		}
	}

	async function backfillPaychecks(dryRun: boolean) {
		backfillingPaychecks = true;
		backfillResult = null;
		try {
			const url = `/api/admin/salary-profile/backfill${dryRun ? '?dryRun=true' : ''}`;
			const res = await fetch(url, { method: 'POST' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Backfill feilet');
			if (dryRun) {
				const { wouldTag, wouldClear } = payload;
				backfillResult = {
					success: true,
					message: `Tørrtest: ville tagget ${wouldTag?.main ?? 0} hoved + ${wouldTag?.supplementary ?? 0} tillegg, fjernet ${wouldClear ?? 0} foreldede tagger`
				};
			} else {
				const { tagged, cleared } = payload;
				backfillResult = {
					success: true,
					message: `Tagget ${tagged?.main ?? 0} hoved + ${tagged?.supplementary ?? 0} tillegg, fjernet ${cleared ?? 0} foreldede tagger`
				};
				await loadSalaryProfileData();
			}
		} catch (err) {
			backfillResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			backfillingPaychecks = false;
		}
	}

	function startEditProfile() {
		if (!salaryProfile) return;
		profileEditFingerprint = salaryProfile.descriptionFingerprint;
		profileEditAmountMin = salaryProfile.amountMin;
		profileEditAmountMax = salaryProfile.amountMax;
		profileEditDom = salaryProfile.typicalDom;
		editingProfile = true;
		profileEditResult = null;
	}

	async function saveProfileEdit() {
		savingProfileEdit = true;
		profileEditResult = null;
		try {
			const safeDom = Math.max(1, Math.min(31, Math.floor(Number(profileEditDom) || 25)));
			profileEditDom = safeDom;
			const res = await fetch('/api/admin/salary-profile', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					descriptionFingerprint: profileEditFingerprint.trim().toUpperCase(),
					amountMin: Number(profileEditAmountMin),
					amountMax: Number(profileEditAmountMax),
					typicalDom: safeDom
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Lagring feilet');
			profileEditResult = { success: true, message: 'Lønnsprofile oppdatert.' };
			salaryProfile = payload.profile ?? salaryProfile;
			editingProfile = false;
		} catch (err) {
			profileEditResult = { success: false, message: err instanceof Error ? err.message : 'Ukjent feil' };
		} finally {
			savingProfileEdit = false;
		}
	}

	async function loadSparebank1Status() {
		loadingSparebank1 = true;
		try {
			const res = await fetch('/api/sensors/sparebank1/status');
			if (res.ok) sparebank1Status = await res.json();
		} finally {
			loadingSparebank1 = false;
		}
	}

	async function syncSparebank1(mode: 'default' | 'days' | 'from2020' = 'default') {
		syncingSparebank1 = true;
		sparebank1Result = null;
		sparebank1JobPollError = null;
		showSparebank1Details = false;
		try {
			let url = '/api/sensors/sparebank1/sync';
			if (mode === 'from2020') {
				url = '/api/sensors/sparebank1/sync?from2020=true';
			} else if (mode === 'days') {
				const safeDays = Math.max(1, Math.min(365, Math.floor(Number(sparebank1ImportDays) || 1)));
				sparebank1ImportDays = safeDays;
				url = `/api/sensors/sparebank1/sync?days=${safeDays}`;
			}
			const res = await fetch(url, { method: 'POST' });
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Sync feilet');
			const queuedJob: Sparebank1QueuedJob | undefined = payload?.job
				? {
					id: payload.job.id,
					status: payload.job.status,
					createdAt: payload.job.createdAt,
					updatedAt: payload.job.updatedAt,
					startedAt: payload.job.startedAt ?? null,
					finishedAt: payload.job.finishedAt ?? null,
					error: payload.job.error ?? null,
					result: payload.job.result ?? null
				}
				: undefined;
			sparebank1Result = {
				success: true,
				message: payload.message || 'SpareBank 1 synkronisert.',
				debug: payload?.synced?.debug,
				queued: payload?.queued === true,
				job: queuedJob
			};
			if (payload?.queued === true && queuedJob?.id) {
				startSparebank1JobPolling(queuedJob.id);
			} else {
				clearSparebank1Polling();
			}
			await loadSparebank1Status();
		} catch (error) {
			clearSparebank1Polling();
			sparebank1Result = { success: false, message: error instanceof Error ? error.message : 'Ukjent feil' };
		} finally {
			syncingSparebank1 = false;
		}
	}

	async function importSparebank1Batch() {
		const today = new Date().toISOString().split('T')[0];
		let fromDate: string;

		if (sparebank1ImportMode === 'from2020') {
			fromDate = '2020-01-01';
		} else {
			const safeDays = Math.max(1, Math.min(365, Math.floor(Number(sparebank1ImportDays) || 30)));
			sparebank1ImportDays = safeDays;
			const d = new Date();
			d.setDate(d.getDate() - safeDays);
			fromDate = d.toISOString().split('T')[0];
		}

		sparebank1BatchRunning = true;
		sparebank1BatchProgress = null;
		sparebank1BatchJobId = null;
		sparebank1Result = null;

		try {
			const res = await fetch('/api/admin/batch/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ type: 'sparebank1_backfill', fromDate, toDate: today })
			});
			const payload = await res.json();
			if (!res.ok) throw new Error(payload.error || 'Klarte ikke starte import');
			sparebank1BatchJobId = payload.jobId;
			await runSparebank1BatchLoop();
		} catch (error) {
			sparebank1BatchProgress = {
				done: true, processedDays: 0, totalDays: 0, progressPct: 0,
				nextDate: null, stats: { transactionsInserted: 0, chunksWritten: 0, totalChunks: 0 },
				error: error instanceof Error ? error.message : 'Ukjent feil'
			};
			sparebank1BatchRunning = false;
		}
	}

	async function runSparebank1BatchLoop() {
		if (!sparebank1BatchJobId) return;
		try {
			while (true) {
				const res = await fetch('/api/admin/batch/step', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ jobId: sparebank1BatchJobId })
				});
				const progress = await res.json();
				sparebank1BatchProgress = progress;
				if (progress.done || progress.error) break;
				if (progress.waitMs > 0) await new Promise(r => setTimeout(r, progress.waitMs));
			}
		} finally {
			sparebank1BatchRunning = false;
		}
	}

	function formatDateTime(iso: string) {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso;
		return date.toLocaleString('nb-NO');
	}

	function formatDecision(decision: string) {
		switch (decision) {
			case 'queued_for_insert':
				return 'Klar for insert';
			case 'skipped_existing_in_db':
				return 'Filtrert: finnes i DB';
			case 'duplicate_in_batch':
				return 'Filtrert: duplikat i batch';
			case 'replaced_by_booked_in_batch':
				return 'Filtrert: erstattet av BOOKED';
			default:
				return decision;
		}
	}

	async function disconnectSparebank1() {
		if (!confirm('Koble fra SpareBank 1?')) return;
		await fetch('/api/sensors/sparebank1/disconnect', { method: 'POST' });
		await loadSparebank1Status();
	}

	async function resetEconomicsData() {
		const ok = confirm('Dette sletter ALL økonomidata (transaksjoner, saldo, canonical, kategorisering). Fortsette?');
		if (!ok) return;
		const confirmAgain = confirm('Er du helt sikker? Dette kan ikke angres.');
		if (!confirmAgain) return;

		resettingEconomics = true;
		resetEconomicsResult = null;
		clearSparebank1Polling();

		try {
			const res = await fetch('/api/admin/reset-economics', { method: 'DELETE' });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(payload?.error || 'Kunne ikke tømme økonomidata');

			const deletedCount = Number(payload?.deletedCount ?? 0);
			resetEconomicsResult = {
				success: true,
				message: payload?.message || `Slettet ${deletedCount} rader med økonomidata.`
			};
			sparebank1Result = null;
			await loadSparebank1Status();
		} catch (error) {
			resetEconomicsResult = {
				success: false,
				message: error instanceof Error ? error.message : 'Ukjent feil under tømming av økonomidata'
			};
		} finally {
			resettingEconomics = false;
		}
	}

	async function loadGoogleSheetsStatus() {
		loadingGoogleSheets = true;
		try {
			const res = await fetch('/api/sensors/google-sheets/status');
			if (res.ok) googleSheetsStatus = await res.json();
		} finally {
			loadingGoogleSheets = false;
		}
	}

	async function disconnectGoogleSheets() {
		if (!confirm('Koble fra Google Regneark?')) return;
		await fetch('/api/sensors/google-sheets/disconnect', { method: 'POST' });
		await loadGoogleSheetsStatus();
	}

</script>

<AppPage width="full" theme="dark" className="sources-page">
	<PageHeader
		title="Kilder"
		subtitle={`${connectedCount}/4 tilkoblet`}
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	/>

	<div class="sources-content">
	<section class="card">
		<h2>Google Chat og tidssone</h2>
		<div class="field">
			<label for="webhook">Webhook URL</label>
			<Input id="webhook" className="input" type="url" bind:value={webhook} placeholder="https://chat.googleapis.com/v1/spaces/..." />
		</div>
		<div class="field">
			<label for="timezone">Tidssone</label>
			<Select id="timezone" className="input" bind:value={timezone}>
				<option value="Europe/Oslo">Europe/Oslo</option>
				<option value="Europe/Copenhagen">Europe/Copenhagen</option>
				<option value="Europe/Stockholm">Europe/Stockholm</option>
				<option value="UTC">UTC</option>
			</Select>
		</div>
		<Button onClick={saveSourceConfig} disabled={savingSourceConfig}>
			{savingSourceConfig ? 'Lagrer...' : 'Lagre'}
		</Button>
		{#if sourceConfigResult}
			<p class={sourceConfigResult.success ? 'ok' : 'err'}>{sourceConfigResult.message}</p>
		{/if}
	</section>

	<section class="card">
		<h2>Withings</h2>
		{#if loadingWithings}
			<p>Laster...</p>
		{:else if withingsStatus?.connected}
			<p class="ok">Tilkoblet</p>
			<div class="field">
				<p class="field-title">Importperiode</p>
				<div class="row import-mode-row">
					<label class="option-pill">
						<Radio name="withings-import-mode" value="days" bind:group={withingsImportMode} />
						<span>Siste</span>
						<Input
							type="number"
							min="1"
							max="365"
							className="input days-input"
							bind:value={withingsImportDays}
							disabled={withingsImportMode !== 'days'}
						/>
						<span>dager</span>
					</label>
					<label class="option-pill">
						<Radio name="withings-import-mode" value="from2017" bind:group={withingsImportMode} />
						<span>Fra 2017 (uten begrensning)</span>
					</label>
				</div>
			</div>
			<div class="row">
				<Button variant="secondary" onClick={() => syncWithings('default')} disabled={syncingWithings || withingsBatchRunning}>{syncingWithings ? 'Synker...' : 'Synk nå'}</Button>
				<Button variant="secondary" onClick={importWithingsBatch} disabled={syncingWithings || withingsBatchRunning}>
					{withingsBatchRunning ? 'Importerer…' : 'Importer valgt periode'}
				</Button>
				<Button variant="ghost" onClick={disconnectWithings}>Koble fra</Button>
			</div>
			{#if withingsBatchProgress}
				<div class="batch-progress">
					<div class="batch-progress-bar">
						<div class="batch-progress-fill" style="width: {withingsBatchProgress.progressPct}%"></div>
					</div>
					<p class="debug-summary">
						{withingsBatchProgress.processedDays} / {withingsBatchProgress.totalDays} dager
						({withingsBatchProgress.progressPct}%)
						{#if withingsBatchProgress.nextDate && !withingsBatchProgress.done}· behandler {withingsBatchProgress.nextDate}{/if}
						{#if withingsBatchProgress.done && !withingsBatchProgress.error}· ferdig ✓{/if}
					</p>
					{#if withingsBatchProgress.stats}
						<p class="debug-summary">
							Vekt: {withingsBatchProgress.stats.weight} · Aktivitet: {withingsBatchProgress.stats.activity} · Søvn: {withingsBatchProgress.stats.sleep} · Treninger: {withingsBatchProgress.stats.workouts}
						</p>
					{/if}
					{#if withingsBatchProgress.error}
						<p class="err">Feil: {withingsBatchProgress.error}</p>
					{/if}
				</div>
			{/if}
		{:else}
			<Button href="/api/sensors/withings/connect">Koble til Withings</Button>
		{/if}
		{#if withingsResult}<p class={withingsResult.success ? 'ok' : 'err'}>{withingsResult.message}</p>{/if}

		{#if withingsStatus?.connected}
			<div class="details-wrap">
				<Button
					type="button"
					variant="ghost"
					onClick={() => (showWithingsDebug = !showWithingsDebug)}
				>
					{showWithingsDebug ? 'Skjul debug' : 'Vis debug (rå aktiviteter fra Withings)'}
				</Button>

				{#if showWithingsDebug}
					<div class="debug-panel">
						<div class="row debug-controls">
							<label class="option-pill">
								<span>Siste</span>
								<Input
									type="number"
									min="1"
									max="365"
									className="input days-input"
									bind:value={withingsDebugDays}
								/>
								<span>dager</span>
							</label>
							<label class="option-pill">
								<span>Maks</span>
								<Input
									type="number"
									min="1"
									max="100"
									className="input days-input"
									bind:value={withingsDebugLimit}
								/>
								<span>treff</span>
							</label>
							<Button
								type="button"
								variant="secondary"
								onClick={loadWithingsDebug}
								disabled={loadingWithingsDebug}
							>
								{loadingWithingsDebug ? 'Henter...' : 'Hent'}
							</Button>
						</div>

						{#if withingsDebugError}
							<p class="err">{withingsDebugError}</p>
						{/if}

						{#if withingsDebug}
							<p class="debug-summary">
								Vindu: {withingsDebug.windowDays} dager · Hentet: {withingsDebug.totalFetched} · Viser: {withingsDebug.returned}
							</p>
							<div class="debug-table-wrap">
								<table class="debug-table">
									<thead>
										<tr>
											<th>Start</th>
											<th>Kategori</th>
											<th>Sport</th>
											<th>Varighet</th>
											<th>Distanse</th>
											<th>Kalorier</th>
										</tr>
									</thead>
									<tbody>
										{#each withingsDebug.workouts as w}
											<tr class={w.mapped ? '' : 'unmapped-row'}>
												<td>{new Date(w.startdate * 1000).toLocaleString('nb-NO')}</td>
												<td>{w.category}</td>
												<td>{w.sportType}{w.mapped ? '' : ' (umappet)'}</td>
												<td>{formatDuration(w.durationSeconds)}</td>
												<td>{w.distance != null ? `${Math.round(w.distance)} m` : '-'}</td>
												<td>{w.calories != null ? Math.round(w.calories) : '-'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="details-wrap">
				<Button
					type="button"
					variant="ghost"
					onClick={() => (showSleepDebug = !showSleepDebug)}
				>
					{showSleepDebug ? 'Skjul søvn-debug' : 'Vis søvn-debug (puls fra Withings)'}
				</Button>

				{#if showSleepDebug}
					<div class="debug-panel">
						<Button
							type="button"
							variant="secondary"
							onClick={loadSleepDebug}
							disabled={loadingSleepDebug}
						>
							{loadingSleepDebug ? 'Henter...' : 'Hent'}
						</Button>

						{#if sleepDebugError}
							<p class="err">{sleepDebugError}</p>
						{/if}

						{#if sleepDebug}
							<p class="debug-summary">
								DB: {sleepDebug.db.totalEvents} sleep-events · {sleepDebug.db.eventsWithHr} med HR
							</p>
							{#if sleepDebug.db.events.length > 0}
								<div class="debug-table-wrap">
									<table class="debug-table">
										<thead>
											<tr>
												<th>Tidspunkt</th>
												<th>HR snitt</th>
												<th>Varighet</th>
												<th>Felter</th>
											</tr>
										</thead>
										<tbody>
											{#each sleepDebug.db.events as e}
												<tr class={e.hr_average !== null ? '' : 'unmapped-row'}>
													<td>{new Date(e.timestamp).toLocaleString('nb-NO')}</td>
													<td>{e.hr_average ?? '–'}</td>
													<td>{e.duration != null ? Math.round(e.duration / 60) + ' min' : '–'}</td>
													<td class="small">{e.dataKeys.join(', ')}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}

							<p class="debug-summary" style="margin-top:0.75rem">
								Sammendrag (getsummary): {sleepDebug.summary.totalNights} netter · {sleepDebug.summary.nightsWithHr} med HR
							</p>
							{#if sleepDebug.summary.nights?.length > 0}
								<div class="debug-table-wrap">
									<table class="debug-table">
										<thead>
											<tr>
												<th>Dato</th>
												<th>HR snitt</th>
												<th>HR min</th>
												<th>HR maks</th>
												<th>ÅF snitt</th>
												<th>Varighet</th>
												<th>Felter</th>
											</tr>
										</thead>
										<tbody>
											{#each sleepDebug.summary.nights as s}
												<tr class={s.hr_average !== null ? '' : 'unmapped-row'}>
													<td>{s.date}</td>
													<td>{s.hr_average ?? '–'}</td>
													<td>{s.hr_min ?? '–'}</td>
													<td>{s.hr_max ?? '–'}</td>
													<td>{s.rr_average ?? '–'}</td>
													<td>{s.duration != null ? Math.round(s.duration / 60) + ' min' : '–'}</td>
													<td class="small">{s.dataKeys.join(', ')}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}

							<p class="debug-summary" style="margin-top:0.75rem">
								Rå datapunkter (get): {sleepDebug.detail.totalSegments} segmenter siste 14 dager
								{#if (sleepDebug.detail as any).error}· Feil: {(sleepDebug.detail as any).error}{/if}
								{#if (sleepDebug.detail as any).rawBodyKeys?.length}· Body-nøkler: {(sleepDebug.detail as any).rawBodyKeys.join(', ')}{/if}
							</p>
							{#if sleepDebug.detail.nights?.length > 0}
								<div class="debug-table-wrap">
									<table class="debug-table">
										<thead>
											<tr>
												<th>Natt</th>
												<th>Segmenter</th>
												<th>HR-prøver</th>
												<th>ÅF-prøver</th>
												<th>Snorking</th>
												<th>Felter</th>
											</tr>
										</thead>
										<tbody>
											{#each sleepDebug.detail.nights as n}
												<tr class={n.hrSamples > 0 ? '' : 'unmapped-row'}>
													<td>{n.date}</td>
													<td>{n.segments}</td>
													<td>{n.hrSamples}</td>
													<td>{n.rrSamples}</td>
													<td>{n.snoringSegments}</td>
													<td class="small">{n.sampleKeys.join(', ')}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
							{#if sleepDebug.detail.sampleSegments?.length > 0}
								<p class="debug-summary" style="margin-top:0.5rem">Eksempelsegmenter siste natt:</p>
								<div class="debug-table-wrap">
									<table class="debug-table">
										<thead>
											<tr><th>Tidspunkt</th><th>Fase</th><th>HR</th><th>ÅF</th><th>Snorking</th></tr>
										</thead>
										<tbody>
											{#each sleepDebug.detail.sampleSegments as seg}
												<tr>
													<td>{new Date(seg.startdate).toLocaleString('nb-NO')}</td>
													<td>{['Våken','Lett','Dyp','REM'][seg.state] ?? seg.state}</td>
													<td>{seg.hr ?? '–'}</td>
													<td>{seg.rr ?? '–'}</td>
													<td>{seg.snoring ?? '–'}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			<div class="details-wrap">
				<p class="field-desc" style="margin-bottom:0.5rem">Backfill søvn-HR — henter puls fra Withings (get) og lagrer i eksisterende sleep-events.</p>
				<div class="row debug-controls">
					<label class="option-pill">
						<span>Fra</span>
						<Input type="date" className="input days-input" bind:value={sleepBackfillFromDate} />
					</label>
					<label class="option-pill">
						<span>Til</span>
						<Input type="date" className="input days-input" bind:value={sleepBackfillToDate} />
					</label>
					<Button
						type="button"
						variant="secondary"
						onClick={startSleepBackfill}
						disabled={sleepBackfillRunning}
					>
						{sleepBackfillRunning ? 'Kjører…' : 'Start backfill'}
					</Button>
				</div>

				{#if sleepBackfillProgress}
					<div class="batch-progress">
						<div class="batch-progress-bar">
							<div class="batch-progress-fill" style="width: {sleepBackfillProgress.progressPct}%"></div>
						</div>
						<p class="debug-summary">
							{sleepBackfillProgress.processedDays} / {sleepBackfillProgress.totalDays} dager
							({sleepBackfillProgress.progressPct}%)
							{#if sleepBackfillProgress.nextDate && !sleepBackfillProgress.done}· behandler {sleepBackfillProgress.nextDate}{/if}
							{#if sleepBackfillProgress.done && !sleepBackfillProgress.error && !sleepBackfillReaggregating}· ferdig ✓{/if}
							{#if sleepBackfillReaggregating}· oppdaterer periodetabell…{/if}
						</p>
						{#if sleepBackfillProgress.stats}
							<p class="debug-summary">
								Oppdatert: {sleepBackfillProgress.stats.updated} events · Dager med HR: {sleepBackfillProgress.stats.daysWithHr}
							</p>
						{/if}
						{#if sleepBackfillProgress.error}
							<p class="err">Feil: {sleepBackfillProgress.error}</p>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<section class="card">
		<h2>Spond</h2>
		<p class="field-desc">Importer barnas (og egne) aktiviteter fra Spond-grupper.</p>
		{#if loadingSpond}
			<p>Laster...</p>
		{:else if spondStatus?.connected}
			<p class="ok">Tilkoblet</p>
			{#if spondStatus.sensor?.lastSync}
				<p class="meta">Siste synk: {new Date(spondStatus.sensor.lastSync).toLocaleString('nb-NO')}</p>
			{/if}
			<div class="row">
				<Button variant="secondary" onClick={syncSpond} disabled={syncingSpond}>
					{syncingSpond ? 'Synker...' : 'Synk nå'}
				</Button>
				<Button variant="ghost" onClick={disconnectSpond}>Koble fra</Button>
			</div>
		{:else}
			<div class="field">
				<label for="spond-email">E-post</label>
				<Input
					id="spond-email"
					type="email"
					className="input"
					bind:value={spondEmail}
					placeholder="din@epost.no"
					autocomplete="username"
				/>
			</div>
			<div class="field">
				<label for="spond-password">Passord</label>
				<Input
					id="spond-password"
					type="password"
					className="input"
					bind:value={spondPassword}
					autocomplete="current-password"
				/>
			</div>
			<Button
				onClick={connectSpond}
				disabled={connectingSpond || !spondEmail || !spondPassword}
			>
				{connectingSpond ? 'Kobler til...' : 'Koble til Spond'}
			</Button>
		{/if}
		{#if spondResult}<p class={spondResult.success ? 'ok' : 'err'}>{spondResult.message}</p>{/if}
	</section>

	<section class="card">
		<h2>SpareBank 1</h2>
		{#if loadingSparebank1}
			<p>Laster...</p>
		{:else if sparebank1Status?.connected}
			<p class="ok">Tilkoblet</p>
			<div class="field">
				<p class="field-title">Importperiode</p>
				<div class="row import-mode-row">
					<label class="option-pill">
						<Radio name="sparebank1-import-mode" value="days" bind:group={sparebank1ImportMode} />
						<span>Siste</span>
						<Input
							type="number"
							min="1"
							max="365"
							className="input days-input"
							bind:value={sparebank1ImportDays}
							disabled={sparebank1ImportMode !== 'days'}
						/>
						<span>dager</span>
					</label>

					<label class="option-pill">
						<Radio name="sparebank1-import-mode" value="from2020" bind:group={sparebank1ImportMode} />
						<span>Fra 2020 (uten begrensning)</span>
					</label>
				</div>
			</div>
			<div class="row">
				<Button variant="secondary" onClick={() => syncSparebank1('default')} disabled={syncingSparebank1 || sparebank1BatchRunning}>Synk nå</Button>
				<Button variant="secondary" onClick={importSparebank1Batch} disabled={syncingSparebank1 || sparebank1BatchRunning}>
					{sparebank1BatchRunning ? 'Importerer…' : 'Importer valgt periode'}
				</Button>
				<Button variant="danger" onClick={resetEconomicsData} disabled={resettingEconomics || syncingSparebank1 || sparebank1BatchRunning}>
					{resettingEconomics ? 'Tømmer...' : 'Tøm all økonomidata'}
				</Button>
				<Button variant="ghost" onClick={disconnectSparebank1}>Koble fra</Button>
			</div>
			{#if sparebank1BatchProgress}
				{@const chunksDone = sparebank1BatchProgress.stats?.chunksWritten ?? 0}
				{@const chunksTotal = sparebank1BatchProgress.stats?.totalChunks ?? 0}
				{@const chunkPct = chunksTotal > 0 ? Math.round((chunksDone / chunksTotal) * 100) : sparebank1BatchProgress.progressPct}
				<div class="batch-progress">
					<div class="batch-progress-bar">
						<div class="batch-progress-fill" style="width: {chunkPct}%"></div>
					</div>
					<p class="debug-summary">
						{chunksDone} / {chunksTotal || '?'} chunks ({chunkPct}%)
						{#if sparebank1BatchProgress.done && !sparebank1BatchProgress.error}· ferdig ✓{/if}
					</p>
					{#if sparebank1BatchProgress.stats}
						<p class="debug-summary">
							Transaksjoner hentet: {sparebank1BatchProgress.stats.transactionsInserted}
						</p>
					{/if}
					{#if sparebank1BatchProgress.error}
						<p class="err">Feil: {sparebank1BatchProgress.error}</p>
					{/if}
				</div>
			{/if}
			{#if resetEconomicsResult}
				<p class={resetEconomicsResult.success ? 'ok' : 'err'}>{resetEconomicsResult.message}</p>
			{/if}

			<!-- ── Lønnsdeteksjon ──────────────────────────────────────────────── -->
			<div class="salary-section">
				<div class="salary-header">
					<h3>Lønnsdeteksjon</h3>
					<Button
						type="button"
						variant="ghost"
						onClick={() => { showSalaryProfile = !showSalaryProfile; if (showSalaryProfile) loadSalaryAccounts(); }}
					>
						{showSalaryProfile ? 'Skjul' : 'Vis detaljer'}
					</Button>
				</div>

				{#if loadingSalaryProfile}
					<p class="meta">Laster lønnsprofile...</p>
				{:else if salaryProfile}
					<p class="meta">
						Neste lønning: <strong>{salaryProfileNextPayday ?? '–'}</strong>
						· Dag i mnd: <strong>{salaryProfile.typicalDom}</strong>
						· Beløpsintervall: <strong>{Math.round(salaryProfile.amountMin).toLocaleString('nb-NO')} – {Math.round(salaryProfile.amountMax).toLocaleString('nb-NO')} kr</strong>
					</p>
				{:else}
					<p class="meta">Ingen aktiv lønnsprofile. Bygg profil basert på historikk.</p>
				{/if}

				{#if showSalaryProfile}
					<div class="salary-detail">
						{#if salaryProfile}
							<div class="profile-grid">
								<span class="profile-label">Fingeravtrykk</span>
								<span class="profile-value mono">{salaryProfile.descriptionFingerprint || '–'}</span>
								<span class="profile-label">Kildekonto</span>
								<span class="profile-value mono">{salaryProfile.sourceAccountId}</span>
								<span class="profile-label">Typisk ukedag</span>
								<span class="profile-value">{['', 'Man', 'Tir', 'Ons', 'Tor', 'Fre'][salaryProfile.typicalDow] ?? '–'}</span>
							</div>
						{/if}

						<!-- Edit profile -->
						{#if editingProfile}
							<div class="profile-edit-form">
								<div class="field">
									<label for="profile-fingerprint">Fingeravtrykk (3 ord, store bokstaver)</label>
									<Input id="profile-fingerprint" className="input" bind:value={profileEditFingerprint} placeholder="EKS ARBEIDSGIVER AS" />
								</div>
								<div class="field row">
									<div>
										<label for="profile-amount-min">Min beløp (kr)</label>
										<Input id="profile-amount-min" className="input" type="number" min="0" bind:value={profileEditAmountMin} />
									</div>
									<div>
										<label for="profile-amount-max">Maks beløp (kr)</label>
										<Input id="profile-amount-max" className="input" type="number" min="0" bind:value={profileEditAmountMax} />
									</div>
									<div>
										<label for="profile-dom">Dag i mnd</label>
										<Input id="profile-dom" className="input" type="number" min="1" max="31" bind:value={profileEditDom} />
									</div>
								</div>
								<div class="row">
									<Button onClick={saveProfileEdit} disabled={savingProfileEdit}>
										{savingProfileEdit ? 'Lagrer...' : 'Lagre endringer'}
									</Button>
									<Button variant="ghost" onClick={() => { editingProfile = false; profileEditResult = null; }}>Avbryt</Button>
								</div>
								{#if profileEditResult}
									<p class={profileEditResult.success ? 'ok' : 'err'}>{profileEditResult.message}</p>
								{/if}
							</div>
						{/if}

						<!-- Action buttons -->
						<div class="row salary-actions">
							<Button variant="secondary" onClick={rebuildSalaryProfile} disabled={rebuildingProfile}>
								{rebuildingProfile ? 'Bygger...' : 'Bygg ny profil fra historikk'}
							</Button>
							{#if salaryProfile && !editingProfile}
								<Button variant="secondary" onClick={startEditProfile}>Korriger manuelt</Button>
							{/if}
						</div>
						{#if rebuildProfileResult}
							<p class={rebuildProfileResult.success ? 'ok' : 'err'}>{rebuildProfileResult.message}</p>
						{/if}

						<!-- Manual setup: pick account + transaction -->
						<div class="manual-setup-section">
							<h4>Manuelt oppsett (velg lønnskonto og transaksjon)</h4>
							<p class="field-desc">Bruk dette om automatikken plukker feil lønningsdag. Velg kontoen lønnen treffer og klikk på riktig lønnstransaksjon.</p>
							<div class="field">
								<label for="salary-account-select">Lønnskonto</label>
								<Select
									id="salary-account-select"
									className="input"
									bind:value={manualAccountId}
									onChange={loadAccountTransactions}
								>
									<option value="">Velg konto...</option>
									{#each salaryAccounts as acc}
										<option value={acc.accountId}>{acc.accountName ?? acc.accountId}{acc.accountType ? ` (${acc.accountType})` : ''}</option>
									{/each}
								</Select>
							</div>

							{#if loadingAccountTxs}
								<p class="meta">Laster transaksjoner...</p>
							{:else if accountTransactions.length > 0}
								<div class="field">
									<p class="field-title">Velg en representativ lønnstransaksjon</p>
									<div class="tx-picker">
										{#each accountTransactions as tx}
											<label class="tx-option" class:tx-selected={selectedTxId === tx.id}>
												<input type="radio" name="salary-tx-pick" value={tx.id} bind:group={selectedTxId} />
												<span class="tx-date">{tx.canonicalDate}</span>
												<span class="tx-amount">{Number(tx.amount).toLocaleString('nb-NO', { minimumFractionDigits: 2 })} kr</span>
												<span class="tx-desc">{tx.description || '–'}</span>
											</label>
										{/each}
									</div>
								</div>
								<div class="row">
									<Button onClick={buildProfileFromTransaction} disabled={!selectedTxId || buildingFromTx}>
										{buildingFromTx ? 'Bygger...' : 'Bygg profil fra valgt transaksjon'}
									</Button>
								</div>
								{#if buildFromTxResult}
									<p class={buildFromTxResult.success ? 'ok' : 'err'}>{buildFromTxResult.message}</p>
								{/if}
							{:else if manualAccountId}
								<p class="meta">Ingen store inntektstransaksjoner (≥ 10 000 kr) funnet på denne kontoen.</p>
							{/if}
						</div>

						<!-- Backfill -->
						{#if salaryProfile}
							<div class="backfill-section">
								<p class="field-desc">Tagg eksisterende transaksjoner med lønnsstatus basert på aktiv profil.</p>
								<div class="row">
									<Button variant="secondary" onClick={() => backfillPaychecks(true)} disabled={backfillingPaychecks}>
										Tørrtest
									</Button>
									<Button variant="secondary" onClick={() => backfillPaychecks(false)} disabled={backfillingPaychecks}>
										{backfillingPaychecks ? 'Kjører...' : 'Kjør backfill'}
									</Button>
								</div>
								{#if backfillResult}
									<p class={backfillResult.success ? 'ok' : 'err'}>{backfillResult.message}</p>
								{/if}
							</div>
						{/if}

						<!-- Recent paychecks -->
						{#if salaryProfilePaychecks.length > 0}
							<div class="paycheck-list">
								<p class="field-title">Siste lønnsinnbetalinger (siste 12 mnd)</p>
								<table class="debug-table">
									<thead>
										<tr>
											<th>Dato</th>
											<th>Beløp</th>
											<th>Beskrivelse</th>
											<th>Type</th>
										</tr>
									</thead>
									<tbody>
										{#each salaryProfilePaychecks as pc}
											<tr>
												<td>{pc.canonicalDate}</td>
												<td>{Number(pc.amount).toLocaleString('nb-NO', { minimumFractionDigits: 2 })} kr</td>
												<td>{pc.description || '–'}</td>
												<td>{pc.paycheckType === 'main' ? 'Hoved' : 'Tillegg'}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{:else if salaryProfile}
							<p class="meta">Ingen taggede lønnsinnbetalinger funnet siste 12 måneder.</p>
						{/if}

						<!-- Diagnostics -->
						<div class="diag-section">
							<div class="row">
								<Button variant="ghost" onClick={loadDiagnostics} disabled={loadingDiag}>
									{loadingDiag ? 'Laster...' : '🔍 Diagnostikk: vis hva som er i databasen'}
								</Button>
							</div>
							{#if diagData}
								<div class="diag-content">
									<p class="field-title">Konto-oversikt (canonical_bank_transactions)</p>
									<table class="debug-table">
										<thead><tr><th>Konto-ID</th><th>Totalt</th><th>Innskudd ≥10k</th><th>Tidligste</th><th>Siste</th></tr></thead>
										<tbody>
											{#each diagData.accountSummary as acc}
												<tr>
													<td class="mono">{acc.accountId}</td>
													<td>{acc.txCount}</td>
													<td>{acc.incomeCount}</td>
													<td>{acc.minDate ?? '–'}</td>
													<td>{acc.maxDate ?? '–'}</td>
												</tr>
											{/each}
										</tbody>
									</table>

									{#if diagData.bigInflows.length > 0}
										<p class="field-title" style="margin-top:0.75rem">Store innbetalinger (≥10k) — siste 36</p>
										<table class="debug-table diag-inflow-table">
											<thead>
												<tr>
													<th>Dato</th>
													<th>Konto</th>
													<th>Beløp</th>
													<th>Beskrivelse</th>
													<th>Nøkkel</th>
													<th>Norm</th>
													<th>FP-treff</th>
													<th>Beløp-treff</th>
													<th>Score</th>
													<th>Resultat</th>
												</tr>
											</thead>
											<tbody>
												{#each diagData.bigInflows as row}
													<tr class:diag-tagged={!!row.paycheckType} class:diag-mismatch={!row.paycheckResult && !row.paycheckType}>
														<td>{row.date}</td>
														<td class="mono" style="font-size:0.72rem">{row.accountId.slice(0,12)}…</td>
														<td>{row.amount.toLocaleString('nb-NO')} kr</td>
														<td>{row.descriptionDisplay ?? '–'}</td>
														<td class="mono">{row.merchantKey ?? '–'}</td>
														<td class="mono">{row.scoreComponents?.descNorm ?? '–'}</td>
														<td>{row.scoreComponents?.fingerprintMatch ? '✓' : '✗'}</td>
														<td>{row.scoreComponents?.inAmountRange ? '✓' : '✗'}</td>
														<td class:diag-score-ok={row.score !== null && row.score >= 80}>{row.score ?? '–'}</td>
														<td>{row.paycheckResult ?? row.paycheckType ?? '–'}</td>
													</tr>
												{/each}
											</tbody>
										</table>
									{:else}
										<p class="meta">Ingen innbetalinger ≥ 10 000 kr funnet i canonical_bank_transactions.</p>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
			<!-- ── /Lønnsdeteksjon ─────────────────────────────────────────────── -->
		{:else}
			<Button href="/api/sensors/sparebank1/connect">Koble til SpareBank 1</Button>
		{/if}
		{#if sparebank1Result}
			<p class={sparebank1Result.success ? 'ok' : 'err'}>{sparebank1Result.message}</p>
			{#if sparebank1Result.success && sparebank1Result.queued && sparebank1Result.job}
				<div class="job-status-panel">
					<p><strong>Bakgrunnsjobb:</strong> {sparebank1Result.job.id}</p>
					<p><strong>Opprettet:</strong> {sparebank1Result.job.createdAt ? formatDateTime(sparebank1Result.job.createdAt) : '-'}</p>
					<p><strong>Status:</strong> {formatJobStatus(sparebank1Result.job.status)}{#if sparebank1Polling} (oppdateres automatisk){/if}</p>
					{#if sparebank1Result.job.startedAt}
						<p><strong>Startet:</strong> {formatDateTime(sparebank1Result.job.startedAt)}</p>
					{/if}
					{#if sparebank1Result.job.finishedAt}
						<p><strong>Ferdig:</strong> {formatDateTime(sparebank1Result.job.finishedAt)}</p>
					{/if}
					{#if sparebank1Result.job.error}
						<p class="err"><strong>Feil:</strong> {sparebank1Result.job.error}</p>
					{/if}
					{#if sparebank1JobPollError}
						<p class="err"><strong>Polling-feil:</strong> {sparebank1JobPollError}</p>
					{/if}
				</div>
			{/if}
			{#if sparebank1Result.success && sparebank1Result.debug}
				<div class="details-wrap">
					<Button
						type="button"
						variant="ghost"
						onClick={() => (showSparebank1Details = !showSparebank1Details)}
					>
						{showSparebank1Details ? 'Skjul detaljer' : 'Vis detaljer'}
					</Button>

					{#if showSparebank1Details}
						<div class="debug-panel">
							<p class="debug-summary">
								Funnet: {sparebank1Result.debug.rawTransactionCount} ·
								Unike i batch: {sparebank1Result.debug.uniqueTransactionCount} ·
								Klar for insert: {sparebank1Result.debug.queuedForInsertCount} ·
								Filtrert i DB: {sparebank1Result.debug.skippedExistingCount} ·
								Batch-duplikater: {sparebank1Result.debug.duplicateInBatchCount} ·
								Erstattet av BOOKED: {sparebank1Result.debug.replacedByBookedInBatchCount}
							</p>
							{#if sparebank1Result.debug.since}
								<p class="debug-since">Fra dato: {formatDateTime(sparebank1Result.debug.since)}</p>
							{/if}
							<div class="debug-table-wrap">
								<table class="debug-table">
									<thead>
										<tr>
											<th>Tidspunkt</th>
											<th>Konto</th>
											<th>Beskrivelse</th>
											<th>Beløp</th>
											<th>Status</th>
											<th>Resultat</th>
											<th>Årsak</th>
										</tr>
									</thead>
									<tbody>
										{#each sparebank1Result.debug.transactions as tx}
											<tr>
												<td>{formatDateTime(tx.timestamp)}</td>
												<td>{tx.accountId}</td>
												<td>{tx.description || '-'}</td>
												<td>{tx.amount.toFixed(2)}</td>
												<td>{tx.bookingStatus || '-'}</td>
												<td>{formatDecision(tx.decision)}</td>
												<td>{tx.reason}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</section>

	<section class="card">
		<h2>Kontoutskrifter – SpareBank 1 (PDF)</h2>
		<p>Last opp en ZIP-fil med SpareBank 1 PDF-kontoutskrifter for å importere historiske transaksjoner og saldo-ankre.</p>
		<label class="upload-label">
			<input
				type="file"
				accept=".zip"
				onchange={importStatements}
				disabled={importingStatements}
				style="display:none"
			/>
			<span class="upload-trigger">
				{importingStatements ? 'Importerer...' : 'Last opp ZIP'}
			</span>
		</label>
		{#if importResult}
			{#if importResult.error}
				<p class="err">❌ {importResult.error}</p>
			{:else}
				<p class="ok">
					✅ {importResult.pdfsProcessed ?? 0} PDF(er) behandlet ·
					{importResult.transactionsImported ?? 0} transaksjoner ·
					{importResult.balancesImported ?? 0} saldo-ankre
					{#if (importResult.skipped ?? 0) > 0}· {importResult.skipped} duplikater hoppet over{/if}
				</p>
			{/if}
		{/if}
		{#if anchorAccounts.length > 0}
			<table class="anchor-table">
				<thead><tr><th>Konto</th><th>Ankre</th><th>Tidligst</th><th>Siste</th><th>Kilde(r)</th></tr></thead>
				<tbody>
					{#each anchorAccounts as acc}
						<tr>
							<td>{acc.accountNumber}</td>
							<td>{acc.totalAnchors}</td>
							<td>{acc.earliest}</td>
							<td>{acc.latest}</td>
							<td>{acc.sources.join(', ')}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section class="card">
		<h2>E-postregler</h2>
		<p class="field-title">Konfigurer hvilke e-poster som skal importeres og hvordan de prosesseres.</p>

		{#if loadingEmailRules}
			<p>Laster...</p>
		{:else}
			{#if emailRulesData.length > 0}
				<div class="email-rules-list">
					{#each emailRulesData as rule}
						<div class="email-rule-item" class:rule-inactive={!rule.isActive}>
							<div class="email-rule-header">
								<div class="email-rule-info">
									<strong>{rule.name}</strong>
									<span class="email-rule-type">{rule.processingType === 'ai_extraction' ? 'AI-ekstraksjon' : rule.processingType === 'workout_files' ? 'Treningsfiler' : rule.processingType === 'library' ? 'Bibliotek' : 'Rå lagring'}</span>
								</div>
								<div class="email-rule-actions">
									<button class="rule-toggle" onclick={() => toggleRule(rule)} title={rule.isActive ? 'Deaktiver' : 'Aktiver'}>
										{rule.isActive ? 'På' : 'Av'}
									</button>
									<button class="rule-edit" onclick={() => editRule(rule)}>Rediger</button>
									<button class="rule-delete" onclick={() => deleteRule(rule)}>Slett</button>
								</div>
							</div>
							<div class="email-rule-filters">
								{#if rule.labelPattern}
									<span class="filter-chip">Label: {rule.labelPattern}</span>
								{/if}
								{#if rule.senderPattern}
									<span class="filter-chip">Avsender: {rule.senderPattern}</span>
								{/if}
								{#if rule.subjectPattern}
									<span class="filter-chip">Emne: {rule.subjectPattern}</span>
								{/if}
								{#if !rule.labelPattern && !rule.senderPattern && !rule.subjectPattern}
									<span class="filter-chip filter-warn">Ingen filter — matcher alle e-poster</span>
								{/if}
							</div>
							{#if rule.matchCount > 0}
								<p class="email-rule-stats">Treff: {rule.matchCount}{rule.lastMatchedAt ? ` · Sist: ${new Date(rule.lastMatchedAt).toLocaleDateString('nb-NO')}` : ''}</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else if !showEmailRuleForm}
				<p style="color: var(--text-tertiary); font-size: 0.84rem;">Ingen regler ennå. Legg til en regel for å importere e-poster automatisk.</p>
			{/if}

			{#if showEmailRuleForm}
				<div class="email-rule-form">
					<h3>{editingRuleId ? 'Rediger regel' : 'Ny regel'}</h3>
					<div class="field">
						<label for="rule-name">Navn *</label>
						<Input id="rule-name" className="input" bind:value={ruleForm.name} placeholder="f.eks. Oda-kvitteringer" />
					</div>
					<div class="field">
						<label for="rule-label">Gmail-label</label>
						<Input id="rule-label" className="input" bind:value={ruleForm.labelPattern} placeholder="f.eks. resonans/oda" />
						<p class="field-hint">Matcher e-poster fra denne Gmail-labelen. Bruk * som wildcard.</p>
					</div>
					<div class="field">
						<label for="rule-sender">Avsender-filter</label>
						<Input id="rule-sender" className="input" bind:value={ruleForm.senderPattern} placeholder="f.eks. *@oda.com eller noreply@spond.com" />
						<p class="field-hint">Bruk * som wildcard. La stå tom for å matche alle avsendere.</p>
					</div>
					<div class="field">
						<label for="rule-subject">Emne-filter</label>
						<Input id="rule-subject" className="input" bind:value={ruleForm.subjectPattern} placeholder="f.eks. Ordrebekreftelse" />
						<p class="field-hint">Matcher om emnet inneholder teksten.</p>
					</div>
					<div class="field">
						<label for="rule-type">Prosessering</label>
						<Select id="rule-type" className="input" bind:value={ruleForm.processingType}>
							<option value="ai_extraction">AI-ekstraksjon (GPT trekker ut data)</option>
							<option value="raw_store">Rå lagring (lagre som tekst)</option>
							<option value="workout_files">Treningsfiler (GPX/TCX)</option>
							<option value="library">Bibliotek (lånefrist → sjekkliste)</option>
						</Select>
					</div>
					{#if ruleForm.processingType === 'ai_extraction'}
						<div class="field">
							<label for="rule-prompt">Tilpasset AI-prompt (valgfritt)</label>
							<textarea id="rule-prompt" class="input" bind:value={ruleForm.extractionPrompt} rows="4" placeholder="La stå tom for standard-ekstraksjon. Skriv en tilpasset prompt for spesifikke behov."></textarea>
						</div>
					{/if}
					<div class="row">
						<Button onClick={saveEmailRule} disabled={savingRule || !ruleForm.name.trim()}>
							{savingRule ? 'Lagrer...' : editingRuleId ? 'Oppdater' : 'Opprett'}
						</Button>
						<Button variant="ghost" onClick={resetRuleForm}>Avbryt</Button>
					</div>
					{#if ruleResult}
						<p class={ruleResult.success ? 'ok' : 'err'}>{ruleResult.message}</p>
					{/if}
				</div>
			{:else}
				<Button variant="secondary" onClick={() => { showEmailRuleForm = true; ruleResult = null; }}>
					Legg til e-postregel
				</Button>
			{/if}
		{/if}
	</section>

	<section class="card">
		<h2>Google Regneark</h2>
		{#if loadingGoogleSheets}
			<p>Laster...</p>
		{:else if googleSheetsStatus?.connected}
			<p class="ok">Tilkoblet</p>
			<div class="row">
				<Button variant="ghost" onClick={disconnectGoogleSheets}>Koble fra</Button>
				<Button variant="secondary" href="/api/sensors/google-sheets/connect">Koble til på nytt</Button>
			</div>
		{:else}
			<Button href="/api/sensors/google-sheets/connect">Koble til Google Regneark</Button>
		{/if}
	</section>

	<section class="card">
		<h2>E-post (Gmail via Apps Script)</h2>
		<p class="muted">
			Send merkede Gmail-meldinger til Resonans. Kun e-poster med en av de
			konfigurerte labelene forlater Gmail — alt annet ignoreres.
		</p>

		{#if !data.emailWebhookConfigured}
			<p class="err">
				<code>EMAIL_WEBHOOK_SECRET</code> er ikke satt på serveren. Be admin
				generere en hemmelighet og deploye på nytt.
			</p>
		{:else}
			<div class="email-stats">
				<span class="ok">Aktiv</span>
				<span class="muted">·</span>
				<span>{data.emailImports.last7Days} e-poster siste 7 dager</span>
				{#if data.emailImports.last7Days > 0}
					<span class="muted">
						({data.emailImports.workouts} treninger, {data.emailImports.libraryItems} bibliotek)
					</span>
				{/if}
			</div>

			<div class="field">
				<p class="field-title">Endepunkt</p>
				<div class="row">
					<code class="endpoint-code">{data.emailEndpoint}</code>
					<Button variant="secondary" onClick={copyEmailEndpoint}>
						{emailEndpointCopied ? 'Kopiert ✓' : 'Kopier'}
					</Button>
				</div>
			</div>

			<div class="field">
				<p class="field-title">Støttede labels</p>
				<ul class="label-list">
					{#each data.emailLabels as entry (entry.label)}
						<li>
							<code>{entry.label}</code>
							<span class="muted"> — {entry.description}</span>
						</li>
					{/each}
				</ul>
			</div>

			<div class="field">
				<p class="field-title">Apps Script-kildekode</p>
				<p class="muted">
					Lim inn dette i <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a>
					→ nytt prosjekt → <code>Code.gs</code>. Endepunkt og token er
					pre-utfylt. Sett en tidsutløser som kjører <code>syncResonans</code>
					hvert 5. minutt.
				</p>
				<div class="row">
					<Button variant="secondary" onClick={copyAppsScript}>
						{emailScriptCopied ? 'Kopiert ✓' : 'Kopier kildekode'}
					</Button>
					<Button variant="secondary" onClick={runEmailTest} disabled={emailTestRunning}>
						{emailTestRunning ? 'Tester…' : 'Send test-bibliotek-mail'}
					</Button>
				</div>
				{#if emailTestResult}
					<p class={emailTestResult.ok ? 'ok' : 'err'}>{emailTestResult.message}</p>
				{/if}

				{#if data.emailAppsScriptSource}
					<details bind:open={emailGuideOpen} class="apps-script-details">
						<summary>Vis kildekode</summary>
						<pre class="apps-script-code"><code>{data.emailAppsScriptSource}</code></pre>
					</details>
				{/if}
			</div>

			<details class="email-guide">
				<summary>Trinnvis oppsett-guide</summary>
				<ol class="email-guide-list">
					<li>
						Opprett labels i Gmail som matcher tabellen over (f.eks.
						<code>Resonans/Workout</code>, <code>Resonans/Bibliotek</code>).
						Bruk skråstrek for å lage hierarki.
					</li>
					<li>
						Sett opp filtre i Gmail for å auto-merke relevante e-poster.
						(Innstillinger → Filtre og blokkerte adresser → Opprett filter →
						Bruk label.)
					</li>
					<li>
						Åpne <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a>,
						opprett et nytt prosjekt, lim inn kildekoden over i <code>Code.gs</code>.
					</li>
					<li>
						Klikk <em>Run</em> én gang for å autorisere scriptet (Google ber om
						tilgang til Gmail).
					</li>
					<li>
						Sett en tidsutløser: klokke-ikonet → <em>Add Trigger</em> →
						funksjon <code>syncResonans</code>, type <em>Time-driven</em>,
						intervall <em>Every 5 minutes</em>.
					</li>
					<li>
						Test ved å merke en e-post med en støttet label og vente
						5 minutter — eller kjør <em>Send test-bibliotek-mail</em>-knappen
						over for å verifisere at endepunktet og handler-en virker.
					</li>
				</ol>
			</details>
		{/if}
	</section>
	</div>
</AppPage>

<style>
	:global(.sources-page) {
		color: var(--text-secondary);
		--surface: #171717;
		--surface-soft: #1c1c1c;
		--surface-strong: #202020;
		--line: #2a2a2a;
		--accent: #4a5af0;
	}

	.sources-content {
		display: flex;
		flex-direction: column;
		gap: 0.95rem;
	}

	.card {
		background: var(--surface);
		border: none;
		border-radius: 18px;
		padding: 1rem 1rem 1.05rem;
		box-shadow: none;
	}
	.card h2 {
		margin: 0 0 0.55rem;
		color: #e4e4e4;
		font-size: 1rem;
		font-weight: 620;
	}
	.field { margin-bottom: 0.9rem; }
	.field label { display: block; margin-bottom: 0.4rem; color: #bdbdbd; font-size: 0.82rem; }
	.field-title { margin: 0 0 0.4rem; color: #c8c8c8; font-size: 0.82rem; }
	:global(.input) {
		width: 100%;
		padding: 0.65rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #111;
		color: #f0f0f0;
	}
	:global(.input:focus) {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 2px rgba(74, 90, 240, 0.18);
	}
	.row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
	.ok { color: #4ade80; margin: 0.6rem 0 0; }
	.err { color: #f87171; margin: 0.6rem 0 0; }
	.meta { color: #7f7f7f; font-size: 0.82rem; margin: 0.2rem 0 0.6rem; }
	.field-desc { color: #9b9b9b; font-size: 0.84rem; margin: 0 0 0.8rem; }
	:global(.btn-primary), :global(.btn-secondary), :global(.btn-ghost) { text-decoration: none; }
	.upload-label { display: inline-flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
	.upload-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 18px;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-card);
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}
	.upload-trigger:hover {
		border-color: var(--text-tertiary);
		color: var(--text-primary);
	}
	.anchor-table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.82rem; color: var(--text-secondary); }
	.anchor-table th, .anchor-table td { padding: 0.4rem 0.6rem; text-align: left; border-bottom: 1px solid #252525; }
	.anchor-table th { color: #7c7c7c; font-weight: 500; }
	.details-wrap { margin-top: 0.65rem; }
	.debug-panel {
		margin-top: 0.6rem;
		padding: 0.7rem;
		border: 1px solid #262626;
		border-radius: 10px;
		background: #121212;
	}
	.debug-summary, .debug-since { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-secondary); }
	.debug-table-wrap { overflow-x: auto; }
	.debug-table { width: 100%; border-collapse: collapse; font-size: 0.79rem; color: var(--text-secondary); }
	.debug-table th, .debug-table td { padding: 0.34rem 0.45rem; text-align: left; border-bottom: 1px solid #252525; white-space: nowrap; }
	.debug-table th { color: var(--text-tertiary); font-weight: 500; }
	.import-mode-row { align-items: center; gap: 0.5rem; }
	.debug-controls { align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
	.unmapped-row { background: rgba(255, 180, 0, 0.07); }
	.batch-progress { margin-top: 0.75rem; }
	.batch-progress-bar {
		height: 6px;
		background: var(--color-border, #e0e0e0);
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.4rem;
	}
	.batch-progress-fill {
		height: 100%;
		background: var(--color-primary, #4f46e5);
		border-radius: 3px;
		transition: width 0.2s ease;
	}
	.option-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid #292929;
		border-radius: 10px;
		background: #121212;
	}
	:global(.days-input) { width: 6rem; padding: 0.35rem 0.45rem; }
	.job-status-panel {
		margin-top: 0.6rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid #2f3b56;
		border-radius: 10px;
		background: #111827;
	}
	.job-status-panel p { margin: 0.2rem 0; }

	/* ── Salary profile ──────────────────────────────────────────────────────── */
	.salary-section {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid #252525;
	}
	.salary-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.4rem;
	}
	.salary-header h3 {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.salary-detail {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.profile-grid {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 0.75rem;
		font-size: 0.84rem;
	}
	.profile-label { color: var(--text-tertiary); }
	.profile-value { color: var(--text-secondary); }
	.profile-value.mono { font-family: monospace; font-size: 0.82rem; }
	.salary-actions { flex-wrap: wrap; gap: 0.5rem; }
	.profile-edit-form {
		padding: 0.75rem;
		border: 1px solid #262626;
		border-radius: 10px;
		background: #121212;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.backfill-section {
		padding: 0.65rem 0.75rem;
		border: 1px solid #262626;
		border-radius: 10px;
		background: #121212;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.paycheck-list { margin-top: 0.25rem; }
	.field-title { margin: 0 0 0.4rem; font-size: 0.84rem; font-weight: 500; color: var(--text-secondary); }
	.manual-setup-section {
		padding: 0.75rem;
		border: 1px solid #262626;
		border-radius: 10px;
		background: #121212;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.manual-setup-section h4 {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.tx-picker {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 16rem;
		overflow-y: auto;
		border: 1px solid #262626;
		border-radius: 8px;
		padding: 0.25rem;
	}
	.tx-option {
		display: grid;
		grid-template-columns: 1fr max-content 2fr;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.84rem;
		color: var(--text-secondary);
		border: 1px solid transparent;
	}
	.tx-option input[type="radio"] { display: none; }
	.tx-option:hover { background: #1e1e1e; }
	.tx-option.tx-selected { background: #1a2a1a; border-color: #2d5a2d; color: var(--text-primary); }
	.tx-date { color: var(--text-tertiary); font-size: 0.8rem; white-space: nowrap; }
	.tx-amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.tx-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* ── Diagnostics ─────────────────────────────────────────────────────────── */
	.diag-section {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.75rem;
		border: 1px solid #262626;
		border-radius: 10px;
		background: #0d0d0d;
	}
	.diag-content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-x: auto;
	}
	.diag-inflow-table { font-size: 0.78rem; min-width: 820px; }
	tr.diag-tagged td { color: #6ee76e; }
	tr.diag-mismatch td { color: #aaa; }
	td.diag-score-ok { color: #6ee76e; font-weight: 600; }
	td.mono { font-family: monospace; font-size: 0.78rem; }

	/* ── E-postregler ────────────────────────────────────────────────────── */
	.email-rules-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.email-rule-item {
		border: 1px solid #262626;
		border-radius: 10px;
		padding: 0.6rem 0.75rem;
		background: #0d0d0d;
	}
	.email-rule-item.rule-inactive {
		opacity: 0.5;
	}
	.email-rule-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.email-rule-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.email-rule-info strong {
		color: var(--text-primary);
		font-size: 0.88rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.email-rule-type {
		font-size: 0.72rem;
		background: #1a2a3a;
		color: #6ea8e7;
		padding: 0.15rem 0.4rem;
		border-radius: 4px;
		white-space: nowrap;
	}
	.email-rule-actions {
		display: flex;
		gap: 0.3rem;
		flex-shrink: 0;
	}
	.email-rule-actions button {
		font-size: 0.76rem;
		padding: 0.2rem 0.45rem;
		border-radius: 5px;
		border: 1px solid #333;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.email-rule-actions button:hover { background: #1e1e1e; }
	.rule-delete:hover { color: #e74c4c !important; border-color: #e74c4c !important; }
	.rule-toggle { min-width: 2rem; text-align: center; }
	.email-rule-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.35rem;
	}
	.filter-chip {
		font-size: 0.74rem;
		background: #1a1a2a;
		color: #9a9ac0;
		padding: 0.12rem 0.4rem;
		border-radius: 4px;
	}
	.filter-warn { background: #2a2a1a; color: #c0b060; }
	.email-rule-stats {
		font-size: 0.74rem;
		color: var(--text-tertiary);
		margin: 0.25rem 0 0;
	}
	.email-rule-form {
		border: 1px solid #262626;
		border-radius: 10px;
		padding: 0.75rem;
		background: #0d0d0d;
		margin-top: 0.5rem;
	}
	.email-rule-form h3 {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.field-hint {
		font-size: 0.74rem;
		color: var(--text-tertiary);
		margin: 0.2rem 0 0;
	}
	.email-rule-form textarea.input {
		width: 100%;
		padding: 0.65rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface-soft);
		color: inherit;
		font-family: inherit;
		font-size: 0.84rem;
		resize: vertical;
	}

	@media (max-width: 720px) {
		.sources-content {
			gap: 0.8rem;
		}
		.email-rule-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	/* ── E-post-kilde ─────────────────────────────────────────────────────────── */
	.email-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.88rem;
		margin: 0 0 0.5rem;
	}
	.endpoint-code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		font-family: monospace;
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid #262626;
		border-radius: 6px;
		background: #121212;
		color: var(--text-secondary);
	}
	.label-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.86rem;
	}
	.label-list code {
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		background: #1c1c1c;
		color: var(--text-primary);
	}
	.apps-script-details summary,
	.email-guide summary {
		cursor: pointer;
		font-size: 0.86rem;
		color: var(--text-secondary);
		padding: 0.3rem 0;
	}
	.apps-script-code {
		max-height: 22rem;
		overflow: auto;
		padding: 0.75rem;
		border: 1px solid #262626;
		border-radius: 8px;
		background: #0d0d0d;
		font-family: monospace;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--text-secondary);
		margin: 0.5rem 0 0;
	}
	.email-guide-list {
		margin: 0.5rem 0 0;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		font-size: 0.86rem;
		color: var(--text-secondary);
	}
	.email-guide-list code {
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.05rem 0.3rem;
		border-radius: 4px;
		background: #1c1c1c;
	}
</style>
