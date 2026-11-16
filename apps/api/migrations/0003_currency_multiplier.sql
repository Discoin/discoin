ALTER TABLE currencies ADD COLUMN multiplier numeric(18, 2);

-- Existing currencies keep 4, the fixed multiplier they were created with, so their reserves and rates do not change.
UPDATE currencies SET multiplier = 4;

ALTER TABLE currencies
    ALTER COLUMN multiplier SET NOT NULL,
    ADD CONSTRAINT currencies_multiplier_positive CHECK (multiplier > 0);
