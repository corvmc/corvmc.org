<script lang="ts">
	import type { RemoteFormField } from '@sveltejs/kit';
	/**
	 * "What you'd help with" — the grouped role checkboxes plus the availability
	 * note. Shared by the onboarding interests step and the Interests modal on
	 * /member/volunteer.
	 *
	 * It used to sit open in the middle of /member/volunteer, which pushed the
	 * shift board below the fold on every visit. Asked once during onboarding and
	 * reachable from a header button afterwards.
	 *
	 * Takes plain props, never a query — see the note in ProfileFields.svelte.
	 */
	import { CheckboxGroup } from '$lib/components/ui/Form';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { volunteerRoleGroups, volunteerRoleGroupLabels } from '$lib/config';

	type Role = { id: string; name: string; group: string; descriptionHtml: string | null };

	let {
		fields,
		roleOptions,
		selected = [],
		availability = ''
	}: {
		/** `remote.fields` from the form this is rendered inside. */
		/** The subset of `remote.fields` this set posts into. */
		fields: {
			roleIds: RemoteFormField<string[]>;
			availability: RemoteFormField<string>;
		};
		roleOptions: Role[];
		selected?: string[];
		availability?: string;
	} = $props();

	// Group order comes from the enum, not from the data, so the sections stay put
	// as roles are added. Empty groups drop out rather than rendering a bare
	// heading — a club with no committees shouldn't see the word.
	function groupedRoles(all: Role[]) {
		return volunteerRoleGroups
			.map((key) => ({ key, roles: all.filter((r) => r.group === key) }))
			.filter((g) => g.roles.length > 0);
	}
</script>

<p class="text-sm text-base-content/70">
	Tick anything that interests you. It isn't a commitment — it just tells us who to ask when
	something comes up, and we'll show you how to do it.
</p>

{#each groupedRoles(roleOptions) as group (group.key)}
	<CheckboxGroup
		field={fields.roleIds}
		legend={volunteerRoleGroupLabels[group.key]}
		{selected}
		descriptionHtml
		options={group.roles.map((r) => ({
			value: r.id,
			label: r.name,
			description: r.descriptionHtml
		}))}
	/>
{/each}

<FormField
	field={fields.availability}
	type="textarea"
	label="When are you usually around?"
	value={availability}
	description="Rough is fine — “weekday evenings, some weekends”."
/>
