package services

import (
	"bytes"
	"container/list"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"strconv"
	"strings"
	"sync"
	"time"

	"fanuc-backend/models"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"gorm.io/gorm"
)

const (
	watermarkSettingCacheTTL  = 60 * time.Second
	watermarkBaseCacheTTL     = 5 * time.Minute
	watermarkRenderLRUMaxItem = 256
	watermarkRenderLRUMaxByte = 10 * 1024 * 1024 // 10 MiB bounded JPEG cache
)

type cachedWatermarkSetting struct {
	setting   models.WatermarkSetting
	fetchedAt time.Time
}

type cachedWatermarkBase struct {
	img       *image.RGBA
	identity  string
	fetchedAt time.Time
}

type renderedWatermarkEntry struct {
	key   string
	bytes []byte
	etag  string
}

var (
	wmSettingMu    sync.RWMutex
	wmSettingCache *cachedWatermarkSetting

	wmBaseMu    sync.Mutex
	wmBaseCache = map[string]*cachedWatermarkBase{}

	wmLRUMu    sync.Mutex
	wmLRUList  = list.New()
	wmLRUMap   = map[string]*list.Element{}
	wmLRUBytes int
)

// InvalidateWatermarkRuntimeCache clears cached watermark settings, decoded
// base RGBA images, and rendered JPEG entries so admin edits apply immediately.
func InvalidateWatermarkRuntimeCache() {
	wmSettingMu.Lock()
	wmSettingCache = nil
	wmSettingMu.Unlock()

	wmBaseMu.Lock()
	wmBaseCache = map[string]*cachedWatermarkBase{}
	wmBaseMu.Unlock()

	wmLRUMu.Lock()
	wmLRUList.Init()
	wmLRUMap = map[string]*list.Element{}
	wmLRUBytes = 0
	wmLRUMu.Unlock()
}

// GetCachedWatermarkSetting caches the singleton WatermarkSetting row in memory
// for 60s so every fallback product image request does not query MySQL.
func GetCachedWatermarkSetting(db *gorm.DB) (*models.WatermarkSetting, error) {
	now := time.Now()
	wmSettingMu.RLock()
	cached := wmSettingCache
	wmSettingMu.RUnlock()

	if cached != nil && now.Sub(cached.fetchedAt) <= watermarkSettingCacheTTL {
		cp := cached.setting
		if cached.setting.BaseMediaAssetID != nil {
			id := *cached.setting.BaseMediaAssetID
			cp.BaseMediaAssetID = &id
		}
		return &cp, nil
	}

	s, err := GetOrCreateWatermarkSetting(db)
	if err != nil {
		return nil, err
	}
	cp := *s
	if s.BaseMediaAssetID != nil {
		id := *s.BaseMediaAssetID
		cp.BaseMediaAssetID = &id
	}
	wmSettingMu.Lock()
	wmSettingCache = &cachedWatermarkSetting{setting: cp, fetchedAt: time.Now()}
	wmSettingMu.Unlock()
	return s, nil
}

// NormalizeDefaultImageWidth quantizes requested ?w= values into two cacheable
// sizes: 400 (product cards/thumbnails) and 800 (detail viewer default).
func NormalizeDefaultImageWidth(raw string) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 800
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 800
	}
	if n <= 480 {
		return 400
	}
	return 800
}

func wmLRUGet(key string) ([]byte, string, bool) {
	wmLRUMu.Lock()
	defer wmLRUMu.Unlock()
	if el, ok := wmLRUMap[key]; ok {
		wmLRUList.MoveToFront(el)
		ent := el.Value.(*renderedWatermarkEntry)
		return ent.bytes, ent.etag, true
	}
	return nil, "", false
}

func wmLRUPut(key string, data []byte, etag string) {
	if len(data) == 0 || len(data) > watermarkRenderLRUMaxByte/4 {
		return
	}
	wmLRUMu.Lock()
	defer wmLRUMu.Unlock()
	if el, ok := wmLRUMap[key]; ok {
		old := el.Value.(*renderedWatermarkEntry)
		wmLRUBytes -= len(old.bytes)
		old.bytes = data
		old.etag = etag
		wmLRUBytes += len(data)
		wmLRUList.MoveToFront(el)
	} else {
		ent := &renderedWatermarkEntry{key: key, bytes: data, etag: etag}
		el := wmLRUList.PushFront(ent)
		wmLRUMap[key] = el
		wmLRUBytes += len(data)
	}
	for len(wmLRUMap) > watermarkRenderLRUMaxItem || wmLRUBytes > watermarkRenderLRUMaxByte {
		back := wmLRUList.Back()
		if back == nil {
			break
		}
		ent := back.Value.(*renderedWatermarkEntry)
		wmLRUList.Remove(back)
		delete(wmLRUMap, ent.key)
		wmLRUBytes -= len(ent.bytes)
	}
}

func toRGBAImage(src image.Image) *image.RGBA {
	if rgba, ok := src.(*image.RGBA); ok && rgba.Rect.Min.X == 0 && rgba.Rect.Min.Y == 0 {
		return rgba
	}
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), src, b.Min, draw.Src)
	return dst
}

// resizeBilinearRGBA downscales an image to fit within maxDim using crisp
// bilinear interpolation; runs once per base image and is cached in memory.
func resizeBilinearRGBA(src image.Image, maxDim int) *image.RGBA {
	srcRGBA := toRGBAImage(src)
	sw, sh := srcRGBA.Rect.Dx(), srcRGBA.Rect.Dy()
	if sw <= 0 || sh <= 0 || maxDim <= 0 || (sw <= maxDim && sh <= maxDim) {
		return srcRGBA
	}
	var dw, dh int
	if sw >= sh {
		dw = maxDim
		dh = int(float64(sh) * float64(maxDim) / float64(sw))
	} else {
		dh = maxDim
		dw = int(float64(sw) * float64(maxDim) / float64(sh))
	}
	if dw < 1 {
		dw = 1
	}
	if dh < 1 {
		dh = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	xRatio := float64(sw-1) / float64(maxIntWM(dw-1, 1))
	yRatio := float64(sh-1) / float64(maxIntWM(dh-1, 1))

	for y := 0; y < dh; y++ {
		sy := float64(y) * yRatio
		y0 := int(sy)
		y1 := y0 + 1
		if y1 >= sh {
			y1 = sh - 1
		}
		dy := sy - float64(y0)
		row0 := y0 * srcRGBA.Stride
		row1 := y1 * srcRGBA.Stride
		dstRow := y * dst.Stride

		for x := 0; x < dw; x++ {
			sx := float64(x) * xRatio
			x0 := int(sx)
			x1 := x0 + 1
			if x1 >= sw {
				x1 = sw - 1
			}
			dx := sx - float64(x0)

			i00 := row0 + x0*4
			i10 := row0 + x1*4
			i01 := row1 + x0*4
			i11 := row1 + x1*4

			w00 := (1 - dx) * (1 - dy)
			w10 := dx * (1 - dy)
			w01 := (1 - dx) * dy
			w11 := dx * dy

			di := dstRow + x*4
			dst.Pix[di+0] = uint8(float64(srcRGBA.Pix[i00+0])*w00 + float64(srcRGBA.Pix[i10+0])*w10 + float64(srcRGBA.Pix[i01+0])*w01 + float64(srcRGBA.Pix[i11+0])*w11 + 0.5)
			dst.Pix[di+1] = uint8(float64(srcRGBA.Pix[i00+1])*w00 + float64(srcRGBA.Pix[i10+1])*w10 + float64(srcRGBA.Pix[i01+1])*w01 + float64(srcRGBA.Pix[i11+1])*w11 + 0.5)
			dst.Pix[di+2] = uint8(float64(srcRGBA.Pix[i00+2])*w00 + float64(srcRGBA.Pix[i10+2])*w10 + float64(srcRGBA.Pix[i01+2])*w01 + float64(srcRGBA.Pix[i11+2])*w11 + 0.5)
			dst.Pix[di+3] = uint8(float64(srcRGBA.Pix[i00+3])*w00 + float64(srcRGBA.Pix[i10+3])*w10 + float64(srcRGBA.Pix[i01+3])*w01 + float64(srcRGBA.Pix[i11+3])*w11 + 0.5)
		}
	}
	return dst
}

func maxIntWM(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func getCachedWatermarkBaseRGBA(db *gorm.DB, baseAssetID *uint, targetMaxDim int) (*image.RGBA, string, error) {
	var idVal uint
	if baseAssetID != nil {
		idVal = *baseAssetID
	}
	key := fmt.Sprintf("asset=%d|dim=%d", idVal, targetMaxDim)

	wmBaseMu.Lock()
	defer wmBaseMu.Unlock()

	if cached, ok := wmBaseCache[key]; ok && time.Since(cached.fetchedAt) <= watermarkBaseCacheTTL {
		return cached.img, cached.identity, nil
	}

	var baseImg image.Image
	identity := fmt.Sprintf("builtin:%d", targetMaxDim)
	if idVal > 0 {
		var base models.MediaAsset
		if err := db.First(&base, idVal).Error; err != nil {
			return nil, "", err
		}
		img, err := loadMediaAssetImage(&base)
		if err != nil {
			return nil, "", err
		}
		baseImg = img
		sha := strings.TrimSpace(base.SHA256)
		if sha == "" {
			sha = fmt.Sprintf("id-%d", base.ID)
		}
		identity = fmt.Sprintf("asset:%s:%d", sha, targetMaxDim)
	}
	if baseImg == nil {
		baseImg = generateDefaultBaseImage(targetMaxDim, targetMaxDim)
	}

	rgba := resizeBilinearRGBA(baseImg, targetMaxDim)
	wmBaseCache[key] = &cachedWatermarkBase{
		img:       rgba,
		identity:  identity,
		fetchedAt: time.Now(),
	}
	return rgba, identity, nil
}

func wrapWatermarkLinesFast(face font.Face, text string, maxWidth int) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	d := &font.Drawer{Face: face}
	if d.MeasureString(text).Ceil() <= maxWidth {
		return []string{text}
	}
	runes := []rune(text)
	var lines []string
	start := 0
	for start < len(runes) {
		end := start + 1
		lastBreak := -1
		for end <= len(runes) {
			cand := string(runes[start:end])
			if d.MeasureString(cand).Ceil() > maxWidth {
				break
			}
			ch := runes[end-1]
			if ch == ' ' || ch == '-' || ch == '/' || ch == '_' {
				lastBreak = end
			}
			end++
		}
		if end > len(runes) {
			lines = append(lines, strings.TrimSpace(string(runes[start:])))
			break
		}
		cut := end - 1
		if cut <= start {
			cut = start + 1
		}
		if lastBreak > start && lastBreak <= cut {
			cut = lastBreak
		}
		line := strings.TrimSpace(string(runes[start:cut]))
		if line != "" {
			lines = append(lines, line)
		}
		start = cut
		for start < len(runes) && runes[start] == ' ' {
			start++
		}
	}
	return lines
}

func renderWatermarkFromCachedRGBA(base *image.RGBA, text string, position string) ([]byte, error) {
	w, h := base.Rect.Dx(), base.Rect.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("invalid base image")
	}

	pix := make([]byte, len(base.Pix))
	copy(pix, base.Pix)
	canvas := &image.RGBA{Pix: pix, Stride: base.Stride, Rect: base.Rect}

	fontTTF, err := getGoRegularFont()
	if err != nil {
		return nil, err
	}

	pad := int(float64(w) * 0.04)
	if pad < 14 {
		pad = 14
	}
	boxPadX := int(float64(w) * 0.022)
	if boxPadX < 10 {
		boxPadX = 10
	}
	boxPadY := int(float64(w) * 0.015)
	if boxPadY < 7 {
		boxPadY = 7
	}
	maxTextWidth := w - (pad+boxPadX)*2
	if maxTextWidth < 100 {
		maxTextWidth = 100
	}

	startSize := float64(w) / 14.0
	if startSize < 16 {
		startSize = 16
	}
	if startSize > 58 {
		startSize = 58
	}
	minSize := 13.0
	if w >= 700 {
		minSize = 18.0
	}

	var face font.Face
	var lines []string
	for size := startSize; size >= minSize; size -= 2 {
		candidate, faceErr := opentype.NewFace(fontTTF, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
		if faceErr != nil {
			return nil, faceErr
		}
		candidateLines := wrapWatermarkLinesFast(candidate, text, maxTextWidth)
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
	if lineGap < 3 {
		lineGap = 3
	}
	textH := lineHeight*len(lines) + lineGap*(len(lines)-1)
	boxW := textW + boxPadX*2
	boxH := textH + boxPadY*2

	boxX1, boxY1 := watermarkBoxOrigin(w, h, boxW, boxH, pad, position)

	draw.Draw(canvas, image.Rect(boxX1, boxY1, boxX1+boxW, boxY1+boxH), &image.Uniform{C: color.RGBA{0, 0, 0, 95}}, image.Point{}, draw.Over)

	d.Dst = canvas
	baseline := boxY1 + boxPadY + metrics.Ascent.Ceil()
	for index, line := range lines {
		lineWidth := d.MeasureString(line).Ceil()
		lineX := boxX1 + (boxW-lineWidth)/2
		lineY := baseline + index*(lineHeight+lineGap)
		d.Src = image.NewUniform(color.RGBA{0, 0, 0, 125})
		d.Dot = fixed.P(lineX+2, lineY+2)
		d.DrawString(line)
		d.Src = image.NewUniform(color.RGBA{255, 255, 255, 225})
		d.Dot = fixed.P(lineX, lineY)
		d.DrawString(line)
	}

	quality := watermarkJPEGQuality()
	if w <= 480 && quality > 78 {
		quality = 78
	}
	var out bytes.Buffer
	out.Grow(32 * 1024)
	if err := jpeg.Encode(&out, canvas, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// RenderWatermarkedImageSized renders a SKU fallback image using a pre-decoded,
// pre-resized in-memory RGBA base image and a bounded LRU cache of rendered JPEGs.
func RenderWatermarkedImageSized(db *gorm.DB, req WatermarkRequest, targetMaxDim int) ([]byte, string, string, error) {
	if db == nil {
		return nil, "", "", errors.New("db is nil")
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, "", "", errors.New("watermark text is empty")
	}
	if len(text) > 80 {
		text = text[:80]
	}
	text = strings.ToUpper(text)
	if targetMaxDim != 400 {
		targetMaxDim = 800
	}
	pos := normalizeWatermarkPosition(req.Position)

	baseRGBA, baseIdentity, err := getCachedWatermarkBaseRGBA(db, req.BaseAssetID, targetMaxDim)
	if err != nil {
		return nil, "", "", err
	}

	lruKey := fmt.Sprintf("%s|%s|%d|%s", baseIdentity, pos, targetMaxDim, text)
	if cachedBytes, cachedETag, ok := wmLRUGet(lruKey); ok {
		return cachedBytes, "image/jpeg", cachedETag, nil
	}

	outBytes, err := renderWatermarkFromCachedRGBA(baseRGBA, text, pos)
	if err != nil {
		return nil, "", "", err
	}
	h := sha256.Sum256(outBytes)
	etag := hex.EncodeToString(h[:16])
	wmLRUPut(lruKey, outBytes, etag)
	return outBytes, "image/jpeg", etag, nil
}
