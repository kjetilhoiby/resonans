<script lang="ts">
	interface Props {
		role: 'user' | 'assistant' | 'system';
		content: string;
		timestamp?: Date;
	}

	let { role, content, timestamp }: Props = $props();
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
	<div class="message-content">
		{content}
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

	.message-content {
		color: #333;
		line-height: 1.5;
		white-space: pre-wrap;
	}
</style>
