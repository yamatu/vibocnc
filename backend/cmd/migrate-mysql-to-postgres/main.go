package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"sort"
	"time"

	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 说明：
// - 该工具用于将 MySQL 数据迁移到 PostgreSQL（按 SKU/Slug 做映射）
// - 避免在代码中硬编码任何凭证：请通过环境变量传入 DSN/账号信息
//
// 推荐变量：
// - MYSQL_DSN：完整 MySQL DSN（优先）
// - POSTGRES_DSN：完整 PostgreSQL DSN（优先）
//
// 若未提供 DSN，则会使用 DB_* / PG_* 拼装连接串（见 buildMySQLDSN/buildPostgresDSN）

type AdminUser struct {
	ID           uint `gorm:"primaryKey"`
	Username     string
	Email        string
	PasswordHash string
	FullName     string
	Role         string
	IsActive     bool
	LastLogin    *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (AdminUser) TableName() string { return "admin_users" }

type Category struct {
	ID          uint `gorm:"primaryKey"`
	Name        string
	Slug        string
	Description string
	ImageURL    string
	ParentID    *uint
	SortOrder   int
	IsActive    bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (Category) TableName() string { return "categories" }

type Product struct {
	ID               uint `gorm:"primaryKey"`
	SKU              string
	Name             string
	Slug             string
	ShortDescription string
	Description      string
	Price            float64
	ComparePrice     *float64
	CostPrice        *float64
	StockQuantity    int
	MinStockLevel    int
	Weight           *float64
	Dimensions       string
	Brand            string
	Model            string
	PartNumber       string
	CategoryID       uint
	IsActive         bool
	IsFeatured       bool
	MetaTitle        string
	MetaDescription  string
	MetaKeywords     string
	ImageURLs        string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (Product) TableName() string { return "products" }

type ProductImage struct {
	ID           uint `gorm:"primaryKey"`
	ProductID    uint
	URL          string
	Filename     string
	OriginalName string
	AltText      string
	SortOrder    int
	IsPrimary    bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (ProductImage) TableName() string { return "product_images" }

type ProductAttribute struct {
	ID             uint `gorm:"primaryKey"`
	ProductID      uint
	AttributeName  string
	AttributeValue string
	SortOrder      int
	CreatedAt      time.Time
}

func (ProductAttribute) TableName() string { return "product_attributes" }

func main() {
	switch os.Getenv("GO_ENV") {
	case "production":
		_ = godotenv.Load(".env.production")
	default:
		_ = godotenv.Load(".env")
	}

	mysqlDSN := os.Getenv("MYSQL_DSN")
	if mysqlDSN == "" {
		mysqlDSN = buildMySQLDSN()
	}
	pgDSN := os.Getenv("POSTGRES_DSN")
	if pgDSN == "" {
		pgDSN = buildPostgresDSN()
	}

	mysqlDB, err := gorm.Open(mysql.Open(mysqlDSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		log.Fatalf("连接 MySQL 失败：%v", err)
	}
	pgDB, err := gorm.Open(postgres.Open(pgDSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		log.Fatalf("连接 PostgreSQL 失败：%v", err)
	}

	log.Println("开始迁移：AutoMigrate（PostgreSQL）…")
	if err := pgDB.AutoMigrate(&AdminUser{}, &Category{}, &Product{}, &ProductImage{}, &ProductAttribute{}); err != nil {
		log.Fatalf("PostgreSQL AutoMigrate 失败：%v", err)
	}

	log.Println("迁移 admin_users…")
	migrateAdminUsers(mysqlDB, pgDB)

	log.Println("迁移 categories（两段：先创建再补 parent_id）…")
	categoryIDMap := migrateCategories(mysqlDB, pgDB)

	log.Println("迁移 products（并建立 sku->newID 映射）…")
	skuToNewID, oldProductIDToSKU := migrateProducts(mysqlDB, pgDB, categoryIDMap)

	log.Println("迁移 product_images…")
	migrateProductImages(mysqlDB, pgDB, skuToNewID, oldProductIDToSKU)

	log.Println("迁移 product_attributes…")
	migrateProductAttributes(mysqlDB, pgDB, skuToNewID, oldProductIDToSKU)

	log.Println("迁移完成 ✅")
}

func buildMySQLDSN() string {
	host := getenv("DB_HOST", "127.0.0.1")
	port := getenv("DB_PORT", "3306")
	user := getenv("DB_USER", "root")
	pass := getenv("DB_PASSWORD", "")
	name := getenv("DB_NAME", "fanuc_sales")
	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, port, name)
}

func buildPostgresDSN() string {
	host := getenv("PG_HOST", "127.0.0.1")
	port := getenv("PG_PORT", "5432")
	user := getenv("PG_USER", "postgres")
	pass := getenv("PG_PASSWORD", "")
	name := getenv("PG_DB", "postgres")
	ssl := getenv("PG_SSLMODE", "disable")
	tz := getenv("PG_TIMEZONE", "UTC")
	return fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=%s", host, user, pass, name, port, ssl, tz)
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func migrateAdminUsers(mysqlDB, pgDB *gorm.DB) {
	var users []AdminUser
	if err := mysqlDB.Order("id asc").Find(&users).Error; err != nil {
		log.Fatalf("读取 admin_users 失败：%v", err)
	}
	for _, u := range users {
		u.ID = 0

		var existing AdminUser
		err := pgDB.Where("username = ?", u.Username).First(&existing).Error
		if err == nil {
			continue
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("查询 admin_user 失败（username=%s）：%v", u.Username, err)
			continue
		}
		if e := pgDB.Create(&u).Error; e != nil {
			log.Printf("创建 admin_user 失败（username=%s）：%v", u.Username, e)
		}
	}
}

func migrateCategories(mysqlDB, pgDB *gorm.DB) map[uint]uint {
	var categories []Category
	if err := mysqlDB.Order("id asc").Find(&categories).Error; err != nil {
		log.Fatalf("读取 categories 失败：%v", err)
	}

	// 第 1 段：创建（先不写 parent_id，避免顺序问题）
	idMap := make(map[uint]uint, len(categories))
	for _, c := range categories {
		oldID := c.ID
		c.ID = 0
		c.ParentID = nil

		var existing Category
		err := pgDB.Where("slug = ?", c.Slug).First(&existing).Error
		if err == nil {
			idMap[oldID] = existing.ID
			continue
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("查询 categories 失败（slug=%s）：%v", c.Slug, err)
			continue
		}

		if e := pgDB.Create(&c).Error; e != nil {
			log.Printf("创建 category 失败（slug=%s）：%v", c.Slug, e)
			continue
		}
		idMap[oldID] = c.ID
	}

	// 第 2 段：补 parent_id
	// 为了避免循环依赖，这里做稳定排序：oldID 从小到大
	oldIDs := make([]int, 0, len(categories))
	byOldID := map[uint]Category{}
	for _, c := range categories {
		byOldID[c.ID] = c
		oldIDs = append(oldIDs, int(c.ID))
	}
	sort.Ints(oldIDs)
	for _, oldIDInt := range oldIDs {
		oldID := uint(oldIDInt)
		c := byOldID[oldID]
		if c.ParentID == nil {
			continue
		}
		newID, ok := idMap[oldID]
		if !ok || newID == 0 {
			continue
		}
		newParent, ok := idMap[*c.ParentID]
		if !ok || newParent == 0 {
			continue
		}
		if e := pgDB.Model(&Category{}).Where("id = ?", newID).Update("parent_id", newParent).Error; e != nil {
			log.Printf("更新 parent_id 失败（oldID=%d）：%v", oldID, e)
		}
	}

	return idMap
}

func migrateProducts(mysqlDB, pgDB *gorm.DB, categoryIDMap map[uint]uint) (map[string]uint, map[uint]string) {
	var products []Product
	if err := mysqlDB.Order("id asc").Find(&products).Error; err != nil {
		log.Fatalf("读取 products 失败：%v", err)
	}

	skuToNewID := make(map[string]uint, len(products))
	oldIDToSKU := make(map[uint]string, len(products))

	for _, p := range products {
		oldID := p.ID
		oldIDToSKU[oldID] = p.SKU

		if newCID, ok := categoryIDMap[p.CategoryID]; ok && newCID != 0 {
			p.CategoryID = newCID
		}

		var existing Product
		err := pgDB.Where("sku = ?", p.SKU).First(&existing).Error
		if err == nil {
			skuToNewID[p.SKU] = existing.ID
			continue
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("查询 products 失败（sku=%s）：%v", p.SKU, err)
			continue
		}

		p.ID = 0
		if e := pgDB.Create(&p).Error; e != nil {
			log.Printf("创建 product 失败（sku=%s）：%v", p.SKU, e)
			continue
		}
		skuToNewID[p.SKU] = p.ID
	}

	return skuToNewID, oldIDToSKU
}

func migrateProductImages(mysqlDB, pgDB *gorm.DB, skuToNewID map[string]uint, oldIDToSKU map[uint]string) {
	var images []ProductImage
	if err := mysqlDB.Order("id asc").Find(&images).Error; err != nil {
		log.Fatalf("读取 product_images 失败：%v", err)
	}
	for _, img := range images {
		sku := oldIDToSKU[img.ProductID]
		if sku == "" {
			continue
		}
		newPID := skuToNewID[sku]
		if newPID == 0 {
			continue
		}
		img.ID = 0
		img.ProductID = newPID
		if e := pgDB.Create(&img).Error; e != nil {
			log.Printf("创建 product_image 失败（sku=%s）：%v", sku, e)
		}
	}
}

func migrateProductAttributes(mysqlDB, pgDB *gorm.DB, skuToNewID map[string]uint, oldIDToSKU map[uint]string) {
	var attrs []ProductAttribute
	if err := mysqlDB.Order("id asc").Find(&attrs).Error; err != nil {
		log.Fatalf("读取 product_attributes 失败：%v", err)
	}
	for _, a := range attrs {
		sku := oldIDToSKU[a.ProductID]
		if sku == "" {
			continue
		}
		newPID := skuToNewID[sku]
		if newPID == 0 {
			continue
		}
		a.ID = 0
		a.ProductID = newPID
		if e := pgDB.Create(&a).Error; e != nil {
			log.Printf("创建 product_attribute 失败（sku=%s）：%v", sku, e)
		}
	}
}
