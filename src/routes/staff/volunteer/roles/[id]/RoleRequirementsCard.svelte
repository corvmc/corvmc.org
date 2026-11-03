<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import CheckboxGroup from '#lib/components/ui/Form/CheckboxGroup.svelte';
	import { setRoleCertifications, getActiveCertifications } from '#lib/remote/volunteer.remote.js';

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

<InfoCard title={m.staff_volunteer_roles_id_role_requirements_card_title()}>
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			{#if certOptions.length > 0}
				<Action
					action={setRoleCertifications}
					label={m.staff_edit()}
					variant="ghost"
					size="sm"
					modalTitle={m.staff_volunteer_roles_id_role_requirements_card_modal_title({
						name: role.name
					})}
					successToast={m.staff_volunteer_roles_id_role_requirements_card_success_toas()}
				>
					{#snippet form()}
						<input type="hidden" name="roleId" value={role.id} />
						<p class="text-muted">
							{m.staff_volunteer_roles_id_role_requirements_card_someone_must()}
						</p>
						<CheckboxGroup
							field={setRoleCertifications.fields.certificationIds}
							selected={held.map((c) => c.id)}
							options={certOptions.map((c) => ({
								value: c.id,
								label: c.name,
								description:
									c.issuedBy ?? m.staff_volunteer_roles_id_role_requirements_card_description()
							}))}
						/>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/snippet}

	{#if held.length === 0}
		<p class="text-muted">{m.staff_volunteer_roles_id_role_requirements_card_anyone_can_c()}</p>
	{:else}
		<ul class="space-y-2 text-sm">
			{#each held as cert (cert.id)}
				<li>
					<span class="font-medium">{cert.name}</span>
					<span class="opacity-60"
						>· {cert.issuedBy ??
							m.staff_volunteer_roles_id_role_requirements_card_granted_by_c()}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</InfoCard>
