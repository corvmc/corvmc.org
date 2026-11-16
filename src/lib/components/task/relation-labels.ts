import { m } from '#lib/paraglide/messages.js';
import type { RelationKey } from '#lib/utils/related-tasks.js';

/** The group heading for each relation, shared by `RelatedTasks` and `RelatedShifts`. */
export const RELATION_LABELS: Record<RelationKey, () => string> = {
	event: m.staff_related_tasks_event_label,
	show: m.staff_related_tasks_show_label,
	project: m.staff_related_tasks_project_label,
	group: m.staff_related_tasks_group_label,
	groupProjects: m.staff_related_tasks_group_projects_label,
	role: m.staff_related_tasks_role_label,
	recurringWork: m.staff_related_tasks_recurring_work_label,
	about: m.staff_related_tasks_about_label,
	contractorJobs: m.staff_related_tasks_contractor_jobs_label,
	funding: m.staff_related_tasks_funding_label
};
