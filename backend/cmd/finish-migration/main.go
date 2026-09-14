package main

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type ProductMigration struct {
	ID               uint      `json:"id" gorm:"primaryKey"`
	SKU              string    `json:"sku"`
	Name             string    `json:"name"`
	Slug             string    `json:"slug"`
	ShortDescription string    `json:"short_description"`
	Description      string    `json:"description"`
	Price            float64   `json:"price"`
	ComparePrice     *float64  `json:"compare_price"`
	CostPrice        *float64  `json:"cost_price"`
	StockQuantity    int       `json:"stock_quantity"`
	MinStockLevel    int       `json:"min_stock_level"`
	Weight           *float64  `json:"weight"`
	Dimensions       string    `json:"dimensions"`
	Brand            string    `json:"brand"`
	Model            string    `json:"model"`
	PartNumber       string    `json:"part_number"`
	CategoryID       uint      `json:"category_id"`
	IsActive         bool      `json:"is_active"`
	IsFeatured       bool      `json:"is_featured"`
	MetaTitle        string    `json:"meta_title"`
	MetaDescription  string    `json:"meta_description"`
	MetaKeywords     string    `json:"meta_keywords"`
	ImageURLs        string    `json:"image_urls"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (ProductMigration) TableName() string {
	return "products"
}

type ProductImageMigration struct {
	ID           uint      `json:"id" gorm:"primaryKey"`
	ProductID    uint      `json:"product_id"`
	URL          string    `json:"url"`
	Filename     string    `json:"filename"`
	OriginalName string    `json:"original_name"`
	AltText      string    `json:"alt_text"`
	SortOrder    int       `json:"sort_order"`
	IsPrimary    bool      `json:"is_primary"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (ProductImageMigration) TableName() string {
	return "product_images"
}

type ProductAttributeMigration struct {
	ID             uint      `json:"id" gorm:"primaryKey"`
	ProductID      uint      `json:"product_id"`
	AttributeName  string    `json:"attribute_name"`
	AttributeValue string    `json:"attribute_value"`
	SortOrder      int       `json:"sort_order"`
	CreatedAt      time.Time `json:"created_at"`
}

func (ProductAttributeMigration) TableName() string {
	return "product_attributes"
}

func main() {
	// 加载环境变量
	switch os.Getenv("GO_ENV") {
	case "production":
		_ = godotenv.Load(".env.production")
	default:
		_ = godotenv.Load(".env")
	}

	// MySQL连接（优先使用 MYSQL_DSN，其次用 DB_* 拼装）
	mysqlDSN := os.Getenv("MYSQL_DSN")
	if mysqlDSN == "" {
		host := getenv("DB_HOST", "127.0.0.1")
		port := getenv("DB_PORT", "3306")
		user := getenv("DB_USER", "root")
		pass := getenv("DB_PASSWORD", "")
		name := getenv("DB_NAME", "fanuc_sales")
		mysqlDSN = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, port, name)
	}
	mysqlDB, err := gorm.Open(mysql.Open(mysqlDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		log.Fatalf("Failed to connect to MySQL: %v", err)
	}
	log.Println("Connected to MySQL successfully")

	// PostgreSQL连接（优先使用 POSTGRES_DSN，其次用 PG_* 拼装）
	postgresDSN := os.Getenv("POSTGRES_DSN")
	if postgresDSN == "" {
		pgHost := getenv("PG_HOST", "127.0.0.1")
		pgPort := getenv("PG_PORT", "5432")
		pgUser := getenv("PG_USER", "postgres")
		pgPass := getenv("PG_PASSWORD", "")
		pgDBName := getenv("PG_DB", "postgres")
		pgSSL := getenv("PG_SSLMODE", "disable")
		pgTZ := getenv("PG_TIMEZONE", "UTC")
		postgresDSN = fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=%s",
			pgHost, pgUser, pgPass, pgDBName, pgPort, pgSSL, pgTZ)
	}
	postgresDB, err := gorm.Open(postgres.Open(postgresDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	log.Println("Connected to PostgreSQL successfully")

	// 完成剩余的迁移
	migrateImages(mysqlDB, postgresDB)
	migrateAttributes(mysqlDB, postgresDB)

	log.Println("Migration completed successfully!")
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func migrateImages(mysqlDB, pgDB *gorm.DB) {
	log.Println("Migrating product images...")
	var images []ProductImageMigration
	mysqlDB.Find(&images)

	successCount := 0
	for _, image := range images {
		// 查找对应的新产品ID
		var newProduct ProductMigration
		var oldProduct ProductMigration

		// 从MySQL获取原产品信息
		if err := mysqlDB.First(&oldProduct, image.ProductID).Error; err != nil {
			log.Printf("Error finding old product with ID %d: %v", image.ProductID, err)
			continue
		}

		// 在PostgreSQL中通过SKU查找新产品
		if err := pgDB.Where("sku = ?", oldProduct.SKU).First(&newProduct).Error; err != nil {
			log.Printf("Error finding new product with SKU %s: %v", oldProduct.SKU, err)
			continue
		}

		// 更新产品ID并重置图片ID
		image.ProductID = newProduct.ID
		image.ID = 0

		result := pgDB.Create(&image)
		if result.Error != nil {
			log.Printf("Error migrating product image: %v", result.Error)
		} else {
			successCount++
			if successCount%10 == 0 {
				log.Printf("Migrated %d product images so far...", successCount)
			}
		}
	}
	log.Printf("Successfully migrated %d out of %d product images", successCount, len(images))
}

func migrateAttributes(mysqlDB, pgDB *gorm.DB) {
	log.Println("Migrating product attributes...")
	var attributes []ProductAttributeMigration
	mysqlDB.Find(&attributes)

	successCount := 0
	for _, attr := range attributes {
		// 查找对应的新产品ID
		var newProduct ProductMigration
		var oldProduct ProductMigration

		// 从MySQL获取原产品信息
		if err := mysqlDB.First(&oldProduct, attr.ProductID).Error; err != nil {
			log.Printf("Error finding old product with ID %d: %v", attr.ProductID, err)
			continue
		}

		// 在PostgreSQL中通过SKU查找新产品
		if err := pgDB.Where("sku = ?", oldProduct.SKU).First(&newProduct).Error; err != nil {
			log.Printf("Error finding new product with SKU %s: %v", oldProduct.SKU, err)
			continue
		}

		// 更新产品ID并重置属性ID
		attr.ProductID = newProduct.ID
		attr.ID = 0

		result := pgDB.Create(&attr)
		if result.Error != nil {
			log.Printf("Error migrating product attribute: %v", result.Error)
		} else {
			successCount++
			if successCount%10 == 0 {
				log.Printf("Migrated %d product attributes so far...", successCount)
			}
		}
	}
	log.Printf("Successfully migrated %d out of %d product attributes", successCount, len(attributes))
}
