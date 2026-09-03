package services

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/webp"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func GetOrCreateWatermarkSetting(db *gorm.DB) (*models.WatermarkSetting, error) {
	if db == nil {
		return nil, errors.New("db is nil")
	}
	var s models.WatermarkSetting
	if err := db.First(&s, 1).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s = models.WatermarkSetting{ID: 1, Enabled: true, WatermarkPosition: "bottom-right"}
			if e := db.Create(&s).Error; e != nil {
				return nil, e
			}
			return &s, nil
		}
		return nil, err
	}
	if strings.TrimSpace(s.WatermarkPosition) == "" {
		_ = db.Model(&models.WatermarkSetting{}).Where("id = ?", s.ID).Update("watermark_position", "bottom-right").Error
		s.WatermarkPosition = "bottom-right"
	}
	return &s, nil
}

type WatermarkRequest struct {
	BaseAssetID *uint
	Text        string
	Folder      string
	Title       string
	AltText     string
	Position    string
	// Transient keeps lazily generated SKU fallbacks out of the admin media
	// library while still caching the rendered JPEG on disk.
	Transient bool
}

type WatermarkResult struct {
	Asset      models.MediaAsset
	CreatedNew bool
	SHA256     string
}

func GenerateWatermarkedMediaAsset(db *gorm.DB, req WatermarkRequest) (*WatermarkResult, error) {
	if db == nil {
		return nil, errors.New("db is nil")
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, errors.New("watermark text is empty")
	}
	if len(text) > 80 {
		text = text[:80]
	}
	text = strings.ToUpper(text)

	var baseImg image.Image
	baseIdentity := "builtin"

	if req.BaseAssetID != nil && *req.BaseAssetID > 0 {
		var base models.MediaAsset
		if err := db.First(&base, *req.BaseAssetID).Error; err != nil {
			return nil, err
		}
		baseIdentity = "asset:" + strings.TrimSpace(base.SHA256)
		if baseIdentity == "asset:" {
			baseIdentity = fmt.Sprintf("asset-id:%d", base.ID)
		}
	}

	pos := normalizeWatermarkPosition(req.Position)
	cacheKey := buildWatermarkCacheKey(baseIdentity, text, pos)
	fileName := cacheKey + ".jpg"
	relPath := filepath.ToSlash(filepath.Join("media", fileName))
	uploadRoot := getUploadRootForServices()
	mediaDir := filepath.Join(uploadRoot, "media")
	finalPath := filepath.Join(mediaDir, fileName)

	if req.Transient {
		if cachedBytes, readErr := os.ReadFile(finalPath); readErr == nil {
			h := sha256.Sum256(cachedBytes)
			return &WatermarkResult{
				Asset: models.MediaAsset{
					OriginalName: "sku-fallback-" + utils.GenerateSlug(text) + ".jpg",
					FileName:     fileName,
					RelativePath: relPath,
					SHA256:       hex.EncodeToString(h[:]),
					MimeType:     "image/jpeg",
					SizeBytes:    int64(len(cachedBytes)),
					Folder:       "watermarked-default",
					Tags:         "watermark,generated,sku-fallback",
				},
				CreatedNew: false,
				SHA256:     hex.EncodeToString(h[:]),
			}, nil
		}
	}

	silentDB := db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	var existing models.MediaAsset
	if err := silentDB.Where("relative_path = ?", relPath).Take(&existing).Error; err == nil {
		return &WatermarkResult{Asset: existing, CreatedNew: false, SHA256: existing.SHA256}, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if req.BaseAssetID != nil && *req.BaseAssetID > 0 {
		var base models.MediaAsset
		if err := db.First(&base, *req.BaseAssetID).Error; err != nil {
			return nil, err
		}
		img, err := loadMediaAssetImage(&base)
		if err != nil {
			return nil, err
		}
		baseImg = img
	}

	if baseImg == nil {
		baseImg = generateDefaultBaseImage(1000, 1000)
	}

	baseImg = prepareWatermarkBaseImage(baseImg)

	outBytes, err := renderWatermarkJPEG(baseImg, text, pos)
	if err != nil {
		return nil, err
	}
	h := sha256.Sum256(outBytes)
	sha := hex.EncodeToString(h[:])

	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		return nil, err
	}

	if _, statErr := os.Stat(finalPath); statErr != nil {
		if err := os.WriteFile(finalPath, outBytes, 0o644); err != nil {
			return nil, err
		}
	}

	folder := strings.TrimSpace(req.Folder)
	if folder == "" {
		folder = "watermarked"
	}

	origName := strings.TrimSpace(req.Title)
	if origName == "" {
		origName = "watermark-" + utils.GenerateSlug(text)
	}
	origName = utils.CleanFilename(origName)
	if origName == "" {
		origName = "watermark"
	}
	origName = origName + ".jpg"

	asset := models.MediaAsset{
		OriginalName: origName,
		FileName:     fileName,
		RelativePath: relPath,
		SHA256:       sha,
		MimeType:     "image/jpeg",
		SizeBytes:    int64(len(outBytes)),
		Title:        strings.TrimSpace(req.Title),
		AltText:      strings.TrimSpace(req.AltText),
		Folder:       folder,
		Tags:         "watermark",
	}
	if req.Transient {
		asset.Tags = "watermark,generated,sku-fallback"
		return &WatermarkResult{Asset: asset, CreatedNew: true, SHA256: sha}, nil
	}

	if err := db.Create(&asset).Error; err != nil {
		var again models.MediaAsset
		if e2 := silentDB.Where("relative_path = ?", relPath).Take(&again).Error; e2 == nil {
			return &WatermarkResult{Asset: again, CreatedNew: false, SHA256: again.SHA256}, nil
		}
		return nil, err
	}

	return &WatermarkResult{Asset: asset, CreatedNew: true, SHA256: sha}, nil
}

func getUploadRootForServices() string {
	p := os.Getenv("UPLOAD_PATH")
	if strings.TrimSpace(p) == "" {
		return "./uploads"
	}
	return p
}

func watermarkMaxDimension() int {
	return clampInt(envInt("WATERMARK_MAX_DIM", 1400), 400, 4000)
}

func watermarkJPEGQuality() int {
	return clampInt(envInt("WATERMARK_JPEG_QUALITY", 82), 55, 92)
}

func buildWatermarkCacheKey(baseIdentity, text, position string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf(
		"watermark:v3|base=%s|text=%s|pos=%s|max=%d|quality=%d",
		baseIdentity,
		text,
		position,
		watermarkMaxDimension(),
		watermarkJPEGQuality(),
	)))
	return hex.EncodeToString(sum[:])
}

func prepareWatermarkBaseImage(img image.Image) image.Image {
	if img == nil {
		return img
	}
	return resizeNearest(img, watermarkMaxDimension())
}

func loadMediaAssetImage(asset *models.MediaAsset) (image.Image, error) {
	if asset == nil {
		return nil, errors.New("asset is nil")
	}
	root := getUploadRootForServices()
	full, err := utils.SafeExistingPath(root, asset.RelativePath)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	return decodeImageByExt(bytes.NewReader(b), strings.ToLower(filepath.Ext(asset.FileName)))
}

func decodeImageByExt(r io.Reader, ext string) (image.Image, error) {
	switch strings.ToLower(strings.TrimSpace(ext)) {
	case ".jpg", ".jpeg":
		return jpeg.Decode(r)
	case ".png":
		return png.Decode(r)
	case ".webp":
		return webp.Decode(r)
	default:
		img, _, err := image.Decode(r)
		return img, err
	}
}

var (
	fontOnce     sync.Once
	fontParsed   *opentype.Font
	fontParseErr error
)

func getGoRegularFont() (*opentype.Font, error) {
	fontOnce.Do(func() {
		fontParsed, fontParseErr = opentype.Parse(goregular.TTF)
	})
	return fontParsed, fontParseErr
}

func renderWatermarkJPEG(base image.Image, text string, position string) ([]byte, error) {
	b := base.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("invalid base image")
	}

	canvas := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(canvas, canvas.Bounds(), base, b.Min, draw.Src)

	fontTTF, err := getGoRegularFont()
	if err != nil {
		return nil, err
	}
	pad := int(float64(w) * 0.04)
	if pad < 20 {
		pad = 20
	}
	text = strings.TrimSpace(text)
	boxPadX := 18
	boxPadY := 12
	maxTextWidth := w - (pad+boxPadX)*2
	if maxTextWidth < 120 {
		maxTextWidth = 120
	}

	startSize := float64(w) / 14.0
	if startSize < 22 {
		startSize = 22
	}
	if startSize > 72 {
		startSize = 72
	}
	minSize := 18.0
	var face font.Face
	var lines []string
	for size := startSize; size >= minSize; size -= 2 {
		candidate, faceErr := opentype.NewFace(fontTTF, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
		if faceErr != nil {
			return nil, faceErr
		}
		candidateLines := wrapWatermarkText(candidate, text, maxTextWidth)
		if len(candidateLines) <= 3 || size <= minSize {
			face = candidate
			lines = candidateLines
			break
		}
		_ = candidate.Close()
	}
	if face == nil || len(lines) == 0 {
		return nil, errors.New("failed to fit watermark text")
	}
	defer face.Close()

	d := &font.Drawer{Face: face}
	textW := 0
	for _, line := range lines {
		if width := d.MeasureString(line).Ceil(); width > textW {
			textW = width
		}
	}
	metrics := face.Metrics()
	lineHeight := (metrics.Ascent + metrics.Descent).Ceil()
	lineGap := lineHeight / 4
	if lineGap < 4 {
		lineGap = 4
	}
	textH := lineHeight*len(lines) + lineGap*(len(lines)-1)
	boxW := textW + boxPadX*2
	boxH := textH + boxPadY*2

	boxX1, boxY1 := watermarkBoxOrigin(w, h, boxW, boxH, pad, position)

	// background box
	draw.Draw(canvas, image.Rect(boxX1, boxY1, boxX1+boxW, boxY1+boxH), &image.Uniform{C: color.RGBA{0, 0, 0, 90}}, image.Point{}, draw.Over)

	d.Dst = canvas
	baseline := boxY1 + boxPadY + metrics.Ascent.Ceil()
	for index, line := range lines {
		lineWidth := d.MeasureString(line).Ceil()
		lineX := boxX1 + (boxW-lineWidth)/2
		lineY := baseline + index*(lineHeight+lineGap)
		// shadow
		d.Src = image.NewUniform(color.RGBA{0, 0, 0, 120})
		d.Dot = fixed.P(lineX+2, lineY+2)
		d.DrawString(line)
		// text
		d.Src = image.NewUniform(color.RGBA{255, 255, 255, 225})
		d.Dot = fixed.P(lineX, lineY)
		d.DrawString(line)
	}

	var out bytes.Buffer
	if err := jpeg.Encode(&out, canvas, &jpeg.Options{Quality: watermarkJPEGQuality()}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func wrapWatermarkText(face font.Face, text string, maxWidth int) []string {
	text = strings.TrimSpace(text)
	if face == nil || text == "" || maxWidth <= 0 {
		return nil
	}
	drawer := &font.Drawer{Face: face}
	if drawer.MeasureString(text).Ceil() <= maxWidth {
		return []string{text}
	}

	runes := []rune(text)
	lines := make([]string, 0, 3)
	start := 0
	for start < len(runes) {
		end := start + 1
		lastBreak := -1
		for end <= len(runes) {
			candidate := string(runes[start:end])
			if drawer.MeasureString(candidate).Ceil() > maxWidth {
				break
			}
			if end < len(runes) && (runes[end-1] == '-' || runes[end-1] == '/' || runes[end-1] == ' ') {
				lastBreak = end
			}
			end++
		}
		if end > len(runes) {
			end = len(runes)
		} else {
			end--
		}
		if lastBreak > start && end < len(runes) {
			end = lastBreak
		}
		if end <= start {
			end = start + 1
		}
		line := strings.TrimSpace(string(runes[start:end]))
		if line != "" {
			lines = append(lines, line)
		}
		start = end
		for start < len(runes) && runes[start] == ' ' {
			start++
		}
	}
	return lines
}

func normalizeWatermarkPosition(pos string) string {
	p := strings.ToLower(strings.TrimSpace(pos))
	switch p {
	case "center", "centre":
		return "center"
	case "bottom-left", "bottom_left", "bl":
		return "bottom-left"
	case "top-left", "top_left", "tl":
		return "top-left"
	case "top-right", "top_right", "tr":
		return "top-right"
	case "bottom-right", "bottom_right", "br", "":
		return "bottom-right"
	default:
		return "bottom-right"
	}
}

func watermarkBoxOrigin(imgW, imgH, boxW, boxH, pad int, pos string) (x1 int, y1 int) {
	pos = normalizeWatermarkPosition(pos)
	switch pos {
	case "center":
		x1 = (imgW - boxW) / 2
		y1 = (imgH - boxH) / 2
	case "top-left":
		x1 = pad
		y1 = pad
	case "top-right":
		x1 = imgW - pad - boxW
		y1 = pad
	case "bottom-left":
		x1 = pad
		y1 = imgH - pad - boxH
	case "bottom-right":
		fallthrough
	default:
		x1 = imgW - pad - boxW
		y1 = imgH - pad - boxH
	}
	if x1 < pad {
		x1 = pad
	}
	if y1 < pad {
		y1 = pad
	}
	if x1+boxW > imgW-pad {
		x1 = imgW - pad - boxW
	}
	if y1+boxH > imgH-pad {
		y1 = imgH - pad - boxH
	}
	if x1 < 0 {
		x1 = 0
	}
	if y1 < 0 {
		y1 = 0
	}
	return x1, y1
}

func generateDefaultBaseImage(w, h int) image.Image {
	if w <= 0 {
		w = 1000
	}
	if h <= 0 {
		h = 1000
	}
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// Simple two-tone background
	draw.Draw(img, image.Rect(0, 0, w, h), &image.Uniform{C: color.RGBA{245, 247, 250, 255}}, image.Point{}, draw.Src)
	// Diagonal band
	band := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(band, band.Bounds(), &image.Uniform{C: color.RGBA{232, 237, 244, 255}}, image.Point{}, draw.Src)
	// Very cheap pattern
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if (x+y)%19 == 0 {
				img.Set(x, y, color.RGBA{226, 232, 240, 255})
			}
		}
	}
	_ = band
	return img
}
