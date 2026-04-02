package routes

import (
	"fanuc-backend/config"
	"fanuc-backend/controllers"
	"fanuc-backend/handlers"
	"fanuc-backend/middleware"
	"fanuc-backend/services"
	"net/http"

	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine) {
	// Initialize services
	db := config.GetDB()
	companyProfileService := services.NewCompanyProfileService(db)

	// Initialize controllers
	authController := &controllers.AuthController{}
	productController := &controllers.ProductController{}
	categoryController := &controllers.CategoryController{}
	orderController := &controllers.OrderController{}
	userController := &controllers.UserController{}
	bannerController := &controllers.BannerController{}
	purchaseLinkController := &controllers.PurchaseLinkController{}
	homepageContentController := &controllers.HomepageContentController{}
	companyProfileController := controllers.NewCompanyProfileController(companyProfileService)
	dashboardController := controllers.NewDashboardController()
	contactHandler := handlers.NewContactHandler(db)
	couponController := &controllers.CouponController{}
	customerController := &controllers.CustomerController{}
	emailController := &controllers.EmailController{}
	resendWebhookController := &controllers.ResendWebhookController{}
	ticketController := &controllers.TicketController{}
	mediaController := &controllers.MediaController{}
	watermarkController := &controllers.WatermarkController{}
	shippingRateController := &controllers.ShippingRateController{}
	backupController := &controllers.BackupController{}
	cacheController := &controllers.CacheController{}
	hotlinkController := &controllers.HotlinkController{}
	payPalController := &controllers.PayPalController{}
	analyticsController := &controllers.AnalyticsController{}
	newsController := &controllers.NewsController{}
	productOptimizationController := &controllers.ProductOptimizationController{}
	indexNowController := &controllers.IndexNowController{}

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"message": "FANUC Backend API is running",
		})
	})

	// API v1 routes
	v1 := r.Group("/api/v1")
	{
		// Public routes (no authentication required)
		public := v1.Group("/public")
		{
			// Categories (public read access) - cached
			public.GET("/categories", middleware.CachePublicGET(middleware.CacheTTLCategories(), "cache:public:categories:"), categoryController.GetCategories)
			public.GET("/categories/path/*path", categoryController.GetCategoryByPath)

			public.GET("/categories/:id", categoryController.GetCategory)
			public.GET("/categories/slug/:slug", categoryController.GetCategoryBySlug)

			// Products (public read access) - cached
			public.GET("/products", middleware.CachePublicGET(middleware.CacheTTLProducts(), "cache:public:products:"), productController.GetProducts)
			public.GET("/products/default-image", watermarkController.DefaultProductImage)
			public.GET("/products/default-image/:sku", watermarkController.DefaultProductImage)

			// Shipping (public)
			public.GET("/shipping/countries", shippingRateController.PublicCountries)
			public.GET("/shipping/quote", shippingRateController.PublicQuote)
			public.GET("/shipping/free-countries", shippingRateController.PublicFreeShippingCountries)

			// Product detail endpoints are also cached (same TTL as product list)
			public.GET("/products/:id", middleware.CachePublicGET(middleware.CacheTTLProducts(), "cache:public:product:"), productController.GetProduct)
			public.GET("/products/sku", middleware.CachePublicGET(middleware.CacheTTLProducts(), "cache:public:product_sku_query:"), productController.GetProductBySKUQuery) // query param: sku=...
			public.GET("/products/sku/:sku", middleware.CachePublicGET(middleware.CacheTTLProducts(), "cache:public:product_sku:"), productController.GetProductBySKU)       // legacy: path param

			// Banners (public read access) - cached
			public.GET("/banners", middleware.CachePublicGET(middleware.CacheTTLHomepage(), "cache:public:banners:"), bannerController.GetPublicBanners)

			// Homepage Content (public read access) - cached
			public.GET("/homepage-content", middleware.CachePublicGET(middleware.CacheTTLHomepage(), "cache:public:homepage:"), homepageContentController.GetHomepageContents)

			public.GET("/homepage-content/section/:section_key", homepageContentController.GetHomepageContentBySection)

			// Company Profile (public read access) - cached
			public.GET("/company-profile", middleware.CachePublicGET(middleware.CacheTTLHomepage(), "cache:public:company_profile:"), companyProfileController.GetCompanyProfile)

			// Contact form submission (public access)
			public.POST("/contact", contactHandler.SubmitContact)

			// Coupon validation (public access)
			public.POST("/coupons/validate", couponController.ValidateCoupon)

			// PayPal (public config)
			public.GET("/paypal/config", payPalController.GetPublicConfig)

			// Email (public)
			public.GET("/email/config", emailController.GetPublicConfig)
			public.POST("/email/send-code", emailController.SendCode)
			public.GET("/indexnow/key", indexNowController.GetPublicKey)

			// News / Articles (public read access)
			public.GET("/news", newsController.GetPublicArticles)
			public.GET("/news/path/*path", newsController.GetPublicArticleByPath)
			public.GET("/news/:id", newsController.GetPublicArticle)
			public.GET("/news/slug/:slug", newsController.GetPublicArticleBySlug)
		}

		// Authentication routes
		auth := v1.Group("/auth")
		{
			auth.POST("/login", middleware.LoginRateLimitMiddleware(), authController.Login)
			auth.POST("/password-reset/request", middleware.LoginRateLimitMiddleware(), authController.RequestPasswordReset)
			auth.POST("/password-reset/confirm", authController.ConfirmPasswordReset)

			// Protected auth routes
			authProtected := auth.Group("")
			authProtected.Use(middleware.AuthMiddleware())
			{
				authProtected.GET("/profile", authController.GetProfile)
				authProtected.PUT("/profile", authController.UpdateProfile)
				authProtected.POST("/change-password", authController.ChangePassword)
			}
		}

		// Admin routes (authentication required)
		admin := v1.Group("/admin")
		admin.Use(middleware.AuthMiddleware())
		{
			// Dashboard statistics (admin and editor access)
			dashboard := admin.Group("/dashboard")
			dashboard.Use(middleware.EditorOrAdmin())
			{
				dashboard.GET("/stats", dashboardController.GetDashboardStats)
				dashboard.GET("/recent-orders", dashboardController.GetRecentOrders)
				dashboard.GET("/top-products", dashboardController.GetTopProducts)
				dashboard.GET("/revenue", dashboardController.GetRevenueData)
			}

			// Category management (admin and editor access)
			categories := admin.Group("/categories")
			categories.Use(middleware.EditorOrAdmin())
			{
				categories.GET("", categoryController.GetCategories)
				categories.GET("/:id", categoryController.GetCategory)
				categories.POST("", categoryController.CreateCategory)
				categories.PUT("/reorder", categoryController.ReorderCategories)
				categories.PUT("/:id", categoryController.UpdateCategory)
				categories.DELETE("/:id", middleware.AdminOnly(), categoryController.DeleteCategory)
			}

			// Product management (admin and editor access)
			products := admin.Group("/products")
			products.Use(middleware.EditorOrAdmin())
			{
				// Bulk import (XLSX)
				products.GET("/import/template", productController.DownloadImportTemplate)
				products.POST("/import/xlsx", productController.ImportProductsXLSX)
				products.GET("/import/xlsx/tasks/:id", productController.GetProductImportTask)

				// Bulk update is_active / is_featured
				products.PUT("/bulk-update", productController.BulkUpdateProducts)
				products.POST("/selection-ids", productController.GetBulkProductSelectionIDs)
				products.PUT("/bulk-auto-categorize", productController.BulkAutoCategorizeProducts)
				products.PUT("/bulk-categorize-optimize", productController.BulkCategorizeAndOptimizeProducts)
				products.GET("/optimization-status", productOptimizationController.GetOptimizationStatus)
				products.POST("/optimize", productOptimizationController.OptimizeProduct)
				products.POST("/bulk-optimize", productOptimizationController.BulkOptimizeProducts)

				// Bulk: apply/remove default watermark image URL
				products.PUT("/bulk-default-image/apply", productController.BulkApplyDefaultImage)
				products.PUT("/bulk-default-image/remove", productController.BulkRemoveDefaultImage)
				products.PUT("/bulk-category-image", productController.BulkApplyCategoryImage)

				products.GET("", productController.GetProducts)
				products.GET("/:id", productController.GetProduct)
				products.POST("", productController.CreateProduct)
				products.PUT("/:id", productController.UpdateProduct)
				products.DELETE("/:id", middleware.AdminOnly(), productController.DeleteProduct)

				// Product image management
				products.POST("/:id/images", productController.AddImage)
				products.GET("/:id/images", productController.GetProductImages)
				// Note: controller expects :imageIndex for deletion
				products.DELETE("/:id/images/:imageIndex", middleware.AdminOnly(), productController.DeleteImage)
			}

			// Shipping template management (admin and editor access)
			shippingRates := admin.Group("/shipping-rates")
			shippingRates.Use(middleware.EditorOrAdmin())
			{
				shippingRates.GET("", shippingRateController.AdminList)
				shippingRates.GET("/import/template", shippingRateController.DownloadTemplate)
				shippingRates.POST("/import/xlsx", shippingRateController.ImportXLSX)
				shippingRates.POST("/bulk-delete", middleware.AdminOnly(), shippingRateController.BulkDelete)
				// Allowed countries whitelist
				shippingRates.GET("/allowed-countries", shippingRateController.ListAllowedCountries)
				shippingRates.POST("/allowed-countries", shippingRateController.AddAllowedCountry)
				shippingRates.DELETE("/allowed-countries/:code", shippingRateController.RemoveAllowedCountry)
				shippingRates.POST("/allowed-countries/bulk", shippingRateController.BulkSetAllowedCountries)
				// Free shipping settings
				shippingRates.GET("/free-shipping", shippingRateController.GetFreeShippingCountries)
				shippingRates.POST("/free-shipping", shippingRateController.SetFreeShippingCountries)
			}

			// Order management (admin only)
			orders := admin.Group("/orders")
			orders.Use(middleware.AdminOnly())
			{
				orders.GET("", orderController.GetOrders)
				orders.GET("/:id", orderController.GetOrder)
				orders.PUT("/:id", orderController.UpdateOrder)
				orders.PUT("/:id/status", orderController.UpdateOrderStatus)
				orders.DELETE("/:id", orderController.DeleteOrder)
			}

			// User management (admin only)
			users := admin.Group("/users")
			users.Use(middleware.AdminOnly())
			{
				users.GET("", userController.GetUsers)
				users.GET("/:id", userController.GetUser)
				users.POST("", userController.CreateUser)
				users.PUT("/:id", userController.UpdateUser)
				users.DELETE("/:id", userController.DeleteUser)
			}

			// Banner management (admin and editor access)
			banners := admin.Group("/banners")
			banners.Use(middleware.EditorOrAdmin())
			{
				banners.GET("", bannerController.GetBanners)
				banners.GET("/:id", bannerController.GetBanner)
				banners.POST("", bannerController.CreateBanner)
				banners.PUT("/:id", bannerController.UpdateBanner)
				banners.PUT("/:id/order", bannerController.UpdateBannerOrder)
				banners.DELETE("/:id", middleware.AdminOnly(), bannerController.DeleteBanner)
			}

			// Purchase Link management (admin and editor access)
			purchaseLinks := admin.Group("/purchase-links")
			purchaseLinks.Use(middleware.EditorOrAdmin())
			{
				purchaseLinks.GET("", purchaseLinkController.GetPurchaseLinks)
				purchaseLinks.GET("/:id", purchaseLinkController.GetPurchaseLink)
				purchaseLinks.POST("", purchaseLinkController.CreatePurchaseLink)
				purchaseLinks.PUT("/:id", purchaseLinkController.UpdatePurchaseLink)
				purchaseLinks.DELETE("/:id", middleware.AdminOnly(), purchaseLinkController.DeletePurchaseLink)
			}

			// Media library (admin and editor access)
			media := admin.Group("/media")
			media.Use(middleware.EditorOrAdmin())
			{
				media.GET("", mediaController.List)
				media.POST("/upload", mediaController.Upload)
				media.PUT("/batch", mediaController.BatchUpdate)
				media.DELETE("/batch", mediaController.BatchDelete)
				media.PUT("/:id", mediaController.Update)
				media.GET("/watermark/settings", watermarkController.GetSettings)
				media.PUT("/watermark/settings", watermarkController.UpdateSettings)
				media.POST("/watermark", watermarkController.GenerateFromMedia)
			}

			// Backup & restore (admin only)
			backup := admin.Group("/backup")
			backup.Use(middleware.AdminOnly())
			{
				backup.GET("/db", backupController.DownloadDBBackup)
				backup.POST("/db/restore", backupController.RestoreDBBackup)
				backup.GET("/media", backupController.DownloadMediaBackup)
				backup.POST("/media/restore", backupController.RestoreMediaBackup)
			}

			// Cache & CDN (admin only)
			cache := admin.Group("/cache")
			cache.Use(middleware.AdminOnly())
			{
				cache.GET("/settings", cacheController.GetSettings)
				cache.PUT("/settings", cacheController.UpdateSettings)
				cache.POST("/purge", cacheController.PurgeNow)
				cache.POST("/test", cacheController.Test)
			}

			// Hotlink protection (admin only)
			hotlink := admin.Group("/hotlink")
			hotlink.Use(middleware.AdminOnly())
			{
				hotlink.GET("/settings", hotlinkController.GetSettings)
				hotlink.PUT("/settings", hotlinkController.UpdateSettings)
			}

			// PayPal (admin only)
			paypal := admin.Group("/paypal")
			paypal.Use(middleware.AdminOnly())
			{
				paypal.GET("/settings", payPalController.GetSettings)
				paypal.PUT("/settings", payPalController.UpdateSettings)
			}

			// IndexNow / Bing (admin only)
			indexnow := admin.Group("/indexnow")
			indexnow.Use(middleware.AdminOnly())
			{
				indexnow.GET("/settings", indexNowController.GetSettings)
				indexnow.GET("/product-status", indexNowController.GetProductStatus)
				indexnow.GET("/verify-key", indexNowController.VerifyKey)
				indexnow.PUT("/settings", indexNowController.UpdateSettings)
				indexnow.POST("/submit", indexNowController.Submit)
				indexnow.POST("/submit-products", indexNowController.SubmitProducts)
				indexnow.POST("/submit-sample", indexNowController.SubmitSampleProduct)
				indexnow.POST("/products/:id/submit", indexNowController.SubmitProductByID)
			}

			// Visitor Analytics (editor/admin for reads, admin-only for cleanup)
			analytics := admin.Group("/analytics")
			analytics.Use(middleware.EditorOrAdmin())
			{
				analytics.GET("/overview", analyticsController.GetOverview)
				analytics.GET("/visitors", analyticsController.GetVisitors)
				analytics.GET("/countries", analyticsController.GetCountries)
				analytics.GET("/pages", analyticsController.GetPages)
				analytics.GET("/trends", analyticsController.GetTrends)
				analytics.GET("/country-visitors", analyticsController.GetCountryVisitors)
				analytics.GET("/product-skus", analyticsController.GetProductSKUs)
				analytics.GET("/country-skus", analyticsController.GetCountrySKUs)
				analytics.GET("/settings", analyticsController.GetSettings)
				analytics.PUT("/settings", analyticsController.UpdateSettings)
				analytics.DELETE("/cleanup", middleware.AdminOnly(), analyticsController.ManualCleanup)
			}

			// News / Article management (editor/admin)
			news := admin.Group("/news")
			news.Use(middleware.EditorOrAdmin())
			{
				news.GET("", newsController.GetArticles)
				news.GET("/:id", newsController.GetArticle)
				news.POST("", newsController.CreateArticle)
				news.PUT("/:id", newsController.UpdateArticle)
				news.DELETE("/:id", middleware.AdminOnly(), newsController.DeleteArticle)
			}

			// Email settings + marketing (admin only)
			email := admin.Group("/email")
			email.Use(middleware.AdminOnly())
			{
				email.GET("/settings", emailController.GetSettings)
				email.PUT("/settings", emailController.UpdateSettings)
				email.POST("/test", emailController.SendTest)
				email.POST("/send", emailController.Send)
				email.POST("/broadcast", emailController.Broadcast)

				// Resend webhook management (proxy to Resend API)
				resend := email.Group("/resend")
				{
					resend.GET("/webhooks", resendWebhookController.List)
					resend.POST("/webhooks", resendWebhookController.Create)
					resend.GET("/webhooks/:id", resendWebhookController.Get)
					resend.PUT("/webhooks/:id", resendWebhookController.Update)
					resend.DELETE("/webhooks/:id", resendWebhookController.Remove)
				}
			}

			// Homepage Content management (admin and editor access)
			homepageContent := admin.Group("/homepage-content")
			homepageContent.Use(middleware.EditorOrAdmin())
			{
				homepageContent.GET("", homepageContentController.GetHomepageContentsAdmin)
				homepageContent.GET("/sections", homepageContentController.GetPredefinedSections)
				homepageContent.GET("/section/:section_key", homepageContentController.GetHomepageContentBySectionAdmin)
				homepageContent.PUT("/section/:section_key", homepageContentController.UpsertHomepageContentBySection)
				homepageContent.GET("/:id", homepageContentController.GetHomepageContent)
				homepageContent.POST("", homepageContentController.CreateHomepageContent)
				homepageContent.PUT("/:id", homepageContentController.UpdateHomepageContent)
				homepageContent.DELETE("/:id", middleware.AdminOnly(), homepageContentController.DeleteHomepageContent)
			}

			// Company Profile management (admin and editor access)
			companyProfile := admin.Group("/company-profile")
			companyProfile.Use(middleware.EditorOrAdmin())
			{
				companyProfile.GET("", companyProfileController.GetCompanyProfileAdmin)
				companyProfile.POST("", companyProfileController.UpsertCompanyProfile)
				companyProfile.PUT("/:id", companyProfileController.UpdateCompanyProfile)
				companyProfile.DELETE("/:id", middleware.AdminOnly(), companyProfileController.DeleteCompanyProfile)
			}

			// Contact Messages management (admin and editor access)
			contacts := admin.Group("/contacts")
			contacts.Use(middleware.EditorOrAdmin())
			{
				contacts.GET("", contactHandler.GetContacts)
				contacts.GET("/stats", contactHandler.GetContactStats)
				contacts.GET("/:id", contactHandler.GetContact)
				contacts.PUT("/:id", contactHandler.UpdateContactStatus)
				contacts.DELETE("/:id", middleware.AdminOnly(), contactHandler.DeleteContact)
			}

			// Coupon management (admin and editor access)
			coupons := admin.Group("/coupons")
			coupons.Use(middleware.EditorOrAdmin())
			{
				coupons.GET("", couponController.GetCoupons)
				coupons.GET("/:id", couponController.GetCoupon)
				coupons.GET("/:id/usage", couponController.GetCouponUsage)
				coupons.POST("", couponController.CreateCoupon)
				coupons.PUT("/:id", couponController.UpdateCoupon)
				coupons.DELETE("/:id", middleware.AdminOnly(), couponController.DeleteCoupon)
			}

			// Customer management (admin and editor access)
			customers := admin.Group("/customers")
			customers.Use(middleware.EditorOrAdmin())
			{
				customers.GET("", customerController.GetAllCustomers)
				customers.GET("/:id", customerController.GetCustomerByID)
				customers.PUT("/:id/status", customerController.UpdateCustomerStatus)
				customers.DELETE("/:id", middleware.AdminOnly(), customerController.DeleteCustomer)
			}
		}

		// Public order endpoints (with optional customer authentication)
		publicOrders := v1.Group("/orders")
		publicOrders.Use(middleware.OptionalCustomerAuth()) // Try to authenticate if token present
		{
			publicOrders.POST("", orderController.CreateOrder)
			publicOrders.POST("/:id/payment", orderController.ProcessPayment)
			publicOrders.GET("/track/:orderNumber", orderController.GetOrderByNumber) // Order tracking endpoint
		}

		// Customer authentication routes (public)
		customer := v1.Group("/customer")
		{
			customer.POST("/register", customerController.Register)
			customer.POST("/login", customerController.Login)
			customer.POST("/password-reset/request", customerController.RequestPasswordReset)
			customer.POST("/password-reset/confirm", customerController.ConfirmPasswordReset)

			// Protected customer routes
			customerProtected := customer.Group("")
			customerProtected.Use(middleware.CustomerAuthMiddleware())
			{
				// Profile management
				customerProtected.GET("/profile", customerController.GetProfile)
				customerProtected.PUT("/profile", customerController.UpdateProfile)
				customerProtected.POST("/change-password", customerController.ChangePassword)

				// Customer orders
				customerProtected.GET("/orders", orderController.GetMyOrders)
				customerProtected.GET("/orders/:id", orderController.GetMyOrderDetails)

				// Ticket/Support system
				customerProtected.POST("/tickets", ticketController.CreateTicket)
				customerProtected.GET("/tickets", ticketController.GetMyTickets)
				customerProtected.GET("/tickets/:id", ticketController.GetTicketDetails)
				customerProtected.POST("/tickets/:id/reply", ticketController.ReplyToTicket)
			}
		}

		// Admin ticket management
		adminTickets := admin.Group("/tickets")
		adminTickets.Use(middleware.EditorOrAdmin())
		{
			adminTickets.GET("", ticketController.GetAllTickets)
			adminTickets.GET("/:id", ticketController.GetAdminTicketDetails)
			adminTickets.PUT("/:id", ticketController.UpdateTicketStatus)
			adminTickets.POST("/:id/reply", ticketController.AdminReplyToTicket)
		}
	}

	// Serve static files (uploaded images)
	uploads := r.Group("/uploads")
	uploads.Use(middleware.HotlinkProtectionMiddleware())
	uploads.StaticFS("/", http.Dir("./uploads"))
}
