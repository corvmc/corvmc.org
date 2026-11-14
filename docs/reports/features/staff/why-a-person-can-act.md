# Why a person can act

Status: ✅ /staff/members/[id]

The Account tab of a member record lists the person's staff positions, committee seats (with the committee positions they hold there) and current shift roles, each with the capabilities it gives (#2994). It is read by holders of `user.read`. A task's page shows the people it waits on, each with the reason (assigned, holds the tagged position, or a seat on the owning committee), and why the viewer can or cannot act on it. Both come from the functions the guards use (`capabilitySet`, `committeeGrantsFor`, `liveRoleGrantsFor`, `waitingOn`, `canActOnTask`); `why-can-act.spec.ts` and `can-act.spec.ts` check every user, capability, scope and task in their fixtures against the guard.
