-- ============================================
-- VCC Directory - D1 Schema (Final Version)
-- ============================================

-- 平台表 (Provider - Core Entity)
CREATE TABLE IF NOT EXISTS vcc_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  website TEXT,
  founded_date TEXT,           -- 建立日期
  apply_method TEXT,           -- 开户途径
  desc_zh TEXT,
  desc_en TEXT,
  need_kyc INTEGER DEFAULT 0,  -- 0=No, 1=Yes
  region TEXT,
  status TEXT DEFAULT 'active', -- active / inactive
  logo_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 卡段表 (Card/BIN - Subordinate to Provider)
CREATE TABLE IF NOT EXISTS vcc_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,
  bin TEXT NOT NULL,
  card_type TEXT NOT NULL,       -- Visa / Mastercard
  currency TEXT DEFAULT 'USD',
  issuance_fee REAL DEFAULT 0,   -- 开卡费
  fee_rate REAL DEFAULT 0,       -- 手续费率 (%)
  monthly_fee REAL DEFAULT 0,    -- 月费
  initial_load REAL DEFAULT 0,   -- 起充额度
  quota TEXT,
  usage TEXT,
  description TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (provider_id) REFERENCES vcc_providers(id) ON DELETE CASCADE
);

-- 标签表 (Tags - Bilingual)
CREATE TABLE IF NOT EXISTS vcc_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  category TEXT
);

-- 平台-标签关联表
CREATE TABLE IF NOT EXISTS vcc_provider_tags (
  provider_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (provider_id, tag_id),
  FOREIGN KEY (provider_id) REFERENCES vcc_providers(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES vcc_tags(id) ON DELETE CASCADE
);

-- 管理员表
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- Seed Data: Tags
-- ============================================
INSERT OR IGNORE INTO vcc_tags (id, name_zh, name_en, category) VALUES
  (1, '支持加密货币充值', 'Crypto Top-up', 'payment'),
  (2, '支持支付宝充值', 'Alipay Top-up', 'payment'),
  (3, '无需KYC', 'No KYC Required', 'compliance'),
  (4, '需要KYC', 'KYC Required', 'compliance'),
  (5, '支持多币种', 'Multi-Currency', 'feature'),
  (6, '即时发卡', 'Instant Issuance', 'feature'),
  (7, '企业账户', 'Business Account', 'type'),
  (8, '个人账户', 'Personal Account', 'type'),
  (9, '支持USDT', 'USDT Supported', 'payment'),
  (10, '低手续费', 'Low Fees', 'feature');

-- ============================================
-- Seed Data: Sample Provider
-- ============================================
INSERT OR IGNORE INTO vcc_providers (id, name_zh, name_en, website, founded_date, apply_method, desc_zh, desc_en, need_kyc, region, status) VALUES
  (1, 'FomePay', 'FomePay', 'https://www.fomepay.com', '2020-01', '官网注册 / Website Registration', '全球虚拟信用卡平台，支持加密货币充值，快速发卡。', 'Global virtual credit card platform with crypto top-up and instant card issuance.', 0, 'Global', 'active'),
  (2, 'DuPay', 'DuPay', 'https://www.dupay.one', '2022-06', 'App注册 / App Registration', '支持USDT充值的虚拟卡平台，提供Visa和Mastercard卡段。', 'Virtual card platform supporting USDT top-up, offering Visa and Mastercard BINs.', 1, 'Global', 'active'),
  (3, 'OneKey Card', 'OneKey Card', 'https://card.onekey.so', '2023-01', '官网注册 / Website Registration', '硬件钱包品牌推出的虚拟卡服务，安全性高。', 'Virtual card service by hardware wallet brand, high security.', 1, 'Global', 'active');

-- Seed Data: Sample Cards (BINs)
INSERT OR IGNORE INTO vcc_cards (id, provider_id, bin, card_type, currency, issuance_fee, fee_rate, monthly_fee, initial_load, quota, usage, description, status) VALUES
  (1, 1, '556150', 'Mastercard', 'USD', 10.00, 1.5, 0.00, 20.00, '单笔$5000', '电商/广告/订阅', 'FomePay经典卡段', 'active'),
  (2, 1, '404038', 'Visa', 'USD', 15.00, 2.0, 1.00, 50.00, '单笔$10000', '全场景', 'FomePay高额卡段', 'active'),
  (3, 2, '531993', 'Mastercard', 'USD', 0.00, 1.2, 1.00, 5.00, '单笔$3000', '日常消费', 'DuPay标准卡', 'active'),
  (4, 2, '559666', 'Mastercard', 'USD', 10.00, 0.8, 2.00, 100.00, '单笔$50000', '大额消费', 'DuPay高级卡', 'active'),
  (5, 3, '556766', 'Visa', 'USD', 2.00, 1.0, 0.00, 10.00, '单笔$5000', '线上消费', 'OneKey基础卡', 'active');

-- Seed Data: Provider-Tag Associations
INSERT OR IGNORE INTO vcc_provider_tags (provider_id, tag_id) VALUES
  (1, 1), (1, 3), (1, 6), (1, 8),
  (2, 1), (2, 4), (2, 5), (2, 9),
  (3, 1), (3, 4), (3, 6);

-- ============================================
-- Initial Admin User
-- Password: admin123 (SHA-256 hash)
-- IMPORTANT: Change this password after first login!
-- To generate a new hash: echo -n "yourpassword" | sha256sum
-- ============================================
INSERT OR IGNORE INTO admin_users (id, username, password_hash) VALUES
  (1, 'admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9');
