DROP TABLE IF EXISTS admin_users;

CREATE INDEX IF NOT EXISTS idx_providers_status_updated ON vcc_providers(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_cards_provider_status ON vcc_cards(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_provider_tags_tag ON vcc_provider_tags(tag_id, provider_id);
