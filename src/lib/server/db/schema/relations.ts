import { defineRelations } from 'drizzle-orm';
import * as schema from './index';

export const relations = defineRelations(schema, (t) => ({
	user: {
		directoryEntry: t.one.directoryEntry({ from: t.user.id, to: t.directoryEntry.userId }),
		sessions: t.many.session(),
		accounts: t.many.account(),
		groupMembers: t.many.groupMember(),
		media: t.many.mediaAttachment({
			from: t.user.id,
			to: t.mediaAttachment.attachableId,
			where: { attachableType: 'user' },
			alias: 'mediaAttachment_user'
		})
	},
	session: {
		user: t.one.user({ from: t.session.userId, to: t.user.id })
	},
	account: {
		user: t.one.user({ from: t.account.userId, to: t.user.id })
	},
	group: {
		site: t.one.bandSite({ from: t.group.id, to: t.bandSite.groupId }),
		media: t.many.mediaAttachment({
			from: t.group.id,
			to: t.mediaAttachment.attachableId,
			where: { attachableType: 'group' },
			alias: 'mediaAttachment_group'
		}),
		directoryEntry: t.one.directoryEntry({ from: t.group.id, to: t.directoryEntry.groupId }),
		members: t.many.groupMember(),
		files: t.many.file(),
		rider: t.one.rider({ from: t.group.id, to: t.rider.groupId }),
		packingList: t.one.packingList({ from: t.group.id, to: t.packingList.groupId }),
		/** Events this band OWNS. Shows it merely played are `lineups`. */
		events: t.many.event(),
		// No `lineups` here any more. A credit names a `directory_entry`, so a
		// group's credits are two hops away (group → its entry → its credits) and
		// the relations API expresses one. `confirmedForBand()` in
		// `event-service.ts` is the query that answers this, and it is the single
		// definition of "shows on this band's profile".
		creditsAdded: t.many.eventBand({
			from: t.group.id,
			to: t.eventBand.addedByGroupId,
			alias: 'eventBand_addedBy'
		})
	},
	bandSite: {
		group: t.one.group({ from: t.bandSite.groupId, to: t.group.id })
	},
	directoryEntry: {
		user: t.one.user({ from: t.directoryEntry.userId, to: t.user.id }),
		group: t.one.group({ from: t.directoryEntry.groupId, to: t.group.id }),
		tags: t.many.directoryTag()
	},
	directoryTag: {
		entry: t.one.directoryEntry({ from: t.directoryTag.entryId, to: t.directoryEntry.id })
	},
	groupMember: {
		band: t.one.group({ from: t.groupMember.groupId, to: t.group.id }),
		user: t.one.user({ from: t.groupMember.userId, to: t.user.id })
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
		group: t.one.group({ from: t.event.groupId, to: t.group.id }),
		project: t.one.project({ from: t.event.projectId, to: t.project.id }),
		lineup: t.many.eventBand(),
		media: t.many.mediaAttachment({
			from: t.event.id,
			to: t.mediaAttachment.attachableId,
			where: { attachableType: 'event' },
			alias: 'mediaAttachment_event'
		})
	},
	eventBand: {
		event: t.one.event({ from: t.eventBand.eventId, to: t.event.id }),
		/** The party credited — a member, a CMC band, or an external act. */
		entry: t.one.directoryEntry({
			from: t.eventBand.directoryEntryId,
			to: t.directoryEntry.id,
			alias: 'eventBand_entry'
		}),
		addedByGroup: t.one.group({
			from: t.eventBand.addedByGroupId,
			to: t.group.id,
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
		items: t.many.inventoryItem()
	},
	inventoryLocation: {
		assets: t.many.inventoryAsset()
	},
	inventoryItem: {
		category: t.one.equipmentCategory({
			from: t.inventoryItem.categoryId,
			to: t.equipmentCategory.id
		}),
		assets: t.many.inventoryAsset(),
		movements: t.many.stockMovement(),
		loans: t.many.inventoryLoan()
	},
	inventoryAsset: {
		item: t.one.inventoryItem({ from: t.inventoryAsset.itemId, to: t.inventoryItem.id }),
		location: t.one.inventoryLocation({
			from: t.inventoryAsset.locationId,
			to: t.inventoryLocation.id
		}),
		movements: t.many.stockMovement(),
		loans: t.many.inventoryLoan(),
		// Flags hang off the unit, not the catalog entry: "this amp hums" is about
		// one amp, the way a damage photo is.
		flags: t.many.workRequest()
	},
	stockMovement: {
		item: t.one.inventoryItem({ from: t.stockMovement.itemId, to: t.inventoryItem.id }),
		asset: t.one.inventoryAsset({ from: t.stockMovement.assetId, to: t.inventoryAsset.id }),
		actor: t.one.user({ from: t.stockMovement.actorId, to: t.user.id })
	},
	acquisition: {
		lines: t.many.acquisitionLine(),
		project: t.one.project({ from: t.acquisition.projectId, to: t.project.id }),
		donor: t.one.user({
			from: t.acquisition.donorUserId,
			to: t.user.id,
			alias: 'acquisition_donor'
		}),
		recordedBy: t.one.user({
			from: t.acquisition.recordedByUserId,
			to: t.user.id,
			alias: 'acquisition_recordedBy'
		})
	},
	acquisitionLine: {
		acquisition: t.one.acquisition({
			from: t.acquisitionLine.acquisitionId,
			to: t.acquisition.id
		}),
		item: t.one.inventoryItem({ from: t.acquisitionLine.itemId, to: t.inventoryItem.id })
	},
	inventoryLoan: {
		item: t.one.inventoryItem({ from: t.inventoryLoan.itemId, to: t.inventoryItem.id }),
		asset: t.one.inventoryAsset({ from: t.inventoryLoan.assetId, to: t.inventoryAsset.id }),
		user: t.one.user({ from: t.inventoryLoan.userId, to: t.user.id }),
		// Flags raised when this loan came back.
		flags: t.many.workRequest()
	},
	workRequest: {
		asset: t.one.inventoryAsset({ from: t.workRequest.assetId, to: t.inventoryAsset.id }),
		reportedBy: t.one.user({ from: t.workRequest.reportedByUserId, to: t.user.id }),
		resolvedBy: t.one.user({ from: t.workRequest.resolvedByUserId, to: t.user.id }),
		loan: t.one.inventoryLoan({ from: t.workRequest.loanId, to: t.inventoryLoan.id })
		// No `workOrder` relation: `workOrderId` carries no FK, so that the
		// inventory and volunteer schema modules do not import each other. The
		// service joins it explicitly.
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
		edits: t.many.suggestionEdit(),
		/** The work that answers it, once staff commit. At most one. */
		project: t.one.project({ from: t.suggestion.id, to: t.project.suggestionId })
	},
	contractorJob: {
		contractor: t.one.contractor({ from: t.contractorJob.contractorId, to: t.contractor.id }),
		asset: t.one.inventoryAsset({ from: t.contractorJob.assetId, to: t.inventoryAsset.id }),
		project: t.one.project({ from: t.contractorJob.projectId, to: t.project.id }),
		requestedBy: t.one.user({ from: t.contractorJob.requestedByUserId, to: t.user.id })
	},
	purchaseOrder: {
		// No `lines` arm: `purchase_order_line` has no block of its own, and adding
		// one is unrelated to this change. The service joins lines explicitly.
		project: t.one.project({ from: t.purchaseOrder.projectId, to: t.project.id }),
		createdBy: t.one.user({ from: t.purchaseOrder.createdByUserId, to: t.user.id })
	},
	project: {
		/** The owning committee — a `group` with `kind = 'committee'`. */
		group: t.one.group({ from: t.project.groupId, to: t.group.id }),
		suggestion: t.one.suggestion({ from: t.project.suggestionId, to: t.suggestion.id }),
		createdBy: t.one.user({ from: t.project.createdByUserId, to: t.user.id }),
		// The four ledgers burn is summed over, plus the events. No `stockMovement`
		// arm: consumption reaches a project through the item it moved, not
		// directly, and `project-service.ts` joins it explicitly.
		workOrders: t.many.workOrder(),
		contractorJobs: t.many.contractorJob(),
		purchaseOrders: t.many.purchaseOrder(),
		acquisitions: t.many.acquisition(),
		events: t.many.event()
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
	groupInvite: {
		group: t.one.group({ from: t.groupInvite.groupId, to: t.group.id }),
		invitedBy: t.one.user({ from: t.groupInvite.invitedById, to: t.user.id })
	},
	announcement: {
		group: t.one.group({ from: t.announcement.groupId, to: t.group.id }),
		author: t.one.user({ from: t.announcement.authorId, to: t.user.id })
	},
	file: {
		group: t.one.group({ from: t.file.groupId, to: t.group.id }),
		uploadedBy: t.one.user({ from: t.file.uploadedById, to: t.user.id })
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
		shifts: t.many.workOrder(),
		requiredCertifications: t.many.volunteerRoleCertification()
	},
	volunteerRoleInterest: {
		user: t.one.user({ from: t.volunteerRoleInterest.userId, to: t.user.id }),
		role: t.one.volunteerRole({
			from: t.volunteerRoleInterest.volunteerRoleId,
			to: t.volunteerRole.id
		})
	},
	workOrder: {
		role: t.one.volunteerRole({
			from: t.workOrder.volunteerRoleId,
			to: t.volunteerRole.id
		}),
		event: t.one.event({ from: t.workOrder.eventId, to: t.event.id }),
		asset: t.one.inventoryAsset({ from: t.workOrder.assetId, to: t.inventoryAsset.id }),
		project: t.one.project({ from: t.workOrder.projectId, to: t.project.id }),
		resolvedBy: t.one.user({
			from: t.workOrder.resolvedByUserId,
			to: t.user.id
		}),
		signups: t.many.volunteerSignup()
	},
	volunteerSignup: {
		shift: t.one.workOrder({ from: t.volunteerSignup.shiftId, to: t.workOrder.id }),
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
	},
	media: {
		attachments: t.many.mediaAttachment()
	},
	mediaAttachment: {
		media: t.one.media({ from: t.mediaAttachment.mediaId, to: t.media.id })
	},
	// Three FKs to user across the rider tables — the tech contact, whoever last
	// confirmed it, and the owner of an element — so each needs an alias saying
	// which one it follows.
	rider: {
		group: t.one.group({ from: t.rider.groupId, to: t.group.id }),
		techContact: t.one.user({
			from: t.rider.techContactUserId,
			to: t.user.id,
			alias: 'rider_techContact'
		}),
		confirmedBy: t.one.user({
			from: t.rider.confirmedByUserId,
			to: t.user.id,
			alias: 'rider_confirmedBy'
		}),
		elements: t.many.riderElement()
	},
	riderElement: {
		rider: t.one.rider({ from: t.riderElement.riderId, to: t.rider.id }),
		/** Whose gear this is. Null is the band's own. */
		user: t.one.user({
			from: t.riderElement.userId,
			to: t.user.id,
			alias: 'riderElement_user'
		}),
		inputs: t.many.riderInput()
	},
	riderInput: {
		element: t.one.riderElement({ from: t.riderInput.elementId, to: t.riderElement.id }),
		monitorMixUser: t.one.user({
			from: t.riderInput.monitorMixUserId,
			to: t.user.id,
			alias: 'riderInput_monitorMixUser'
		})
	},
	packingList: {
		group: t.one.group({ from: t.packingList.groupId, to: t.group.id }),
		lastResetBy: t.one.user({
			from: t.packingList.lastResetByUserId,
			to: t.user.id,
			alias: 'packingList_lastResetBy'
		}),
		items: t.many.packingItem()
	},
	// Four FKs to user on one row — whose it is, who is bringing it, who put it
	// on them, and who ticked it — so every one needs an alias saying which it
	// follows. `user` and `assignedUser` are the pair that must never be
	// conflated: see the table comment in `packing.ts`.
	packingItem: {
		list: t.one.packingList({ from: t.packingItem.listId, to: t.packingList.id }),
		/** Whose gear this is. Null is the band's own. */
		user: t.one.user({ from: t.packingItem.userId, to: t.user.id, alias: 'packingItem_user' }),
		/** Who is carrying it. Null is "nobody has this". */
		assignedUser: t.one.user({
			from: t.packingItem.assignedUserId,
			to: t.user.id,
			alias: 'packingItem_assignedUser'
		}),
		assignedBy: t.one.user({
			from: t.packingItem.assignedByUserId,
			to: t.user.id,
			alias: 'packingItem_assignedBy'
		}),
		packedBy: t.one.user({
			from: t.packingItem.packedByUserId,
			to: t.user.id,
			alias: 'packingItem_packedBy'
		})
	}
}));
