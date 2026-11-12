// Command schema-check verifies that the database has every table and column
// the backend models expect. Deploy scripts run it after applying migrations
// and before starting a new backend, so a missing migration stops the release
// instead of surfacing as errors when users hit the affected pages.
//
// Exit codes: 0 schema up to date, 1 schema drift, 2 could not check.
package main

import (
	"fmt"
	"os"

	"fanuc-backend/config"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func main() {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"), os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME"))
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		fmt.Fprintf(os.Stderr, "schema-check: cannot connect to database: %v\n", err)
		os.Exit(2)
	}

	missing, err := config.FindSchemaDrift(db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "schema-check: %v\n", err)
		os.Exit(2)
	}
	if len(missing) == 0 {
		fmt.Println("schema-check: database schema matches the backend models")
		return
	}
	fmt.Fprintf(os.Stderr, "schema-check: %d table(s)/column(s) required by the code are missing:\n", len(missing))
	for _, item := range missing {
		fmt.Fprintf(os.Stderr, "  - %s\n", item)
	}
	fmt.Fprintln(os.Stderr, "Add an idempotent SQL file under backend/migrations/ that creates them, then rerun scripts/apply-migrations.sh.")
	os.Exit(1)
}
