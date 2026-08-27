<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { setRoleCertifications, getActiveCertifications } from '$lib/remote/volunteer.remote';

	/**
	 * What a role requires before someone can claim a shift for it.
	 *
	 * Owns `getActiveCertifications` — unparameterized and refreshed by name from the certification
	 * mutations, so it could not join the page's role-id-keyed query. The requirements themselves
	 * arrive as a prop from that query, because `setRoleCertifications` refreshes them with a
	 * `roleId` it does have.
	 */
	let {
		role,
		held
	}: {
		role: { id: string; name: string };
		held: { id: string; name: string; issuedBy: string | null }[];
	} = $props();

	const certOptions = $derived(await getActiveCertifications());
</script>

<InfoCard title="Requirements">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			{#if certOptions.length > 0}
				<Action
					action={setRoleCertifications}
					label="Edit"
					variant="ghost"
					size="sm"
					modalTitle="What {role.name} requires"
					successToast="Requirements saved"
				>
					{#snippet form()}
						<input type="hidden" name="roleId" value={role.id} />
						<p class="text-muted">
							Someone must hold all of these before they can claim a shift for this role. Logging
							hours is never blocked — the review queue just flags it.
						</p>
						<CheckboxGroup
							field={setRoleCertifications.fields.certificationIds}
							selected={held.map((c) => c.id)}
							options={certOptions.map((c) => ({
								value: c.id,
								label: c.name,
								description: c.issuedBy ?? 'Granted by CMC'
							}))}
						/>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/snippet}

	{#if held.length === 0}
		<p class="text-muted">Anyone can claim a shift for this role — no clearance needed.</p>
	{:else}
		<ul class="space-y-2 text-sm">
			{#each held as cert (cert.id)}
				<li>
					<span class="font-medium">{cert.name}</span>
					<span class="opacity-60">· {cert.issuedBy ?? 'Granted by CMC'}</span>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
