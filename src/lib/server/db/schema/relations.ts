import { defineRelations } from 'drizzle-orm';
import * as schema from './index';

export const relations = defineRelations(schema, (t) => ({
	user: {
		instruments: t.many.userInstrument(),
		genres: t.many.userGenre(),
		sessions: t.many.session(),
		accounts: t.many.account(),
		bandMembers: t.many.bandMember()
	},
	userInstrument: {
		user: t.one.user({ from: t.userInstrument.userId, to: t.user.id })
	},
	userGenre: {
		user: t.one.user({ from: t.userGenre.userId, to: t.user.id })
	},
	session: {
		user: t.one.user({ from: t.session.userId, to: t.user.id })
	},
	account: {
		user: t.one.user({ from: t.account.userId, to: t.user.id })
	},
	band: {
		genres: t.many.bandGenre(),
		members: t.many.bandMember(),
		/** Events this band OWNS. Shows it merely played are `lineups`. */
		events: t.many.event(),
		// eventBand points at band twice (the act, and who added it), so both
		// sides need a matching alias to say which FK this relation follows.
		lineups: t.many.eventBand({
			from: t.band.id,
			to: t.eventBand.bandId,
			alias: 'eventBand_band'
		})
	},
	bandGenre: {
		band: t.one.band({ from: t.bandGenre.bandId, to: t.band.id })
	},
	bandMember: {
		band: t.one.band({ from: t.bandMember.bandId, to: t.band.id }),
		user: t.one.user({ from: t.bandMember.userId, to: t.user.id })
	},
	reservation: {
		createdBy: t.one.user({ from: t.reservation.createdByUserId, to: t.user.id }),
		recurringSeries: t.one.recurringSeries({
			from: t.reservation.recurringSeriesId,
			to: t.recurringSeries.id
		})
	},
	event: {
		reservation: t.one.reservation({ from: t.event.reservationId, to: t.reservation.id }),
		createdBy: t.one.user({ from: t.event.createdByUserId, to: t.user.id }),
		/** The owning band, not the bill. Who played is `lineup`. */
		band: t.one.band({ from: t.event.bandId, to: t.band.id }),
		lineup: t.many.eventBand()
	},
	eventBand: {
		event: t.one.event({ from: t.eventBand.eventId, to: t.event.id }),
		band: t.one.band({ from: t.eventBand.bandId, to: t.band.id, alias: 'eventBand_band' }),
		addedByBand: t.one.band({
			from: t.eventBand.addedByBandId,
			to: t.band.id,
			alias: 'eventBand_addedBy'
		})
	},
	// Two FKs to user (the member, and the staffer who last changed it), so both
	// need an alias to say which one they follow. One entry covers every scope —
	// this replaced communityEventStanding, suggestionStanding and
	// messagingStanding, which had this same shape three times.
	memberStanding: {
		user: t.one.user({
			from: t.memberStanding.userId,
			to: t.user.id,
			alias: 'memberStanding_user'
		}),
		updatedBy: t.one.user({
			from: t.memberStanding.updatedByUserId,
			to: t.user.id,
			alias: 'memberStanding_updatedBy'
		}),
		triggeringFlag: t.one.contentFlag({
			from: t.memberStanding.triggeringFlagId,
			to: t.contentFlag.id
		})
	},
	// Two FKs to user (blocker and blocked), so both need an alias.
	userBlock: {
		blocker: t.one.user({
			from: t.userBlock.blockerUserId,
			to: t.user.id,
			alias: 'userBlock_blocker'
		}),
		blocked: t.one.user({
			from: t.userBlock.blockedUserId,
			to: t.user.id,
			alias: 'userBlock_blocked'
		})
	},
	equipmentCategory: {
		equipment: t.many.equipment()
	},
	equipment: {
		category: t.one.equipmentCategory({ from: t.equipment.categoryId, to: t.equipmentCategory.id }),
		loans: t.many.equipmentLoan()
	},
	equipmentLoan: {
		equipment: t.one.equipment({ from: t.equipmentLoan.equipmentId, to: t.equipment.id }),
		user: t.one.user({ from: t.equipmentLoan.userId, to: t.user.id })
	},
	ticket: {
		event: t.one.event({ from: t.ticket.eventId, to: t.event.id }),
		user: t.one.user({ from: t.ticket.userId, to: t.user.id }),
		checkedInBy: t.one.user({ from: t.ticket.checkedInByUserId, to: t.user.id })
	},
	eventRsvp: {
		event: t.one.event({ from: t.eventRsvp.eventId, to: t.event.id }),
		user: t.one.user({ from: t.eventRsvp.userId, to: t.user.id })
	},
	paymentCache: {
		user: t.one.user({ from: t.paymentCache.userId, to: t.user.id }),
		reservation: t.one.reservation({ from: t.paymentCache.reservationId, to: t.reservation.id })
	},
	creditTransaction: {
		user: t.one.user({ from: t.creditTransaction.userId, to: t.user.id })
	},
	notification: {
		user: t.one.user({ from: t.notification.userId, to: t.user.id })
	},
	notificationPreference: {
		user: t.one.user({ from: t.notificationPreference.userId, to: t.user.id })
	},
	role: {
		users: t.many.modelHasRole(),
		permissions: t.many.roleHasPermission()
	},
	permission: {
		users: t.many.modelHasPermission(),
		roles: t.many.roleHasPermission()
	},
	modelHasRole: {
		role: t.one.role({ from: t.modelHasRole.roleId, to: t.role.id }),
		user: t.one.user({ from: t.modelHasRole.userId, to: t.user.id })
	},
	modelHasPermission: {
		permission: t.one.permission({ from: t.modelHasPermission.permissionId, to: t.permission.id }),
		user: t.one.user({ from: t.modelHasPermission.userId, to: t.user.id })
	},
	roleHasPermission: {
		permission: t.one.permission({ from: t.roleHasPermission.permissionId, to: t.permission.id }),
		role: t.one.role({ from: t.roleHasPermission.roleId, to: t.role.id })
	},
	subscriber: {
		user: t.one.user({ from: t.subscriber.userId, to: t.user.id }),
		audienceMembers: t.many.audienceMember()
	},
	audience: {
		members: t.many.audienceMember(),
		campaigns: t.many.campaignAudience()
	},
	audienceMember: {
		subscriber: t.one.subscriber({ from: t.audienceMember.subscriberId, to: t.subscriber.id }),
		audience: t.one.audience({ from: t.audienceMember.audienceId, to: t.audience.id })
	},
	campaign: {
		sentBy: t.one.user({ from: t.campaign.sentById, to: t.user.id }),
		audiences: t.many.campaignAudience()
	},
	campaignAudience: {
		campaign: t.one.campaign({ from: t.campaignAudience.campaignId, to: t.campaign.id }),
		audience: t.one.audience({ from: t.campaignAudience.audienceId, to: t.audience.id })
	},
	contentFlag: {
		reportedBy: t.one.user({ from: t.contentFlag.reportedByUserId, to: t.user.id }),
		resolvedBy: t.one.user({ from: t.contentFlag.resolvedByUserId, to: t.user.id })
	},
	// Forward-only, like contentFlag above: `suggestion` points at `user` five
	// times, and a reverse t.many.suggestion() on the user block would need a
	// matching alias on both sides to say which FK it follows. No self-relation
	// for mergedIntoId either — the service aliases the table explicitly.
	suggestion: {
		author: t.one.user({ from: t.suggestion.authorUserId, to: t.user.id }),
		respondedBy: t.one.user({ from: t.suggestion.responseByUserId, to: t.user.id }),
		votes: t.many.suggestionVote(),
		edits: t.many.suggestionEdit()
	},
	suggestionVote: {
		suggestion: t.one.suggestion({ from: t.suggestionVote.suggestionId, to: t.suggestion.id }),
		user: t.one.user({ from: t.suggestionVote.userId, to: t.user.id })
	},
	suggestionEdit: {
		suggestion: t.one.suggestion({ from: t.suggestionEdit.suggestionId, to: t.suggestion.id }),
		requestedBy: t.one.user({ from: t.suggestionEdit.requestedByUserId, to: t.user.id })
	},
	helpCategory: {
		articles: t.many.helpArticle()
	},
	helpArticle: {
		category: t.one.helpCategory({ from: t.helpArticle.categoryId, to: t.helpCategory.id }),
		createdBy: t.one.user({ from: t.helpArticle.createdByUserId, to: t.user.id })
	},
	platformInvite: {
		band: t.one.band({ from: t.platformInvite.bandId, to: t.band.id }),
		invitedBy: t.one.user({ from: t.platformInvite.invitedById, to: t.user.id })
	},
	inboxThread: {
		messages: t.many.inboxMessage(),
		notes: t.many.inboxNote(),
		participants: t.many.inboxParticipant(),
		assignedTo: t.one.user({ from: t.inboxThread.assignedToUserId, to: t.user.id })
	},
	inboxParticipant: {
		thread: t.one.inboxThread({ from: t.inboxParticipant.threadId, to: t.inboxThread.id }),
		user: t.one.user({ from: t.inboxParticipant.userId, to: t.user.id })
	},
	inboxMessage: {
		thread: t.one.inboxThread({ from: t.inboxMessage.threadId, to: t.inboxThread.id }),
		author: t.one.user({ from: t.inboxMessage.authorUserId, to: t.user.id })
	},
	inboxNote: {
		thread: t.one.inboxThread({ from: t.inboxNote.threadId, to: t.inboxThread.id }),
		author: t.one.user({ from: t.inboxNote.authorUserId, to: t.user.id })
	},
	volunteerRole: {
		hourLogs: t.many.volunteerHourLog(),
		interests: t.many.volunteerRoleInterest(),
		shifts: t.many.volunteerShift(),
		requiredCertifications: t.many.volunteerRoleCertification()
	},
	volunteerRoleInterest: {
		user: t.one.user({ from: t.volunteerRoleInterest.userId, to: t.user.id }),
		role: t.one.volunteerRole({
			from: t.volunteerRoleInterest.volunteerRoleId,
			to: t.volunteerRole.id
		})
	},
	volunteerShift: {
		role: t.one.volunteerRole({
			from: t.volunteerShift.volunteerRoleId,
			to: t.volunteerRole.id
		}),
		event: t.one.event({ from: t.volunteerShift.eventId, to: t.event.id }),
		signups: t.many.volunteerSignup()
	},
	volunteerSignup: {
		shift: t.one.volunteerShift({ from: t.volunteerSignup.shiftId, to: t.volunteerShift.id }),
		user: t.one.user({ from: t.volunteerSignup.userId, to: t.user.id }),
		feedback: t.one.volunteerShiftFeedback({
			from: t.volunteerSignup.id,
			to: t.volunteerShiftFeedback.signupId
		})
	},
	volunteerShiftFeedback: {
		signup: t.one.volunteerSignup({
			from: t.volunteerShiftFeedback.signupId,
			to: t.volunteerSignup.id
		})
	},
	volunteerCertification: {
		holders: t.many.memberCertification(),
		roles: t.many.volunteerRoleCertification()
	},
	memberCertification: {
		user: t.one.user({ from: t.memberCertification.userId, to: t.user.id }),
		certification: t.one.volunteerCertification({
			from: t.memberCertification.certificationId,
			to: t.volunteerCertification.id
		}),
		grantedBy: t.one.user({ from: t.memberCertification.grantedByUserId, to: t.user.id }),
		revokedBy: t.one.user({ from: t.memberCertification.revokedByUserId, to: t.user.id })
	},
	volunteerRoleCertification: {
		role: t.one.volunteerRole({
			from: t.volunteerRoleCertification.volunteerRoleId,
			to: t.volunteerRole.id
		}),
		certification: t.one.volunteerCertification({
			from: t.volunteerRoleCertification.certificationId,
			to: t.volunteerCertification.id
		})
	},
	volunteerHourLog: {
		user: t.one.user({ from: t.volunteerHourLog.userId, to: t.user.id }),
		reviewedBy: t.one.user({ from: t.volunteerHourLog.reviewedByUserId, to: t.user.id }),
		role: t.one.volunteerRole({
			from: t.volunteerHourLog.volunteerRoleId,
			to: t.volunteerRole.id
		})
	}
}));
