ALTER TABLE vcc_cards ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_posts ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_posts ADD COLUMN featured_image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_cards_featured_status ON vcc_cards(is_featured, status, created_at);
CREATE INDEX IF NOT EXISTS idx_content_featured_published ON content_posts(is_featured, status, published_at);
