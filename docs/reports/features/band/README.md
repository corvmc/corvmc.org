# Band panel

The band panel uses a per-band layout at `/band/[slug]/` with role-gated navigation — a layout-level
auth check with `getUserRole` + `hasAnyRole` for staff bypass.
