<script lang="ts">
	import { marked } from 'marked';

	interface Props {
		role: 'user' | 'assistant' | 'system';
		content: string;
		timestamp?: Date;
		imageUrl?: string;
	}

	let { role, content, timestamp, imageUrl }: Props = $props();

	// Configure marked for safe rendering
	marked.setOptions({
		breaks: true, // Convert \n to <br>
		gfm: true // GitHub Flavored Markdown
	});

	// Render markdown to HTML
	const htmlContent = $derived(marked.parse(content) as string);
</script>

<div class="message {role}" class:error={content.startsWith('⚠️')}>
	<div class="message-header">
		<span class="role-badge">
			{#if role === 'user'}
				👤 Du
			{:else if role === 'assistant'}
				🤖 Resonans AI
			{:else}
				ℹ️ System
			{/if}
		</span>
		{#if timestamp}
			<span class="timestamp">
				{timestamp.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
			</span>
		{/if}
	</div>
	
	{#if imageUrl}
		<div class="message-image">
			<img src={imageUrl} alt="User uploaded content" />
		</div>
	{/if}
	
	<div class="message-content">
		{@html htmlContent}
	</div>
</div>

<style>
	.message {
		margin-bottom: 1rem;
		padding: 1rem;
		border-radius: 0.5rem;
		max-width: 80%;
	}

	.message.user {
		background-color: #e3f2fd;
		margin-left: auto;
		border-bottom-right-radius: 0.25rem;
	}

	.message.assistant {
		background-color: #f5f5f5;
		margin-right: auto;
		border-bottom-left-radius: 0.25rem;
	}

	.message.system {
		background-color: #fff3e0;
		margin: 0 auto;
		max-width: 60%;
		text-align: center;
		font-size: 0.9rem;
	}

	.message.error {
		background-color: #ffebee;
		border: 1px solid #ef5350;
		color: #c62828;
		animation: shake 0.3s ease-in-out;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		25% { transform: translateX(-5px); }
		75% { transform: translateX(5px); }
	}

	.message-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
	}

	.role-badge {
		font-weight: 600;
		color: #555;
	}

	.timestamp {
		color: #999;
		font-size: 0.75rem;
	}

	.message-image {
		margin: 0.75rem 0;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.message-image img {
		max-width: 100%;
		height: auto;
		display: block;
		border-radius: 0.5rem;
	}

	.message-content {
		color: #333;
		line-height: 1.6;
	}

	/* Markdown styles */
	.message-content :global(p) {
		margin: 0.5rem 0;
	}

	.message-content :global(p:first-child) {
		margin-top: 0;
	}

	.message-content :global(p:last-child) {
		margin-bottom: 0;
	}

	.message-content :global(ul),
	.message-content :global(ol) {
		margin: 0.5rem 0;
		padding-left: 1.5rem;
	}

	.message-content :global(li) {
		margin: 0.25rem 0;
	}

	.message-content :global(code) {
		background-color: rgba(0, 0, 0, 0.05);
		padding: 0.125rem 0.25rem;
		border-radius: 0.25rem;
		font-family: 'Courier New', monospace;
		font-size: 0.9em;
	}

	.message-content :global(pre) {
		background-color: rgba(0, 0, 0, 0.05);
		padding: 0.75rem;
		border-radius: 0.375rem;
		overflow-x: auto;
		margin: 0.5rem 0;
	}

	.message-content :global(pre code) {
		background-color: transparent;
		padding: 0;
	}

	.message-content :global(strong) {
		font-weight: 600;
		color: #222;
	}

	.message-content :global(em) {
		font-style: italic;
	}

	.message-content :global(a) {
		color: #1976d2;
		text-decoration: none;
	}

	.message-content :global(a:hover) {
		text-decoration: underline;
	}

	.message-content :global(blockquote) {
		border-left: 3px solid #ddd;
		padding-left: 1rem;
		margin: 0.5rem 0;
		color: #666;
	}

	.message-content :global(h1),
	.message-content :global(h2),
	.message-content :global(h3),
	.message-content :global(h4) {
		margin: 1rem 0 0.5rem 0;
		font-weight: 600;
		color: #222;
	}

	.message-content :global(h1) { font-size: 1.5em; }
	.message-content :global(h2) { font-size: 1.3em; }
	.message-content :global(h3) { font-size: 1.15em; }
	.message-content :global(h4) { font-size: 1em; }

	.message-content :global(hr) {
		border: none;
		border-top: 1px solid #ddd;
		margin: 1rem 0;
	}

	.message-content :global(table) {
		border-collapse: collapse;
		width: 100%;
		margin: 0.5rem 0;
	}

	.message-content :global(th),
	.message-content :global(td) {
		border: 1px solid #ddd;
		padding: 0.5rem;
		text-align: left;
	}

	.message-content :global(th) {
		background-color: rgba(0, 0, 0, 0.05);
		font-weight: 600;
	}
</style>
