# View as member

Status: ✅ /staff/members/[id]?tab=account

An admin (the `admin` role, not a grantable capability) views the app signed in as a member, with a banner and Stop on every page (#2847). Admins are never viewed as. The admin may act for the member; start, stop and every request that could write are audited with the admin as actor and the member as subject. Payments, password and email changes are refused. See `docs/development/business-workflows.md` §27
