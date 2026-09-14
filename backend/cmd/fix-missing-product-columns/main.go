package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

type colDef struct {
	Name string
	DDL  string
}

func main() {
	_ = godotenv.Load(".env")
	host := getenv("DB_HOST", "127.0.0.1")
	port := getenv("DB_PORT", "3306")
	user := getenv("DB_USER", "root")
	pass := getenv("DB_PASSWORD", "")
	name := getenv("DB_NAME", "fanuc_sales")

	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local", user, pass, host, port, name)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatal(err)
	}

	// Define missing columns based on models.Product
	defs := []colDef{
		{"warranty_period", "VARCHAR(50) NOT NULL DEFAULT '12 months'"},
		{"condition_type", "ENUM('new','refurbished','used') NOT NULL DEFAULT 'new'"},
		{"origin_country", "VARCHAR(50) NOT NULL DEFAULT 'China'"},
		{"manufacturer", "VARCHAR(100) NOT NULL DEFAULT 'FANUC'"},
		{"lead_time", "VARCHAR(50) NOT NULL DEFAULT '3-7 days'"},
		{"minimum_order_quantity", "INT NOT NULL DEFAULT 1"},
		{"packaging_info", "TEXT NULL"},
		{"certifications", "TEXT NULL"},
		{"technical_specs", "JSON NULL"},
		{"compatibility_info", "TEXT NULL"},
		{"installation_guide", "TEXT NULL"},
		{"maintenance_tips", "TEXT NULL"},
		{"related_products", "JSON NULL"},
		{"video_urls", "JSON NULL"},
		{"datasheet_url", "VARCHAR(500) NULL"},
		{"manual_url", "VARCHAR(500) NULL"},
		{"view_count", "INT NOT NULL DEFAULT 0"},
		{"popularity_score", "DECIMAL(3,2) NOT NULL DEFAULT 0.00"},
		{"seo_score", "INT NOT NULL DEFAULT 0"},
		{"last_optimized_at", "TIMESTAMP NULL"},
	}

	existing := getExistingColumns(db, name, "products")
	added := 0
	for _, d := range defs {
		if existing[strings.ToLower(d.Name)] {
			continue
		}
		sqlStmt := fmt.Sprintf("ALTER TABLE products ADD COLUMN IF NOT EXISTS %s %s", d.Name, d.DDL)
		log.Printf("Adding missing column: %s", d.Name)
		if _, err := db.Exec(sqlStmt); err != nil {
			// Some MySQL versions may not support IF NOT EXISTS for ADD COLUMN, fallback to plain add
			if strings.Contains(strings.ToLower(err.Error()), "syntax") || strings.Contains(strings.ToLower(err.Error()), "exists") {
				sqlStmt2 := fmt.Sprintf("ALTER TABLE products ADD COLUMN %s %s", d.Name, d.DDL)
				if _, err2 := db.Exec(sqlStmt2); err2 != nil {
					log.Printf("Failed to add column %s: %v", d.Name, err2)
					continue
				}
			} else {
				log.Printf("Failed to add column %s: %v", d.Name, err)
				continue
			}
		}
		added++
	}
	log.Printf("Done. Added %d columns.", added)
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getExistingColumns(db *sql.DB, schema, table string) map[string]bool {
	rows, err := db.Query("SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=?", schema, table)
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()
	res := map[string]bool{}
	for rows.Next() {
		var c string
		rows.Scan(&c)
		res[strings.ToLower(c)] = true
	}
	return res
}
