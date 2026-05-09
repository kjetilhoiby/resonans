<script lang="ts">
	interface MessageMention {
		messageId: string;
		conversationId: string;
		role: string;
		snippet: string;
		createdAt: string;
		confidence: 'explicit' | 'inferred';
	}

	interface TaskMention {
		taskId: string;
		goalId: string;
		title: string;
		status: string;
		frequency: string | null;
		createdAt: string;
		confidence: 'explicit' | 'inferred';
	}

	interface Props {
		messages: MessageMention[];
		tasks: TaskMention[];
	}

	let { messages, tasks }: Props = $props();

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('no-NO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<div class="mentions">
	{#if tasks.length > 0}
		<section>
			<h4>Oppgaver der personen er nevnt</h4>
			<ul>
				{#each tasks as task (task.taskId)}
					<li>
						<a href={`/oppgaver/${task.taskId}`} class="task-link">
							<span class="title">{task.title}</span>
							<span class="meta">
								{task.status === 'active' ? 'Aktiv' : task.status}
								· {formatDate(task.createdAt)}
								{#if task.confidence === 'inferred'}<span class="inferred">utledet</span>{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if messages.length > 0}
		<section>
			<h4>Chatter der personen er nevnt</h4>
			<ul>
				{#each messages as msg (msg.messageId)}
					<li>
						<a href={`/samtaler/${msg.conversationId}`} class="msg-link">
							<span class="snippet">{msg.snippet}</span>
							<span class="meta">
								{msg.role === 'user' ? 'Du' : 'Resonans'}
								· {formatDate(msg.createdAt)}
								{#if msg.confidence === 'inferred'}<span class="inferred">utledet</span>{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if tasks.length === 0 && messages.length === 0}
		<p class="empty">Ingen omtaler ennå.</p>
	{/if}
</div>

<style>
	.mentions { display: flex; flex-direction: column; gap: 1rem; }
	section h4 { margin: 0 0 0.5rem; font-size: 0.9rem; opacity: 0.8; }
	ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
	a {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		background: var(--surface-1, #fff);
		border: 1px solid var(--border, #e0e0e3);
		text-decoration: none;
		color: inherit;
	}
	a:hover { background: var(--surface-2, #f5f5f7); }
	.title, .snippet { font-weight: 500; font-size: 0.9rem; }
	.snippet {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		font-size: 0.75rem;
		opacity: 0.6;
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.inferred {
		font-size: 0.7rem;
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
		background: rgba(0,0,0,0.05);
	}
	.empty { opacity: 0.6; font-style: italic; }
</style>
