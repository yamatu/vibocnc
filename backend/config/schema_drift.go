package config

import (
	"fmt"
	"sort"
	"strings"

	"gorm.io/gorm"
)

// FindSchemaDrift reports tables and columns the models expect but the
// connected database lacks, as "table" or "table.column". With
// DB_AUTO_MIGRATE=false nothing else creates them, and GORM selects every
// mapped column, so each entry is a query that will fail at runtime.
func FindSchemaDrift(db *gorm.DB) ([]string, error) {
	if db == nil {
		return nil, fmt.Errorf("database connection is nil")
	}

	columnsByTable := map[string]map[string]bool{}
	rows, err := db.Raw(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`).Rows()
	if err != nil {
		return nil, fmt.Errorf("read information_schema: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			return nil, err
		}
		key := strings.ToLower(table)
		if columnsByTable[key] == nil {
			columnsByTable[key] = map[string]bool{}
		}
		columnsByTable[key][strings.ToLower(column)] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	var missing []string
	for _, model := range MigratedModels() {
		stmt := &gorm.Statement{DB: db}
		if err := stmt.Parse(model); err != nil {
			return nil, fmt.Errorf("parse %T: %w", model, err)
		}
		table := stmt.Schema.Table
		columns, ok := columnsByTable[strings.ToLower(table)]
		if !ok {
			if !seen[table] {
				seen[table] = true
				missing = append(missing, table)
			}
			continue
		}
		for _, field := range stmt.Schema.Fields {
			if field.DBName == "" || field.IgnoreMigration {
				continue
			}
			key := table + "." + field.DBName
			if !columns[strings.ToLower(field.DBName)] && !seen[key] {
				seen[key] = true
				missing = append(missing, key)
			}
		}
	}
	sort.Strings(missing)
	return missing, nil
}
