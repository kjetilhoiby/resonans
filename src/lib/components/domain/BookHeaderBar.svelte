<script lang="ts">
	import PageHeader from '../ui/PageHeader.svelte';

	export interface Book {
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
		contextProgress?: { jobStatus: string; progress: { stepIndex: number; totalSteps: number; label: string } | null } | null;
		startedAt: string | null;
		finishedAt: string | null;
		loanDueDate: string | null;
		loanStartDate: string | null;
		createdAt: string;
	}

	interface Props {
		book: Book;
		progressEditorOpen: boolean;
		progressPage: string;
		posHours: number;
		posMins: number;
		totalDurHours: number;
		totalDurMins: number;
		progressSaving: boolean;
		progressError: string;
		onClose: () => void;
		onToggleEditor: () => void;
		onSaveProgress: () => void;
		onCancelEditor: () => void;
		onProgressPageChange: (v: string) => void;
		onPosHoursChange: (v: number) => void;
		onPosMinsChange: (v: number) => void;
	}

	let {
		book,
		progressEditorOpen,
		progressPage,
		posHours,
		posMins,
		totalDurHours,
		totalDurMins,
		progressSaving,
		progressError,
		onClose,
		onToggleEditor,
		onSaveProgress,
		onCancelEditor,
		onProgressPageChange,
		onPosHoursChange,
		onPosMinsChange,
	}: Props = $props();

	function statusLabel(s: Book['status']): string {
		return s === 'not_started' ? 'Ikke startet' : s === 'reading' ? 'Leser' : s === 'completed' ? 'Ferdig' : 'Pause';
	}

	function statusEmoji(s: Book['status']): string {
		return s === 'not_started' ? '📚' : s === 'reading' ? '📖' : s === 'completed' ? '✅' : '⏸️';
	}

	function progressPct(bk: Book): number {
		if (!bk.totalPages || bk.totalPages <= 0) return 0;
		return Math.min(100, Math.round((bk.currentPage / bk.totalPages) * 100));
	}

	function minutesPct(bk: Book): number {
		if (!bk.totalMinutes || bk.totalMinutes <= 0) return 0;
		return Math.min(100, Math.round(((bk.currentMinutes || 0) / bk.totalMinutes) * 100));
	}

	function formatMinutes(mins: number): string {
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		return h > 0 ? `${h}t ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
	}
</script>

<div class="bk-header">
	<PageHeader
		title={book.title}
		subtitle={book.author || undefined}
		onTitleClick={onClose}
		titleLabel="Tilbake til biblioteket"
	>
		{#snippet actions()}
			<span class="bk-status-badge" class:reading={book.status === 'reading'} class:completed={book.status === 'completed'} class:paused={book.status === 'paused'}>
				{statusEmoji(book.status)} {statusLabel(book.status)}
			</span>
			{#if book.contextStatus === 'pending'}
				{@const p = book.contextProgress?.progress}
				<span class="bk-ctx-badge pending" title={p?.label ?? 'Samler kontekst'}>
					⏳ Samler kontekst{#if p}… {p.stepIndex}/{p.totalSteps}{:else}…{/if}
				</span>
			{:else if book.contextStatus === 'ready'}
				<span class="bk-ctx-badge ready">✦ Kontekst klar</span>
			{/if}
		{/snippet}
	</PageHeader>

	{#if book.format !== 'audio' && book.totalPages}
		{@const pct = progressPct(book)}
		<button
			type="button"
			class="bk-progress-trigger"
			onclick={onToggleEditor}
			aria-expanded={progressEditorOpen}
			aria-label="Juster fremdrift"
		>
			<div class="bk-progress-bar"><div class="bk-progress-fill" style="width:{pct}%"></div></div>
			<span class="bk-progress-label">{book.currentPage} / {book.totalPages} sider</span>
		</button>
	{/if}
	{#if book.format !== 'print' && book.totalMinutes}
		{@const pct = minutesPct(book)}
		<button
			type="button"
			class="bk-progress-trigger"
			onclick={onToggleEditor}
			aria-expanded={progressEditorOpen}
			aria-label="Juster lydbok-posisjon"
		>
			<div class="bk-progress-bar"><div class="bk-progress-fill" style="width:{pct}%"></div></div>
			<span class="bk-progress-label">🎧 {formatMinutes(book.currentMinutes)} / {formatMinutes(book.totalMinutes)}</span>
		</button>
	{/if}

	{#if progressEditorOpen}
		<div class="bk-progress-editor">
			{#if book.format !== 'audio'}
				<div class="bk-pe-row">
					<label class="bk-pe-label" for="bk-pe-page">Side</label>
					<input
						id="bk-pe-page"
						class="bk-pe-input"
						type="number"
						min="0"
						value={progressPage}
						oninput={(e) => onProgressPageChange((e.target as HTMLInputElement).value)}
					/>
					{#if book.totalPages}
						<span class="bk-pe-of">av {book.totalPages}</span>
					{/if}
				</div>
			{/if}
			{#if book.format !== 'print'}
				{#if (totalDurHours || 0) * 60 + (totalDurMins || 0) > 0}
					{@const sliderMax = (totalDurHours || 0) * 60 + (totalDurMins || 0)}
					<input
						type="range"
						class="bk-time-slider"
						min="0"
						max={sliderMax}
						value={(posHours || 0) * 60 + (posMins || 0)}
						oninput={(e) => {
							const v = parseInt((e.target as HTMLInputElement).value);
							onPosHoursChange(Math.floor(v / 60));
							onPosMinsChange(v % 60);
						}}
					/>
				{/if}
				<div class="bk-pe-row">
					<label class="bk-pe-label" for="bk-pe-hours">Posisjon</label>
					<input id="bk-pe-hours" type="number" class="bk-pe-input bk-pe-input-sm" min="0" value={posHours} oninput={(e) => onPosHoursChange(parseInt((e.target as HTMLInputElement).value) || 0)} />
					<span class="bk-pe-of">t</span>
					<input type="number" class="bk-pe-input bk-pe-input-sm" min="0" max="59" value={posMins} oninput={(e) => onPosMinsChange(parseInt((e.target as HTMLInputElement).value) || 0)} />
					<span class="bk-pe-of">min</span>
					{#if (totalDurHours || 0) * 60 + (totalDurMins || 0) > 0}
						<span class="bk-pe-of">av {totalDurHours}t {totalDurMins < 10 ? '0' : ''}{totalDurMins}m</span>
					{/if}
				</div>
			{/if}
			<div class="bk-pe-actions">
				<button class="bk-pe-cancel" onclick={onCancelEditor}>Avbryt</button>
				<button class="bk-save-btn bk-save-btn-sm" onclick={onSaveProgress} disabled={progressSaving}>
					{progressSaving ? '…' : 'Lagre fremdrift'}
				</button>
			</div>
			{#if progressError}<p class="bk-error">{progressError}</p>{/if}
		</div>
	{/if}
</div>

<style>
	.bk-header {
		padding: var(--screen-title-top-pad, 34px) 20px 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.bk-status-badge {
		font-size: 0.72rem;
		padding: 2px 8px;
		border-radius: 99px;
		border: 1px solid var(--border-color);
		color: var(--book-text-dim, #8a8a8a);
	}
	.bk-status-badge.reading { color: var(--accent-light); border-color: var(--book-border-accent, #3b3e6a); }
	.bk-status-badge.completed { color: var(--book-success, #48b581); border-color: var(--book-success-border, #2a4a3a); }
	.bk-status-badge.paused { color: var(--book-warning, #e0a050); border-color: var(--book-warning-border, #4a3a1a); }

	.bk-ctx-badge {
		font-size: 0.7rem;
		padding: 2px 8px;
		border-radius: 99px;
	}
	.bk-ctx-badge.pending { background: #1e1e10; color: #8a8a50; border: 1px solid #3a3a20; }
	.bk-ctx-badge.ready { background: var(--book-success-bg, #0f1e1a); color: var(--book-success, #48b581); border: 1px solid var(--book-success-border, #2a4a3a); }

	.bk-progress-bar {
		height: 4px;
		background: var(--border-subtle);
		border-radius: 99px;
		overflow: hidden;
	}

	.bk-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent-light), var(--book-accent-deep, #5a70ee));
		border-radius: 99px;
		transition: width 0.4s ease;
	}

	.bk-progress-label {
		font-size: 0.72rem;
		color: #6a6a6a;
		margin: 0;
	}

	.bk-progress-trigger {
		all: unset;
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 8px;
		padding: 4px 0;
		cursor: pointer;
		border-radius: 6px;
		transition: background 0.15s;
	}
	.bk-progress-trigger:hover .bk-progress-bar { background: #25252e; }
	.bk-progress-trigger:hover .bk-progress-label { color: var(--book-text-strong, #c0c0d0); }
	.bk-progress-trigger:focus-visible { outline: 2px solid #4a5cff; outline-offset: 2px; }

	.bk-progress-editor {
		margin-top: 10px;
		padding: 12px 14px;
		background: var(--book-bg-elevated, #14141c);
		border: 1px solid #22222e;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.bk-pe-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.bk-pe-label {
		font-size: 0.78rem;
		color: var(--book-text-secondary, #888);
		min-width: 4.5rem;
	}
	.bk-pe-input {
		width: 100px;
		background: var(--book-bg-input, #0d0d14);
		border: 1px solid var(--book-border, #2a2a35);
		color: #e0e0ea;
		padding: 6px 8px;
		border-radius: 6px;
		font-size: 0.92rem;
	}
	.bk-pe-input-sm { width: 60px; }
	.bk-pe-of { color: var(--book-text-secondary, #888); font-size: 0.82rem; }
	.bk-pe-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
	.bk-pe-cancel {
		background: none;
		border: 1px solid var(--book-border, #2a2a35);
		color: var(--book-text-secondary, #888);
		padding: 5px 12px;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.bk-pe-cancel:hover { color: var(--book-text-strong, #c0c0d0); border-color: var(--book-border-strong, #3a3a45); }

	.bk-time-slider {
		width: 100%;
		margin: 4px 0 10px;
		accent-color: var(--book-accent-strong, #6b7fff);
		cursor: pointer;
	}

	.bk-save-btn {
		font: inherit;
		font-size: 0.82rem;
		padding: 8px 16px;
		background: var(--book-bg-accent, #1e2244);
		border: 1px solid var(--book-border-accent, #3b3e6a);
		color: var(--book-accent-text, #c8ccff);
		border-radius: 8px;
		cursor: pointer;
		align-self: flex-start;
	}
	.bk-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.bk-save-btn:hover:not(:disabled) { background: var(--book-bg-accent-hover, #252b55); }
	.bk-save-btn-sm { padding: 6px 12px; }

	.bk-error {
		color: var(--error-text);
		font-size: 0.8rem;
		margin: 0;
	}
</style>
