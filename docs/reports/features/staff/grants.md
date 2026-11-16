# Grants

Status: ✅ /staff/funding

Funders (an `organization` holding `funder`), applications to them (`grant_application`: requested and awarded amounts, apply-by, award period, status prospect → applied → awarded → closed or declined), each one a project of kind `grant` owned by the Development committee, with the "Grant application" template stamped on create; reports are that project's tasks (#2622). The Funding page lists grants and sponsorships by stage, soonest next task or deadline first. An awarded grant offers the award and close-out templates, and `funds_project_id` shows the money in that project's budget. Guarded by `grant.read` / `grant.manage`, which a committee's grant list can also carry (seeded on Development, #1578); the treasurer reads. Reminds grant managers 14 and 3 days before each deadline (#1477). See business-workflows §21
