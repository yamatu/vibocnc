package config

import (
	"encoding/json"
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
		// Named AI profiles add columns to tables that may already contain years
		// of settings and SEO job history. Repair those additive fields first so
		// a benign error in the broader migration cannot leave a partial schema.
		if err := migrateAIAgentProfileSchema(DB); err != nil {
			log.Fatalf("Failed to migrate required AI profile schema: %v", err)
		}

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
			&models.EbayImportJSONTask{},
			&models.EbayImportJSONTaskItem{},
			&models.PurchaseLink{},
			&models.SEORedirect{},
			&models.Customer{},
			&models.Order{},
			&models.OrderItem{},
			&models.PaymentTransaction{},
			&models.Refund{},
			&models.Banner{},
			&models.HomepageContent{},
			&models.CompanyProfile{},
			&models.SocialMediaSetting{},
			&models.ContactMessage{},
			&models.Coupon{},
			&models.CouponUsage{},
			&models.Ticket{},
			&models.TicketReply{},
			&models.TicketAttachment{},
			&models.MediaAsset{},
			&models.CloudflareCacheSetting{},
			&models.AIAgentProfile{},
			&models.AIAgentSetting{},
			&models.AIAgentSEOJob{},
			&models.AIAgentSEOJobItem{},
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
			&models.ProductImageAutofillJob{},
			&models.ProductImageCleanupJob{},
			&models.ProductImageArchiveJob{},
			&models.ProductImagePolicySetting{},
			&models.ProductImageTrustedURL{},
			&models.ProductCatalogImportJob{},
			&models.VisitorLog{},
			&models.AnalyticsSetting{},
			// News / Articles
			&models.Article{},
			&models.ArticleTranslation{},
			&models.SitePage{},
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
		// Preserve existing articles created before content types were introduced.
		DB.Model(&models.Article{}).Where("content_type IS NULL OR content_type = ''").Update("content_type", "news")
		log.Println("Database migration completed (with tolerant drop handling)")
	} else {
		log.Println("DB_AUTO_MIGRATE=false, skipping AutoMigrate")
		if missing := missingAIAgentProfileSchema(DB); len(missing) > 0 {
			log.Printf(
				"AI profile schema is incomplete (%s); run backend/migrations/20260808_add_ai_agent_profiles.sql before using AI profiles",
				strings.Join(missing, ", "),
			)
		}
	}

	// Create default admin user if not exists
	createDefaultAdmin()

	// Create default categories
	createDefaultCategories()

	// Create default company profile
	createDefaultCompanyProfile()

	// Clean legacy brand/domain text left by older imports or previous SEO generation.
	sanitizeLegacyBrandReferences()

	// Upgrade known legacy company facts and duplicated homepage copy without
	// overwriting unrelated admin-managed content.
	migrateLegacyCompanyFacts()

	// Preserve the former singleton provider configuration as the first named
	// AI profile. This migration is idempotent and copies encrypted key material
	// without decrypting or rotating it.
	migrateLegacyAIAgentProfile()
}

func legacyAIAgentProfileFromSetting(setting models.AIAgentSetting) models.AIAgentProfile {
	apiMode := setting.APIMode
	if apiMode == "" {
		apiMode = "standard_chat"
	}
	return models.AIAgentProfile{
		Name:            "Default",
		BaseURL:         setting.BaseURL,
		APIKeyEnc:       setting.APIKeyEnc,
		Model:           setting.Model,
		APIMode:         apiMode,
		ReasoningEffort: setting.ReasoningEffort,
		TimeoutSeconds:  setting.TimeoutSeconds,
	}
}

func migrateLegacyAIAgentProfile() {
	if DB == nil || !DB.Migrator().HasTable(&models.AIAgentSetting{}) ||
		!DB.Migrator().HasTable(&models.AIAgentProfile{}) ||
		!DB.Migrator().HasColumn(&models.AIAgentSetting{}, "ActiveProfileID") {
		return
	}

	silentDB := DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	createdProfile := false
	err := silentDB.Transaction(func(tx *gorm.DB) error {
		var setting models.AIAgentSetting
		err := tx.First(&setting, 1).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			setting = models.AIAgentSetting{
				ID: 1, BaseURL: "https://api.openai.com/v1", Model: "gpt-5.6-terra", APIMode: "standard_chat",
				ReasoningEffort: "medium", TimeoutSeconds: 75, SEOJobConcurrency: 2, SEOCandidateLimit: 30000,
				DefaultWarrantyPeriod: "12 months", DefaultLeadTime: "3-7 days",
			}
			if err := tx.Create(&setting).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}

		if setting.ActiveProfileID != nil {
			var count int64
			if err := tx.Model(&models.AIAgentProfile{}).Where("id = ?", *setting.ActiveProfileID).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return nil
			}
		}

		var profile models.AIAgentProfile
		if err := tx.Order("id ASC").First(&profile).Error; errors.Is(err, gorm.ErrRecordNotFound) {
			profile = legacyAIAgentProfileFromSetting(setting)
			if err := tx.Create(&profile).Error; err != nil {
				return err
			}
			createdProfile = true
		} else if err != nil {
			return err
		}

		return tx.Model(&models.AIAgentSetting{}).Where("id = ?", setting.ID).Updates(map[string]any{
			"active_profile_id": profile.ID,
			"base_url":          profile.BaseURL,
			"api_key_enc":       profile.APIKeyEnc,
			"model":             profile.Model,
			"api_mode":          profile.APIMode,
			"reasoning_effort":  profile.ReasoningEffort,
			"timeout_seconds":   profile.TimeoutSeconds,
		}).Error
	})
	if err != nil {
		log.Printf("AI profile migration warning: %v", err)
		return
	}
	if createdProfile {
		log.Println("Legacy AI provider settings migrated to the Default profile")
	}
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
		{"VIBO CNC", "Vibocnc"},
		{"Vibo CNC", "Vibocnc"},
		{"ViboCNC", "Vibocnc"},
		{"VIBOCNC", "Vibocnc"},
		{"VCO" + "CNC", "Vibocnc"},
		{"VCO " + "CNC", "Vibocnc"},
		{"Vco" + "cnc", "Vibocnc"},
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

func upgradeLegacyCompanyCopy(value string) string {
	replacements := [][2]string{
		{"Vibocnc- One-Stop CNC Solution Supplier", "Industrial Automation Parts, CNC Spares & Repair Support"},
		{"Your Trusted Partner Since 2005", "FANUC, Siemens, Mitsubishi, ABB and 20+ automation brands"},
		{"Vibocnc established in 2005 in Kunshan, China. We are selling automation components like System unit, Circuit board, PLC, HMI, Inverter, Encoder, Amplifier, Servomotor, Servodrive etc of AB, ABB, Fanuc, Mitsubishi, Siemens and other manufacturers.", "Since 2007, Vibocnc has helped maintenance teams source current, legacy and obsolete automation parts, verify models and coordinate inspection, repair evaluation and worldwide delivery."},
		{"Vibocnc established in 2005 in Kunshan, China. We are selling automation components like System unit, Circuit board, PLC, HMI, Inverter, Encoder, Amplifier, Servomotor, Servodrive etc of AB ABB, Fanuc, Mitsubishi, Siemens and other manufacturers in our own 5,000sqm workshop.", "Since 2007, Vibocnc has helped maintenance teams source current, legacy and obsolete automation parts, verify models and coordinate inspection, repair evaluation and worldwide delivery."},
		{"5,000sqm Workshop Facility", "3,500 sqm Parts Inspection & Service Facility"},
		{"Top 3 Fanuc Supplier in China", "Organized stock, testing benches and export packing"},
		{"Especially Fanuc, We are one of the top three suppliers in China. We now have 27 workers, 10 sales and 100,000 items regularly stocked. Daily parcel around 50-100pcs, yearly turnover around 200 million.", "Our Kunshan facility supports organized storage, incoming inspection, functional checks, protective export packing and efficient dispatch for urgent industrial parts orders."},
		{"20+ Years Professional Service", "15+ Years Supporting Industrial Maintenance"},
		{"More than 18 years experience we have ability to coordinate specific strengths into a whole, providing clients with solutions that consider various import and export transportation options.", "Our sales and technical teams coordinate part-number checks, sourcing, testing, repair evaluation and international transport as one practical service."},
		{"More than 20 years", "More than 15 years"},
		{"20+ Years", "15+ Years"},
		{"20+ years", "15+ years"},
		{"5,000sqm", "3,500sqm"},
		{"5,000 sqm", "3,500 sqm"},
		{"5,000 m²", "3,500 m²"},
		{"2005", "2007"},
		{"Yearly Turnover: 200M", "Worldwide Delivery Support"},
		{"Yearly Turnover / 200M", "Worldwide Delivery Support"},
		{"200M Yearly Turnover", "Worldwide Delivery Support"},
		{"Yearly Turnover", "Worldwide Delivery Support"},
		{"ISO Certified", "Documented Inspection"},
		{"International quality management standards", "Documented inspection and quality-control procedures"},
		{"24/7 Operations", "Responsive Service"},
		{"24/7 Support Available", "Responsive Support"},
		{"24/7 Availability", "Responsive Support"},
		{"24/7 availability", "Responsive support"},
		{"Quality certification process", "Documented inspection process"},
		{"Certified technicians", "Experienced technicians"},
		{"Certified specialists", "Automation parts specialists"},
		{"Join thousands of satisfied customers worldwide.", "Contact our team to discuss your automation parts requirements."},
		{"Continuous production", "Parts inspection and service support"},
		{"Quality Guaranteed", "Quality Checked"},
		{"Quality guarantee", "Quality checks"},
	}

	result := value
	for _, replacement := range replacements {
		result = strings.ReplaceAll(result, replacement[0], replacement[1])
	}
	return result
}

func normalizeLegacyClaimValue(value any) string {
	return strings.ToLower(strings.Join(strings.Fields(fmt.Sprint(value)), " "))
}

func isUnsupportedLegacyStat(value, label, description, title, subtitle any) bool {
	normalizedValue := normalizeLegacyClaimValue(value)
	normalizedLabel := normalizeLegacyClaimValue(label)
	normalizedTitle := normalizeLegacyClaimValue(title)
	normalizedDescription := normalizeLegacyClaimValue(description)
	normalizedSubtitle := normalizeLegacyClaimValue(subtitle)

	if normalizedLabel == "yearly turnover" || normalizedTitle == "yearly turnover" ||
		(normalizedValue == "200m" && (normalizedDescription == "annual revenue" || normalizedSubtitle == "annual revenue")) {
		return true
	}
	if normalizedValue == "24/7" && (normalizedLabel == "operations" || normalizedTitle == "operations") {
		return true
	}
	if (normalizedLabel == "operations" || normalizedTitle == "operations") &&
		(normalizedDescription == "continuous production" || normalizedSubtitle == "continuous production") {
		return true
	}
	return normalizedValue == "iso" && (normalizedLabel == "certified" || normalizedTitle == "certified")
}

func isUnsupportedLegacyJSONItem(value any) bool {
	item, ok := value.(map[string]any)
	if !ok {
		return false
	}
	return isUnsupportedLegacyStat(
		item["value"],
		item["label"],
		item["description"],
		item["title"],
		item["subtitle"],
	)
}

func upgradeLegacyJSONValue(value any) (any, bool) {
	switch current := value.(type) {
	case string:
		updated := upgradeLegacyCompanyCopy(current)
		return updated, updated != current
	case []any:
		changed := false
		updatedItems := make([]any, 0, len(current))
		for _, item := range current {
			if isUnsupportedLegacyJSONItem(item) {
				changed = true
				continue
			}
			updated, itemChanged := upgradeLegacyJSONValue(item)
			updatedItems = append(updatedItems, updated)
			changed = changed || itemChanged
		}
		return updatedItems, changed
	case map[string]any:
		changed := false
		for key, item := range current {
			updated, itemChanged := upgradeLegacyJSONValue(item)
			current[key] = updated
			changed = changed || itemChanged
		}

		context := strings.ToLower(fmt.Sprintf(
			"%v %v %v %v",
			current["label"],
			current["description"],
			current["title"],
			current["subtitle"],
		))
		if _, hasValue := current["value"]; hasValue {
			setIfDifferent := func(key string, value any) {
				if fmt.Sprint(current[key]) == fmt.Sprint(value) {
					return
				}
				current[key] = value
				changed = true
			}
			setStatValue := func(number float64, display string) {
				if _, isString := current["value"].(string); isString {
					setIfDifferent("value", display)
					return
				}
				setIfDifferent("value", number)
			}
			setSuffix := func(suffix string) {
				if _, exists := current["suffix"]; exists {
					setIfDifferent("suffix", suffix)
				}
			}
			switch {
			case strings.Contains(context, "years experience") || strings.Contains(context, "industry experience"):
				setStatValue(15, "15")
				setSuffix("+")
				setIfDifferent("description", "Supporting industrial maintenance teams since 2007")
			case strings.Contains(context, "workshop") || strings.Contains(context, "facility") || strings.Contains(context, "square meters") || strings.Contains(context, "sqm"):
				setStatValue(3500, "3,500")
				setSuffix(" sqm")
			case strings.Contains(context, "brand"):
				setStatValue(20, "20")
				setSuffix("+")
				setIfDifferent("description", "FANUC, Siemens, Mitsubishi, ABB and other automation brands")
			}
		}
		return current, changed
	default:
		return value, false
	}
}

func upgradeLegacyCompanyProfile(profile *models.CompanyProfile) bool {
	if profile == nil {
		return false
	}

	changed := false
	if profile.EstablishmentYear == "2005" {
		profile.EstablishmentYear = "2007"
		changed = true
	}
	if profile.WorkshopSize == "5,000sqm" || profile.WorkshopSize == "5,000 sqm" {
		profile.WorkshopSize = "3,500sqm"
		changed = true
	}
	for _, field := range []*string{
		&profile.CompanySubtitle,
		&profile.Description1,
		&profile.Description2,
		&profile.Achievement,
	} {
		updated := upgradeLegacyCompanyCopy(*field)
		if updated != *field {
			*field = updated
			changed = true
		}
	}

	statsChanged := false
	updatedStats := make(models.CompanyStatsArray, 0, len(profile.Stats))
	for _, stat := range profile.Stats {
		if isUnsupportedLegacyStat(stat.Value, stat.Label, stat.Description, "", "") {
			statsChanged = true
			continue
		}
		if stat.Value == "2005" && strings.EqualFold(stat.Label, "Established") {
			stat.Value = "2007"
			stat.Description = "Founded in Kunshan, China"
			statsChanged = true
		}
		updatedLabel := upgradeLegacyCompanyCopy(stat.Label)
		updatedDescription := upgradeLegacyCompanyCopy(stat.Description)
		if updatedLabel != stat.Label || updatedDescription != stat.Description {
			stat.Label = updatedLabel
			stat.Description = updatedDescription
			statsChanged = true
		}
		updatedStats = append(updatedStats, stat)
	}
	if statsChanged {
		profile.Stats = updatedStats
		changed = true
	}

	for index, expertise := range profile.Expertise {
		updated := upgradeLegacyCompanyCopy(expertise)
		if updated != expertise {
			profile.Expertise[index] = updated
			changed = true
		}
	}
	for index := range profile.WorkshopFacilities {
		facility := &profile.WorkshopFacilities[index]
		updatedTitle := upgradeLegacyCompanyCopy(facility.Title)
		updatedDescription := upgradeLegacyCompanyCopy(facility.Description)
		if updatedTitle != facility.Title || updatedDescription != facility.Description {
			facility.Title = updatedTitle
			facility.Description = updatedDescription
			changed = true
		}
	}

	return changed
}

func migrateLegacyCompanyFacts() {
	if os.Getenv("DISABLE_COMPANY_FACTS_MIGRATION") == "true" {
		return
	}

	silentDB := DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	updatedRecords := int64(0)

	var profiles []models.CompanyProfile
	if err := silentDB.Find(&profiles).Error; err == nil {
		for index := range profiles {
			profile := &profiles[index]
			if upgradeLegacyCompanyProfile(profile) && silentDB.Save(profile).Error == nil {
				updatedRecords++
			}
		}
	}

	var contents []models.HomepageContent
	if err := silentDB.Find(&contents).Error; err == nil {
		for index := range contents {
			content := &contents[index]
			changed := false
			for _, field := range []*string{&content.Title, &content.Subtitle, &content.Description} {
				updated := upgradeLegacyCompanyCopy(*field)
				if updated != *field {
					*field = updated
					changed = true
				}
			}

			if len(content.Data) > 0 && string(content.Data) != "null" {
				var decoded any
				if err := json.Unmarshal(content.Data, &decoded); err == nil {
					updated, dataChanged := upgradeLegacyJSONValue(decoded)
					if dataChanged {
						if encoded, err := json.Marshal(updated); err == nil {
							content.Data = encoded
							changed = true
						}
					}
				}
			}

			if upgradeHomepageSEOContent(content) {
				changed = true
			}

			if changed && silentDB.Save(content).Error == nil {
				updatedRecords++
			}
		}
	}

	if updatedRecords > 0 {
		log.Printf("Legacy company facts upgraded: %d record(s)", updatedRecords)
	}
}

const (
	legacyHomepageHeroTitle  = "Industrial Automation Parts, CNC Spares & Repair Support"
	brandedHomepageHeroTitle = "Vibocnc Industrial Automation Parts, CNC Spares & Repair Support"
)

func upgradeHomepageSEOContent(content *models.HomepageContent) bool {
	if content == nil {
		return false
	}

	changed := false
	if content.SectionKey == "hero_section" {
		if strings.TrimSpace(content.Title) == legacyHomepageHeroTitle {
			content.Title = brandedHomepageHeroTitle
			changed = true
		}

		if len(content.Data) > 0 && strings.TrimSpace(string(content.Data)) != "null" {
			var decoded map[string]any
			if err := json.Unmarshal(content.Data, &decoded); err == nil {
				if slides, ok := decoded["slides"].([]any); ok && len(slides) > 0 {
					if firstSlide, ok := slides[0].(map[string]any); ok {
						if title, ok := firstSlide["title"].(string); ok && strings.TrimSpace(title) == legacyHomepageHeroTitle {
							firstSlide["title"] = brandedHomepageHeroTitle
							if encoded, err := json.Marshal(decoded); err == nil {
								content.Data = encoded
								changed = true
							}
						}
					}
				}
			}
		}
	}

	if content.SectionKey == "brands_section" && !content.IsActive {
		hasText := false
		for _, value := range []string{
			content.Title,
			content.Subtitle,
			content.Description,
			content.ImageURL,
			content.ButtonText,
			content.ButtonURL,
		} {
			if strings.TrimSpace(value) != "" {
				hasText = true
				break
			}
		}
		rawData := strings.TrimSpace(string(content.Data))
		hasData := rawData != "" && rawData != "null" && rawData != "{}"
		if !hasText && !hasData {
			content.Title = "Brands We Supply"
			content.Description = "Browse current, legacy and obsolete automation parts from established industrial manufacturers, with model verification and worldwide shipping support."
			content.ButtonText = "Browse All Automation Parts"
			content.ButtonURL = "/products"
			content.IsActive = true
			changed = true
		}
	}

	return changed
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
		CompanyName:       "Vibocnc",
		CompanySubtitle:   "Industrial Automation Specialists",
		EstablishmentYear: "2007",
		Location:          "Kunshan, China",
		WorkshopSize:      "3,500sqm",
		Description1:      "Since 2007, Vibocnc has helped maintenance teams source current, legacy and obsolete automation parts, verify models and coordinate inspection, repair evaluation and worldwide delivery.",
		Description2:      "We support multiple automation brands with 27 workers, 10 sales professionals and more than 100,000 items regularly stocked. Daily parcel volume is around 50-100 pieces, with testing, repair and worldwide delivery support.",
		Achievement:       "Multi-Brand Automation Parts Supplier",
		Stats: models.CompanyStatsArray{
			{Icon: "CalendarIcon", Value: "2007", Label: "Established", Description: "Founded in Kunshan, China"},
			{Icon: "UserGroupIcon", Value: "27", Label: "Workers", Description: "Professional team"},
			{Icon: "UserGroupIcon", Value: "10", Label: "Sales Staff", Description: "Dedicated sales team"},
			{Icon: "ArchiveBoxIcon", Value: "100,000", Label: "Items Stocked", Description: "Regular inventory"},
			{Icon: "TruckIcon", Value: "50-100", Label: "Daily Parcels", Description: "Shipments per day"},
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
