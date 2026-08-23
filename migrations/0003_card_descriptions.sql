-- Bilingual card descriptions and a real updated_at for card sorting.
-- The legacy `description` column is kept for backward compatibility.

ALTER TABLE vcc_cards ADD COLUMN description_zh TEXT;
ALTER TABLE vcc_cards ADD COLUMN description_en TEXT;
ALTER TABLE vcc_cards ADD COLUMN updated_at TEXT;

-- Seed the English column from the legacy column where it is still empty.
UPDATE vcc_cards
SET description_en = description
WHERE description_en IS NULL OR trim(description_en) = '';

-- Give existing rows a baseline so "ORDER BY updated_at DESC" is meaningful.
UPDATE vcc_cards
SET updated_at = created_at
WHERE updated_at IS NULL;
