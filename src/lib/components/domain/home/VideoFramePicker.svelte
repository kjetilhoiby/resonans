<!--
  Manuell frame-picker: spol i videoen og fang akkurat de øyeblikkene som skal
  sendes til analyse. Redigerer `preview` (VideoPreviewFields) direkte — legger
  til/fjerner frames + miniatyrer. Alt lokalt (object-URL), ingen opplasting her.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import { captureFrameAt } from '$lib/client/video-frames';
	import type { VideoPreviewFields } from './home-media';

	interface Props {
		file: File;
		preview: VideoPreviewFields;
		maxFrames?: number;
		onClose: () => void;
	}
	let { file, preview, maxFrames = 12, onClose }: Props = $props();

	let videoEl: HTMLVideoElement;
	let duration = $state(0);
	let pos = $state(0);
	let ready = $state(false);
	let capturing = $state(false);
	let objectUrl = '';

	const count = $derived(preview.videoFrames?.length ?? 0);

	onMount(() => {
		objectUrl = URL.createObjectURL(file);
		videoEl.src = objectUrl;
	});
	onDestroy(() => {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
	});

	function onLoaded() {
		duration = videoEl.duration || 0;
		ready = true;
	}

	function onScrub() {
		if (Number.isFinite(pos)) videoEl.currentTime = pos;
	}

	async function capture() {
		if (capturing || count >= maxFrames) return;
		capturing = true;
		try {
			const frame = await captureFrameAt(videoEl, pos);
			const thumb = URL.createObjectURL(frame.blob);
			const pairs = [
				...(preview.videoFrames ?? []).map((f, i) => ({ f, t: preview.videoThumbs?.[i] ?? '' })),
				{ f: frame, t: thumb }
			].sort((a, b) => a.f.timestampSec - b.f.timestampSec);
			preview.videoFrames = pairs.map((p) => p.f);
			preview.videoThumbs = pairs.map((p) => p.t);
		} catch (err) {
			console.error('Frame-fangst feilet:', err);
		} finally {
			capturing = false;
		}
	}

	function removeAt(index: number) {
		const thumbs = preview.videoThumbs ?? [];
		const frames = preview.videoFrames ?? [];
		if (thumbs[index]) URL.revokeObjectURL(thumbs[index]);
		preview.videoFrames = frames.filter((_, i) => i !== index);
		preview.videoThumbs = thumbs.filter((_, i) => i !== index);
	}

	function fmt(t: number): string {
		const total = Math.max(0, Math.floor(t));
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

<div class="picker" role="dialog" aria-label="Velg bilder fra video">
	<div class="picker-head">
		<span class="picker-title">Velg bilder</span>
		<button class="picker-done" onclick={onClose}>Ferdig</button>
	</div>

	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={videoEl} class="picker-video" muted playsinline preload="auto" onloadedmetadata={onLoaded}></video>

	{#if ready}
		<input
			class="picker-scrub"
			type="range"
			min="0"
			max={duration}
			step="0.1"
			bind:value={pos}
			oninput={onScrub}
			aria-label="Spol i video"
			data-track="video-picker:spol"
		/>
		<div class="picker-controls">
			<span class="picker-time">{fmt(pos)} / {fmt(duration)}</span>
			<button
				class="picker-capture"
				onclick={capture}
				disabled={capturing || count >= maxFrames}
				data-track="video-picker:fang-bilde"
			>
				{#if count >= maxFrames}
					Maks {maxFrames} bilder
				{:else if capturing}
					Fanger …
				{:else}
					Fang dette bildet
				{/if}
			</button>
		</div>
	{:else}
		<p class="picker-loading">Laster video …</p>
	{/if}

	<div class="picker-strip">
		{#each preview.videoThumbs ?? [] as url, i}
			<div class="picker-thumb-wrap">
				<img class="picker-thumb" src={url} alt="Valgt bilde" />
				<button
					class="picker-thumb-remove"
					onclick={() => removeAt(i)}
					aria-label="Fjern bilde"
					data-track="video-picker:fjern-bilde"
				>
					<Icon name="close" size={11} />
				</button>
			</div>
		{/each}
	</div>
	<p class="picker-hint">{count} bilder valgt. Spol og fang øyeblikkene du vil analysere.</p>
</div>

<style>
	.picker {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: #0b0b0b;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
		overflow-y: auto;
	}
	.picker-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.picker-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: #ddd;
	}
	.picker-done {
		background: none;
		border: none;
		color: #7c8ef5;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		padding: 4px 8px;
	}
	.picker-video {
		width: 100%;
		max-height: 42vh;
		background: #000;
		border-radius: 12px;
		object-fit: contain;
	}
	.picker-scrub {
		width: 100%;
		accent-color: #4a5af0;
	}
	.picker-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.picker-time {
		font-size: 0.8rem;
		color: #888;
		font-variant-numeric: tabular-nums;
	}
	.picker-capture {
		background: #4a5af0;
		border: none;
		color: #fff;
		border-radius: 12px;
		padding: 10px 16px;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s, opacity 0.15s;
	}
	.picker-capture:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.picker-loading {
		color: #666;
		font-size: 0.85rem;
		text-align: center;
	}
	.picker-strip {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 4px;
		min-height: 4px;
	}
	.picker-thumb-wrap {
		position: relative;
		flex-shrink: 0;
	}
	.picker-thumb {
		height: 64px;
		width: auto;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		display: block;
	}
	.picker-thumb-remove {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #1a1a1a;
		border: 1px solid #333;
		color: #ddd;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
	}
	.picker-hint {
		margin: 0;
		font-size: 0.8rem;
		color: #666;
		text-align: center;
	}
</style>
