<script lang="ts">
	interface WordTimestamp {
		word: string;
		start: number;
		end: number;
	}

	interface Props {
		src: string;
		words?: WordTimestamp[] | null;
		text?: string;
		compact?: boolean; // hides text body, only player bar
	}

	let { src, words = null, text = '', compact = false }: Props = $props();

	let audioEl = $state<HTMLAudioElement | null>(null);
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);

	function activeWordIndex(t: number): number {
		if (!words?.length) return -1;
		for (let i = words.length - 1; i >= 0; i--) {
			if (t >= words[i].start) return i;
		}
		return -1;
	}

	function fmt(s: number): string {
		if (!isFinite(s)) return '0:00';
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	function seek(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const t = Number(input.value);
		if (audioEl) {
			audioEl.currentTime = t;
			currentTime = t;
		}
	}

	function togglePlay() {
		if (!audioEl) return;
		if (playing) {
			audioEl.pause();
		} else {
			audioEl.play();
		}
	}
</script>

<!-- svelte-ignore a11y_media_has_caption -->
<audio
	bind:this={audioEl}
	{src}
	onplay={() => (playing = true)}
	onpause={() => (playing = false)}
	onended={() => { playing = false; currentTime = 0; if (audioEl) audioEl.currentTime = 0; }}
	ontimeupdate={() => { currentTime = audioEl?.currentTime ?? 0; }}
	onloadedmetadata={() => { duration = audioEl?.duration ?? 0; }}
></audio>

<div class="akp-root" class:akp-compact={compact}>
	<!-- Controls row -->
	<div class="akp-controls">
		<button class="akp-play" onclick={togglePlay} aria-label={playing ? 'Pause' : 'Spill av'}>
			{#if playing}
				<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
					<rect x="2" y="2" width="4" height="12" rx="1"/>
					<rect x="10" y="2" width="4" height="12" rx="1"/>
				</svg>
			{:else}
				<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
					<path d="M3 2.5v11l10-5.5L3 2.5z"/>
				</svg>
			{/if}
		</button>

		<span class="akp-time">{fmt(currentTime)}</span>

		<input
			class="akp-scrub"
			type="range"
			min="0"
			max={duration || 1}
			step="0.05"
			value={currentTime}
			style="--pct:{duration ? (currentTime / duration) * 100 : 0}%"
			oninput={seek}
			aria-label="Spol"
		/>

		<span class="akp-time akp-dur">{fmt(duration)}</span>
	</div>

	<!-- Karaoke or plain text -->
	{#if !compact}
		{#if words?.length}
			{@const activeIdx = activeWordIndex(currentTime)}
			<blockquote class="akp-text akp-karaoke">
				{#each words as w, i}
					<button
						type="button"
						class="akp-word"
						class:akp-done={i < activeIdx}
						class:akp-active={i === activeIdx}
						onclick={() => { if (audioEl) { audioEl.currentTime = w.start; currentTime = w.start; } }}
						aria-label="Hopp til «{w.word}»"
					>{w.word}</button>{' '}
				{/each}
			</blockquote>
		{:else if text}
			<blockquote class="akp-text">{text}</blockquote>
		{/if}
	{/if}
</div>

<style>
	.akp-root {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* Controls */
	.akp-controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.akp-play {
		flex-shrink: 0;
		background: #1e1e3a;
		border: 1px solid #3b3e6a;
		color: #a0a8ff;
		border-radius: 50%;
		width: 30px;
		height: 30px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
		padding: 0;
	}
	.akp-play:hover { background: #2a2a5a; }

	.akp-time {
		font-size: 0.7rem;
		color: #666;
		min-width: 30px;
		font-variant-numeric: tabular-nums;
	}
	.akp-dur { text-align: right; }

	.akp-scrub {
		flex: 1;
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		border-radius: 99px;
		background: linear-gradient(
			to right,
			#7c8ef5 0%,
			#7c8ef5 var(--pct, 0%),
			#1e1e2a var(--pct, 0%),
			#1e1e2a 100%
		);
		outline: none;
		cursor: pointer;
	}
	.akp-scrub::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #7c8ef5;
		cursor: pointer;
	}
	.akp-scrub::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #7c8ef5;
		cursor: pointer;
		border: none;
	}

	/* Karaoke text */
	.akp-text {
		margin: 0;
		font-style: italic;
		font-size: 0.88rem;
		color: #d0d0d0;
		line-height: 1.7;
		border-left: 3px solid #3b3e6a;
		padding-left: 10px;
	}

	.akp-karaoke {
		padding-left: 10px;
		word-spacing: 0.05em;
	}

	.akp-word {
		background: none;
		border: none;
		padding: 1px 0;
		margin: 0;
		font: inherit;
		font-style: italic;
		line-height: inherit;
		color: #50507a;
		transition: color 0.08s;
		cursor: pointer;
		display: inline;
		white-space: pre-wrap;
	}
	.akp-word:hover { color: #9090c0; }
	.akp-done {
		color: #9090b0;
	}
	.akp-active {
		color: #e8ecff;
		background: rgba(124, 142, 245, 0.18);
		border-radius: 3px;
		padding: 1px 2px;
	}

	/* Compact mode (chat drawer) */
	.akp-compact .akp-controls {
		gap: 6px;
	}
</style>
