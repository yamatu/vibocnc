package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	// 数据库结构自检脚本（用于排查表/字段是否缺失）
	// Load .env from backend dir if present
	_ = godotenv.Load(".env")

	host := env("DB_HOST", "127.0.0.1")
	port := env("DB_PORT", "3306")
	user := env("DB_USER", "root")
	pass := env("DB_PASSWORD", "")
	name := env("DB_NAME", "fanuc_sales")

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		user, pass, host, port, name,
	)
	log.Printf("Connecting to MySQL %s:%s, DB=%s as %s", host, port, name, user)

	db, err := sql.Open("mysql", dsn)
	must(err)
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("Ping failed: %v", err)
	}
	log.Println("Connected.")

	// List critical tables
	critical := []string{
		"admin_users", "languages", "categories", "category_translations",
		"products", "product_translations", "product_attributes",
		"purchase_links", "seo_redirects", "orders", "order_items",
		"banners", "homepage_contents", "company_profiles", "contact_messages",
		"coupons", "coupon_usages",
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(critical)), ",")
	rows, err := db.Query(
		"SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name IN ("+placeholders+") ORDER BY table_name",
		append([]interface{}{name}, toAnySlice(critical)...)...,
	)
	must(err)
	have := map[string]bool{}
	for rows.Next() {
		var t string
		rows.Scan(&t)
		have[strings.ToLower(t)] = true
	}
	rows.Close()
	missing := []string{}
	for _, t := range critical {
		if !have[strings.ToLower(t)] {
			missing = append(missing, t)
		}
	}
	if len(missing) > 0 {
		log.Printf("Missing tables: %s", strings.Join(missing, ", "))
	} else {
		log.Printf("All critical tables exist.")
	}

	// Check products columns
	needCols := []string{
		"id", "sku", "name", "slug", "short_description", "description", "price", "compare_price", "cost_price", "stock_quantity", "min_stock_level", "weight", "dimensions", "brand", "model", "part_number", "category_id", "is_active", "is_featured", "meta_title", "meta_description", "meta_keywords", "image_urls", "created_at", "updated_at",
	}
	prodCols := fetchColumns(db, name, "products")
	missingCols := diff(needCols, prodCols)
	log.Printf("products columns present: %d, missing: %v", len(prodCols), missingCols)

	// Extra model fields that may be added by AutoMigrate
	extraModelCols := []string{
		"warranty_period", "condition_type", "origin_country", "manufacturer", "lead_time", "minimum_order_quantity", "packaging_info", "certifications", "technical_specs", "compatibility_info", "installation_guide", "maintenance_tips", "related_products", "video_urls", "datasheet_url", "manual_url", "view_count", "popularity_score",
	}
	extraMissing := diff(extraModelCols, prodCols)
	if len(extraMissing) > 0 {
		log.Printf("products missing additional model columns (will be added by AutoMigrate): %v", extraMissing)
	}

	// Check admin_users unique indexes
	idx := fetchIndexes(db, name, "admin_users")
	log.Printf("admin_users indexes: %v", idx)

	// Count some seed rows
	showCount(db, "categories")
	showCount(db, "admin_users")

	log.Println("DB check completed.")
}

func toAnySlice(s []string) []interface{} {
	out := make([]interface{}, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

func fetchColumns(db *sql.DB, schema, table string) map[string]bool {
	rows, err := db.Query("SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?", schema, table)
	must(err)
	defer rows.Close()
	cols := map[string]bool{}
	for rows.Next() {
		var c string
		rows.Scan(&c)
		cols[strings.ToLower(c)] = true
	}
	return cols
}

func fetchIndexes(db *sql.DB, schema, table string) []string {
	rows, err := db.Query("SELECT index_name FROM information_schema.statistics WHERE table_schema = ? AND table_name = ?", schema, table)
	must(err)
	defer rows.Close()
	set := map[string]bool{}
	for rows.Next() {
		var n string
		rows.Scan(&n)
		set[n] = true
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func diff(need []string, have map[string]bool) []string {
	miss := []string{}
	for _, n := range need {
		if !have[strings.ToLower(n)] {
			miss = append(miss, n)
		}
	}
	return miss
}

func showCount(db *sql.DB, table string) {
	var c int64
	row := db.QueryRow("SELECT COUNT(*) FROM " + table)
	if err := row.Scan(&c); err != nil {
		log.Printf("Count %s failed: %v", table, err)
		return
	}
	log.Printf("%s: %d rows", table, c)
}
