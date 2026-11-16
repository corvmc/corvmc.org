# Loan clearance

Status: ✅ /staff/inventory/[id]

An item can name a clearance from the volunteer clearance catalog (**Clearance** on the item's edit form, #2953). A loan request for it from a member who did not hold that clearance on the requested pickup date is still created: `requestLoan` checks with `missingCertifications` (the shift gate's as-of-date check over `member_certification`), stores the clearance on the loan as `missing_clearance_id`, and writes `equipment_loan.requested_without_clearance` to the audit log. Staff see **Missing clearance** on the loan; the member sees the requirement in the request form when they lack it today, and a warning after submitting. `src/lib/server/inventory/loan-service.ts`.
