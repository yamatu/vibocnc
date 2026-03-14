// API Response Types
export interface APIResponse<T = any> {
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
  parent_id?: number;
  parent?: Category;
  children?: Category[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  products?: Product[];
  translations?: CategoryTranslation[];
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
  data?: any;
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

// Image Request Type
export interface ImageReq {
  url: string;
  alt_text?: string;
  is_primary?: boolean;
  sort_order?: number;
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
  parent_id?: number;
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
  summary?: string;
  content: string;
  featured_image?: string;
  image_urls?: string[];
  is_published: boolean;
  is_featured: boolean;
  meta_title?: string;
  meta_description?: string;
  meta_keywords?: string;
  sort_order?: number;
  translations?: ArticleTranslationReq[];
}

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
