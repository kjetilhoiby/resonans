<!--
  SharedWalkPlaybackView — offentlig visning av en delt gåtur-avspilling.
  Tynn innpakning rundt WalkPlayback3D; hentes fra /share/[token] når
  ressurstypen er walkPlayback.
-->
<script lang="ts">
	import WalkPlayback3D from '../WalkPlayback3D.svelte';
	import type { WalkPlayback } from '../walk-playback';

	interface WalkResource {
		title: string;
		sportType: string | null;
		startedAt: string;
		imageCount: number;
		playback: WalkPlayback;
		ownerName?: string | null;
		basemap?: string | null;
	}

	let { resource }: { resource: WalkResource } = $props();
</script>

<WalkPlayback3D
	playback={resource.playback}
	title={resource.title}
	sportType={resource.sportType}
	startedAt={resource.startedAt}
	ownerName={resource.ownerName ?? null}
	defaultBasemap={resource.basemap ?? null}
/>
