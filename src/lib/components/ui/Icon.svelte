<script lang="ts">
	export type IconName =
		| 'chat'
		| 'camera'
		| 'wave'
		| 'checkin'
		| 'file'
		| 'goals'
		| 'settings'
		| 'back'
		| 'forward'
		| 'search'
		| 'refresh'
		| 'close'
		| 'plus'
		| 'attach'
		| 'check'
		| 'calendar';

	interface Props {
		name: IconName;
		size?: number;
		strokeWidth?: number;
		decorative?: boolean;
		title?: string | null;
	}

	let {
		name,
		size = 20,
		strokeWidth = 1.75,
		decorative = true,
		title = null,
	}: Props = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden={decorative}
	aria-label={decorative ? undefined : (title ?? name)}
	role={decorative ? undefined : 'img'}
>
	{#if title && !decorative}
		<title>{title}</title>
	{/if}

	{#if name === 'chat'}
		<path d="M4.5 5.5h15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H11l-4.5 3v-3H4.5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
	{:else if name === 'camera'}
		<path d="M8.5 6.5 10 4.5h4l1.5 2h2.5a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8a2 2 0 0 1 2-2Z" />
		<circle cx="12" cy="12" r="3.2" />
	{:else if name === 'wave'}
		<path d="M2.5 12c1.8-4.7 4.2-4.7 6 0s4.2 4.7 6 0 4.2-4.7 6 0" />
	{:else if name === 'checkin'}
		<path d="M12 3.5a8.5 8.5 0 1 1 0 17" />
		<path d="M12 3.5a8.5 8.5 0 0 0 0 17" opacity="0.45" />
	{:else if name === 'file'}
		<path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5Z" />
		<path d="M14 3.5v4h4" />
	{:else if name === 'goals'}
		<circle cx="12" cy="12" r="7.5" />
		<circle cx="12" cy="12" r="3.5" />
		<circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3.5" />
		<path d="M9.8 5.3 L10.1 3.2 L13.9 3.2 L14.2 5.3 L16.7 6.8 L18.7 6.0 L20.6 9.2 L18.9 10.6 L18.9 13.5 L20.6 14.8 L18.7 18.0 L16.7 17.2 L14.2 18.7 L13.9 20.8 L10.1 20.8 L9.8 18.7 L7.3 17.2 L5.3 18.0 L3.4 14.8 L5.2 13.5 L5.2 10.6 L3.4 9.2 L5.3 6.0 L7.3 6.8 Z" />
	{:else if name === 'back'}
		<path d="m14.5 6.5-6 5.5 6 5.5" />
	{:else if name === 'forward'}
		<path d="m9.5 6.5 6 5.5-6 5.5" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="6.5" />
		<path d="m16 16 4.5 4.5" />
	{:else if name === 'refresh'}
		<path d="M19.5 7.5A8 8 0 1 0 20 12" />
		<path d="m19.5 3.5.5 4-4 .5" />
	{:else if name === 'close'}
		<path d="m7 7 10 10" />
		<path d="m17 7-10 10" />
	{:else if name === 'plus'}
		<path d="M12 5v14" />
		<path d="M5 12h14" />
	{:else if name === 'attach'}
		<path d="M8.5 12.5 15 6a3 3 0 1 1 4.2 4.2l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5" />
	{:else if name === 'check'}
		<path d="m5.5 12.5 4 4 9-10" />
	{:else if name === 'calendar'}
		<rect x="3.5" y="5.5" width="17" height="16" rx="2" />
		<path d="M3.5 10.5h17" />
		<path d="M8 4V7" />
		<path d="M16 4V7" />
	{/if}
</svg>