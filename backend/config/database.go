package config

import (
	"errors"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func ConnectDatabase() {
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	database := os.Getenv("DB_NAME")
	username := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")

	// First, connect without database to create it if needed
	dsnWithoutDB := fmt.Sprintf("%s:%s@tcp(%s:%s)/?charset=utf8mb4&parseTime=True&loc=Local",
		username, password, host, port)

	tempDB, err := gorm.Open(mysql.Open(dsnWithoutDB), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to MySQL server: %v", err)
	}

	// Create database if it doesn't exist
	sqlDB, err := tempDB.DB()
	if err != nil {
		log.Fatalf("Failed to get underlying sql.DB: %v", err)
	}

	_, err = sqlDB.Exec(fmt.Sprintf("CREATE DATABASE IF NOT EXISTS %s CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", database))
	if err != nil {
		log.Fatalf("Failed to create database: %v", err)
	}

	sqlDB.Close()

	// Now connect to the specific database
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		username, password, host, port, database)

	// Reduce query log noise in production by default (can override via DB_LOG_LEVEL).
	// Options: silent | error | warn | info
	dbLogLevel := strings.ToLower(strings.TrimSpace(os.Getenv("DB_LOG_LEVEL")))
	if dbLogLevel == "" {
		if strings.ToLower(strings.TrimSpace(os.Getenv("GO_ENV"))) == "production" {
			dbLogLevel = "warn"
		} else {
			dbLogLevel = "info"
		}
	}
	logMode := logger.Info
	switch dbLogLevel {
	case "silent", "off", "none":
		logMode = logger.Silent
	case "error":
		logMode = logger.Error
	case "warn", "warning":
		logMode = logger.Warn
	case "info":
		logMode = logger.Info
	default:
		logMode = logger.Info
	}

	DB, err = gorm.Open(mysql.Open(dsn), &gorm.Config{
		Logger:                                   logger.Default.LogMode(logMode),
		DisableForeignKeyConstraintWhenMigrating: true,
	})

	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	log.Println("Database connected successfully")

	// Tune connection pool to reduce latency on remote DBs
	if sqlDB, e := DB.DB(); e == nil {
		sqlDB.SetMaxOpenConns(50)
		sqlDB.SetMaxIdleConns(25)
		sqlDB.SetConnMaxLifetime(60 * time.Minute)
		sqlDB.SetConnMaxIdleTime(15 * time.Minute)
	}

	// Auto migrate the schema (can be disabled by DB_AUTO_MIGRATE=false)
	if os.Getenv("DB_AUTO_MIGRATE") != "false" {
		// Some hosted MySQLs have legacy constraints/index names that cause GORM to try dropping
		// non-existent foreign keys (e.g., "uni_admin_users_username"). We migrate per-model and
		// ignore harmless DROP errors to avoid hard-failing startup.
		ignoreDropErr := func(e error) bool {
			if e == nil {
				return true
			}
			msg := e.Error()
			// MySQL 1091 (Can't DROP ...; check that column/key exists)
			if strings.Contains(msg, "Error 1091") || strings.Contains(strings.ToLower(msg), "can't drop") {
				log.Printf("AutoMigrate notice: ignoring benign drop error: %v", e)
				return true
			}
			return false
		}

		// Disable FK checks during migrate to reduce noisy failures
		DB.Exec("SET FOREIGN_KEY_CHECKS=0;")
		modelsToMigrate := []interface{}{
			&models.AdminUser{},
			&models.Language{},
			&models.Category{},
			&models.CategoryTranslation{},
			&models.Product{},
			&models.ProductImage{},
			&models.ProductTranslation{},
			&models.ProductAttribute{},
			&models.ProductReview{},
			&models.ProductFAQ{},
			&models.EbayImportDraft{},
			&models.PurchaseLink{},
			&models.SEORedirect{},
			&models.Customer{},
			&models.Order{},
			&models.OrderItem{},
			&models.PaymentTransaction{},
			&models.Banner{},
			&models.HomepageContent{},
			&models.CompanyProfile{},
			&models.ContactMessage{},
			&models.Coupon{},
			&models.CouponUsage{},
			&models.Ticket{},
			&models.TicketReply{},
			&models.TicketAttachment{},
			&models.MediaAsset{},
			&models.CloudflareCacheSetting{},
			&models.HotlinkProtectionSetting{},
			&models.PayPalSetting{},
			&models.EmailSetting{},
			&models.IndexNowSetting{},
			&models.EmailVerificationCode{},
			// Shipping (new template-based)
			&models.ShippingTemplate{},
			&models.ShippingWeightBracket{},
			&models.ShippingQuoteSurcharge{},
			// Shipping (carrier-specific)
			&models.ShippingCarrierTemplate{},
			&models.ShippingCarrierWeightBracket{},
			&models.ShippingCarrierQuoteSurcharge{},
			// Shipping allowed countries whitelist
			&models.ShippingAllowedCountry{},
			// Shipping free shipping settings
			&models.ShippingFreeSetting{},
			// Legacy flat shipping rate table (kept for compatibility; not used by new flow)
			&models.ShippingRate{},
			&models.WatermarkSetting{},
			&models.VisitorLog{},
			&models.AnalyticsSetting{},
			// News / Articles
			&models.Article{},
			&models.ArticleTranslation{},
		}
		for _, m := range modelsToMigrate {
			// GORM may try to "DROP FOREIGN KEY <uni_xxx>" on existing tables (a known benign issue when
			// unique indexes are mistaken for FKs during diff). If that happens while migrating a model
			// whose table does NOT yet exist (e.g. products), AutoMigrate aborts early and the table
			// never gets created. To keep startup reliable, we proactively create missing tables first.
			if !DB.Migrator().HasTable(m) {
				if e := DB.Migrator().CreateTable(m); e != nil {
					DB.Exec("SET FOREIGN_KEY_CHECKS=1;")
					log.Fatalf("Failed to create table for %T: %v", m, e)
				}
			}

			if e := DB.AutoMigrate(m); !ignoreDropErr(e) {
				// Re-enable FK checks before exiting
				DB.Exec("SET FOREIGN_KEY_CHECKS=1;")
				log.Fatalf("Failed to migrate schema for %T: %v", m, e)
			}
		}
		DB.Exec("SET FOREIGN_KEY_CHECKS=1;")
		log.Println("Database migration completed (with tolerant drop handling)")
	} else {
		log.Println("DB_AUTO_MIGRATE=false, skipping AutoMigrate")
	}

	// Create default admin user if not exists
	createDefaultAdmin()

	// Create default categories
	createDefaultCategories()

	// Create default company profile
	createDefaultCompanyProfile()

	// Clean legacy brand/domain text left by older imports or previous SEO generation.
	sanitizeLegacyBrandReferences()
}

func createDefaultAdmin() {
	// 为避免生产环境出现“硬编码默认密码”，默认仅在开发环境自动创建；
	// 生产环境需要显式开启 SEED_DEFAULT_ADMIN=true 并提供 DEFAULT_ADMIN_PASSWORD。
	goEnv := os.Getenv("GO_ENV")
	seedSwitch := os.Getenv("SEED_DEFAULT_ADMIN")
	if seedSwitch == "" {
		// 未配置开关时：开发/测试默认创建，生产默认不创建
		if goEnv == "production" {
			log.Println("SEED_DEFAULT_ADMIN 未启用且 GO_ENV=production，跳过默认管理员创建")
			return
		}
	} else if seedSwitch != "true" {
		log.Println("SEED_DEFAULT_ADMIN!=true，跳过默认管理员创建")
		return
	}

	username := os.Getenv("DEFAULT_ADMIN_USERNAME")
	if username == "" {
		username = "admin"
	}
	email := os.Getenv("DEFAULT_ADMIN_EMAIL")
	if email == "" {
		email = "admin@vibocnc.com"
	}
	fullName := os.Getenv("DEFAULT_ADMIN_FULLNAME")
	if fullName == "" {
		fullName = "System Administrator"
	}
	role := os.Getenv("DEFAULT_ADMIN_ROLE")
	if role == "" {
		role = "admin"
	}

	password := os.Getenv("DEFAULT_ADMIN_PASSWORD")
	if password == "" {
		if goEnv == "production" {
			log.Println("GO_ENV=production 且 DEFAULT_ADMIN_PASSWORD 未设置，跳过默认管理员创建（建议设置后再启用 SEED_DEFAULT_ADMIN=true）")
			return
		}
		// 开发环境兜底：便于本地启动；不会在日志中输出明文
		password = "admin123"
	}

	hashedPassword, err := utils.HashPassword(password)
	if err != nil {
		log.Printf("Failed to hash admin password: %v", err)
		return
	}

	var existing models.AdminUser
	err = DB.Where("username = ?", username).First(&existing).Error
	if err == nil {
		// 已存在则默认不覆盖密码，避免每次启动重置
		if os.Getenv("RESET_DEFAULT_ADMIN_PASSWORD") == "true" {
			if e := DB.Model(&existing).Updates(map[string]any{
				"email":         email,
				"full_name":     fullName,
				"role":          role,
				"is_active":     true,
				"password_hash": hashedPassword,
			}).Error; e != nil {
				log.Printf("Failed to reset default admin password: %v", e)
				return
			}
			log.Printf("默认管理员已更新（用户名：%s，已重置密码）", username)
			return
		}

		// 可选：同步基础资料但不改密码
		if e := DB.Model(&existing).Updates(map[string]any{
			"email":     email,
			"full_name": fullName,
			"role":      role,
			"is_active": true,
		}).Error; e != nil {
			log.Printf("Failed to update default admin profile: %v", e)
		}
		log.Printf("默认管理员已存在（用户名：%s），跳过创建/重置", username)
		return
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("Failed to query default admin user: %v", err)
		return
	}

	admin := models.AdminUser{
		Username:     username,
		Email:        email,
		PasswordHash: hashedPassword,
		FullName:     fullName,
		Role:         role,
		IsActive:     true,
	}

	if e := DB.Create(&admin).Error; e != nil {
		log.Printf("Failed to create default admin user: %v", e)
		return
	}
	log.Printf("默认管理员已创建（用户名：%s）。密码来自 DEFAULT_ADMIN_PASSWORD（未输出明文）", username)
}

func sanitizeLegacyBrandReferences() {
	if os.Getenv("DISABLE_LEGACY_BRAND_SANITIZE") == "true" {
		return
	}
	silentDB := DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})

	type tableColumns struct {
		table   string
		columns []string
	}

	targets := []tableColumns{
		{"admin_users", []string{"email", "full_name"}},
		{"products", []string{
			"name", "short_description", "description",
			"meta_title", "meta_description", "meta_keywords",
			"packaging_info", "compatibility_info", "installation_guide", "maintenance_tips",
			"datasheet_url", "manual_url",
		}},
		{"product_translations", []string{"name", "short_description", "description", "meta_title", "meta_description", "meta_keywords"}},
		{"product_faqs", []string{"question", "answer"}},
		{"categories", []string{"name", "description", "image_url"}},
		{"category_translations", []string{"name", "description"}},
		{"articles", []string{"title", "custom_path", "summary", "content", "featured_image", "image_urls", "meta_title", "meta_description", "meta_keywords"}},
		{"article_translations", []string{"title", "slug", "summary", "content", "meta_title", "meta_description", "meta_keywords"}},
		{"homepage_contents", []string{"title", "subtitle", "description", "image_url", "button_text", "button_url"}},
		{"company_profiles", []string{"company_name", "company_subtitle", "location", "description1", "description2", "description_1", "description_2", "achievement"}},
		{"email_settings", []string{"from_name", "from_email", "reply_to", "smtp_host", "smtp_username", "order_notification_emails"}},
		{"hotlink_protection_settings", []string{"allowed_hosts"}},
		{"index_now_settings", []string{"site_url", "last_submission_host", "last_submission_note"}},
		{"seo_redirects", []string{"old_url", "new_url"}},
		{"ebay_import_drafts", []string{"source_url", "source_title", "source_description", "name", "description", "meta_title", "meta_description", "meta_keywords"}},
	}

	legacyCompact := "vco" + "cnc"
	legacySpareHost := legacyCompact + "spare.com"
	legacyShopHost := legacyCompact + ".shop"
	replacements := [][2]string{
		{"sales@" + legacySpareHost, "sales@vibocnc.com"},
		{"admin@" + legacyShopHost, "admin@vibocnc.com"},
		{"https://www." + legacySpareHost, "https://www.vibocnc.com"},
		{"http://www." + legacySpareHost, "https://www.vibocnc.com"},
		{"https://" + legacySpareHost, "https://www.vibocnc.com"},
		{"http://" + legacySpareHost, "https://www.vibocnc.com"},
		{"www." + legacySpareHost, "www.vibocnc.com"},
		{legacySpareHost, "vibocnc.com"},
		{"https://www." + legacyShopHost, "https://www.vibocnc.com"},
		{"https://" + legacyShopHost, "https://www.vibocnc.com"},
		{"www." + legacyShopHost, "www.vibocnc.com"},
		{legacyShopHost, "vibocnc.com"},
		{"VCO" + "CNC", "VIBO CNC"},
		{"VCO " + "CNC", "VIBO CNC"},
		{"Vco" + "cnc", "VIBO CNC"},
		{legacyCompact, "vibocnc"},
	}

	totalUpdated := int64(0)
	for _, target := range targets {
		if !silentDB.Migrator().HasTable(target.table) {
			continue
		}
		for _, column := range target.columns {
			if !silentDB.Migrator().HasColumn(target.table, column) {
				continue
			}
			for _, pair := range replacements {
				oldValue := pair[0]
				newValue := pair[1]
				result := silentDB.Exec(
					fmt.Sprintf("UPDATE `%s` SET `%s` = REPLACE(`%s`, ?, ?) WHERE `%s` LIKE ?", target.table, column, column, column),
					oldValue,
					newValue,
					"%"+oldValue+"%",
				)
				if result.Error != nil {
					log.Printf("Legacy brand sanitize skipped %s.%s: %v", target.table, column, result.Error)
					continue
				}
				totalUpdated += result.RowsAffected
			}
		}
	}

	if totalUpdated > 0 {
		log.Printf("Legacy brand/domain references sanitized: %d field update(s)", totalUpdated)
	}
}

func createDefaultCategories() {
	// Check if categories already exist
	var count int64
	DB.Model(&models.Category{}).Count(&count)
	if count > 0 {
		log.Println("Categories already exist, skipping creation")
		return
	}

	fanuc := models.Category{
		Name:        "Fanuc",
		Slug:        "fanuc",
		Description: "FANUC CNC, servo, spindle, PCB, I/O, cable, encoder, power supply and accessory parts",
		SortOrder:   1,
		IsActive:    true,
	}
	if err := DB.Create(&fanuc).Error; err != nil {
		log.Printf("Error creating category %s: %v", fanuc.Name, err)
		return
	}

	// Create default FANUC type categories under the FANUC root.
	parentID := fanuc.ID
	categories := []models.Category{
		{
			Name:        "FANUC I/O Module",
			Slug:        "fanuc-i-o-module",
			Description: "FANUC input and output modules",
			ParentID:    &parentID,
			SortOrder:   1,
			IsActive:    true,
		},
		{
			Name:        "FANUC Operator Panel & MDI",
			Slug:        "fanuc-operator-panel-mdi",
			Description: "FANUC operator panels, MDI units and teach pendants",
			ParentID:    &parentID,
			SortOrder:   2,
			IsActive:    true,
		},
		{
			Name:        "FANUC Display / Monitor",
			Slug:        "fanuc-display-monitor",
			Description: "FANUC CRT, LCD, display and monitor parts",
			ParentID:    &parentID,
			SortOrder:   3,
			IsActive:    true,
		},
		{
			Name:        "FANUC Encoder / Feedback",
			Slug:        "fanuc-encoder-feedback",
			Description: "FANUC encoders, pulse coders and feedback components",
			ParentID:    &parentID,
			SortOrder:   4,
			IsActive:    true,
		},
		{
			Name:        "FANUC Cables & Connectors",
			Slug:        "fanuc-cables-connectors",
			Description: "FANUC cables, connectors and harnesses",
			ParentID:    &parentID,
			SortOrder:   5,
			IsActive:    true,
		},
		{
			Name:        "FANUC Memory / Storage",
			Slug:        "fanuc-memory-storage",
			Description: "FANUC memory and storage components",
			ParentID:    &parentID,
			SortOrder:   6,
			IsActive:    true,
		},
		{
			Name:        "FANUC Battery",
			Slug:        "fanuc-battery",
			Description: "FANUC batteries and backup power accessories",
			ParentID:    &parentID,
			SortOrder:   7,
			IsActive:    true,
		},
		{
			Name:        "FANUC Filters / Fan Unit / Cooling",
			Slug:        "fanuc-filters-fan-unit-cooling",
			Description: "FANUC filters, fan units and cooling parts",
			ParentID:    &parentID,
			SortOrder:   8,
			IsActive:    true,
		},
		{
			Name:        "FANUC Accessories & Others",
			Slug:        "fanuc-accessories-others",
			Description: "FANUC accessories and other replacement parts",
			ParentID:    &parentID,
			SortOrder:   9,
			IsActive:    true,
		},
		{
			Name:        "FANUC CNC System Parts",
			Slug:        "fanuc-cnc-system-parts",
			Description: "FANUC CNC controller and system parts",
			ParentID:    &parentID,
			SortOrder:   10,
			IsActive:    true,
		},
		{
			Name:        "FANUC Servo Amplifier / Drive",
			Slug:        "fanuc-servo-amplifier-drive",
			Description: "FANUC servo amplifiers and drives",
			ParentID:    &parentID,
			SortOrder:   11,
			IsActive:    true,
		},
		{
			Name:        "FANUC Spindle Amplifier / Drive",
			Slug:        "fanuc-spindle-amplifier-drive",
			Description: "FANUC spindle amplifiers and drives",
			ParentID:    &parentID,
			SortOrder:   12,
			IsActive:    true,
		},
		{
			Name:        "FANUC Servo Motor",
			Slug:        "fanuc-servo-motor",
			Description: "FANUC servo motors",
			ParentID:    &parentID,
			SortOrder:   13,
			IsActive:    true,
		},
		{
			Name:        "FANUC Spindle Motor",
			Slug:        "fanuc-spindle-motor",
			Description: "FANUC spindle motors",
			ParentID:    &parentID,
			SortOrder:   14,
			IsActive:    true,
		},
		{
			Name:        "FANUC Power Supply",
			Slug:        "fanuc-power-supply",
			Description: "FANUC power supplies, fuses and power components",
			ParentID:    &parentID,
			SortOrder:   15,
			IsActive:    true,
		},
		{
			Name:        "FANUC PCB / Control Board",
			Slug:        "fanuc-pcb-control-board",
			Description: "FANUC PCB boards and control boards",
			ParentID:    &parentID,
			SortOrder:   16,
			IsActive:    true,
		},
	}

	for _, category := range categories {
		if err := DB.Create(&category).Error; err != nil {
			log.Printf("Error creating category %s: %v", category.Name, err)
		} else {
			log.Printf("Created category: %s", category.Name)
		}
	}

	log.Println("Default categories created successfully")
}

func createDefaultCompanyProfile() {
	// Check if company profile already exists
	var count int64
	DB.Model(&models.CompanyProfile{}).Count(&count)
	if count > 0 {
		log.Println("Company profile already exists, skipping creation")
		return
	}

	// Create default company profile
	defaultProfile := models.CompanyProfile{
		CompanyName:       "VIBO CNC",
		CompanySubtitle:   "Industrial Automation Specialists",
		EstablishmentYear: "2005",
		Location:          "Kunshan, China",
		WorkshopSize:      "5,000sqm",
		Description1:      "VIBO CNC established in 2005 in Kunshan, China. We are selling automation components like System unit, Circuit board, PLC, HMI, Inverter, Encoder, Amplifier, Servomotor, Servodrive etc of AB ABB, Fanuc, Mitsubishi, Siemens and other manufacturers in our own 5,000sqm workshop.",
		Description2:      "Especially Fanuc, We are one of the top three suppliers in China. We now have 27 workers, 10 sales and 100,000 items regularly stocked. Daily parcel around 50-100pcs, yearly turnover around 200 million.",
		Achievement:       "Top 3 FANUC Supplier in China",
		Stats: models.CompanyStatsArray{
			{Icon: "CalendarIcon", Value: "2005", Label: "Established", Description: "Years of experience"},
			{Icon: "UserGroupIcon", Value: "27", Label: "Workers", Description: "Professional team"},
			{Icon: "UserGroupIcon", Value: "10", Label: "Sales Staff", Description: "Dedicated sales team"},
			{Icon: "ArchiveBoxIcon", Value: "100,000", Label: "Items Stocked", Description: "Regular inventory"},
			{Icon: "TruckIcon", Value: "50-100", Label: "Daily Parcels", Description: "Shipments per day"},
			{Icon: "CurrencyDollarIcon", Value: "200M", Label: "Yearly Turnover", Description: "Annual revenue"},
		},
		Expertise: models.StringArray{
			"AB & ABB Components",
			"FANUC Systems",
			"Mitsubishi Parts",
			"Siemens Solutions",
			"Quality Testing",
			"Global Shipping",
		},
		WorkshopFacilities: models.WorkshopFacilitiesArray{
			{ID: "1", Title: "Modern Facility", Description: "State-of-the-art workshop with advanced equipment", ImageURL: "/api/placeholder/300/200"},
			{ID: "2", Title: "Inventory Management", Description: "Organized storage for 100,000+ items", ImageURL: "/api/placeholder/300/200"},
			{ID: "3", Title: "Quality Control", Description: "Rigorous testing and quality assurance", ImageURL: "/api/placeholder/300/200"},
		},
	}

	if err := DB.Create(&defaultProfile).Error; err != nil {
		log.Printf("Error creating default company profile: %v", err)
	} else {
		log.Println("Default company profile created successfully")
	}
}

func GetDB() *gorm.DB {
	return DB
}
