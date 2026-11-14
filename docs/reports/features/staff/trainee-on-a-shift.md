# Trainee on a shift

Status: ✅ /staff/volunteering

A signup can name another signup on the same shift as the one it trained under (`volunteer_signup.supervising_signup_id`, #2720). Staff set or clear it from the shift roster; the supervisor marks trainees on their own shift page. A supervisor on another shift, or the member themselves, is refused in `training-service.ts` as an integrity rule, not a workflow gate. Granting a clearance offers the member's completed supervised shifts whose role asks for it, and the chosen one is kept on the grant (`member_certification.training_signup_id`).
