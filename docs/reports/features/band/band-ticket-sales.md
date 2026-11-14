# Band ticket sales

Status: ✅ Band event page

`/band/[slug]/events/[eventId]` — a premium band with finished payouts puts its own gig on sale (suggested price, pay-what-you-can floor, capacity) and stops selling from the same card. Checkout is a destination charge to the band (`ticket-seller.ts`); the collective's share opens at 10% on the buyer's slider and may go to zero (#1470), and only its application fee reaches the ledger as `band_ticket_sales`. Cancelling the gig refunds every buyer, reversing both shares (#1472). Owner/admin only. Sale terms live on `ticket_sale`, not the listing (#1203)
