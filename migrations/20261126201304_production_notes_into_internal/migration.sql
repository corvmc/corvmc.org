-- Billing and hospitality notes leave the Production tab (#3272): their text moves
-- into internal notes, labelled, so nothing a producer wrote is hidden. The columns stay.
UPDATE `production` SET `internal_notes` = trim(
	coalesce(`internal_notes`, '')
	|| CASE WHEN coalesce(`billing_notes`, '') <> '' THEN char(10) || 'Billing: ' || `billing_notes` ELSE '' END
	|| CASE WHEN coalesce(`hospitality_notes`, '') <> '' THEN char(10) || 'Hospitality: ' || `hospitality_notes` ELSE '' END,
	char(10)
)
WHERE coalesce(`billing_notes`, '') <> '' OR coalesce(`hospitality_notes`, '') <> '';
