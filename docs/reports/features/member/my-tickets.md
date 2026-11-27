# My tickets

Status: ✅ Full flow

Upcoming/past split, ticket codes, status badges. A guest ticket (no `user_id`) links to an account when its address is verified, through `claimVerifiedEmail`, which the verification link and a confirmed email change both call, and at purchase when a live account with a verified email already holds the address; the match ignores case and never moves a ticket a user already holds. Not at signup, because typing an address proves nothing until the link is clicked (#3408). Tickets bought before this shipped are not backfilled.
