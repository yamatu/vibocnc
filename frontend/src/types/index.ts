// API Response Types
export interface APIResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export interface PaginationResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

// User and Authentication Types
export interface AdminUser {
  id: number;
  username: string;
  email: string;
  full_name: string;
  role: 'admin' | 'editor' | 'viewer';
  is_active: boolean;
  last_login?: string;
  created_at: string;
  updated_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AdminUser;
  expires_at: string;
}

export interface AdminUserCreateRequest {
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'editor' | 'viewer';
  is_active: boolean;
}

export interface AdminUserUpdateRequest {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'editor' | 'viewer';
  is_active: boolean;
  password?: string;
}

// Product Types
export interface Product {
  id: number;
  sku: string;
  name: string;
  slug: string;
  short_description: string;
  description: string;
  price: number;
  compare_price?: number;
  cost_price?: number;
  stock_quantity: number;
  min_stock_level: number;
  weight?: number;
  dimensions: string;
  brand: string;
  model: string;
  part_number: string;
  category_id: number;
  category: Category;
  is_active: boolean;
  is_featured: boolean;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  disable_auto_seo?: boolean;
  ai_seo_status?: '' | 'optimized' | 'running' | 'failed';
  ai_seo_optimized_at?: string;
  ai_seo_optimization_job_id?: string;
  image_urls: string[];
  // Enhanced fields
  warranty_period?: string;
  condition_type?: 'new' | 'refurbished' | 'used';
  origin_country?: string;
  manufacturer?: string;
  lead_time?: string;
  minimum_order_quantity?: number;
  packaging_info?: string;
  certifications?: string;
  technical_specs?: string;
  specifications?: Record<string, string> | string;
  compatibility_info?: string;
  installation_guide?: string;
  maintenance_tips?: string;
  datasheet_url?: string;
  manual_url?: string;
  video_urls?: string;
  view_count?: number;
  seo_score?: number;
  created_at: string;
  updated_at: string;
  images?: ProductImage[];
  attributes?: ProductAttribute[];
  translations?: ProductTranslation[];
  purchase_links?: PurchaseLink[];
  reviews?: ProductReview[];
  faqs?: ProductFAQ[];
  tags?: ProductTag[];
}

export interface ProductImage {
  id: number;
  product_id: number;
  url: string;
  alt_text: string;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductAttribute {
  id: number;
  product_id: number;
  attribute_name: string;
  attribute_value: string;
  sort_order: number;
  created_at: string;
}

export interface ProductTranslation {
  id: number;
  product_id: number;
  language_code: string;
  name: string;
  slug: string;
  short_description: string;
  description: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  created_at: string;
  updated_at: string;
}

export interface PurchaseLink {
  id: number;
  product_id: number;
  platform: string;
  url: string;
  price?: number;
  currency: string;
  is_active: boolean;
  sort_order: number;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ProductReview {
  id: number;
  product_id: number;
  customer_name: string;
  customer_email?: string;
  rating: number;
  review_title: string;
  review_content: string;
  is_verified: boolean;
  is_approved: boolean;
  helpful_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProductFAQ {
  id: number;
  product_id: number;
  question: string;
  answer: string;
  is_active: boolean;
  sort_order: number;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProductTag {
  id: number;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EbayImportDraftListItem {
  id: number;
  source_site: string;
  source_url: string;
  title_raw: string;
  normalized_title: string;
  normalized_brand: string;
  normalized_model: string;
  normalized_part_number: string;
  normalized_mpn: string;
  normalized_price: number;
  suggested_category_id?: number;
  suggested_category_name: string;
  suggested_part_type: string;
  taxonomy_status: string;
  match_status: string;
  match_score: number;
  match_reason: string;
  import_action: string;
  status: string;
  review_note: string;
  failure_reason: string;
  imported_product_id?: number;
  confirmed_at?: string;
  imported_at?: string;
  created_at: string;
  updated_at: string;
  matched_product?: {
    id: number;
    sku: string;
    name: string;
    slug: string;
    category_id: number;
  };
  suggested_category?: {
    id: number;
    name: string;
    slug: string;
  };
}

export interface EbayImportDraftListResponse {
  items: EbayImportDraftListItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface MediaAssetSummary {
  id: number;
  original_name: string;
  file_name: string;
  relative_path: string;
  url: string;
  sha256: string;
  mime_type: string;
  size_bytes: number;
  title: string;
  alt_text: string;
  folder: string;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface EbayImportDraftDetail {
  id: number;
  source_type: string;
  source_site: string;
  source_url: string;
  ebay_item_id: string;
  listing_id: string;
  raw_payload: Record<string, unknown>;
  title_raw: string;
  description_raw: string;
  price_raw: string;
  currency_raw: string;
  normalized_title: string;
  normalized_brand: string;
  normalized_model: string;
  normalized_part_number: string;
  normalized_mpn: string;
  normalized_price: number;
  suggested_category_id?: number;
  suggested_category_name: string;
  suggested_part_type: string;
  taxonomy_status: string;
  match_status: string;
  matched_product_id?: number;
  match_score: number;
  match_reason: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  disable_auto_seo: boolean;
  main_image_source_url: string;
  image_source_urls: string[];
  media_asset_ids: number[];
  media_assets: MediaAssetSummary[];
  import_action: string;
  status: string;
  review_note: string;
  failure_reason: string;
  imported_product_id?: number;
  confirmed_by?: number;
  confirmed_at?: string;
  imported_at?: string;
  created_at: string;
  updated_at: string;
  matched_product?: Product;
  suggested_category?: Category;
}

export interface EbayImportDraftUpdateRequest {
  normalized_title?: string;
  normalized_brand?: string;
  normalized_model?: string;
  normalized_part_number?: string;
  normalized_mpn?: string;
  normalized_price?: number;
  suggested_category_id?: number;
  import_action?: string;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  disable_auto_seo?: boolean;
  review_note?: string;
  status?: string;
}

export interface EbayBulkConfirmItemResult {
  id: number;
  success: boolean;
  skipped?: boolean;
  status_code: number;
  error?: string;
}

export interface EbayBulkConfirmTaskSnapshot {
  id: string;
  status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed';
  total: number;
  processed: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  duplicate_count: number;
  needs_review_count: number;
  already_processed_count: number;
  missing_identifier_count: number;
  progress_pct: number;
  message?: string;
  current_id?: number;
  results?: EbayBulkConfirmItemResult[];
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

// Category Types
export interface Category {
  id: number;
  name: string;
  slug: string;
  // Computed full path for nested categories, e.g. "fanuc-controls/fanuc-power-mate".
  // Present on tree/list endpoints.
  path?: string;
  description: string;
  image_url: string;
  parent_id?: number | null;
  parent?: Category;
  children?: Category[];
  sort_order: number;
  is_active: boolean;
  // Active products in this category and all descendants. Present on the
  // public tree endpoint.
  product_count?: number;
  created_at: string;
  updated_at: string;
  products?: Product[];
  translations?: CategoryTranslation[];
}

// Lightweight shape used by public category navigation. Keeping this
// separate from Category prevents admin/database fields from being serialized
// into the large categories directory page.
export interface CategoryNavigationNode {
  id: number;
  name: string;
  slug: string;
  path?: string;
  sort_order?: number;
  product_count?: number;
  children?: CategoryNavigationNode[];
}

export interface CategoryTranslation {
  id: number;
  category_id: number;
  language_code: string;
  name: string;
  slug: string;
  description: string;
  created_at: string;
  updated_at: string;
}

// Order Types
export interface Order {
  id: number;
  order_number: string;
  user_id?: number;
  user?: AdminUser;
  customer_email: string;
  customer_name: string;
  customer_phone: string;
  shipping_address: string;
  billing_address: string;
  status: string;
  payment_status: string;
  payment_method: string;
  payment_id: string;
  refunded_amount?: number;
  refunded_at?: string;
  stock_restored_at?: string;

  tracking_number?: string;
  shipping_carrier?: string;
  shipping_country?: string;
  shipping_fee?: number;
  shipped_at?: string;
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
  coupon_code?: string;
  coupon_id?: number;
  coupon?: Coupon;
  currency: string;
  notes: string;
  items?: OrderItem[];
  refunds?: Refund[];
  created_at: string;
  updated_at: string;
}

export interface Refund {
  id: number;
  order_id: number;
  provider_refund_id?: string;
  capture_id: string;
  amount: number;
  currency: string;
  reason?: string;
  status: string;
  requested_by?: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  order?: Order;
  product_id: number;
  product?: Product;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentTransaction {
  id: number;
  order_id: number;
  order?: Order;
  transaction_id: string;
  payment_method: string;
  amount: number;
  currency: string;
  status: string;
  payer_id: string;
  payer_email: string;
  payment_data: string;
  created_at: string;
  updated_at: string;
}

// Banner Types
export interface Banner {
  id: number;
  title: string;
  subtitle: string;
  image_url: string;
  link_url: string;
  content_type: string;
  category_key: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Homepage Content Types
export interface HomepageContent {
  id: number;
  section_key: string;
  title: string;
  subtitle: string;
  description: string;
  image_url: string;
  button_text: string;
  button_url: string;
  // Optional structured config (slides/stats/services/etc)
  data?: unknown;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Company Profile Types
export interface CompanyStats {
  icon: string;
  value: string;
  label: string;
  description: string;
}

export interface WorkshopFacility {
  id: string;
  title: string;
  description: string;
  image_url: string;
}

export interface CompanyProfile {
  id: number;
  company_name: string;
  company_subtitle: string;
  establishment_year: string;
  location: string;
  workshop_size: string;
  description_1: string;
  description_2: string;
  achievement: string;
  stats: CompanyStats[];
  expertise: string[];
  workshop_facilities: WorkshopFacility[];
  created_at: string;
  updated_at: string;
}

export interface SocialMediaSettings {
  id: number;
  x_url: string;
  facebook_url: string;
  instagram_url: string;
  linkedin_url: string;
  created_at?: string;
  updated_at?: string;
}

export type SocialMediaSettingsRequest = Pick<
  SocialMediaSettings,
  'x_url' | 'facebook_url' | 'instagram_url' | 'linkedin_url'
>;

// Image Request Type
export interface ImageReq {
  url: string;
  alt_text?: string;
  is_primary?: boolean;
  sort_order?: number;
  source?: 'media' | 'admin_external' | 'archive';
}

// Request Types
export interface ProductCreateRequest {
  sku: string;
  name: string;
  short_description: string;
  description: string;
  price: number;
  compare_price?: number;
  stock_quantity: number;
  weight?: number;
  dimensions: string;
  brand: string;
  model: string;
  part_number: string;
  warranty_period?: string;
  lead_time?: string;
  category_id: number;
  is_active: boolean;
  is_featured: boolean;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  disable_auto_seo?: boolean;
  images: ImageReq[];
  attributes: ProductAttributeReq[];
  translations: ProductTranslationReq[];
}

export interface ProductAttributeReq {
  attribute_name: string;
  attribute_value: string;
  sort_order: number;
}

export interface ProductTranslationReq {
  language_code: string;
  name: string;
  short_description: string;
  description: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
}

export interface CategoryCreateRequest {
  name: string;
  description: string;
  image_url: string;
  parent_id?: number | null;
  sort_order: number;
  is_active: boolean;
}

// Language Types
export interface Language {
  id: number;
  code: string;
  name: string;
  native_name: string;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  created_at: string;
}

// Cart Types (Frontend only)
export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  total: number;
}

// Coupon Types
export interface Coupon {
  id: number;
  code: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  min_order_amount: number;
  max_discount_amount?: number;
  usage_limit?: number;
  used_count: number;
  user_usage_limit?: number;
  is_active: boolean;
  starts_at?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CouponCreateRequest {
  code: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  min_order_amount?: number;
  max_discount_amount?: number;
  usage_limit?: number;
  user_usage_limit?: number;
  is_active?: boolean;
  starts_at?: string;
  expires_at?: string;
}

export interface CouponValidateRequest {
  code: string;
  order_amount: number;
  customer_email: string;
}

export interface CouponValidateResponse {
  valid: boolean;
  coupon_id?: number;
  code?: string;
  name?: string;
  type?: string;
  value?: number;
  discount_amount?: number;
  final_amount?: number;
  message: string;
}

export interface CouponUsage {
  id: number;
  coupon_id: number;
  coupon?: Coupon;
  order_id: number;
  customer_email: string;
  discount_amount: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// News / Articles
// ---------------------------------------------------------------------------

export interface Article {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  content_type: 'news' | 'blog';
  custom_path?: string;
  public_path?: string;
  featured_image: string;
  image_urls: string[] | string;
  is_published: boolean;
  is_featured: boolean;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  author_id: number;
  author?: AdminUser;
  view_count: number;
  sort_order: number;
  published_at?: string;
  created_at: string;
  updated_at: string;
  translations?: ArticleTranslation[];
}

export interface ArticleTranslation {
  id: number;
  article_id: number;
  language_code: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  created_at: string;
  updated_at: string;
}

export interface ArticleCreateRequest {
  title: string;
  slug?: string;
  custom_path?: string;
  summary?: string;
  content: string;
  content_type?: 'news' | 'blog';
  featured_image?: string;
  featured_media_id?: number;
  image_urls?: string[];
  gallery_media_ids?: number[];
  is_published: boolean;
  is_featured: boolean;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  sort_order?: number;
  translations?: ArticleTranslationReq[];
}

export interface SitePage {
  id: number;
  page_key: string;
  title: string;
  summary: string;
  content: string;
  meta_title: string;
  meta_description: string;
  meta_keywords: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export type SitePageRequest = Pick<SitePage, 'title' | 'summary' | 'content' | 'meta_title' | 'meta_description' | 'meta_keywords' | 'is_published'>;

export interface ArticleTranslationReq {
  language_code: string;
  title: string;
  slug?: string;
  summary?: string;
  content?: string;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
}

/**
 * Storefront commercial promise, editable in the admin panel under
 * Settings → Commerce Policy. It drives the visible shipping / warranty /
 * returns copy and the schema.org Offer (shippingDetails,
 * hasMerchantReturnPolicy).
 */
export interface CommercePolicySetting {
  id?: number;
  shipping_handling_time_text: string;
  shipping_handling_days_min: number;
  shipping_handling_days_max: number;
  shipping_transit_time_text: string;
  shipping_transit_days_min: number;
  shipping_transit_days_max: number;
  shipping_carriers: string;
  shipping_destination_countries: string;
  shipping_rate_amount: number;
  shipping_currency: string;
  shipping_notes: string;
  default_warranty_period: string;
  default_lead_time: string;
  return_window_days: number;
  return_window_text: string;
  return_shipping_payer: 'shared' | 'customer' | 'merchant' | string;
  return_policy_country: string;
  return_policy_notes: string;
  /** eBay market pricing is opt-in and always previewed before manual apply. */
  price_sync_enabled: boolean;
  price_sync_factor: number;
  price_sync_min_samples: number;
  price_sync_max_delta_pct: number;
  price_sync_round_to: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Model-number specification research (admin review queue).
 *
 * A draft is produced from public web evidence for one model number (型号). It is
 * never published automatically: every value carries the page it was copied from
 * and an administrator approves it explicitly.
 */
export interface SpecResearchCandidate {
  label: string;
  value: string;
  source_url?: string;
  source_title?: string;
  source_type?: string;
  evidence?: string;
  /** 'extracted' = pattern match, 'ai' = language model proposal that passed the verbatim check. */
  origin?: 'extracted' | 'ai' | string;
  /**
   * Other values found for the same parameter. A reviewer must pick one; the
   * pipeline never silently keeps the first hit.
   */
  alternatives?: string[];
  /** True when sources disagreed about this parameter. */
  conflict?: boolean;
}

export interface ProductWebEvidence {
  title: string;
  url: string;
  snippet: string;
  source_type?: string;
  evidence_level?: string;
}

export interface ProductSpecDraft {
  id: number;
  product_id: number;
  sku?: string;
  brand?: string;
  model: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded' | string;
  confidence?: 'high' | 'medium' | 'low' | string;
  specs_json?: string;
  candidates_json?: string;
  evidence_json?: string;
  notes?: string;
  job_id?: string;
  requested_by?: number;
  reviewed_by?: number;
  reviewed_at?: string | null;
  applied_at?: string | null;
  reject_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface ProductSpecDraftDetail {
  draft: ProductSpecDraft;
  candidates: SpecResearchCandidate[];
  confidence?: string;
  notes?: string;
  evidence: ProductWebEvidence[];
}

/**
 * Model-only research request. Catalogue products are researched through the AI
 * job queue (`SpecResearchJobRequest`) because a web lookup per product is far
 * too slow for a request/response cycle.
 */
export interface SpecResearchRequest {
  brand?: string;
  model?: string;
  sku?: string;
  use_ai?: boolean;
  force?: boolean;
}

/** Scope of a specification research job. Explicit ids win over filters. */
export interface SpecResearchJobRequest {
  product_ids?: number[];
  limit?: number;
  category_id?: number;
  include_descendants?: boolean;
  brand?: string;
  search?: string;
  include_inactive?: boolean;
  /** Skip products that already publish a specification table. */
  only_missing?: boolean;
  use_ai?: boolean;
  force?: boolean;
}

/** One completed job item: which draft to open and how much review it needs. */
export interface SpecResearchItemPayload {
  draft_id: number;
  candidates: number;
  confidence?: string;
  conflicts?: number;
  /** The run reused an existing pending draft instead of creating a new one. */
  reused?: boolean;
}

export interface SpecDraftApproveRequest {
  candidates?: SpecResearchCandidate[];
  overwrite?: boolean;
}
