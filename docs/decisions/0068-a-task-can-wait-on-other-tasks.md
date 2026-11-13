# 0068 A task can wait on other tasks

- **Date:** 2026-11-13
- **Status:** Accepted
- **Issue:** [#2625](https://github.com/corvmc/corvmc.org/issues/2625)

## Context

Grant applications and productions are sequences: the budget follows the narrative, and
submitting follows both. Tasks had a due date and an order inside their project, but nothing said
that one could not start until another was done, so the order lived in people's heads. #2625 also
made Tasks the catalogue of work, with projects as a way to group it (0054's work orders are the
tasks).

## Decision

1. **`work_order_dependency (work_order_id, depends_on_id)`**: one row per task waiting on
   another. Both ends reference `work_order` with cascade, the pair is the primary key, and a
   CHECK refuses a task waiting on itself. It is a graph: a task can wait on several, and several
   can wait on one. It is separate from a link saying what a task is about (#2622's
   `work_order_link`), which is not directional and does not block.
2. **A cycle is refused on write.** Before adding an edge, a recursive query checks whether the
   new blocker already reaches the task. A cycle is an integrity failure, so this is a 422 refusal,
   not a warning ([workflow gates](../development/conventions.md#workflow-gates)).
3. **Both ends are in the same project, or both in none.** The guard on either task is then the
   same, and the picker offers only what the reader can already see.
4. **Blocked is derived on read**: open, with at least one open task it waits on. A called-off
   task blocks nothing, since it will never be done. Nothing stores Blocked.
5. **Marking a blocked task done warns, records and allows.** The form says how many tasks it
   waits on are open, and the `work_order.resolved` audit entry records `openBlockers`.
6. **The last blocker closing tells the waiting task's assignees** (`volunteer.task_ready`,
   notification `task_ready`, in-app by default). It fires when a task is marked done or called
   off on its own.
7. **Templates carry dependencies** in `duty_list_item_dependency`, between items of one template,
   with the same cycle refusal. Applying a template copies each edge onto the tasks it stamps, in
   the batch that writes them. The grant application ships in its natural order: the budget
   waits on the narrative, and submitting waits on the budget and the letters of support.
8. **The project page draws its tasks as a layered graph** in the browser: each task one layer
   right of the furthest task it waits on, done ones greyed. It is a view of the project, not a
   planning tool; edges are set on each task's page.

## Alternatives rejected

- **A `blocked` status or column.** It would need something to keep it right as blockers close.
  Deriving it is one correlated count, as late and overdue are elsewhere.
- **Refusing to close a blocked task.** Work gets done out of order, and the owner's rule for
  workflow gates is warn, record, allow. Only the cycle, which would make the graph meaningless,
  is refused.
- **Gantt charts, critical paths, and due dates that move with their blockers.** Due dates stay
  set by hand. The graph shows order, not time.
- **Cross-project dependencies.** A task in one project waiting on another's would need both
  projects' guards and would show half a graph on each page. No sequence so far crosses projects.

## Consequences

- The Tasks table and the related-tasks cards gain a Blocked chip through the shared chips in
  `task-facts.ts`, with blocked rows dimmed and their open blockers named.
- Bulk call-offs that write `cancelled_at` directly (a cancelled show's committee items) do not
  send the ready notice. Single call-offs and every mark-done path do.
- The dev seed and the e2e fixture replay the grant template order after their wipes, with the
  grant templates (`scripts/db/grant-stage-templates.ts`).
