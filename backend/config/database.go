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
		email = "admin@vcocnc.shop"
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

func createDefaultCategories() {
	// Check if categories already exist
	var count int64
	DB.Model(&models.Category{}).Count(&count)
	if count > 0 {
		log.Println("Categories already exist, skipping creation")
		return
	}

	// Create default categories
	categories := []models.Category{
		{
			Name:        "PCB Boards",
			Slug:        "pcb-boards",
			Description: "FANUC PCB Boards and Circuit Boards",
			SortOrder:   1,
			IsActive:    true,
		},
		{
			Name:        "I/O Modules",
			Slug:        "io-modules",
			Description: "FANUC Input/Output Modules",
			SortOrder:   2,
			IsActive:    true,
		},
		{
			Name:        "Servo Motors",
			Slug:        "servo-motors",
			Description: "FANUC Servo Motors and Drives",
			SortOrder:   3,
			IsActive:    true,
		},
		{
			Name:        "Control Units",
			Slug:        "control-units",
			Description: "FANUC Control Units and Controllers",
			SortOrder:   4,
			IsActive:    true,
		},
		{
			Name:        "Power Supplies",
			Slug:        "power-supplies",
			Description: "FANUC Power Supply Units",
			SortOrder:   5,
			IsActive:    true,
		},
		{
			Name:        "Cables & Connectors",
			Slug:        "cables-connectors",
			Description: "FANUC Cables and Connector Components",
			SortOrder:   6,
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
		CompanyName:       "Vcocnc",
		CompanySubtitle:   "Industrial Automation Specialists",
		EstablishmentYear: "2005",
		Location:          "Kunshan, China",
		WorkshopSize:      "5,000sqm",
		Description1:      "Vcocnc established in 2005 in Kunshan, China. We are selling automation components like System unit, Circuit board, PLC, HMI, Inverter, Encoder, Amplifier, Servomotor, Servodrive etc of AB ABB, Fanuc, Mitsubishi, Siemens and other manufacturers in our own 5,000sqm workshop.",
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
