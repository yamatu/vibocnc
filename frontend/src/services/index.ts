// Import services
import AuthServiceDefault from './auth.service';
import ProductServiceDefault from './product.service';
import CategoryServiceDefault from './category.service';
import OrderServiceDefault from './order.service';
import UserServiceDefault from './user.service';
import BannerServiceDefault from './banner.service';
import HomepageServiceDefault from './homepage.service';
import UploadServiceDefault from './upload.service';
import DashboardServiceDefault from './dashboard.service';
import ContactServiceDefault from './contact.service';
import { MediaService as MediaServiceDefault } from './media.service';
import { BackupService as BackupServiceDefault } from './backup.service';
import { CacheService as CacheServiceDefault } from './cache.service';
import { HotlinkService as HotlinkServiceDefault } from './hotlink.service';
import { PayPalService as PayPalServiceDefault } from './paypal.service';
import { EmailService as EmailServiceDefault } from './email.service';
import { ShippingRateService as ShippingRateServiceDefault } from './shipping-rate.service';
import { AnalyticsService as AnalyticsServiceDefault } from './analytics.service';
import { NewsService as NewsServiceDefault } from './news.service';
import { IndexNowService as IndexNowServiceDefault } from './indexnow.service';
import EbayImportDraftServiceDefault from './ebay-import-draft.service';

// Export all services
export const AuthService = AuthServiceDefault;
export const ProductService = ProductServiceDefault;
export const CategoryService = CategoryServiceDefault;
export const OrderService = OrderServiceDefault;
export const UserService = UserServiceDefault;
export const BannerService = BannerServiceDefault;
export const HomepageService = HomepageServiceDefault;
export const UploadService = UploadServiceDefault;
export const DashboardService = DashboardServiceDefault;
export const ContactService = ContactServiceDefault;
export const MediaService = MediaServiceDefault;
export const BackupService = BackupServiceDefault;
export const CacheService = CacheServiceDefault;
export const HotlinkService = HotlinkServiceDefault;
export const PayPalService = PayPalServiceDefault;
export const EmailService = EmailServiceDefault;
export const ShippingRateService = ShippingRateServiceDefault;
export const AnalyticsService = AnalyticsServiceDefault;
export const NewsService = NewsServiceDefault;
export const IndexNowService = IndexNowServiceDefault;
export const EbayImportDraftService = EbayImportDraftServiceDefault;

// Export types
export type { ProductFilters } from './product.service';
export type { OrderCreateRequest, OrderFilters, PaymentRequest } from './order.service';
export type { UserCreateRequest, UserUpdateRequest, UserFilters } from './user.service';
export type { BannerCreateRequest } from './banner.service';
export type { CompanyProfileRequest } from './company.service';
export type { HomepageContentRequest, HomepageSection } from './homepage.service';
export type { BatchUploadResponse, UploadProgress } from './upload.service';
export type { 
  DashboardStats, 
  RevenueData, 
  TopProduct,
  OrderStatusDistribution
} from './dashboard.service';
export type {
  ContactMessage,
  ContactCreateRequest,
  ContactUpdateRequest,
  ContactFilters,
  ContactStats
} from './contact.service';
export type { MediaAsset, MediaListResponse, MediaUploadResponse } from './media.service';
export type {
  AnalyticsOverview,
  VisitorLog as VisitorLogEntry,
  VisitorListResponse,
  CountryData,
  PageData,
  TrendData,
  AnalyticsSettings,
  AnalyticsFilters,
} from './analytics.service';
export type { NewsFilters } from './news.service';
export type {
  EbayImportDraftFilters,
  EbayImportDraftConfirmResponse,
  EbayImportDraftBulkConfirmResponse,
} from './ebay-import-draft.service';

// API Service class that combines all services
export class ApiService {
  static auth = AuthService;
  static products = ProductService;
  static categories = CategoryService;
  static orders = OrderService;
  static users = UserService;
  static banners = BannerService;
  static homepage = HomepageService;
  static uploads = UploadService;
  static dashboard = DashboardService;
  static contacts = ContactService;
  static media = MediaService;
  static backup = BackupService;
  static cache = CacheService;
  static hotlink = HotlinkService;
  static email = EmailService;
  static shippingRates = ShippingRateService;
  static analytics = AnalyticsService;
  static news = NewsService;
  static indexnow = IndexNowService;
  static ebayImportDrafts = EbayImportDraftService;
}

export default ApiService;
