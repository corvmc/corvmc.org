<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';

	// Tasks' settings (#2767): what generates tasks, set up now and then, so
	// header links rather than peer lists. Each page's remotes guard themselves.
	const caps = $derived((await getStaffLayout()).capabilities);
</script>

{#if hasCapability(caps, 'volunteer.read')}
	<Button variant="ghost" href={resolve('staff/tasks/recurring')}
		>{m.staff_tasks_recurring_work_label()}</Button
	>
{/if}
{#if hasCapability(caps, 'project.read')}
	<Button variant="ghost" href={resolve('staff/tasks/templates')}
		>{m.staff_project_templates_templates_label()}</Button
	>
{/if}
