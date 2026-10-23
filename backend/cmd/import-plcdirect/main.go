// Command import-plcdirect bulk-imports the TSV produced by scripts/plcdirect_prepare.py.
//
// New models are created (active, stock from -stock) under their brand category;
// inquiry models (price 0) start as seo_noindex until enriched or released. Models
// that already exist are never duplicated, only their price is overwritten when the
// file has a price. Without -apply it only reports.
package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"

	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type inputRow struct {
	Brand       string
	MPN         string
	Price       float64
	Condition   string
	Series      string
	ProductType string
	Specs       string
}

type existingRef struct {
	ID     uint
	Brand  string
	Price  float64
	Locked bool
}

type brandStats struct {
	NewPriced, NewInquiry, PriceUpdated, PriceSame, PriceLocked, BrandMismatch, ExistsNoPrice, SkuConflict int
	RuleCategory, FallbackCategory                                                                         int
}

var (
	nonAlnum   = regexp.MustCompile(`[^A-Z0-9]`)
	controlChr = regexp.MustCompile(`[\x00-\x1f\x7f]`)
)

func alnumKey(value string) string {
	return nonAlnum.ReplaceAllString(strings.ToUpper(value), "")
}

func main() {
	var (
		file        = flag.String("file", "", "gzipped TSV from scripts/plcdirect_prepare.py")
		apply       = flag.Bool("apply", false, "write to the database (default is a dry run)")
		stock       = flag.Int("stock", 10, "stock quantity for new products")
		batchSize   = flag.Int("batch", 500, "insert batch size")
		pause       = flag.Duration("pause", 150*time.Millisecond, "pause between batches to keep the shared host responsive")
		limit       = flag.Int("limit", 0, "only process the first N rows (0 = all)")
		samples     = flag.Int("samples", 3, "print N generated products for review")
		updatePrice = flag.Bool("update-prices", true, "overwrite prices of existing products of the same brand")
	)
	flag.Parse()
	if *file == "" {
		log.Fatal("-file is required")
	}

	_ = godotenv.Load()
	db := openDB()
	config.DB = db
	config.ConnectRedis()
	policy := services.CurrentCommercePolicy()

	existing, skus, slugs := loadExisting(db)
	log.Printf("loaded %d existing keys, %d skus, %d slugs", len(existing), len(skus), len(slugs))

	cats := newCategoryResolver(db, *apply)

	rows, err := readRows(*file, *limit)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("read %d rows from %s (apply=%v)", len(rows), *file, *apply)

	stats := map[string]*brandStats{}
	statFor := func(brand string) *brandStats {
		if stats[brand] == nil {
			stats[brand] = &brandStats{}
		}
		return stats[brand]
	}

	type priceUpdate struct {
		ID    uint
		Price float64
	}
	var (
		pending     []models.Product
		updates     []priceUpdate
		created     int
		printed     int
		descBytes   int64
		insertCols  = []string{"SKU", "Name", "Slug", "ShortDescription", "Description", "Price", "StockQuantity", "Brand", "Model", "PartNumber", "Manufacturer", "CategoryID", "IsActive", "IsFeatured", "MetaTitle", "MetaDescription", "MetaKeywords", "ImageURLs", "ConditionType", "PackagingInfo", "TechnicalSpecs", "CompatibilityInfo", "InstallationGuide", "MaintenanceTips", "MinimumOrderQuantity", "SEONoIndex"}
		flushInsert = func() {
			if len(pending) == 0 {
				return
			}
			if *apply {
				if err := db.Select(insertCols).CreateInBatches(&pending, *batchSize).Error; err != nil {
					log.Fatalf("insert batch failed after %d created: %v", created, err)
				}
				time.Sleep(*pause)
			}
			created += len(pending)
			if created%10000 < len(pending) {
				log.Printf("created %d products", created)
			}
			pending = pending[:0]
		}
	)

	for _, row := range rows {
		st := statFor(row.Brand)
		key := alnumKey(row.MPN)

		if ref, ok := existing[key]; ok {
			switch {
			case row.Price <= 0:
				st.ExistsNoPrice++
			case !sameBrand(ref.Brand, row.Brand):
				st.BrandMismatch++
			case ref.Locked:
				st.PriceLocked++
			case math.Abs(ref.Price-row.Price) < 0.005:
				st.PriceSame++
			default:
				st.PriceUpdated++
				if *updatePrice {
					updates = append(updates, priceUpdate{ID: ref.ID, Price: row.Price})
				}
			}
			continue
		}

		sku := services.NormalizeProductModel(row.MPN)
		if sku == "" || len(sku) > 100 || skus[strings.ToLower(sku)] {
			st.SkuConflict++
			continue
		}

		inference := services.InferProductCategory(row.Brand, sku)
		confirmed := services.IsConfirmedProductCategory(inference, sku)
		categoryID, categoryPath, byRule := cats.resolve(row.Brand, inference, confirmed)
		if byRule {
			st.RuleCategory++
		} else {
			st.FallbackCategory++
		}

		product := buildProduct(row, sku, inference, confirmed, categoryID, categoryPath, policy, *stock)
		product.Slug = utils.GenerateUniqueSlug(utils.GenerateSlug(sku+" "+row.Brand), func(s string) bool { return slugs[s] })

		slugs[product.Slug] = true
		skus[strings.ToLower(sku)] = true
		existing[key] = existingRef{Brand: row.Brand, Price: row.Price}
		descBytes += int64(len(product.Description) + len(product.ShortDescription) + len(product.CompatibilityInfo) + len(product.InstallationGuide) + len(product.MaintenanceTips) + len(product.TechnicalSpecs))

		if row.Price > 0 {
			st.NewPriced++
		} else {
			st.NewInquiry++
		}
		if printed < *samples && (printed == 0 || row.Specs != "" || confirmed) {
			printed++
			fmt.Printf("\n--- sample %d ---\nSKU: %s\nName: %s\nSlug: %s\nPrice: %.2f  Stock: %d\nCategory: %s (id %d)\nMetaTitle: %s\nMetaDescription: %s\nShort: %s\nSpecs: %s\nDescription:\n%s\n",
				printed, product.SKU, product.Name, product.Slug, product.Price, product.StockQuantity, categoryPath, categoryID, product.MetaTitle, product.MetaDescription, product.ShortDescription, product.TechnicalSpecs, product.Description)
		}

		pending = append(pending, product)
		if len(pending) >= *batchSize {
			flushInsert()
		}
	}
	flushInsert()

	if *apply && len(updates) > 0 {
		for start := 0; start < len(updates); start += *batchSize {
			end := min(start+*batchSize, len(updates))
			err := db.Transaction(func(tx *gorm.DB) error {
				for _, u := range updates[start:end] {
					if err := tx.Exec("UPDATE products SET price = ?, updated_at = ? WHERE id = ?", u.Price, time.Now(), u.ID).Error; err != nil {
						return err
					}
				}
				return nil
			})
			if err != nil {
				log.Fatalf("price update failed at %d: %v", start, err)
			}
			time.Sleep(*pause)
		}
		log.Printf("updated %d prices", len(updates))
	}

	printReport(stats, cats, created, descBytes)

	if *apply {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		services.InvalidatePublicCaches(ctx, "cmd:import-plcdirect", nil)
		cancel()
		services.TriggerNextRevalidate(nil, []string{"/", "/products"}, true)
		time.Sleep(10 * time.Second)
		log.Print("caches invalidated")
	}
}

func openDB() *gorm.DB {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"), os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME"))
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Error)})
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	return db
}

func loadExisting(db *gorm.DB) (map[string]existingRef, map[string]bool, map[string]bool) {
	existing := map[string]existingRef{}
	skus := map[string]bool{}
	slugs := map[string]bool{}
	rows, err := db.Raw("SELECT id, sku, slug, COALESCE(model,''), COALESCE(part_number,''), COALESCE(brand,''), price, price_locked FROM products").Rows()
	if err != nil {
		log.Fatalf("load products: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			ref                       existingRef
			sku, slug, model, partNum string
		)
		if err := rows.Scan(&ref.ID, &sku, &slug, &model, &partNum, &ref.Brand, &ref.Price, &ref.Locked); err != nil {
			log.Fatalf("scan product: %v", err)
		}
		skus[strings.ToLower(strings.TrimSpace(sku))] = true
		slugs[slug] = true
		for _, v := range []string{sku, model, partNum} {
			if k := alnumKey(v); k != "" {
				if _, taken := existing[k]; !taken {
					existing[k] = ref
				}
			}
		}
	}
	return existing, skus, slugs
}

func sameBrand(siteBrand, rowBrand string) bool {
	site := strings.TrimSpace(siteBrand)
	if site == "" || strings.EqualFold(site, "unbranded") {
		return true
	}
	if strings.EqualFold(alnumKey(site), alnumKey(rowBrand)) {
		return true
	}
	return services.NormalizeBrandKey(site) == services.NormalizeBrandKey(rowBrand)
}

func readRows(path string, limit int) ([]inputRow, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	r := bufio.NewReaderSize(gz, 1<<20)
	var out []inputRow
	header := true
	for {
		line, err := r.ReadString('\n')
		if line = strings.TrimRight(line, "\r\n"); line != "" {
			if header {
				header = false
			} else {
				cols := strings.Split(line, "\t")
				if len(cols) != 7 {
					return nil, fmt.Errorf("bad row (%d columns): %.80s", len(cols), line)
				}
				price, perr := strconv.ParseFloat(cols[2], 64)
				if perr != nil {
					return nil, fmt.Errorf("bad price %q", cols[2])
				}
				out = append(out, inputRow{Brand: cols[0], MPN: cols[1], Price: price, Condition: cols[3], Series: cols[4], ProductType: cols[5], Specs: cols[6]})
				if limit > 0 && len(out) >= limit {
					return out, nil
				}
			}
		}
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// parseSpecs turns "Key: value; Key2: value2" into a map, keeping the first value per key.
func parseSpecs(raw string) map[string]string {
	specs := map[string]string{}
	for part := range strings.SplitSeq(raw, "; ") {
		k, v, ok := strings.Cut(part, ": ")
		k = strings.TrimSpace(controlChr.ReplaceAllString(k, " "))
		v = strings.TrimSpace(controlChr.ReplaceAllString(v, " "))
		if !ok || k == "" || v == "" || len(k) > 80 || strings.EqualFold(k, "model") {
			continue
		}
		if _, dup := specs[k]; !dup && len(specs) < 40 {
			specs[k] = v
		}
	}
	return specs
}

func buildProduct(row inputRow, sku string, inference services.ProductCategoryInference, confirmed bool, categoryID uint, categoryPath string, policy models.CommercePolicySetting, stock int) models.Product {
	p := models.Product{
		SKU:                  sku,
		Price:                row.Price,
		StockQuantity:        stock,
		Brand:                row.Brand,
		Model:                sku,
		PartNumber:           sku,
		Manufacturer:         row.Brand,
		CategoryID:           categoryID,
		IsActive:             true,
		SEONoIndex:           row.Price <= 0,
		ImageURLs:            "[]",
		ConditionType:        "new",
		MinimumOrderQuantity: 1,
	}
	switch row.Condition {
	case "sealed":
		p.PackagingInfo = "New surplus, factory sealed original packaging"
	case "never":
		p.PackagingInfo = "New surplus, never used"
	}

	partType := ""
	categorySlug := ""
	if confirmed {
		partType = inference.PartType
		categorySlug = inference.CategorySlug
	} else if row.ProductType != "" {
		partType = row.ProductType
	}

	specs := services.KnownTechnicalSpecs(&p, policy)
	overlay := parseSpecs(row.Specs)
	if row.Series != "" {
		overlay["Product series"] = row.Series
	}
	specs = services.MergeTechnicalSpecs(specs, overlay)

	categoryName := categoryPath
	if i := strings.LastIndex(categoryName, " > "); i >= 0 {
		categoryName = categoryName[i+3:]
	}
	enr := services.BuildProductContentSkeleton(services.ContentSkeletonInput{
		BrandKey:     services.NormalizeBrandKey(row.Brand),
		BrandName:    row.Brand,
		Model:        sku,
		PartType:     partType,
		CategorySlug: categorySlug,
		CategoryName: categoryName,
		Product:      &p,
		Policy:       policy,
		Specs:        specs,
	})

	p.Name = enr.Name
	if partType == "" {
		p.Name = row.Brand + " " + sku
	}
	p.ShortDescription = enr.ShortDescription
	p.Description = enr.Description
	p.MetaTitle = enr.MetaTitle
	p.MetaDescription = enr.MetaDescription
	p.MetaKeywords = enr.MetaKeywords
	p.CompatibilityInfo = enr.CompatibilityInfo
	p.InstallationGuide = enr.InstallationGuide
	p.MaintenanceTips = enr.MaintenanceTips
	p.TechnicalSpecs = enr.TechnicalSpecs
	if p.TechnicalSpecs == "" {
		p.TechnicalSpecs = "{}"
	}
	return p
}

type leaf struct {
	ID     uint
	RootID uint
	Path   string
	Slug   string
}

type categoryResolver struct {
	db         *gorm.DB
	apply      bool
	all        []models.Category
	slugs      map[string]bool
	leaves     []leaf
	topByName  map[string]models.Category
	hasKids    map[uint]bool
	fallback   map[string]uint
	fallbackPt map[string]string
	ruleCache  map[string]leaf
	created    []string
}

func newCategoryResolver(db *gorm.DB, apply bool) *categoryResolver {
	var all []models.Category
	if err := db.Order("sort_order ASC, id ASC").Find(&all).Error; err != nil {
		log.Fatalf("load categories: %v", err)
	}
	return newCategoryResolverFrom(db, apply, all)
}

func newCategoryResolverFrom(db *gorm.DB, apply bool, all []models.Category) *categoryResolver {
	c := &categoryResolver{
		db: db, apply: apply, all: all,
		slugs: map[string]bool{}, topByName: map[string]models.Category{}, hasKids: map[uint]bool{},
		fallback: map[string]uint{}, fallbackPt: map[string]string{}, ruleCache: map[string]leaf{},
	}
	byID := map[uint]models.Category{}
	for _, cat := range c.all {
		byID[cat.ID] = cat
		c.slugs[cat.Slug] = true
		if cat.IsActive && cat.ParentID != nil {
			c.hasKids[*cat.ParentID] = true
		}
		if cat.IsActive && cat.ParentID == nil {
			if _, dup := c.topByName[alnumKey(cat.Name)]; !dup {
				c.topByName[alnumKey(cat.Name)] = cat
			}
		}
	}
	for _, cat := range c.all {
		if !cat.IsActive || c.hasKids[cat.ID] {
			continue
		}
		names := []string{cat.Name}
		root := cat
		ok := true
		seen := map[uint]bool{cat.ID: true}
		for root.ParentID != nil {
			parent, found := byID[*root.ParentID]
			if !found || !parent.IsActive || seen[parent.ID] {
				ok = false
				break
			}
			seen[parent.ID] = true
			names = append([]string{parent.Name}, names...)
			root = parent
		}
		if ok {
			c.leaves = append(c.leaves, leaf{ID: cat.ID, RootID: root.ID, Path: strings.Join(names, " > "), Slug: cat.Slug})
		}
	}
	return c
}

// resolve returns the category for a new product: an existing leaf below the brand
// matched by the catalogue's own classification rules, or the brand fallback leaf.
func (c *categoryResolver) resolve(brand string, inference services.ProductCategoryInference, confirmed bool) (uint, string, bool) {
	top, hasTop := c.topByName[alnumKey(brand)]
	if confirmed && hasTop {
		key := strings.Join([]string{brand, inference.BrandKey, inference.PartType, inference.CategorySlug, inference.ModelFamily}, "|")
		best, cached := c.ruleCache[key]
		if !cached {
			bestScore := 0
			for _, l := range c.leaves {
				if l.RootID != top.ID {
					continue
				}
				score := services.CategoryPathMatchScore(l.Path, inference)
				if score == 0 {
					continue
				}
				if l.Slug == inference.CategorySlug {
					score += 1000
				}
				if score > bestScore {
					best, bestScore = l, score
				}
			}
			c.ruleCache[key] = best
		}
		if best.ID != 0 {
			return best.ID, best.Path, true
		}
	}
	return c.fallbackFor(brand), c.fallbackPt[brand], false
}

func (c *categoryResolver) fallbackFor(brand string) uint {
	if id, ok := c.fallback[brand]; ok {
		return id
	}
	top, hasTop := c.topByName[alnumKey(brand)]
	if !hasTop {
		top = c.create(brand, nil)
		c.topByName[alnumKey(brand)] = top
	}
	id, path := top.ID, top.Name
	if hasTop && c.hasKids[top.ID] {
		name := brand + " Other Parts"
		var child models.Category
		found := false
		for _, cat := range c.all {
			if cat.ParentID != nil && *cat.ParentID == top.ID && cat.IsActive && strings.EqualFold(cat.Name, name) {
				child, found = cat, true
				break
			}
		}
		if !found {
			parentID := top.ID
			child = c.create(name, &parentID)
		}
		id, path = child.ID, top.Name+" > "+child.Name
	}
	c.fallback[brand] = id
	c.fallbackPt[brand] = path
	return id
}

func (c *categoryResolver) create(name string, parentID *uint) models.Category {
	slug := utils.GenerateUniqueSlug(utils.GenerateSlug(name), func(s string) bool { return c.slugs[s] })
	c.slugs[slug] = true
	cat := models.Category{Name: name, Slug: slug, ParentID: parentID, IsActive: true, SortOrder: 0}
	label := name
	if parentID != nil {
		label = fmt.Sprintf("%s (parent id %d)", name, *parentID)
	}
	c.created = append(c.created, label)
	if c.apply {
		if err := c.db.Select("Name", "Slug", "ParentID", "IsActive", "SortOrder").Create(&cat).Error; err != nil {
			log.Fatalf("create category %q: %v", name, err)
		}
		c.all = append(c.all, cat)
	}
	return cat
}

func printReport(stats map[string]*brandStats, cats *categoryResolver, created int, descBytes int64) {
	brands := make([]string, 0, len(stats))
	for b := range stats {
		brands = append(brands, b)
	}
	sort.Slice(brands, func(i, j int) bool {
		a, b := stats[brands[i]], stats[brands[j]]
		return a.NewPriced+a.NewInquiry > b.NewPriced+b.NewInquiry
	})
	var total brandStats
	fmt.Printf("\n%-28s %9s %9s %9s %9s %9s %9s %9s %9s %9s\n", "brand", "newPriced", "newInq", "priceUpd", "priceSame", "locked", "brandDiff", "existNoP", "ruleCat", "otherCat")
	for _, b := range brands {
		s := stats[b]
		fmt.Printf("%-28s %9d %9d %9d %9d %9d %9d %9d %9d %9d\n", b, s.NewPriced, s.NewInquiry, s.PriceUpdated, s.PriceSame, s.PriceLocked, s.BrandMismatch, s.ExistsNoPrice, s.RuleCategory, s.FallbackCategory)
		total.NewPriced += s.NewPriced
		total.NewInquiry += s.NewInquiry
		total.PriceUpdated += s.PriceUpdated
		total.PriceSame += s.PriceSame
		total.PriceLocked += s.PriceLocked
		total.BrandMismatch += s.BrandMismatch
		total.ExistsNoPrice += s.ExistsNoPrice
		total.SkuConflict += s.SkuConflict
		total.RuleCategory += s.RuleCategory
		total.FallbackCategory += s.FallbackCategory
	}
	fmt.Printf("%-28s %9d %9d %9d %9d %9d %9d %9d %9d %9d\n", "TOTAL", total.NewPriced, total.NewInquiry, total.PriceUpdated, total.PriceSame, total.PriceLocked, total.BrandMismatch, total.ExistsNoPrice, total.RuleCategory, total.FallbackCategory)
	fmt.Printf("sku conflicts skipped: %d\n", total.SkuConflict)
	fmt.Printf("products to create: %d, generated text ~%d MB\n", created, descBytes>>20)
	fmt.Printf("categories to create (%d):\n", len(cats.created))
	for _, name := range cats.created {
		fmt.Printf("  - %s\n", name)
	}
}
