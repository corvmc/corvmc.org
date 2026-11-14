# Ballots

Status: ✅ /member/ballots, /staff/ballots

Formal votes. A committee ballot freezes the committee's active roster when it opens and records each vote, which can be changed until the close and then appears as a roll call. A member-wide ballot freezes members of record (active, at least `ballot.memberOfRecordDays` old, oriented) plus audited staff overrides, and keeps votes secret: a participation row and a per-option counter, with no joinable link and no timestamps. Tallies are hidden from everyone until the close. The named certifier certifies the result and every member is notified. Committee admins run their own ballots; member-wide ballots need `ballot.manage`. A ballot can be put from a suggestion (which reads In ballot while voting is open) or name a project, and a passing certified result offers Start project, linking project → ballot → suggestion; each page shows the chain (domain model 7). See `docs/decisions/0052-secret-ballots-count-without-a-vote-row.md`
