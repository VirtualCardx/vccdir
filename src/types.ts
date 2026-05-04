export type Lang = 'zh' | 'en';

export interface Provider {
  id: number;
  name_zh: string;
  name_en: string;
  website: string | null;
  founded_date: string | null;
  apply_method: string | null;
  desc_zh: string | null;
  desc_en: string | null;
  need_kyc: number;
  region: string | null;
  status: string;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: number;
  provider_id: number;
  bin: string;
  card_type: string;
  currency: string;
  issuance_fee: number;
  fee_rate: number;
  monthly_fee: number;
  initial_load: number;
  quota: string | null;
  usage: string | null;
  description: string | null;
  status: string;
  created_at: string;
}

export interface CardWithProvider extends Card {
  provider_name_zh: string;
  provider_name_en: string;
}

export interface Tag {
  id: number;
  name_zh: string;
  name_en: string;
  category: string | null;
}

export interface ProviderWithTags extends Provider {
  tags: Tag[];
  card_count: number;
}

export interface AdminUser {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
}
