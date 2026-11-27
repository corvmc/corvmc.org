<script lang="ts">
	import TaskStaffing from '#lib/components/volunteer/TaskStaffing.svelte';
	import { getTaskPage } from '#lib/remote/volunteer.remote.js';

	/**
	 * One task's staffing in the Crew box's Assign dialog: read when the dialog
	 * opens, through the task page's own guard, and aimed at one shift, or at the
	 * task itself when it has none (the event lead, #3274).
	 */
	let { workOrderId, shiftId = '' }: { workOrderId: string; shiftId?: string } = $props();

	const view = $derived(await getTaskPage(workOrderId));
</script>

<div class="flex flex-col gap-4">
	<TaskStaffing task={view.task} assignees={view.assignees} shifts={view.shifts} target={shiftId} />
</div>
