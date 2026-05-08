<script lang="ts">
	interface SpondGroup {
		groupId: string;
		groupName: string;
		eventCount: number;
		lastSeen: string;
		assignedPerson: { id: string; name: string } | null;
	}

	interface Props {
		selectedGroupIds: string[];
		currentPersonId?: string;
		onChange: (next: string[]) => void;
	}

	let { selectedGroupIds, currentPersonId, onChange }: Props = $props();

	let groups = $state<SpondGroup[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	$effect(() => {
		void load();
	});

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/sensors/spond/groups');
			if (!res.ok) throw new Error('kunne ikke hente Spond-grupper');
			const body = await res.json();
			groups = body.groups ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Ukjent feil';
		} finally {
			loading = false;
		}
	}

	function toggle(groupId: string) {
		const set = new Set(selectedGroupIds);
		if (set.has(groupId)) set.delete(groupId);
		else set.add(groupId);
		onChange(Array.from(set));
	}

	function isSelected(groupId: string): boolean {
		return selectedGroupIds.includes(groupId);
	}

	function isOwnedByOther(group: SpondGroup): boolean {
		return !!(group.assignedPerson && group.assignedPerson.id !== currentPersonId);
	}
</script>

<div class="spond-picker">
	{#if loading}
		<p class="empty">Henter Spond-grupper…</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if groups.length === 0}
		<p class="empty">Ingen Spond-grupper synket enda. Koble til Spond i innstillinger og kjør sync.</p>
	{:else}
		<ul class="list">
			{#each groups as group (group.groupId)}
				<li>
					<label class="row" class:selected={isSelected(group.groupId)}>
						<input
							type="checkbox"
							checked={isSelected(group.groupId)}
							onchange={() => toggle(group.groupId)}
						/>
						<span class="name">{group.groupName}</span>
						<span class="meta">
							{group.eventCount} events
							{#if isOwnedByOther(group) && group.assignedPerson}
								· allerede knyttet til {group.assignedPerson.name}
							{/if}
						</span>
					</label>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.spond-picker { display: flex; flex-direction: column; gap: 0.4rem; }
	.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.65rem;
		border-radius: 8px;
		background: var(--surface-2, #f5f5f7);
		cursor: pointer;
	}
	.row.selected {
		background: rgba(124, 142, 245, 0.12);
		outline: 1px solid rgba(124, 142, 245, 0.4);
	}
	.name { font-weight: 500; flex: 1; }
	.meta { font-size: 0.75rem; opacity: 0.65; }
	.empty, .error { opacity: 0.7; font-size: 0.9rem; margin: 0; }
	.error { color: #c0392b; }
</style>
