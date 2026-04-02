package models

import (
	"time"
)

// Category represents product categories with hierarchical structure
type Category struct {
	ID           uint                  `json:"id" gorm:"primaryKey"`
	Name         string                `json:"name" gorm:"size:100;not null"`
	Slug         string                `json:"slug" gorm:"size:100;uniqueIndex;not null"`
	Description  string                `json:"description" gorm:"type:text"`
	ImageURL     string                `json:"image_url" gorm:"type:text"`
	ParentID     *uint                 `json:"parent_id" gorm:"index"`
	Parent       *Category             `json:"parent,omitempty" gorm:"foreignKey:ParentID"`
	Children     []Category            `json:"children,omitempty" gorm:"foreignKey:ParentID"`
	SortOrder    int                   `json:"sort_order" gorm:"default:0;index"`
	IsActive     bool                  `json:"is_active" gorm:"default:true;index"`
	CreatedAt    time.Time             `json:"created_at"`
	UpdatedAt    time.Time             `json:"updated_at"`
	Products     []Product             `json:"products,omitempty" gorm:"foreignKey:CategoryID"`
	Translations []CategoryTranslation `json:"translations,omitempty" gorm:"foreignKey:CategoryID"`
}

// Product represents the main product entity with enhanced SEO fields
type Product struct {
	ID               uint     `json:"id" gorm:"primaryKey"`
	SKU              string   `json:"sku" gorm:"size:100;uniqueIndex;not null"`
	Name             string   `json:"name" gorm:"size:255;not null"`
	Slug             string   `json:"slug" gorm:"size:255;uniqueIndex;not null"`
	ShortDescription string   `json:"short_description" gorm:"type:text"`
	Description      string   `json:"description" gorm:"type:longtext"`
	Price            float64  `json:"price" gorm:"type:decimal(10,2);default:0.00"`
	ComparePrice     *float64 `json:"compare_price" gorm:"type:decimal(10,2)"`
	CostPrice        *float64 `json:"cost_price" gorm:"type:decimal(10,2)"`
	StockQuantity    int      `json:"stock_quantity" gorm:"default:0"`
	MinStockLevel    int      `json:"min_stock_level" gorm:"default:0"`
	Weight           *float64 `json:"weight" gorm:"type:decimal(8,2)"`
	Dimensions       string   `json:"dimensions" gorm:"size:100"`
	Brand            string   `json:"brand" gorm:"size:100;index"`
	Model            string   `json:"model" gorm:"size:100;index"`
	PartNumber       string   `json:"part_number" gorm:"size:100;index"`
	CategoryID       uint     `json:"category_id" gorm:"not null;index"`
	Category         Category `json:"category" gorm:"foreignKey:CategoryID"`
	IsActive         bool     `json:"is_active" gorm:"default:true;index"`
	IsFeatured       bool     `json:"is_featured" gorm:"default:false;index"`
	MetaTitle        string   `json:"meta_title" gorm:"size:255"`
	MetaDescription  string   `json:"meta_description" gorm:"type:text"`
	MetaKeywords     string   `json:"meta_keywords" gorm:"type:text"`
	ImageURLs        string   `json:"image_urls" gorm:"type:json"`

	// Enhanced fields for fanucworld.com compatibility
	WarrantyPeriod          string     `json:"warranty_period" gorm:"size:50;default:'12 months'"`
	ConditionType           string     `json:"condition_type" gorm:"type:enum('new','refurbished','used');default:'new'"`
	OriginCountry           string     `json:"origin_country" gorm:"size:50;default:'China'"`
	Manufacturer            string     `json:"manufacturer" gorm:"size:100"`
	LeadTime                string     `json:"lead_time" gorm:"size:50;default:'3-7 days'"`
	MinimumOrderQuantity    int        `json:"minimum_order_quantity" gorm:"default:1"`
	PackagingInfo           string     `json:"packaging_info" gorm:"type:text"`
	Certifications          string     `json:"certifications" gorm:"type:text"`
	TechnicalSpecs          string     `json:"technical_specs" gorm:"type:json"`
	CompatibilityInfo       string     `json:"compatibility_info" gorm:"type:text"`
	InstallationGuide       string     `json:"installation_guide" gorm:"type:text"`
	MaintenanceTips         string     `json:"maintenance_tips" gorm:"type:text"`
	RelatedProducts         string     `json:"related_products" gorm:"type:json"`
	VideoURLs               string     `json:"video_urls" gorm:"type:json"`
	DatasheetURL            string     `json:"datasheet_url" gorm:"size:500"`
	ManualURL               string     `json:"manual_url" gorm:"size:500"`
	ViewCount               int        `json:"view_count" gorm:"default:0"`
	PopularityScore         float64    `json:"popularity_score" gorm:"type:decimal(3,2);default:0.00"`
	SEOScore                float64    `json:"seo_score" gorm:"type:decimal(3,2);default:0.00"`
	LastOptimizedAt         *time.Time `json:"last_optimized_at"`
	IndexNowLastSubmittedAt *time.Time `json:"indexnow_last_submitted_at"`
	IndexNowSubmitCount     int        `json:"indexnow_submit_count" gorm:"default:0"`
	IndexNowLastSubmitCode  int        `json:"indexnow_last_submit_code" gorm:"default:0"`

	CreatedAt     time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`
	Images        []ProductImage       `json:"images,omitempty" gorm:"foreignKey:ProductID"`
	Attributes    []ProductAttribute   `json:"attributes,omitempty" gorm:"foreignKey:ProductID"`
	Translations  []ProductTranslation `json:"translations,omitempty" gorm:"foreignKey:ProductID"`
	PurchaseLinks []PurchaseLink       `json:"purchase_links,omitempty" gorm:"foreignKey:ProductID"`
	Reviews       []ProductReview      `json:"reviews,omitempty" gorm:"foreignKey:ProductID"`
	FAQs          []ProductFAQ         `json:"faqs,omitempty" gorm:"foreignKey:ProductID"`
	Tags          []ProductTag         `json:"tags,omitempty" gorm:"many2many:product_tag_relations"`
}

// ProductImage represents product images (external URLs only)
type ProductImage struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	ProductID    uint      `json:"product_id" gorm:"not null;index"`
	URL          string    `json:"url" gorm:"type:text;not null"`
	Filename     string    `json:"filename" gorm:"size:255;default:''"`
	OriginalName string    `json:"original_name" gorm:"size:255;default:''"`
	AltText      string    `json:"alt_text" gorm:"size:255"`
	SortOrder    int       `json:"sort_order" gorm:"default:0"`
	IsPrimary    bool      `json:"is_primary" gorm:"default:false;index"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ProductAttribute represents product specifications
type ProductAttribute struct {
	ID             uint      `json:"id" gorm:"primaryKey"`
	ProductID      uint      `json:"product_id" gorm:"not null;index"`
	AttributeName  string    `json:"attribute_name" gorm:"size:100;not null;index"`
	AttributeValue string    `json:"attribute_value" gorm:"type:text;not null"`
	SortOrder      int       `json:"sort_order" gorm:"default:0"`
	CreatedAt      time.Time `json:"created_at"`
}

// Language represents supported languages
type Language struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	Code       string    `json:"code" gorm:"size:5;uniqueIndex;not null"`
	Name       string    `json:"name" gorm:"size:50;not null"`
	NativeName string    `json:"native_name" gorm:"size:50;not null"`
	IsActive   bool      `json:"is_active" gorm:"default:true"`
	IsDefault  bool      `json:"is_default" gorm:"default:false"`
	SortOrder  int       `json:"sort_order" gorm:"default:0"`
	CreatedAt  time.Time `json:"created_at"`
}

// ProductTranslation represents product content in different languages
type ProductTranslation struct {
	ID               uint      `json:"id" gorm:"primaryKey"`
	ProductID        uint      `json:"product_id" gorm:"not null;index"`
	LanguageCode     string    `json:"language_code" gorm:"size:5;not null;index"`
	Name             string    `json:"name" gorm:"size:255;not null"`
	Slug             string    `json:"slug" gorm:"size:255;not null"`
	ShortDescription string    `json:"short_description" gorm:"type:text"`
	Description      string    `json:"description" gorm:"type:longtext"`
	MetaTitle        string    `json:"meta_title" gorm:"size:255"`
	MetaDescription  string    `json:"meta_description" gorm:"type:text"`
	MetaKeywords     string    `json:"meta_keywords" gorm:"type:text"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// PurchaseLink represents external purchase links for products
type PurchaseLink struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	ProductID   uint      `json:"product_id" gorm:"not null;index"`
	Platform    string    `json:"platform" gorm:"size:100;not null"` // e.g., "Amazon", "eBay", "AliExpress"
	URL         string    `json:"url" gorm:"type:text;not null"`
	Price       *float64  `json:"price"`
	Currency    string    `json:"currency" gorm:"size:10;default:'USD'"`
	IsActive    bool      `json:"is_active" gorm:"default:true"`
	SortOrder   int       `json:"sort_order" gorm:"default:0"`
	Description string    `json:"description" gorm:"type:text"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// CategoryTranslation represents category content in different languages
type CategoryTranslation struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	CategoryID   uint      `json:"category_id" gorm:"not null;index"`
	LanguageCode string    `json:"language_code" gorm:"size:5;not null;index"`
	Name         string    `json:"name" gorm:"size:100;not null"`
	Slug         string    `json:"slug" gorm:"size:100;not null"`
	Description  string    `json:"description" gorm:"type:text"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AdminUser represents admin panel users
type AdminUser struct {
	ID           uint       `json:"id" gorm:"primaryKey"`
	Username     string     `json:"username" gorm:"size:50;uniqueIndex;not null"`
	Email        string     `json:"email" gorm:"size:100;uniqueIndex;not null"`
	PasswordHash string     `json:"-" gorm:"size:255;not null"`
	FullName     string     `json:"full_name" gorm:"size:100;not null"`
	Role         string     `json:"role" gorm:"type:enum('admin','editor','viewer');default:'editor';index"`
	IsActive     bool       `json:"is_active" gorm:"default:true"`
	LastLogin    *time.Time `json:"last_login"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// SEORedirect represents URL redirects for SEO
type SEORedirect struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	OldURL       string    `json:"old_url" gorm:"size:500;not null;index"`
	NewURL       string    `json:"new_url" gorm:"size:500;not null"`
	RedirectType string    `json:"redirect_type" gorm:"type:enum('301','302');default:'301'"`
	IsActive     bool      `json:"is_active" gorm:"default:true;index"`
	CreatedAt    time.Time `json:"created_at"`
}

// Request/Response DTOs

// LoginRequest represents login request payload
type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// LoginResponse represents login response
type LoginResponse struct {
	Token     string    `json:"token"`
	User      AdminUser `json:"user"`
	ExpiresAt time.Time `json:"expires_at"`
}

// ProductCreateRequest represents product creation request
type ProductCreateRequest struct {
	SKU              string                  `json:"sku" binding:"required"`
	Name             string                  `json:"name" binding:"required"`
	ShortDescription string                  `json:"short_description"`
	Description      string                  `json:"description"`
	Price            float64                 `json:"price"`
	ComparePrice     *float64                `json:"compare_price"`
	StockQuantity    int                     `json:"stock_quantity"`
	Weight           *float64                `json:"weight"`
	Dimensions       string                  `json:"dimensions"`
	Brand            string                  `json:"brand"`
	Model            string                  `json:"model"`
	PartNumber       string                  `json:"part_number"`
	WarrantyPeriod   string                  `json:"warranty_period"`
	LeadTime         string                  `json:"lead_time"`
	CategoryID       uint                    `json:"category_id" binding:"required"`
	IsActive         bool                    `json:"is_active"`
	IsFeatured       bool                    `json:"is_featured"`
	MetaTitle        string                  `json:"meta_title"`
	MetaDescription  string                  `json:"meta_description"`
	MetaKeywords     string                  `json:"meta_keywords"`
	Images           []ImageReq              `json:"images"`
	Attributes       []ProductAttributeReq   `json:"attributes"`
	Translations     []ProductTranslationReq `json:"translations"`
}

// ImageReq represents image URL in request
type ImageReq struct {
	URL       string `json:"url" binding:"required"`
	AltText   string `json:"alt_text"`
	IsPrimary bool   `json:"is_primary"`
	SortOrder int    `json:"sort_order"`
}

// ProductAttributeReq represents product attribute in request
type ProductAttributeReq struct {
	AttributeName  string `json:"attribute_name" binding:"required"`
	AttributeValue string `json:"attribute_value" binding:"required"`
	SortOrder      int    `json:"sort_order"`
}

// ProductTranslationReq represents product translation in request
type ProductTranslationReq struct {
	LanguageCode     string `json:"language_code" binding:"required"`
	Name             string `json:"name" binding:"required"`
	ShortDescription string `json:"short_description"`
	Description      string `json:"description"`
	MetaTitle        string `json:"meta_title"`
	MetaDescription  string `json:"meta_description"`
	MetaKeywords     string `json:"meta_keywords"`
}

// CategoryCreateRequest represents category creation request
type CategoryCreateRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	ImageURL    string `json:"image_url"`
	ParentID    *uint  `json:"parent_id"`
	SortOrder   int    `json:"sort_order"`
	IsActive    bool   `json:"is_active"`
}

// PaginationResponse represents paginated response
type PaginationResponse struct {
	Data       interface{} `json:"data"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	Total      int64       `json:"total"`
	TotalPages int         `json:"total_pages"`
}

// Coupon represents discount coupons
type Coupon struct {
	ID                uint       `json:"id" gorm:"primaryKey"`
	Code              string     `json:"code" gorm:"size:50;uniqueIndex;not null"`
	Name              string     `json:"name" gorm:"size:100;not null"`
	Description       string     `json:"description" gorm:"type:text"`
	Type              string     `json:"type" gorm:"type:enum('percentage','fixed_amount');not null"` // percentage or fixed_amount
	Value             float64    `json:"value" gorm:"type:decimal(10,2);not null"`                    // percentage (0-100) or fixed amount
	MinOrderAmount    float64    `json:"min_order_amount" gorm:"type:decimal(10,2);default:0"`        // minimum order amount to use coupon
	MaxDiscountAmount *float64   `json:"max_discount_amount" gorm:"type:decimal(10,2)"`               // maximum discount amount for percentage coupons
	UsageLimit        *int       `json:"usage_limit"`                                                 // total usage limit (null = unlimited)
	UsedCount         int        `json:"used_count" gorm:"default:0"`                                 // current usage count
	UserUsageLimit    *int       `json:"user_usage_limit"`                                            // per user usage limit (null = unlimited)
	IsActive          bool       `json:"is_active" gorm:"default:true;index"`
	StartsAt          *time.Time `json:"starts_at"`  // when coupon becomes active
	ExpiresAt         *time.Time `json:"expires_at"` // when coupon expires
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// CouponUsage tracks individual coupon usage
type CouponUsage struct {
	ID             uint      `json:"id" gorm:"primaryKey"`
	CouponID       uint      `json:"coupon_id" gorm:"not null;index"`
	Coupon         Coupon    `json:"coupon" gorm:"foreignKey:CouponID"`
	OrderID        uint      `json:"order_id" gorm:"not null;index"`
	CustomerEmail  string    `json:"customer_email" gorm:"size:100;not null;index"`
	DiscountAmount float64   `json:"discount_amount" gorm:"type:decimal(10,2);not null"`
	CreatedAt      time.Time `json:"created_at"`
}

// CouponCreateRequest represents coupon creation request
type CouponCreateRequest struct {
	Code              string     `json:"code" binding:"required"`
	Name              string     `json:"name" binding:"required"`
	Description       string     `json:"description"`
	Type              string     `json:"type" binding:"required,oneof=percentage fixed_amount"`
	Value             float64    `json:"value" binding:"required,gt=0"`
	MinOrderAmount    float64    `json:"min_order_amount"`
	MaxDiscountAmount *float64   `json:"max_discount_amount"`
	UsageLimit        *int       `json:"usage_limit"`
	UserUsageLimit    *int       `json:"user_usage_limit"`
	IsActive          bool       `json:"is_active"`
	StartsAt          *time.Time `json:"starts_at"`
	ExpiresAt         *time.Time `json:"expires_at"`
}

// CouponValidateRequest represents coupon validation request
type CouponValidateRequest struct {
	Code          string  `json:"code" binding:"required"`
	OrderAmount   float64 `json:"order_amount" binding:"required,gt=0"`
	CustomerEmail string  `json:"customer_email" binding:"required,email"`
}

// CouponValidateResponse represents coupon validation response
type CouponValidateResponse struct {
	Valid          bool    `json:"valid"`
	CouponID       uint    `json:"coupon_id,omitempty"`
	Code           string  `json:"code,omitempty"`
	Name           string  `json:"name,omitempty"`
	Type           string  `json:"type,omitempty"`
	Value          float64 `json:"value,omitempty"`
	DiscountAmount float64 `json:"discount_amount,omitempty"`
	FinalAmount    float64 `json:"final_amount,omitempty"`
	Message        string  `json:"message"`
}

// APIResponse represents standard API response
type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// Enhanced models for SEO and fanucworld.com compatibility

// ProductReview represents customer reviews for products
type ProductReview struct {
	ID            uint      `json:"id" gorm:"primaryKey"`
	ProductID     uint      `json:"product_id" gorm:"not null;index"`
	CustomerName  string    `json:"customer_name" gorm:"size:100;not null"`
	CustomerEmail string    `json:"customer_email" gorm:"size:255"`
	Rating        int       `json:"rating" gorm:"not null;check:rating >= 1 AND rating <= 5"`
	ReviewTitle   string    `json:"review_title" gorm:"size:255"`
	ReviewContent string    `json:"review_content" gorm:"type:text"`
	IsVerified    bool      `json:"is_verified" gorm:"default:false"`
	IsApproved    bool      `json:"is_approved" gorm:"default:false"`
	HelpfulCount  int       `json:"helpful_count" gorm:"default:0"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ProductFAQ represents frequently asked questions for products
type ProductFAQ struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	ProductID uint      `json:"product_id" gorm:"not null;index"`
	Question  string    `json:"question" gorm:"type:text;not null"`
	Answer    string    `json:"answer" gorm:"type:text;not null"`
	IsActive  bool      `json:"is_active" gorm:"default:true"`
	SortOrder int       `json:"sort_order" gorm:"default:0"`
	ViewCount int       `json:"view_count" gorm:"default:0"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ProductTag represents tags for categorizing and searching products
type ProductTag struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	Name        string    `json:"name" gorm:"size:100;not null;unique"`
	Slug        string    `json:"slug" gorm:"size:100;not null;unique"`
	Description string    `json:"description" gorm:"type:text"`
	Color       string    `json:"color" gorm:"size:7;default:'#007bff'"`
	UsageCount  int       `json:"usage_count" gorm:"default:0"`
	IsActive    bool      `json:"is_active" gorm:"default:true"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Products    []Product `json:"products,omitempty" gorm:"many2many:product_tag_relations"`
}

// ProductCrossReference represents compatible/alternative parts
type ProductCrossReference struct {
	ID                 uint      `json:"id" gorm:"primaryKey"`
	ProductID          uint      `json:"product_id" gorm:"not null;index"`
	ReferenceProductID uint      `json:"reference_product_id" gorm:"not null"`
	ReferenceType      string    `json:"reference_type" gorm:"type:enum('compatible','alternative','upgrade','related');not null"`
	ConfidenceScore    float64   `json:"confidence_score" gorm:"type:decimal(3,2);default:1.00"`
	CreatedAt          time.Time `json:"created_at"`
	Product            Product   `json:"product" gorm:"foreignKey:ProductID"`
	ReferenceProduct   Product   `json:"reference_product" gorm:"foreignKey:ReferenceProductID"`
}

// SEOAnalytics represents SEO performance tracking
type SEOAnalytics struct {
	ID             uint      `json:"id" gorm:"primaryKey"`
	ProductID      uint      `json:"product_id" gorm:"not null;index"`
	SearchKeyword  string    `json:"search_keyword" gorm:"size:255;not null"`
	SearchCount    int       `json:"search_count" gorm:"default:0"`
	ConversionRate float64   `json:"conversion_rate" gorm:"type:decimal(5,2);default:0.00"`
	LastSearchedAt time.Time `json:"last_searched_at"`
	CreatedAt      time.Time `json:"created_at"`
	Product        Product   `json:"product" gorm:"foreignKey:ProductID"`
}

// Enhanced Category model
type EnhancedCategory struct {
	Category
	IconClass        string `json:"icon_class" gorm:"size:100"`
	BannerImage      string `json:"banner_image" gorm:"size:500"`
	MetaTitle        string `json:"meta_title" gorm:"size:255"`
	MetaDescription  string `json:"meta_description" gorm:"type:text"`
	MetaKeywords     string `json:"meta_keywords" gorm:"type:text"`
	ProductCount     int    `json:"product_count" gorm:"default:0"`
	FeaturedProducts string `json:"featured_products" gorm:"type:json"`
}

// Enhanced Product Request for API
type EnhancedProductCreateRequest struct {
	ProductCreateRequest
	WarrantyPeriod       string `json:"warranty_period"`
	ConditionType        string `json:"condition_type"`
	OriginCountry        string `json:"origin_country"`
	Manufacturer         string `json:"manufacturer"`
	LeadTime             string `json:"lead_time"`
	MinimumOrderQuantity int    `json:"minimum_order_quantity"`
	PackagingInfo        string `json:"packaging_info"`
	Certifications       string `json:"certifications"`
	TechnicalSpecs       string `json:"technical_specs"`
	CompatibilityInfo    string `json:"compatibility_info"`
	InstallationGuide    string `json:"installation_guide"`
	MaintenanceTips      string `json:"maintenance_tips"`
	RelatedProducts      string `json:"related_products"`
	VideoURLs            string `json:"video_urls"`
	DatasheetURL         string `json:"datasheet_url"`
	ManualURL            string `json:"manual_url"`
	Tags                 []uint `json:"tag_ids"`
}

// Product optimization request
type ProductOptimizationRequest struct {
	ProductID   int    `json:"product_id" binding:"required"`
	ForceUpdate bool   `json:"force_update"`
	Brand       string `json:"brand"`
}

// Product optimization response
type ProductOptimizationResponse struct {
	ProductID          int     `json:"product_id"`
	SKU                string  `json:"sku"`
	OptimizationStatus string  `json:"optimization_status"`
	ContentUpdated     bool    `json:"content_updated"`
	SEOScoreBefore     float64 `json:"seo_score_before"`
	SEOScoreAfter      float64 `json:"seo_score_after"`
	Message            string  `json:"message"`
}

// Bulk optimization request
type BulkOptimizationRequest struct {
	ProductIDs  []int  `json:"product_ids"`
	CategoryID  *int   `json:"category_id"`
	Limit       int    `json:"limit"`
	ForceUpdate bool   `json:"force_update"`
	Brand       string `json:"brand"`
}

// ---------------------------------------------------------------------------
// News / Articles
// ---------------------------------------------------------------------------

// Article represents a news/blog article with SEO and markdown support.
type Article struct {
	ID              uint                 `json:"id" gorm:"primaryKey"`
	Title           string               `json:"title" gorm:"size:255;not null"`
	Slug            string               `json:"slug" gorm:"size:255;uniqueIndex;not null"`
	CustomPath      string               `json:"custom_path" gorm:"size:500;uniqueIndex"`
	Summary         string               `json:"summary" gorm:"type:text"`
	Content         string               `json:"content" gorm:"type:longtext;not null"`
	FeaturedImage   string               `json:"featured_image" gorm:"type:text"`
	FeaturedMediaID *uint                `json:"featured_media_id" gorm:"index"`
	FeaturedMedia   *MediaAsset          `json:"featured_media,omitempty" gorm:"foreignKey:FeaturedMediaID"`
	ImageURLs       string               `json:"image_urls" gorm:"type:json"`
	GalleryMediaIDs string               `json:"gallery_media_ids" gorm:"type:json"`
	IsPublished     bool                 `json:"is_published" gorm:"default:false;index"`
	IsFeatured      bool                 `json:"is_featured" gorm:"default:false;index"`
	MetaTitle       string               `json:"meta_title" gorm:"size:255"`
	MetaDescription string               `json:"meta_description" gorm:"type:text"`
	MetaKeywords    string               `json:"meta_keywords" gorm:"type:text"`
	AuthorID        uint                 `json:"author_id" gorm:"not null;index"`
	Author          AdminUser            `json:"author" gorm:"foreignKey:AuthorID"`
	ViewCount       int                  `json:"view_count" gorm:"default:0"`
	SortOrder       int                  `json:"sort_order" gorm:"default:0;index"`
	PublishedAt     *time.Time           `json:"published_at"`
	CreatedAt       time.Time            `json:"created_at"`
	UpdatedAt       time.Time            `json:"updated_at"`
	Translations    []ArticleTranslation `json:"translations,omitempty" gorm:"foreignKey:ArticleID"`
}

func (Article) TableName() string { return "articles" }

// ArticleTranslation represents article content in different languages.
type ArticleTranslation struct {
	ID              uint      `json:"id" gorm:"primaryKey"`
	ArticleID       uint      `json:"article_id" gorm:"not null;index"`
	LanguageCode    string    `json:"language_code" gorm:"size:5;not null;index"`
	Title           string    `json:"title" gorm:"size:255;not null"`
	Slug            string    `json:"slug" gorm:"size:255;not null"`
	Summary         string    `json:"summary" gorm:"type:text"`
	Content         string    `json:"content" gorm:"type:longtext"`
	MetaTitle       string    `json:"meta_title" gorm:"size:255"`
	MetaDescription string    `json:"meta_description" gorm:"type:text"`
	MetaKeywords    string    `json:"meta_keywords" gorm:"type:text"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (ArticleTranslation) TableName() string { return "article_translations" }

// ArticleCreateRequest represents the request body for creating/updating an article.
type ArticleCreateRequest struct {
	Title           string                  `json:"title" binding:"required"`
	Slug            string                  `json:"slug"`
	CustomPath      string                  `json:"custom_path"`
	Summary         string                  `json:"summary"`
	Content         string                  `json:"content" binding:"required"`
	FeaturedImage   string                  `json:"featured_image"`
	FeaturedMediaID *uint                   `json:"featured_media_id"`
	ImageURLs       []string                `json:"image_urls"`
	GalleryMediaIDs []uint                  `json:"gallery_media_ids"`
	IsPublished     bool                    `json:"is_published"`
	IsFeatured      bool                    `json:"is_featured"`
	MetaTitle       string                  `json:"meta_title"`
	MetaDescription string                  `json:"meta_description"`
	MetaKeywords    string                  `json:"meta_keywords"`
	SortOrder       int                     `json:"sort_order"`
	Translations    []ArticleTranslationReq `json:"translations"`
}

// ArticleTranslationReq represents article translation in request.
type ArticleTranslationReq struct {
	LanguageCode    string `json:"language_code" binding:"required"`
	Title           string `json:"title" binding:"required"`
	Slug            string `json:"slug"`
	Summary         string `json:"summary"`
	Content         string `json:"content"`
	MetaTitle       string `json:"meta_title"`
	MetaDescription string `json:"meta_description"`
	MetaKeywords    string `json:"meta_keywords"`
}
