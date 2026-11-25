<script lang="ts">
	import TaskStaffing from '#lib/components/volunteer/TaskStaffing.svelte';
	import { getTaskPage } from '#lib/remote/volunteer.remote.js';

	/**
	 * One shift's staffing in the Crew box's Assign dialog: read when the dialog
	 * opens, through the task page's own guard, and aimed at that shift.
	 */
	let { workOrderId, shiftId }: { workOrderId: string; shiftId: string } = $props();

	const view = $derived(await getTaskPage(workOrderId));
</script>

<div class="flex flex-col gap-4">
	<TaskStaffing task={view.task} assignees={view.assignees} shifts={view.shifts} target={shiftId} />
</div>
