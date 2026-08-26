<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ShiftFormFields from './ShiftFormFields.svelte';
	import { getVolunteerRoles } from '$lib/remote/volunteer.remote';

	/**
	 * `ShiftFormFields` with its role list loaded here rather than passed in.
	 *
	 * The two shift pages were each holding `getVolunteerRoles()` open purely to hand it to the
	 * form. It is unparameterized and refreshed by name, so it could not join their page queries —
	 * owning it at the form keeps both pages down to one query.
	 *
	 * `keepId` is the shift's current role: an edit form has to keep showing a role that has since
	 * been archived, or the select would silently post a different one.
	 */
	type Props = Omit<ComponentProps<typeof ShiftFormFields>, 'roles'> & {
		keepId?: string | null;
	};

	let { keepId = null, ...rest }: Props = $props();

	const all = $derived(await getVolunteerRoles());
	const roles = $derived(all.filter((r) => r.isActive || r.id === keepId));
</script>

<ShiftFormFields {...rest} {roles} />
