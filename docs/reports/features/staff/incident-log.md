# Incident log

Status: ✅ /staff/moderation/incidents

Noise complaints, injuries, hazards, conduct, damage and theft, recorded by staff for liability, insurance and neighbour relations. `incident` + append-only `incident_note`: the account is written once and later facts are notes, reopening and retention holds are audit entries on the page's History card (kept as long as the incident, not the audit log's 24 months), and there is no delete path. Every author is stored as a name beside a `set null` FK so a purged account does not anonymise a report. A member can be linked as involved; recording one changes nothing about their account and they cannot see it. Behind `incident.read` / `incident.record`. Crew file for their own show through `incident.file`, a volunteer-role grant that covers the shift's event from its start until 7 days after it ends; filers see only their own filings. See `docs/development/business-workflows.md` §20
