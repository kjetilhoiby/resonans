<!--
  AccountSettingsSheet — Bottom-sheet for selecting favorite accounts.
  Extracted from EconomicsDashboard to isolate the overlay logic.
-->
<script lang="ts">
	interface EconomicsAccount {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		balance: number;
		currency: string | null;
	}

	interface Props {
		accounts: EconomicsAccount[];
		favoriteAccountIds: string[];
		onToggleFavorite: (accountId: string) => void;
		onClose: () => void;
	}

	let { accounts, favoriteAccountIds, onToggleFavorite, onClose }: Props = $props();
</script>

<button class="ed-sheet-backdrop" type="button" aria-label="Lukk kontoinnstillinger" onclick={onClose}></button>
<div class="ed-sheet" role="dialog" aria-modal="true" aria-label="Kontoinnstillinger">
	<div class="ed-sheet-handle"></div>
	<div class="ed-sheet-head">
		<div>
			<h3>Kontoinnstillinger</h3>
			<p>Velg kontoene du vil se i oversikten.</p>
		</div>
		<button class="ed-sheet-close" type="button" onclick={onClose} aria-label="Lukk">✕</button>
	</div>
	<div class="ed-sheet-body">
		<div class="ed-account-settings">
			{#each accounts as account}
				<label class="ed-account-setting-row">
					<input
						type="checkbox"
						checked={favoriteAccountIds.includes(account.accountId)}
						onchange={() => onToggleFavorite(account.accountId)}
					/>
					<span>{account.accountName ?? account.accountId}</span>
				</label>
			{/each}
		</div>
	</div>
</div>

<style>
	.ed-sheet-backdrop {
		position: fixed;
		inset: 0;
		border: none;
		background: rgba(0, 0, 0, 0.55);
		z-index: 70;
	}
	.ed-sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 71;
		background: #101013;
		border-top: 1px solid #2a2a35;
		border-top-left-radius: 18px;
		border-top-right-radius: 18px;
		padding: 8px 14px calc(16px + env(safe-area-inset-bottom));
		max-height: min(72vh, 640px);
		display: flex;
		flex-direction: column;
		gap: 10px;
		animation: sheet-up 180ms ease-out;
	}
	@keyframes sheet-up {
		from { transform: translateY(20px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
	.ed-sheet-handle {
		width: 46px;
		height: 4px;
		border-radius: 999px;
		background: #3a3a45;
		margin: 2px auto 0;
	}
	.ed-sheet-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.ed-sheet-head h3 { margin: 0; font-size: 0.96rem; color: #ececf5; }
	.ed-sheet-head p { margin: 2px 0 0; font-size: 0.76rem; color: #8f909f; }
	.ed-sheet-close {
		background: #17171d;
		border: 1px solid #2a2a35;
		border-radius: 10px;
		width: 32px;
		height: 32px;
		font: inherit;
		color: #b6b8cb;
		cursor: pointer;
		flex-shrink: 0;
	}
	.ed-sheet-body { overflow-y: auto; padding-right: 2px; }
	.ed-account-settings {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 8px;
	}
	.ed-account-setting-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px;
		border-radius: 10px;
		background: #141414;
		border: 1px solid #232323;
		font-size: 0.82rem;
		color: #bbb;
	}
</style>
