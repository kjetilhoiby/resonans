<script lang="ts">
	import DateInput from '$lib/components/ui/DateInput.svelte';

	interface Book {
		id: string;
		title: string;
		author: string | null;
		coverUrl: string | null;
		totalPages: number | null;
		currentPage: number;
		format: 'print' | 'audio' | 'both';
		totalMinutes: number | null;
		currentMinutes: number;
		status: 'not_started' | 'reading' | 'completed' | 'paused';
		conversationId: string | null;
		contextStatus: 'none' | 'pending' | 'partial' | 'ready';
		contextPack: Record<string, unknown> | null;
		contextProgress?: BookContextProgressEnvelope | null;
		startedAt: string | null;
		finishedAt: string | null;
		loanDueDate: string | null;
		loanStartDate: string | null;
		createdAt: string;
	}

	interface BookContextProgressEnvelope {
		jobStatus: 'queued' | 'running' | 'retry' | 'completed' | 'failed' | 'canceled';
		jobError: string | null;
		progress: BookContextProgress | null;
	}

	interface BookContextProgress {
		stepIndex: number;
		totalSteps: number;
		label: string;
		sourcesCompleted: number;
		sourcesTotal: number;
		sources: {
			openLibrary?: { ok: boolean; worksFound?: number; error?: string };
			criticReviews?: { ok: boolean; count?: number; error?: string };
			readerSources?: { ok: boolean; count?: number; error?: string };
			goodreads?: { ok: boolean; reviewCount?: number; error?: string };
		};
		updatedAt: string;
	}

	interface ProgressLogEntry {
		id: string;
		currentPage: number | null;
		currentMinutes: number | null;
		loggedAt: string;
	}

	interface ProgressChartData {
		linePath: string;
		predPath: string | null;
		dots: { cx: number; cy: number; label: string }[];
		etaDate: Date | null;
		paceLabel: string | null;
		xLabels: { x: number; label: string; star?: boolean }[];
		yLines: { y: number; label: string }[];
		hasEnoughData: boolean;
	}

	interface Props {
		themeId: string;
		book: Book;
		onBookUpdated: (updated: Book) => void;
		onBookDeleted: (bookId: string) => void;
	}

	let { themeId, book, onBookUpdated, onBookDeleted }: Props = $props();

	/* ── Chart constants ─────────────────────────────────── */
	const CHART_VW = 340, CHART_VH = 155;
	const CHART_PL = 48, CHART_PT = 10, CHART_PB = 30;
	const CHART_CW = CHART_VW - CHART_PL - 14;
	const CHART_CH = CHART_VH - CHART_PT - CHART_PB;

	/* ── Progress log + chart ────────────────────────────── */
	let progressLog = $state<ProgressLogEntry[]>([]);
	let progressLogLoaded = $state(false);
	let progressChart = $derived.by(() => buildProgressChart(progressLog, book));

	/* ── Duration editor ─────────────────────────────────── */
	let totalDurExpanded = $state(false);
	let totalDurHours = $state(Math.floor((book.totalMinutes || 0) / 60));
	let totalDurMins = $state((book.totalMinutes || 0) % 60);

	/* ── Loan ────────────────────────────────────────────── */
	let loanSaving = $state(false);

	/* ── Init ────────────────────────────────────────────── */
	$effect(() => {
		if (!progressLogLoaded) void loadProgressLog();
	});

	// Re-sync duration editor when book changes
	$effect(() => {
		totalDurHours = Math.floor((book.totalMinutes || 0) / 60);
		totalDurMins = (book.totalMinutes || 0) % 60;
	});

	/* ── Format helpers ──────────────────────────────────── */
	function formatMinutes(mins: number): string {
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return h > 0 ? `${h}t ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
	}

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
	}

	function fmtEta(d: Date): string {
		const months = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
		return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
	}

	function toDateInput(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function daysUntil(iso: string): number {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const due = new Date(iso);
		due.setHours(0, 0, 0, 0);
		return Math.round((due.getTime() - today.getTime()) / 86_400_000);
	}

	type LoanInfo = { label: string; tone: 'overdue' | 'soon' | 'ok' };
	function loanInfo(iso: string): LoanInfo {
		const d = daysUntil(iso);
		if (d < 0) return { label: d === -1 ? 'Forfalt i går' : `Forfalt for ${-d} dager siden`, tone: 'overdue' };
		if (d === 0) return { label: 'Leveres i dag', tone: 'overdue' };
		if (d === 1) return { label: 'Leveres i morgen', tone: 'soon' };
		if (d <= 3) return { label: `${d} dager igjen`, tone: 'soon' };
		return { label: `${d} dager igjen`, tone: 'ok' };
	}

	function progressPct(bk: Book): number {
		if (!bk.totalPages || bk.totalPages <= 0) return 0;
		return Math.min(100, Math.round((bk.currentPage / bk.totalPages) * 100));
	}

	function minutesPct(bk: Book): number {
		if (!bk.totalMinutes || bk.totalMinutes <= 0) return 0;
		return Math.min(100, Math.round(((bk.currentMinutes || 0) / bk.totalMinutes) * 100));
	}

	/* ── Chart helpers ───────────────────────────────────── */
	function linReg(pts: { x: number; y: number }[]): { slope: number; intercept: number } | null {
		const n = pts.length;
		if (n < 2) return null;
		const sx = pts.reduce((s, p) => s + p.x, 0);
		const sy = pts.reduce((s, p) => s + p.y, 0);
		const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
		const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
		const d = n * sx2 - sx * sx;
		if (d === 0) return null;
		const slope = (n * sxy - sx * sy) / d;
		return { slope, intercept: (sy - slope * sx) / n };
	}

	function buildProgressChart(log: ProgressLogEntry[], bk: Book): ProgressChartData | null {
		const metric: 'page' | 'minutes' = bk.format === 'print' ? 'page' : 'minutes';
		const total = metric === 'page' ? (bk.totalPages ?? 0) : (bk.totalMinutes ?? 0);
		const dayMap = new Map<string, number>();
		for (const e of log) {
			const day = e.loggedAt.slice(0, 10);
			const v = metric === 'page' ? e.currentPage : e.currentMinutes;
			if (v !== null && v !== undefined) dayMap.set(day, v);
		}
		const rawDays = [...dayMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
		if (rawDays.length === 0) return null;

		const hasEnoughData = rawDays.length >= 2;
		const t0 = Date.parse(rawDays[0][0] + 'T00:00:00');
		const tLast = Date.parse(rawDays[rawDays.length - 1][0] + 'T00:00:00');

		let etaDate: Date | null = null;
		let paceLabel: string | null = null;
		let etaMs: number | null = null;
		if (hasEnoughData && total > 0) {
			const regPts = rawDays.map(([day, val]) => ({
				x: (Date.parse(day + 'T00:00:00') - t0) / 86400000, y: val
			}));
			const reg = linReg(regPts);
			if (reg && reg.slope > 0) {
				const etaDays = (total - reg.intercept) / reg.slope;
				if (etaDays > 0 && etaDays < 3650) {
					etaMs = t0 + etaDays * 86400000;
					etaDate = new Date(etaMs);
					paceLabel = metric === 'page'
						? `${reg.slope.toFixed(1)} sider/dag`
						: `${formatMinutes(Math.round(reg.slope))}/dag`;
				}
			}
		}

		const span = Math.max(tLast - t0, 86400000);
		const tMax = etaMs && etaMs > tLast && (etaMs - t0) < Math.max(span * 3, 30 * 86400000)
			? etaMs : tLast;
		const tRange = Math.max(tMax - t0, 86400000);
		const xOf = (ms: number) => CHART_PL + ((ms - t0) / tRange) * CHART_CW;
		const yOf = (v: number) => total > 0
			? CHART_PT + CHART_CH * (1 - Math.max(0, Math.min(v, total)) / total)
			: CHART_PT + CHART_CH;
		const f1 = (n: number) => parseFloat(n.toFixed(1));
		const fmtDay = (d: string) => { const [, mm, dd] = d.split('-'); return `${dd}.${mm}`; };

		const dots = rawDays.map(([day, val]) => {
			const ms = Date.parse(day + 'T00:00:00');
			const lbl = metric === 'page' ? `s.${val}` : formatMinutes(val);
			return { cx: f1(xOf(ms)), cy: f1(yOf(val)), label: `${fmtDay(day)}: ${lbl}` };
		});
		const linePath = dots.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.cx},${d.cy}`).join(' ');

		let predPath: string | null = null;
		if (etaMs && dots.length >= 1) {
			const last = dots[dots.length - 1];
			const etaX = f1(Math.min(xOf(etaMs), CHART_PL + CHART_CW));
			predPath = `M${last.cx},${last.cy} L${etaX},${f1(yOf(total))}`;
		}

		const xLabels: { x: number; label: string; star?: boolean }[] = [
			{ x: f1(xOf(t0)), label: fmtDay(rawDays[0][0]) }
		];
		if (rawDays.length > 1) xLabels.push({ x: f1(xOf(tLast)), label: fmtDay(rawDays[rawDays.length - 1][0]) });
		if (etaDate && etaMs) {
			const d = etaDate;
			const lbl = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`;
			xLabels.push({ x: f1(Math.min(xOf(etaMs), CHART_PL + CHART_CW - 18)), label: lbl, star: true });
		}

		const yLines: { y: number; label: string }[] = [];
		if (total > 0) {
			const yl = (v: number) => metric === 'page' ? String(v) : formatMinutes(v);
			yLines.push({ y: f1(yOf(0)), label: yl(0) });
			yLines.push({ y: f1(yOf(total)), label: yl(total) });
		}
		return { linePath, predPath, dots, etaDate, paceLabel, xLabels, yLines, hasEnoughData };
	}

	/* ── API calls ───────────────────────────────────────── */
	async function loadProgressLog() {
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}/progress-log`);
			if (res.ok) progressLog = await res.json();
		} catch { /* ignore */ }
		progressLogLoaded = true;
	}

	async function setStatus(status: Book['status']) {
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});
			if (!res.ok) throw new Error();
			const updated: Book = await res.json();
			onBookUpdated(updated);
		} catch { /* ignore */ }
	}

	async function saveTotalDuration() {
		const total = (totalDurHours || 0) * 60 + (totalDurMins || 0);
		if (total <= 0) return;
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ totalMinutes: total })
			});
			if (!res.ok) throw new Error();
			const updated: Book = await res.json();
			onBookUpdated(updated);
			totalDurExpanded = false;
		} catch { /* ignore */ }
	}

	async function setFormat(f: 'print' | 'audio') {
		try {
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ format: f })
			});
			if (res.ok) {
				const u: Book = await res.json();
				onBookUpdated(u);
			}
		} catch { /* ignore */ }
	}

	async function setLoanDueDate(dateStr: string) {
		loanSaving = true;
		try {
			const loanDueDate = dateStr ? new Date(`${dateStr}T12:00:00`).toISOString() : null;
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ loanDueDate })
			});
			if (!res.ok) throw new Error('save failed');
			const updated: Book = await res.json();
			onBookUpdated(updated);
		} catch (err) {
			console.warn('Kunne ikke lagre innleveringsdato:', err);
		} finally {
			loanSaving = false;
		}
	}

	async function deleteBook() {
		if (!confirm(`Slett «${book.title}»? Dette kan ikke angres.`)) return;
		await fetch(`/api/tema/${themeId}/books/${book.id}`, { method: 'DELETE' });
		onBookDeleted(book.id);
	}
</script>

<div class="bk-fremdrift-panel">
	{#if book.status === 'reading' || book.status === 'paused'}
		<div class="bk-fremdrift-section">
			<button
				class="bk-pause-btn"
				class:paused={book.status === 'paused'}
				onclick={() => setStatus(book.status === 'reading' ? 'paused' : 'reading')}
				aria-label={book.status === 'reading' ? 'Sett på pause' : 'Fortsett lesing'}
			>
				{book.status === 'reading' ? '⏸' : '▶'}
				<span>{book.status === 'reading' ? 'Pause' : 'Fortsett'}</span>
			</button>
		</div>
	{/if}

	<div class="bk-fremdrift-section">
		<p class="bk-fremdrift-label">Bokfakta</p>
		<dl class="bk-fact-dl">
			<dt>Forfatter</dt><dd>{book.author ?? '—'}</dd>
			<dt>Format</dt>
			<dd>
				<div class="bk-format-toggle">
					{#each ([['print', '📖', 'Papir'], ['audio', '🎧', 'Lyd']] as const) as [f, icon, label]}
						<button
							type="button"
							class="bk-format-opt"
							class:active={book.format === f || (book.format === 'both' && f === 'audio')}
							onclick={() => setFormat(f)}
						><span class="bk-format-icon">{icon}</span> {label}</button>
					{/each}
				</div>
			</dd>
			{#if book.format !== 'audio'}
				<dt>Sider</dt>
				<dd>{book.totalPages ? `${book.currentPage} / ${book.totalPages}` : '—'}</dd>
			{/if}
			{#if book.format !== 'print'}
				<dt>Lydlengde</dt>
				<dd>
					{#if book.totalMinutes && !totalDurExpanded}
						{formatMinutes(book.totalMinutes)}
						<button class="bk-link" onclick={() => (totalDurExpanded = true)}>Endre</button>
					{:else}
						<div class="bk-hm-row">
							<div class="bk-hm-field">
								<input type="number" class="bk-hm-input" min="0" bind:value={totalDurHours} />
								<span class="bk-hm-label">t</span>
							</div>
							<div class="bk-hm-field">
								<input type="number" class="bk-hm-input" min="0" max="59" bind:value={totalDurMins} />
								<span class="bk-hm-label">min</span>
							</div>
							<button class="bk-link" onclick={saveTotalDuration}>Lagre</button>
						</div>
					{/if}
				</dd>
			{/if}
			{#if book.startedAt}<dt>Startet</dt><dd>{fmtDate(book.startedAt)}</dd>{/if}
			{#if book.finishedAt}<dt>Ferdig</dt><dd>{fmtDate(book.finishedAt)}</dd>{/if}
			<dt>Innlevering</dt>
			<dd>
				<div class="bk-loan-row">
					<DateInput
						value={toDateInput(book.loanDueDate)}
						disabled={loanSaving}
						onChange={(e) => setLoanDueDate(e.currentTarget.value)}
					/>
					{#if book.loanDueDate}
						{@const li = loanInfo(book.loanDueDate)}
						<span class="bk-loan-status {li.tone}">{li.label}</span>
						<button class="bk-link" onclick={() => setLoanDueDate('')} disabled={loanSaving}>Fjern</button>
					{/if}
				</div>
			</dd>
		</dl>
	</div>

	{#if book.format !== 'audio' && book.totalPages}
		{@const pct = progressPct(book)}
		<div class="bk-big-progress" title="{book.currentPage}/{book.totalPages} sider">
			<div class="bk-big-fill" style="width:{pct}%"></div>
			<span class="bk-big-pct">{pct}% sider</span>
		</div>
	{/if}

	{#if book.format !== 'print' && book.totalMinutes}
		{@const pct = minutesPct(book)}
		<div class="bk-big-progress" title="{formatMinutes(book.currentMinutes)} av {formatMinutes(book.totalMinutes)}">
			<div class="bk-big-fill" style="width:{pct}%"></div>
			<span class="bk-big-pct">{pct}% lyd · {formatMinutes(book.currentMinutes)}</span>
		</div>
	{/if}

	<!-- Progress chart -->
	<div class="bk-fremdrift-section">
		<p class="bk-fremdrift-label">Fremdriftsgraf</p>
		{#if !progressLogLoaded}
			<p class="bk-empty" style="padding:4px 0">Laster…</p>
		{:else if !progressChart}
			<p class="bk-empty" style="padding:4px 0">Logg fremdrift for å se graf.</p>
		{:else}
			<svg class="bk-chart-svg" viewBox="0 0 {CHART_VW} {CHART_VH}" aria-label="Fremdriftsgraf">
				{#each progressChart.yLines as yl}
					<line class="bk-chart-grid" x1={CHART_PL} y1={yl.y} x2={CHART_PL + CHART_CW} y2={yl.y} />
					<text class="bk-chart-ylabel" x={CHART_PL - 4} y={yl.y + 4} text-anchor="end">{yl.label}</text>
				{/each}
				{#if progressChart.predPath}
					<path class="bk-chart-pred" d={progressChart.predPath} />
				{/if}
				<path class="bk-chart-line" d={progressChart.linePath} />
				{#each progressChart.dots as dot}
					<circle class="bk-chart-dot" cx={dot.cx} cy={dot.cy} r="3.5"><title>{dot.label}</title></circle>
				{/each}
				<line class="bk-chart-axis" x1={CHART_PL} y1={CHART_PT + CHART_CH} x2={CHART_PL + CHART_CW} y2={CHART_PT + CHART_CH} />
				{#each progressChart.xLabels as xl}
					<text class="bk-chart-xlabel" class:bk-chart-xlabel-eta={xl.star} x={xl.x} y={CHART_VH - 2} text-anchor="middle">{xl.label}</text>
				{/each}
			</svg>
			<div class="bk-chart-meta">
				{#if progressChart.paceLabel}<span class="bk-chart-pace">⚡ {progressChart.paceLabel}</span>{/if}
				{#if progressChart.etaDate}<span class="bk-chart-eta">📅 Est. ferdig: <strong>{fmtEta(progressChart.etaDate)}</strong></span>{/if}
			</div>
		{/if}
	</div>

	<div class="bk-fremdrift-section" style="margin-top:1.5rem">
		<button class="bk-delete-btn" onclick={deleteBook}>🗑 Slett bok</button>
	</div>
</div>

<style>
	.bk-fremdrift-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
		flex: 1;
	}

	.bk-fremdrift-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bk-fremdrift-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: #888;
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.bk-pause-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 1px solid #3b3e6a;
		color: #7c8ef5;
		padding: 4px 12px;
		border-radius: 99px;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.bk-pause-btn:hover { background: #111a2a; }
	.bk-pause-btn.paused {
		border-color: #4a3a1a;
		color: #e0a050;
	}
	.bk-pause-btn.paused:hover { background: #1e1a10; }

	.bk-fact-dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.45rem 1rem;
		margin: 0;
		font-size: 0.9rem;
	}
	.bk-fact-dl dt { color: #888; }
	.bk-fact-dl dd { color: #d0d0e0; margin: 0; }

	.bk-format-toggle {
		display: inline-flex;
		background: #0d0d14;
		border: 1px solid #2a2a35;
		border-radius: 8px;
		overflow: hidden;
	}
	.bk-format-opt {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		color: #888;
		padding: 6px 12px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}
	.bk-format-opt + .bk-format-opt { border-left: 1px solid #2a2a35; }
	.bk-format-opt:hover { color: #c0c0d0; }
	.bk-format-opt.active {
		background: #111a2a;
		color: #c8ccff;
	}
	.bk-format-icon { font-size: 0.95rem; }

	.bk-hm-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.bk-hm-field {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.bk-hm-input {
		width: 58px;
		text-align: center;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
		font: inherit;
		font-size: 1rem;
		padding: 6px 8px;
	}

	.bk-hm-label {
		font-size: 0.82rem;
		color: #888;
	}

	.bk-big-progress {
		position: relative;
		height: 24px;
		background: #1a1a1a;
		border-radius: 12px;
		overflow: hidden;
	}

	.bk-big-fill {
		height: 100%;
		background: linear-gradient(90deg, #7c8ef5, #5a70ee);
		transition: width 0.4s ease;
	}

	.bk-big-pct {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 0.78rem;
		font-weight: 700;
		color: #fff;
		pointer-events: none;
	}

	.bk-link {
		background: none;
		border: none;
		color: #7c8ef5;
		font-size: inherit;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
	}

	/* Lån / innleveringsdato */
	.bk-loan-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.bk-loan-input {
		background: #15151c;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #d0d0e0;
		padding: 4px 8px;
		font-size: 0.8rem;
		color-scheme: dark;
	}
	.bk-loan-input:disabled { opacity: 0.5; }
	.bk-loan-status {
		font-size: 0.72rem;
		font-weight: 500;
	}
	.bk-loan-status.ok { color: #8a8a8a; }
	.bk-loan-status.soon { color: #e0a050; }
	.bk-loan-status.overdue { color: #e07070; }

	.bk-delete-btn {
		font: inherit;
		font-size: 0.82rem;
		padding: 6px 12px;
		background: transparent;
		border: 1px solid #6a3b3b;
		color: #ff9999;
		border-radius: 8px;
		cursor: pointer;
	}
	.bk-delete-btn:hover { background: #3b1e1e; }

	/* Progress chart */
	.bk-chart-svg { width: 100%; height: auto; display: block; overflow: visible; }
	.bk-chart-grid { stroke: #1e1e2a; stroke-width: 1; }
	.bk-chart-axis { stroke: #2a2a3a; stroke-width: 1; }
	.bk-chart-line { fill: none; stroke: #6b7fff; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
	.bk-chart-pred { fill: none; stroke: #6b7fff; stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.5; }
	.bk-chart-dot { fill: #6b7fff; stroke: #0d0d14; stroke-width: 1.5; cursor: default; }
	.bk-chart-ylabel { fill: #555; font-size: 9px; }
	.bk-chart-xlabel { fill: #555; font-size: 9px; }
	.bk-chart-xlabel-eta { fill: #88aaff; }
	.bk-chart-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 6px 0 2px; font-size: 0.79rem; }
	.bk-chart-pace { color: #a0a8ff; }
	.bk-chart-eta { color: #c8d4ff; }

	.bk-empty {
		color: #666;
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}
</style>
