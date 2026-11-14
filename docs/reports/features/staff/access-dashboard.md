# Access dashboard

Status: ✅ /staff/settings?tab=access

Admin-only (`user.setRole`) view of who can do what (#1942), a Settings tab since #2624. By person: positions and the capabilities the matrix gives them, active committee seats with their grants, and clearances with expiry and state. By permission: everyone holding a position, a capability (through a position or a committee seat, plus volunteer roles that carry it per shift) or a clearance, revoked and lapsed grants included. Positions are assigned and removed here (audited as `user.roles_changed`; the last admin and your own last position are refused); clearances and committee grants are changed through the volunteer and groups remotes. Band roles are out of scope.
