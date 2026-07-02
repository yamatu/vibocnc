package services

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"
)

const (
	productImportBatchSize     = 200
	productImportRecentItems   = 200
	productImportTempDirName   = "product-imports"
	productImportMaxSavedTasks = 25
)

type ProductImportOptions struct {
	Brand         string
	Overwrite     bool
	CreateMissing bool
}

type ProductImportRow struct {
	RowNumber int
	Model     string
	Price     float64
	Quantity  int
	WeightKg  float64
	Category  string
}

type ProductImportItem struct {
	RowNumber int    `json:"row_number"`
	Model     string `json:"model"`
	Action    string `json:"action"` // created | updated | skipped | failed
	ProductID uint   `json:"product_id,omitempty"`
	SKU       string `json:"sku,omitempty"`
	Message   string `json:"message,omitempty"`
}

type ProductImportResult struct {
	Brand      string              `json:"brand"`
	TotalRows  int                 `json:"total_rows"`
	Created    int                 `json:"created"`
	Updated    int                 `json:"updated"`
	Skipped    int                 `json:"skipped"`
	Failed     int                 `json:"failed"`
	Items      []ProductImportItem `json:"items"`
	Template   string              `json:"template"` // template identifier
	Overwrite  bool                `json:"overwrite"`
	CreatedNew bool                `json:"create_missing"`
	// CategoriesCreated counts new categories created from the optional spreadsheet category column.
	CategoriesCreated int `json:"categories_created"`
}

type ProductImportTaskStatus string

const (
	ProductImportTaskQueued     ProductImportTaskStatus = "queued"
	ProductImportTaskProcessing ProductImportTaskStatus = "processing"
	ProductImportTaskCompleted  ProductImportTaskStatus = "completed"
	ProductImportTaskFailed     ProductImportTaskStatus = "failed"
)

type ProductImportTaskSnapshot struct {
	ID            string                  `json:"id"`
	Status        ProductImportTaskStatus `json:"status"`
	Brand         string                  `json:"brand"`
	Filename      string                  `json:"filename"`
	ProgressPct   float64                 `json:"progress_pct"`
	ProcessedRows int                     `json:"processed_rows"`
	TotalRows     int                     `json:"total_rows"`
	Created       int                     `json:"created"`
	Updated       int                     `json:"updated"`
	Skipped       int                     `json:"skipped"`
	Failed        int                     `json:"failed"`
	Message       string                  `json:"message,omitempty"`
	Result        *ProductImportResult    `json:"result,omitempty"`
	StartedAt     *time.Time              `json:"started_at,omitempty"`
	CompletedAt   *time.Time              `json:"completed_at,omitempty"`
	CreatedAt     time.Time               `json:"created_at"`
	UpdatedAt     time.Time               `json:"updated_at"`
}

type productImportTask struct {
	mu sync.RWMutex

	ID            string
	Status        ProductImportTaskStatus
	Brand         string
	Filename      string
	FilePath      string
	ProgressPct   float64
	ProcessedRows int
	TotalRows     int
	Message       string
	Result        ProductImportResult
	Error         string
	StartedAt     *time.Time
	CompletedAt   *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type ProductImportManager struct {
	mu    sync.RWMutex
	order []string
	tasks map[string]*productImportTask
}

var productImportTasks = &ProductImportManager{
	order: make([]string, 0, productImportMaxSavedTasks),
	tasks: make(map[string]*productImportTask),
}

func GenerateProductImportTemplateXLSX(brand string) ([]byte, error) {
	brand = NormalizeBrandKey(brand)

	f := excelize.NewFile()
	sheet := "Products"
	f.SetSheetName("Sheet1", sheet)

	headers := []string{"型号(Model)", "价格(Price)", "数量(Quantity)", "重量kg(WeightKg)", "分类(Category)"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
	}
	_ = f.SetCellValue(sheet, "A2", "A02B-0120-C041")
	_ = f.SetCellValue(sheet, "B2", 1200)
	_ = f.SetCellValue(sheet, "C2", 5)
	_ = f.SetCellValue(sheet, "D2", 1.2)
	_ = f.SetCellValue(sheet, "E2", "Servo Motors")
	_ = f.SetCellValue(sheet, "E3", "Industrial Automation > Servo Motors")

	_ = f.SetColWidth(sheet, "A", "A", 24)
	_ = f.SetColWidth(sheet, "B", "B", 14)
	_ = f.SetColWidth(sheet, "C", "C", 14)
	_ = f.SetColWidth(sheet, "D", "D", 16)
	_ = f.SetColWidth(sheet, "E", "E", 34)
	_ = f.SetPanes(sheet, &excelize.Panes{Freeze: true, Split: true, YSplit: 1, ActivePane: "bottomLeft"})

	headerStyle, _ := f.NewStyle(&excelize.Style{
		Font:   &excelize.Font{Bold: true, Color: "#111827"},
		Fill:   excelize.Fill{Type: "pattern", Color: []string{"#F3F4F6"}, Pattern: 1},
		Border: []excelize.Border{{Type: "bottom", Color: "#E5E7EB", Style: 1}},
	})
	_ = f.SetCellStyle(sheet, "A1", "E1", headerStyle)

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func StartProductImportTask(ctx context.Context, db *gorm.DB, src io.Reader, filename string, opts ProductImportOptions) (ProductImportTaskSnapshot, error) {
	if db == nil {
		return ProductImportTaskSnapshot{}, errors.New("db is nil")
	}

	brand := NormalizeBrandKey(opts.Brand)

	tempDir := filepath.Join(os.TempDir(), productImportTempDirName)
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		return ProductImportTaskSnapshot{}, err
	}

	taskID := uuid.NewString()
	tmpFile, err := os.CreateTemp(tempDir, fmt.Sprintf("%s-*.xlsx", taskID))
	if err != nil {
		return ProductImportTaskSnapshot{}, err
	}

	cleanupOnError := true
	defer func() {
		if cleanupOnError {
			_ = tmpFile.Close()
			_ = os.Remove(tmpFile.Name())
		}
	}()

	if _, err := io.Copy(tmpFile, src); err != nil {
		return ProductImportTaskSnapshot{}, err
	}
	if err := tmpFile.Close(); err != nil {
		return ProductImportTaskSnapshot{}, err
	}

	task := &productImportTask{
		ID:       taskID,
		Status:   ProductImportTaskQueued,
		Brand:    brand,
		Filename: filename,
		FilePath: tmpFile.Name(),
		Result: ProductImportResult{
			Brand:      brand,
			Items:      make([]ProductImportItem, 0, productImportRecentItems),
			Template:   "model_price_quantity_v1",
			Overwrite:  opts.Overwrite,
			CreatedNew: opts.CreateMissing,
		},
		Message:   "queued",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	productImportTasks.add(task)
	cleanupOnError = false

	go runProductImportTask(detachContext(ctx), db, taskID, opts)

	return task.snapshot(), nil
}

func GetProductImportTaskSnapshot(taskID string) (ProductImportTaskSnapshot, bool) {
	return productImportTasks.getSnapshot(taskID)
}

func detachContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return context.Background()
}

func ImportProductsFromXLSX(ctx context.Context, db *gorm.DB, r io.Reader, opts ProductImportOptions) (ProductImportResult, error) {
	if db == nil {
		return ProductImportResult{}, errors.New("db is nil")
	}

	tempDir := filepath.Join(os.TempDir(), productImportTempDirName)
	if err := os.MkdirAll(tempDir, 0o755); err != nil {
		return ProductImportResult{}, err
	}

	tmpFile, err := os.CreateTemp(tempDir, "sync-*.xlsx")
	if err != nil {
		return ProductImportResult{}, err
	}
	tmpPath := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpPath)
	}()

	if _, err := io.Copy(tmpFile, r); err != nil {
		return ProductImportResult{}, err
	}
	if err := tmpFile.Close(); err != nil {
		return ProductImportResult{}, err
	}

	return processProductImportFile(ctx, db, tmpPath, opts, nil)
}

func runProductImportTask(ctx context.Context, db *gorm.DB, taskID string, opts ProductImportOptions) {
	task, ok := productImportTasks.get(taskID)
	if !ok {
		return
	}

	now := time.Now()
	task.update(func(t *productImportTask) {
		t.Status = ProductImportTaskProcessing
		t.Message = "processing"
		t.StartedAt = &now
		t.UpdatedAt = now
	})

	res, err := processProductImportFile(ctx, db, task.FilePath, opts, task)
	finishedAt := time.Now()
	if err != nil {
		task.update(func(t *productImportTask) {
			t.Status = ProductImportTaskFailed
			t.Message = err.Error()
			t.Error = err.Error()
			t.CompletedAt = &finishedAt
			t.UpdatedAt = finishedAt
		})
	} else {
		task.update(func(t *productImportTask) {
			t.Status = ProductImportTaskCompleted
			t.ProgressPct = 100
			t.ProcessedRows = res.TotalRows
			t.TotalRows = res.TotalRows
			t.Result = res
			t.Message = "completed"
			t.CompletedAt = &finishedAt
			t.UpdatedAt = finishedAt
		})
		if res.Created > 0 || res.Updated > 0 {
			InvalidatePublicCaches(context.Background(), "product:import:xlsx", nil)
			TriggerNextRevalidate(nil, nil, true)
		}
	}

	_ = os.Remove(task.FilePath)
}

func processProductImportFile(ctx context.Context, db *gorm.DB, filePath string, opts ProductImportOptions, task *productImportTask) (ProductImportResult, error) {
	brand := NormalizeBrandKey(opts.Brand)

	f, err := excelize.OpenFile(filePath)
	if err != nil {
		return ProductImportResult{}, err
	}
	defer func() { _ = f.Close() }()

	sheet := f.GetSheetName(0)
	if sheet == "" {
		sheet = "Products"
	}

	totalRows, err := countImportRows(f, sheet)
	if err != nil {
		return ProductImportResult{}, err
	}

	res := ProductImportResult{
		Brand:      brand,
		TotalRows:  totalRows,
		Items:      make([]ProductImportItem, 0, minInt(totalRows, productImportRecentItems)),
		Template:   "model_price_quantity_v1",
		Overwrite:  opts.Overwrite,
		CreatedNew: opts.CreateMissing,
	}
	updateTaskProgress(task, res, 0, totalRows, "reading workbook")
	if totalRows == 0 {
		return res, nil
	}

	categoryCatalog := loadImportCategories(db, brand)
	rows, err := f.Rows(sheet)
	if err != nil {
		return res, err
	}
	defer func() { _ = rows.Close() }()

	processed := 0
	batch := make([]ProductImportRow, 0, productImportBatchSize)
	rowNo := 0
	headerMap := importHeaderMap{}
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if err := applyImportBatch(ctx, db, batch, opts, categoryCatalog, &res); err != nil {
			return err
		}
		res.CategoriesCreated = categoryCatalog.created
		processed += len(batch)
		updateTaskProgress(task, res, processed, totalRows, fmt.Sprintf("processed %d/%d", processed, totalRows))
		batch = batch[:0]
		return nil
	}

	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		rowNo++
		cols, err := rows.Columns()
		if err != nil {
			return res, err
		}
		if rowNo == 1 {
			headerMap = detectImportHeader(cols)
			continue
		}
		row, ok, err := parseImportRow(cols, headerMap, rowNo)
		if err != nil {
			return res, err
		}
		if !ok {
			continue
		}
		batch = append(batch, row)
		if len(batch) >= productImportBatchSize {
			if err := flush(); err != nil {
				return res, err
			}
		}
	}
	if err := flush(); err != nil {
		return res, err
	}
	if err := rows.Error(); err != nil {
		return res, err
	}

	updateTaskProgress(task, res, res.TotalRows, res.TotalRows, "completed")
	return res, nil
}

func countImportRows(f *excelize.File, sheet string) (int, error) {
	rows, err := f.Rows(sheet)
	if err != nil {
		return 0, err
	}
	defer func() { _ = rows.Close() }()

	rowNo := 0
	total := 0
	headerMap := importHeaderMap{}
	for rows.Next() {
		rowNo++
		cols, err := rows.Columns()
		if err != nil {
			return 0, err
		}
		if rowNo == 1 {
			headerMap = detectImportHeader(cols)
			continue
		}
		model := strings.TrimSpace(getCol(cols, headerMap.Model))
		priceStr := getCol(cols, headerMap.Price)
		qtyStr := getCol(cols, headerMap.Qty)
		weightStr := getCol(cols, headerMap.Weight)
		if model == "" && strings.TrimSpace(priceStr) == "" && strings.TrimSpace(qtyStr) == "" && strings.TrimSpace(weightStr) == "" {
			continue
		}
		total++
	}
	return total, rows.Error()
}

type importHeaderMap struct {
	Model    int
	Price    int
	Qty      int
	Weight   int
	Category int
}

func detectImportHeader(header []string) importHeaderMap {
	m := importHeaderMap{Model: 0, Price: 1, Qty: 2, Weight: 3, Category: 4}
	for i, h := range header {
		key := strings.ToLower(strings.TrimSpace(h))
		key = strings.ReplaceAll(key, " ", "")
		key = strings.ReplaceAll(key, "_", "")
		key = strings.ReplaceAll(key, "-", "")
		if strings.Contains(key, "型号") || strings.Contains(key, "model") || key == "sku" {
			m.Model = i
		}
		if strings.Contains(key, "价格") || strings.Contains(key, "price") {
			m.Price = i
		}
		if strings.Contains(key, "数量") || strings.Contains(key, "qty") || strings.Contains(key, "quantity") || strings.Contains(key, "stock") {
			m.Qty = i
		}
		if strings.Contains(key, "weight") || strings.Contains(key, "重量") || strings.Contains(key, "kg") {
			m.Weight = i
		}
		if strings.Contains(key, "分类") ||
			strings.Contains(key, "类目") ||
			strings.Contains(key, "类别") ||
			strings.Contains(key, "category") ||
			strings.Contains(key, "parttype") ||
			strings.Contains(key, "producttype") {
			m.Category = i
		}
	}
	return m
}

func parseImportRow(cols []string, headerMap importHeaderMap, rowNo int) (ProductImportRow, bool, error) {
	model := strings.TrimSpace(getCol(cols, headerMap.Model))
	priceStr := getCol(cols, headerMap.Price)
	qtyStr := getCol(cols, headerMap.Qty)
	weightStr := getCol(cols, headerMap.Weight)
	category := strings.TrimSpace(getCol(cols, headerMap.Category))

	if model == "" && strings.TrimSpace(priceStr) == "" && strings.TrimSpace(qtyStr) == "" && strings.TrimSpace(weightStr) == "" {
		return ProductImportRow{}, false, nil
	}

	price, err := parseFloatCell(priceStr)
	if err != nil {
		return ProductImportRow{}, false, fmt.Errorf("row %d: invalid price: %v", rowNo, err)
	}
	qty, err := parseIntCell(qtyStr)
	if err != nil {
		return ProductImportRow{}, false, fmt.Errorf("row %d: invalid quantity: %v", rowNo, err)
	}
	wkg, err := parseFloatCell(weightStr)
	if err != nil {
		return ProductImportRow{}, false, fmt.Errorf("row %d: invalid weight: %v", rowNo, err)
	}

	return ProductImportRow{
		RowNumber: rowNo,
		Model:     model,
		Price:     price,
		Quantity:  qty,
		WeightKg:  wkg,
		Category:  category,
	}, true, nil
}

func applyImportBatch(ctx context.Context, db *gorm.DB, batch []ProductImportRow, opts ProductImportOptions, categories *importCategoryCatalog, res *ProductImportResult) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, row := range batch {
			model := NormalizeProductModel(row.Model)
			if model == "" {
				appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: row.Model, Action: "failed", Message: "model is empty"})
				continue
			}

			product, found, findErr := findProductByModelOrSKU(tx, model)
			if findErr != nil {
				appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "failed", Message: findErr.Error()})
				continue
			}

			enr, eerr := EnrichProductByBrand(opts.Brand, model)
			if eerr != nil {
				appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "failed", Message: eerr.Error()})
				continue
			}

			if !found && !opts.CreateMissing {
				appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "skipped", Message: "product not found"})
				continue
			}

			categoryID := uint(0)
			customCategory := strings.TrimSpace(row.Category)
			if customCategory != "" {
				id, cerr := categories.ResolveOrCreate(tx, customCategory)
				if cerr != nil {
					appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "failed", Message: cerr.Error()})
					continue
				}
				categoryID = id
			} else {
				categoryID = categories.DefaultCategoryID
				if id, ok := categories.ActiveBySlug[enr.CategorySlug]; ok && id > 0 {
					categoryID = id
				}
				if categoryID == 0 {
					categoryID = categories.DefaultCategoryID
				}
			}

			if found {
				updates := map[string]any{
					"price":          row.Price,
					"stock_quantity": row.Quantity,
				}
				if row.WeightKg > 0 {
					updates["weight"] = row.WeightKg
				}
				if opts.Overwrite || strings.TrimSpace(product.Name) == "" {
					updates["name"] = enr.Name
				}
				if opts.Overwrite || strings.TrimSpace(product.ShortDescription) == "" {
					updates["short_description"] = enr.ShortDescription
				}
				if opts.Overwrite || strings.TrimSpace(product.Description) == "" {
					updates["description"] = enr.Description
				}
				if opts.Overwrite || strings.TrimSpace(product.MetaTitle) == "" {
					updates["meta_title"] = enr.MetaTitle
				}
				if opts.Overwrite || strings.TrimSpace(product.MetaDescription) == "" {
					updates["meta_description"] = enr.MetaDescription
				}
				if opts.Overwrite || strings.TrimSpace(product.MetaKeywords) == "" {
					updates["meta_keywords"] = enr.MetaKeywords
				}
				if strings.TrimSpace(product.Brand) == "" {
					if canonicalBrand := CanonicalBrandName(opts.Brand); canonicalBrand != "" {
						updates["brand"] = canonicalBrand
					}
				}
				if strings.TrimSpace(product.Model) == "" {
					updates["model"] = model
				}
				if strings.TrimSpace(product.PartNumber) == "" {
					updates["part_number"] = model
				}
				if product.CategoryID == 0 && categoryID > 0 {
					updates["category_id"] = categoryID
				}
				if (opts.Overwrite || customCategory != "") && categoryID > 0 {
					updates["category_id"] = categoryID
				}

				if e := tx.Model(&models.Product{}).Where("id = ?", product.ID).Updates(updates).Error; e != nil {
					appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "failed", ProductID: product.ID, SKU: product.SKU, Message: e.Error()})
					continue
				}
				appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "updated", ProductID: product.ID, SKU: product.SKU, Message: "updated"})
				continue
			}

			baseSlug := utils.GenerateSlug(enr.Name)
			slug := utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
				var count int64
				tx.Model(&models.Product{}).Where("slug = ?", s).Count(&count)
				return count > 0
			})

			var wPtr *float64
			if row.WeightKg > 0 {
				w := row.WeightKg
				wPtr = &w
			}

			p := models.Product{
				SKU:              model,
				Name:             enr.Name,
				Slug:             slug,
				ShortDescription: enr.ShortDescription,
				Description:      enr.Description,
				Price:            row.Price,
				StockQuantity:    row.Quantity,
				Weight:           wPtr,
				Brand:            CanonicalBrandName(opts.Brand),
				Model:            model,
				PartNumber:       model,
				CategoryID:       categoryID,
				IsActive:         true,
				IsFeatured:       false,
				MetaTitle:        enr.MetaTitle,
				MetaDescription:  enr.MetaDescription,
				MetaKeywords:     enr.MetaKeywords,
				ImageURLs:        "[]",
			}

			if e := tx.Select("SKU", "Name", "Slug", "ShortDescription", "Description", "Price", "StockQuantity", "Weight", "Brand", "Model", "PartNumber", "CategoryID", "IsActive", "IsFeatured", "MetaTitle", "MetaDescription", "MetaKeywords", "ImageURLs").Create(&p).Error; e != nil {
				appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "failed", Message: e.Error()})
				continue
			}
			appendImportItem(res, ProductImportItem{RowNumber: row.RowNumber, Model: model, Action: "created", ProductID: p.ID, SKU: p.SKU, Message: "created"})
		}
		return nil
	})
}

func appendImportItem(res *ProductImportResult, item ProductImportItem) {
	switch item.Action {
	case "created":
		res.Created++
	case "updated":
		res.Updated++
	case "skipped":
		res.Skipped++
	case "failed":
		res.Failed++
	}
	res.TotalRows = maxInt(res.TotalRows, res.Created+res.Updated+res.Skipped+res.Failed)
	res.Items = append(res.Items, item)
	if len(res.Items) > productImportRecentItems {
		res.Items = append([]ProductImportItem(nil), res.Items[len(res.Items)-productImportRecentItems:]...)
	}
}

func updateTaskProgress(task *productImportTask, res ProductImportResult, processed int, total int, message string) {
	if task == nil {
		return
	}
	task.update(func(t *productImportTask) {
		t.ProcessedRows = processed
		t.TotalRows = total
		t.Message = message
		t.Result = res
		if total > 0 {
			t.ProgressPct = float64(processed) * 100 / float64(total)
			if t.ProgressPct > 100 {
				t.ProgressPct = 100
			}
		} else {
			t.ProgressPct = 0
		}
		t.UpdatedAt = time.Now()
	})
}

type importCategoryCatalog struct {
	BySlug            map[string]uint
	ActiveBySlug      map[string]uint
	bySlugParent      map[string]uint
	byNameParent      map[string]uint
	byNameAny         map[string][]uint
	DefaultCategoryID uint
	created           int
}

func loadImportCategories(db *gorm.DB, brand string) *importCategoryCatalog {
	catalog := &importCategoryCatalog{
		BySlug:       map[string]uint{},
		ActiveBySlug: map[string]uint{},
		bySlugParent: map[string]uint{},
		byNameParent: map[string]uint{},
		byNameAny:    map[string][]uint{},
	}

	var cats []models.Category
	if e := db.Model(&models.Category{}).Order("sort_order ASC, name ASC").Find(&cats).Error; e == nil {
		for _, c := range cats {
			catalog.add(c)
		}
	}

	defaultCategorySlug := InferProductCategory(brand, "").CategorySlug
	if id, ok := catalog.ActiveBySlug[defaultCategorySlug]; ok {
		catalog.DefaultCategoryID = id
	} else {
		for _, c := range cats {
			if c.IsActive {
				catalog.DefaultCategoryID = c.ID
				break
			}
		}
		if catalog.DefaultCategoryID == 0 && len(cats) > 0 {
			catalog.DefaultCategoryID = cats[0].ID
		}
	}
	return catalog
}

func (c *importCategoryCatalog) add(cat models.Category) {
	if c == nil || cat.ID == 0 {
		return
	}
	slug := strings.TrimSpace(cat.Slug)
	if slug != "" {
		c.BySlug[slug] = cat.ID
		if cat.IsActive {
			c.ActiveBySlug[slug] = cat.ID
		}
		c.bySlugParent[categoryParentKey(cat.ParentID, slug)] = cat.ID
	}
	nameKey := normalizeImportCategoryKey(cat.Name)
	if nameKey != "" {
		c.byNameParent[categoryParentKey(cat.ParentID, nameKey)] = cat.ID
		c.byNameAny[nameKey] = append(c.byNameAny[nameKey], cat.ID)
	}
}

func (c *importCategoryCatalog) ResolveOrCreate(db *gorm.DB, raw string) (uint, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, errors.New("category is empty")
	}
	if c == nil {
		return 0, errors.New("category catalog is nil")
	}

	if id := c.findExisting(raw, nil); id > 0 {
		return id, nil
	}

	segments := importCategorySegments(raw)
	if len(segments) == 0 {
		return 0, errors.New("category is empty")
	}

	var parentID *uint
	currentID := uint(0)
	for _, segment := range segments {
		if id := c.findExisting(segment, parentID); id > 0 {
			currentID = id
			parentID = uintPtr(id)
			continue
		}

		cat, err := c.createCategory(db, segment, parentID)
		if err != nil {
			return 0, err
		}
		c.add(cat)
		c.created++
		currentID = cat.ID
		parentID = uintPtr(cat.ID)
	}
	return currentID, nil
}

func (c *importCategoryCatalog) findExisting(raw string, parentID *uint) uint {
	if c == nil {
		return 0
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	slug := strings.TrimSpace(utils.GenerateSlug(raw))
	if parentID == nil {
		if id := c.BySlug[raw]; id > 0 {
			return id
		}
		if slug != "" {
			if id := c.BySlug[slug]; id > 0 {
				return id
			}
		}
	}
	if slug != "" {
		if id := c.bySlugParent[categoryParentKey(parentID, slug)]; id > 0 {
			return id
		}
	}
	nameKey := normalizeImportCategoryKey(raw)
	if nameKey != "" {
		if id := c.byNameParent[categoryParentKey(parentID, nameKey)]; id > 0 {
			return id
		}
		if parentID == nil && len(c.byNameAny[nameKey]) == 1 {
			return c.byNameAny[nameKey][0]
		}
	}
	return 0
}

func (c *importCategoryCatalog) createCategory(db *gorm.DB, name string, parentID *uint) (models.Category, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return models.Category{}, errors.New("category name is empty")
	}
	baseSlug := importCategoryBaseSlug(name)
	slug := utils.GenerateUniqueSlug(baseSlug, func(s string) bool {
		if _, ok := c.BySlug[s]; ok {
			return true
		}
		var count int64
		db.Model(&models.Category{}).Where("slug = ?", s).Count(&count)
		return count > 0
	})

	category := models.Category{
		Name:        name,
		Slug:        slug,
		ParentID:    cloneUintPtr(parentID),
		SortOrder:   0,
		IsActive:    true,
		Description: fmt.Sprintf("Auto-created during product XLSX import for %s.", name),
	}
	if err := db.Create(&category).Error; err != nil {
		return models.Category{}, fmt.Errorf("create category %q: %w", name, err)
	}
	return category, nil
}

func importCategorySegments(raw string) []string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	replacer := strings.NewReplacer(
		"＞", ">",
		"»", ">",
		"→", ">",
		"｜", "|",
		"／", "/",
		"\\", "/",
	)
	s = replacer.Replace(s)

	if strings.Contains(s, ">") || strings.Contains(s, "|") || strings.Contains(s, " / ") || shouldSplitSlashCategoryPath(s) {
		normalized := strings.NewReplacer(">", "\n", "|", "\n", " / ", "\n").Replace(s)
		if shouldSplitSlashCategoryPath(normalized) {
			normalized = strings.ReplaceAll(normalized, "/", "\n")
		}
		parts := strings.Split(normalized, "\n")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	return []string{s}
}

func shouldSplitSlashCategoryPath(s string) bool {
	if !strings.Contains(s, "/") {
		return false
	}
	if strings.Contains(s, " / ") {
		return true
	}
	parts := strings.Split(s, "/")
	if len(parts) < 2 {
		return false
	}
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if len(p) < 2 || !isImportCategorySlugLike(p) {
			return false
		}
	}
	return true
}

func isImportCategorySlugLike(s string) bool {
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			continue
		}
		return false
	}
	return true
}

func importCategoryBaseSlug(name string) string {
	base := utils.GenerateSlug(name)
	if base != "" {
		return base
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(strings.ToLower(strings.TrimSpace(name))))
	return fmt.Sprintf("category-%08x", h.Sum32())
}

func normalizeImportCategoryKey(s string) string {
	key := strings.ToLower(strings.TrimSpace(s))
	key = strings.Join(strings.Fields(key), " ")
	return key
}

func categoryParentKey(parentID *uint, val string) string {
	pid := uint(0)
	if parentID != nil {
		pid = *parentID
	}
	return fmt.Sprintf("%d:%s", pid, strings.ToLower(strings.TrimSpace(val)))
}

func uintPtr(v uint) *uint {
	vv := v
	return &vv
}

func cloneUintPtr(v *uint) *uint {
	if v == nil {
		return nil
	}
	return uintPtr(*v)
}

func parseFloatCell(s string) (float64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	s = strings.ReplaceAll(s, ",", "")
	return strconv.ParseFloat(s, 64)
}

func parseIntCell(s string) (int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	s = strings.ReplaceAll(s, ",", "")
	v, err := strconv.Atoi(s)
	if err != nil {
		f, ferr := strconv.ParseFloat(s, 64)
		if ferr == nil {
			return int(f), nil
		}
	}
	return v, err
}

func getCol(cols []string, idx int) string {
	if idx < 0 || idx >= len(cols) {
		return ""
	}
	return cols[idx]
}

func findProductByModelOrSKU(db *gorm.DB, model string) (models.Product, bool, error) {
	var product models.Product
	if db == nil {
		return product, false, errors.New("db is nil")
	}
	normalized := strings.TrimSpace(model)
	upper := strings.ToUpper(normalized)
	candMap := map[string]bool{}
	candidates := []string{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if !candMap[s] {
			candMap[s] = true
			candidates = append(candidates, s)
		}
	}
	add(normalized)
	if strings.HasPrefix(upper, "FANUC-") {
		add(normalized[6:])
	}
	if strings.HasPrefix(upper, "FANUC ") {
		add(normalized[6:])
	}
	add(upper)
	add("FANUC-" + normalized)
	add("FANUC " + normalized)

	if err := db.Model(&models.Product{}).Where("sku IN ?", candidates).Order(gorm.Expr("FIELD(sku, ?) DESC, updated_at DESC", candidates)).First(&product).Error; err == nil {
		return product, true, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return product, false, err
	}

	if err := db.Model(&models.Product{}).Where("model = ? OR part_number = ?", normalized, normalized).Order("updated_at DESC").First(&product).Error; err == nil {
		return product, true, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return product, false, err
	}

	like := normalized + "%"
	if err := db.Model(&models.Product{}).Where("sku LIKE ? OR model LIKE ? OR part_number LIKE ?", like, like, like).Order("updated_at DESC").First(&product).Error; err == nil {
		return product, true, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return product, false, err
	}

	sanitized := strings.ReplaceAll(strings.ReplaceAll(normalized, "-", ""), "/", "")
	if err := db.Model(&models.Product{}).Where("REPLACE(REPLACE(sku,'-',''),'/','') = ?", sanitized).Order("updated_at DESC").First(&product).Error; err == nil {
		return product, true, nil
	} else if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return product, false, nil
		}
		return product, false, err
	}
	return product, false, nil
}

func (m *ProductImportManager) add(task *productImportTask) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.tasks[task.ID] = task
	m.order = append(m.order, task.ID)
	for len(m.order) > productImportMaxSavedTasks {
		pruned := false
		for i, taskID := range m.order {
			existing, ok := m.tasks[taskID]
			if !ok {
				m.order = append(m.order[:i], m.order[i+1:]...)
				pruned = true
				break
			}

			existing.mu.RLock()
			status := existing.Status
			path := existing.FilePath
			existing.mu.RUnlock()
			if status != ProductImportTaskCompleted && status != ProductImportTaskFailed {
				continue
			}

			m.order = append(m.order[:i], m.order[i+1:]...)
			delete(m.tasks, taskID)
			if path != "" {
				_ = os.Remove(path)
			}
			pruned = true
			break
		}
		if !pruned {
			break
		}
	}
}

func (m *ProductImportManager) get(taskID string) (*productImportTask, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task, ok := m.tasks[taskID]
	return task, ok
}

func (m *ProductImportManager) getSnapshot(taskID string) (ProductImportTaskSnapshot, bool) {
	task, ok := m.get(taskID)
	if !ok {
		return ProductImportTaskSnapshot{}, false
	}
	return task.snapshot(), true
}

func (t *productImportTask) update(fn func(*productImportTask)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	fn(t)
}

func (t *productImportTask) snapshot() ProductImportTaskSnapshot {
	t.mu.RLock()
	defer t.mu.RUnlock()

	result := t.Result
	items := append([]ProductImportItem(nil), result.Items...)
	result.Items = items

	snap := ProductImportTaskSnapshot{
		ID:            t.ID,
		Status:        t.Status,
		Brand:         t.Brand,
		Filename:      t.Filename,
		ProgressPct:   t.ProgressPct,
		ProcessedRows: t.ProcessedRows,
		TotalRows:     t.TotalRows,
		Created:       result.Created,
		Updated:       result.Updated,
		Skipped:       result.Skipped,
		Failed:        result.Failed,
		Message:       t.Message,
		CreatedAt:     t.CreatedAt,
		UpdatedAt:     t.UpdatedAt,
	}
	if t.StartedAt != nil {
		v := *t.StartedAt
		snap.StartedAt = &v
	}
	if t.CompletedAt != nil {
		v := *t.CompletedAt
		snap.CompletedAt = &v
	}
	if t.Status == ProductImportTaskCompleted || t.Status == ProductImportTaskFailed {
		resCopy := result
		snap.Result = &resCopy
	}
	return snap
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
