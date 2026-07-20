<script lang="ts">
	import { onDestroy } from 'svelte';
	import { AppPage, PageHeader, PageSection, Button } from '$lib/components/ui';
	import { createPoseDetector, type PoseDetector, type PoseSample } from '$lib/client/pose-detector';
	import { createVoice, beep, type Voice } from '$lib/client/pose-audio';
	import {
		PullupAnalyzer,
		type PullupPhase,
		type SessionSummary
	} from '$lib/pose/pullup-analyzer';

	type Status = 'idle' | 'loading' | 'live' | 'summarizing' | 'done' | 'error';

	let status = $state<Status>('idle');
	let errorMsg = $state('');

	// Live-tilstand
	let repCount = $state(0);
	let phase = $state<PullupPhase>('unknown');
	let elbowAngle = $state<number | null>(null);
	let lastCue = $state('');

	// Resultat
	let summary = $state<SessionSummary | null>(null);
	let coaching = $state('');

	let videoEl: HTMLVideoElement;
	let canvasEl: HTMLCanvasElement;

	let stream: MediaStream | null = null;
	let detector: PoseDetector | null = null;
	let analyzer: PullupAnalyzer | null = null;
	let voice: Voice | null = null;
	let rafId = 0;

	const phaseLabel: Record<PullupPhase, string> = {
		hang: 'Heng',
		pulling: 'Drar opp',
		top: 'Topp',
		lowering: 'Senker',
		unknown: 'Klar'
	};

	async function startSession() {
		errorMsg = '';
		if (!navigator.mediaDevices?.getUserMedia) {
			status = 'error';
			errorMsg = 'Kameraet er ikke tilgjengelig i denne nettleseren.';
			return;
		}

		status = 'loading';
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false
			});
			videoEl.srcObject = stream;
			await videoEl.play();

			detector = await createPoseDetector();
			analyzer = new PullupAnalyzer();
			voice = createVoice();
			repCount = 0;
			lastCue = '';
			phase = 'unknown';

			status = 'live';
			loop();
		} catch (err) {
			status = 'error';
			errorMsg =
				err instanceof DOMException && err.name === 'NotAllowedError'
					? 'Du må gi tilgang til kameraet for å bruke teknikk-analyse.'
					: 'Klarte ikke å starte kamera/analyse. Prøv igjen.';
			cleanup();
		}
	}

	function loop() {
		if (status !== 'live' || !detector || !analyzer) return;
		const ts = performance.now();

		let sample: PoseSample | null = null;
		try {
			sample = detector.detect(videoEl, ts);
		} catch {
			// Enkeltframe-feil skal ikke stoppe økten.
		}

		if (sample) {
			const fb = analyzer.update(sample.frame, ts);
			repCount = fb.repCount;
			phase = fb.phase;
			elbowAngle = fb.elbowAngle;

			if (fb.completedRep) beep();
			if (fb.cue) {
				lastCue = fb.cue;
				voice?.speak(fb.cue);
			}
			drawPose(sample);
		} else {
			clearCanvas();
			analyzer.update({}, ts);
		}

		rafId = requestAnimationFrame(loop);
	}

	async function stopSession() {
		if (!analyzer) return;
		const result = analyzer.summary();
		cleanup();
		summary = result;

		if (result.reps === 0) {
			status = 'done';
			coaching = 'Ingen reps registrert. Pass på at hele kroppen er i bildet neste gang.';
			return;
		}

		status = 'summarizing';
		try {
			const res = await fetch('/api/trening/teknikk/oppsummering', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ exercise: 'pullups', summary: result, reps: analyzer?.getReps?.() ?? [] })
			});
			const body = (await res.json().catch(() => ({}))) as { coaching?: string; error?: string };
			coaching = body.coaching || 'Bra jobba! Fortsett sånn.';
		} catch {
			coaching = 'Fikk ikke laget en oppsummering nå, men reps-tellingen står over.';
		}
		status = 'done';
	}

	function resetSession() {
		summary = null;
		coaching = '';
		repCount = 0;
		lastCue = '';
		status = 'idle';
	}

	function cleanup() {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		voice?.cancel();
		detector?.close();
		detector = null;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		if (videoEl) videoEl.srcObject = null;
	}

	// ── Tegning ──────────────────────────────────────────────
	const SEGMENTS: [keyof PoseSample['frame'], keyof PoseSample['frame']][] = [
		['leftShoulder', 'leftElbow'],
		['leftElbow', 'leftWrist'],
		['rightShoulder', 'rightElbow'],
		['rightElbow', 'rightWrist'],
		['leftShoulder', 'rightShoulder'],
		['leftShoulder', 'leftHip'],
		['rightShoulder', 'rightHip'],
		['leftHip', 'rightHip']
	];

	function drawPose(sample: PoseSample) {
		const ctx = canvasEl?.getContext('2d');
		if (!ctx) return;
		const w = (canvasEl.width = videoEl.clientWidth);
		const h = (canvasEl.height = videoEl.clientHeight);
		ctx.clearRect(0, 0, w, h);

		const accent = phase === 'top' ? '#4ade80' : phase === 'pulling' ? '#7c8ef5' : '#aaa';
		const { frame } = sample;

		// «Stang»-linja på håndleddshøyde.
		const wrists = [frame.leftWrist, frame.rightWrist].filter(Boolean) as { y: number }[];
		if (wrists.length) {
			const barY = (wrists.reduce((s, p) => s + p.y, 0) / wrists.length) * h;
			ctx.strokeStyle = 'rgba(255,255,255,0.35)';
			ctx.setLineDash([8, 8]);
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(0, barY);
			ctx.lineTo(w, barY);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		ctx.strokeStyle = accent;
		ctx.lineWidth = 4;
		ctx.lineCap = 'round';
		for (const [a, b] of SEGMENTS) {
			const pa = frame[a];
			const pb = frame[b];
			if (!pa || !pb) continue;
			ctx.beginPath();
			ctx.moveTo(pa.x * w, pa.y * h);
			ctx.lineTo(pb.x * w, pb.y * h);
			ctx.stroke();
		}

		ctx.fillStyle = accent;
		for (const key of ['nose', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist'] as const) {
			const p = frame[key];
			if (!p) continue;
			ctx.beginPath();
			ctx.arc(p.x * w, p.y * h, key === 'nose' ? 7 : 5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function clearCanvas() {
		const ctx = canvasEl?.getContext('2d');
		if (ctx && canvasEl) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
	}

	onDestroy(cleanup);
</script>

<AppPage width="content">
	<PageSection>
		<PageHeader
			title="Teknikk"
			titleHref="/trening"
			subtitle="Live pull-up-analyse — telles og vurderes rett i nettleseren"
			emoji="🎯"
		/>

		<div class="stage" class:live={status === 'live'}>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={videoEl} class="cam" playsinline muted></video>
			<canvas bind:this={canvasEl} class="overlay"></canvas>

			{#if status === 'live'}
				<div class="hud">
					<div class="rep-count">{repCount}</div>
					<div class="phase-pill">{phaseLabel[phase]}{elbowAngle != null ? ` · ${elbowAngle}°` : ''}</div>
				</div>
				{#if lastCue}
					<div class="cue">{lastCue}</div>
				{/if}
			{/if}

			{#if status === 'idle' || status === 'error'}
				<div class="placeholder">
					<p class="lead">Heng opp telefonen så hele kroppen er i bildet, og start økta.</p>
					{#if errorMsg}<p class="err">{errorMsg}</p>{/if}
				</div>
			{/if}

			{#if status === 'loading'}
				<div class="placeholder"><p class="lead">Laster modell og kamera …</p></div>
			{/if}
		</div>

		<div class="controls">
			{#if status === 'idle' || status === 'error'}
				<Button variant="primary" fullWidth onClick={startSession}>Start økt</Button>
			{:else if status === 'live'}
				<Button variant="danger" fullWidth onClick={stopSession}>Stopp og oppsummer</Button>
			{:else if status === 'loading' || status === 'summarizing'}
				<Button variant="secondary" fullWidth disabled>
					{status === 'loading' ? 'Starter …' : 'Lager oppsummering …'}
				</Button>
			{:else if status === 'done'}
				<Button variant="primary" fullWidth onClick={resetSession}>Ny økt</Button>
			{/if}
		</div>

		{#if status === 'done' && summary}
			<div class="result">
				<div class="stats">
					<div class="stat"><span class="num">{summary.reps}</span><span class="lbl">reps</span></div>
					<div class="stat"><span class="num">{summary.cleanReps}</span><span class="lbl">rene reps</span></div>
					<div class="stat">
						<span class="num">{summary.chinOverBarReps}</span><span class="lbl">hake over stang</span>
					</div>
					<div class="stat">
						<span class="num">{summary.fullExtensionReps}</span><span class="lbl">full utstrekning</span>
					</div>
				</div>
				{#if coaching}
					<div class="coaching">{coaching}</div>
				{/if}
			</div>
		{/if}

		<p class="privacy">Videoen behandles kun på din enhet og lastes aldri opp. Bare tellingen sendes videre.</p>
	</PageSection>
</AppPage>

<style>
	.stage {
		position: relative;
		width: 100%;
		aspect-ratio: 3 / 4;
		max-height: 70vh;
		background: #000;
		border-radius: var(--radius-lg);
		overflow: hidden;
		border: 1px solid var(--border-color);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cam,
	.overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* Speilvend som et selfie-kamera. */
		transform: scaleX(-1);
	}
	.cam {
		object-fit: cover;
	}

	.hud {
		position: absolute;
		top: var(--space-md);
		left: var(--space-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-xs);
		align-items: flex-start;
	}
	.rep-count {
		font-size: 4rem;
		font-weight: 800;
		line-height: 1;
		color: #fff;
		text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7);
	}
	.phase-pill {
		background: rgba(0, 0, 0, 0.55);
		color: var(--text-primary);
		padding: 4px 10px;
		border-radius: 999px;
		font-size: var(--font-size-caption);
		font-weight: 600;
	}
	.cue {
		position: absolute;
		bottom: var(--space-md);
		left: var(--space-md);
		right: var(--space-md);
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		padding: var(--space-sm) var(--space-md);
		border-radius: var(--radius-md);
		font-weight: 600;
		text-align: center;
	}
	.placeholder {
		padding: var(--space-xl);
		text-align: center;
	}
	.lead {
		color: var(--text-secondary);
		margin: 0;
	}
	.err {
		color: var(--error-text);
		margin-top: var(--space-sm);
	}

	.controls {
		display: flex;
	}

	.result {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--space-sm);
	}
	.stat {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-md);
		padding: var(--space-md);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.num {
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--text-primary);
	}
	.lbl {
		font-size: var(--font-size-caption);
		color: var(--text-tertiary);
		text-align: center;
	}
	.coaching {
		background: var(--info-bg);
		border: 1px solid var(--info-border);
		border-radius: var(--radius-md);
		padding: var(--space-lg);
		color: var(--text-primary);
		line-height: 1.55;
		white-space: pre-wrap;
	}
	.privacy {
		font-size: var(--font-size-caption);
		color: var(--text-tertiary);
		text-align: center;
		margin: 0;
	}
</style>
