package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"fanuc-backend/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// A full catalogue submission covers hundreds of thousands of products, far longer
// than any HTTP request may live, so it runs as one background job per process.
// "unsubmitted" mode resumes naturally after a restart because progress is stored
// on each product (index_now_last_submitted_at).
const (
	indexNowJobURLsPerRequest = 8000 // protocol limit is 10,000 per POST
	indexNowJobScanChunk      = 2000
	indexNowJobPause          = time.Second
	indexNowJobMaxRetries     = 6
	indexNowJobMaxBackoff     = 10 * time.Minute
)

type IndexNowProductJob struct {
	ID             string     `json:"id"`
	Mode           string     `json:"mode"`
	State          string     `json:"state"` // running | stopping | stopped | completed | failed
	Total          int64      `json:"total"`
	Limit          int        `json:"limit"`
	Processed      int64      `json:"processed"`
	SubmittedURLs  int64      `json:"submitted_urls"`
	Requests       int        `json:"requests"`
	LastStatusCode int        `json:"last_status_code"`
	Message        string     `json:"message"`
	StartedAt      time.Time  `json:"started_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	FinishedAt     *time.Time `json:"finished_at,omitempty"`
}

var indexNowJobState struct {
	mu     sync.Mutex
	job    *IndexNowProductJob
	cancel context.CancelFunc
}

var ErrIndexNowJobRunning = errors.New("an IndexNow product submission is already running")

// CurrentIndexNowProductJob returns a snapshot of the latest job, or nil.
func CurrentIndexNowProductJob() *IndexNowProductJob {
	indexNowJobState.mu.Lock()
	defer indexNowJobState.mu.Unlock()
	if indexNowJobState.job == nil {
		return nil
	}
	snapshot := *indexNowJobState.job
	return &snapshot
}

// StopIndexNowProductJob asks the running job to stop after the current request.
func StopIndexNowProductJob() bool {
	indexNowJobState.mu.Lock()
	defer indexNowJobState.mu.Unlock()
	job := indexNowJobState.job
	if job == nil || job.State != "running" || indexNowJobState.cancel == nil {
		return false
	}
	job.State = "stopping"
	job.Message = "Stopping after the current request"
	job.UpdatedAt = time.Now().UTC()
	indexNowJobState.cancel()
	return true
}

// StartIndexNowProductJob submits every active, indexable product ("all") or only
// those never submitted ("unsubmitted"). limit > 0 caps the number of products.
func StartIndexNowProductJob(db *gorm.DB, mode string, limit int) (*IndexNowProductJob, error) {
	if mode != "all" && mode != "unsubmitted" {
		return nil, fmt.Errorf("invalid mode %q", mode)
	}
	service := NewIndexNowService(db)
	setting, err := service.GetOrCreateSetting()
	if err != nil {
		return nil, err
	}
	if !setting.Enabled {
		return nil, errors.New("indexnow is disabled")
	}

	indexNowJobState.mu.Lock()
	if job := indexNowJobState.job; job != nil && (job.State == "running" || job.State == "stopping") {
		indexNowJobState.mu.Unlock()
		return nil, ErrIndexNowJobRunning
	}
	var total int64
	if err := indexNowJobScope(db, mode, 0).Count(&total).Error; err != nil {
		indexNowJobState.mu.Unlock()
		return nil, err
	}
	if limit > 0 && int64(limit) < total {
		total = int64(limit)
	}
	now := time.Now().UTC()
	job := &IndexNowProductJob{ID: uuid.NewString(), Mode: mode, State: "running", Total: total, Limit: limit, StartedAt: now, UpdatedAt: now}
	ctx, cancel := context.WithCancel(context.Background())
	indexNowJobState.job = job
	indexNowJobState.cancel = cancel
	indexNowJobState.mu.Unlock()

	go runIndexNowProductJob(ctx, db, service, setting.SiteURL, job)
	return CurrentIndexNowProductJob(), nil
}

func indexNowJobScope(db *gorm.DB, mode string, afterID uint) *gorm.DB {
	q := db.Model(&models.Product{}).Where("is_active = ? AND seo_noindex = ? AND id > ?", true, false, afterID)
	if mode == "unsubmitted" {
		q = q.Where("index_now_last_submitted_at IS NULL")
	}
	return q
}

func updateIndexNowJob(job *IndexNowProductJob, fn func(*IndexNowProductJob)) {
	indexNowJobState.mu.Lock()
	defer indexNowJobState.mu.Unlock()
	fn(job)
	job.UpdatedAt = time.Now().UTC()
}

func finishIndexNowJob(job *IndexNowProductJob, state, message string) {
	updateIndexNowJob(job, func(j *IndexNowProductJob) {
		now := time.Now().UTC()
		j.State = state
		j.Message = message
		j.FinishedAt = &now
	})
	log.Printf("indexnow product job %s %s: %s (products=%d urls=%d requests=%d)", job.ID, state, message, job.Processed, job.SubmittedURLs, job.Requests)
}

func runIndexNowProductJob(ctx context.Context, db *gorm.DB, service *IndexNowService, siteURL string, job *IndexNowProductJob) {
	var (
		lastID     uint
		urls       []string
		seen       = map[string]bool{}
		pendingIDs []uint
		processed  int64
	)

	flush := func() error {
		if len(urls) == 0 {
			return nil
		}
		result, err := submitIndexNowBatchWithRetry(ctx, service, urls, job)
		if err != nil {
			return err
		}
		for start := 0; start < len(pendingIDs); start += 1000 {
			end := min(start+1000, len(pendingIDs))
			if err := MarkProductsIndexNowSubmitted(db, pendingIDs[start:end], result.SubmittedAt, result.StatusCode); err != nil {
				return err
			}
		}
		updateIndexNowJob(job, func(j *IndexNowProductJob) {
			j.Processed += int64(len(pendingIDs))
			j.SubmittedURLs += int64(len(urls))
			j.LastStatusCode = result.StatusCode
			j.Message = fmt.Sprintf("Submitted %d URLs (HTTP %d)", len(urls), result.StatusCode)
		})
		urls, seen, pendingIDs = nil, map[string]bool{}, nil
		select {
		case <-ctx.Done():
		case <-time.After(indexNowJobPause):
		}
		return nil
	}

	for {
		if ctx.Err() != nil {
			finishIndexNowJob(job, "stopped", "Stopped by administrator")
			return
		}
		var products []models.Product
		if err := indexNowJobScope(db, job.Mode, lastID).Select("id", "sku").Order("id ASC").Limit(indexNowJobScanChunk).Find(&products).Error; err != nil {
			finishIndexNowJob(job, "failed", "Failed to load products: "+err.Error())
			return
		}
		if len(products) == 0 {
			break
		}
		ids := make([]uint, 0, len(products))
		for _, p := range products {
			ids = append(ids, p.ID)
		}
		var translations []models.ProductTranslation
		if err := db.Where("product_id IN ?", ids).Find(&translations).Error; err != nil {
			finishIndexNowJob(job, "failed", "Failed to load translations: "+err.Error())
			return
		}
		byProduct := make(map[uint][]models.ProductTranslation, len(translations))
		for _, t := range translations {
			byProduct[t.ProductID] = append(byProduct[t.ProductID], t)
		}

		for _, p := range products {
			lastID = p.ID
			if job.Limit > 0 && processed >= int64(job.Limit) {
				break
			}
			p.Translations = byProduct[p.ID]
			productURLs := BuildProductIndexNowURLs(siteURL, p)
			fresh := 0
			for _, u := range productURLs {
				if !seen[u] {
					fresh++
				}
			}
			if len(urls)+fresh > indexNowJobURLsPerRequest {
				if err := flush(); err != nil {
					finishIndexNowJob(job, failureState(ctx), err.Error())
					return
				}
			}
			for _, u := range productURLs {
				if !seen[u] {
					seen[u] = true
					urls = append(urls, u)
				}
			}
			pendingIDs = append(pendingIDs, p.ID)
			processed++
		}
		if job.Limit > 0 && processed >= int64(job.Limit) {
			break
		}
	}
	if err := flush(); err != nil {
		finishIndexNowJob(job, failureState(ctx), err.Error())
		return
	}
	finishIndexNowJob(job, "completed", fmt.Sprintf("Submitted %d products", job.Processed))
}

func failureState(ctx context.Context) string {
	if ctx.Err() != nil {
		return "stopped"
	}
	return "failed"
}

// submitIndexNowBatchWithRetry retries throttling (429), server errors and network
// failures with exponential backoff; other rejections (403 ownership, 400/422) stop the job.
func submitIndexNowBatchWithRetry(ctx context.Context, service *IndexNowService, urls []string, job *IndexNowProductJob) (*IndexNowSubmitResult, error) {
	backoff := 30 * time.Second
	for attempt := 1; ; attempt++ {
		reqCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		result, err := service.SubmitURLs(reqCtx, urls)
		cancel()
		updateIndexNowJob(job, func(j *IndexNowProductJob) {
			j.Requests++
			if result != nil {
				j.LastStatusCode = result.StatusCode
			}
		})
		if err == nil {
			return result, nil
		}
		if ctx.Err() != nil {
			return nil, errors.New("Stopped by administrator")
		}
		if IsIndexNowOwnershipError(result) {
			return nil, errors.New("Bing has not verified ownership of this site yet (HTTP 403). Re-verify the site in Bing Webmaster Tools, then resume")
		}
		retryable := result == nil || result.StatusCode == http.StatusTooManyRequests || result.StatusCode >= 500
		if !retryable || attempt > indexNowJobMaxRetries {
			return nil, err
		}
		updateIndexNowJob(job, func(j *IndexNowProductJob) {
			j.Message = fmt.Sprintf("%v; retrying in %s (attempt %d/%d)", err, backoff, attempt, indexNowJobMaxRetries)
		})
		select {
		case <-ctx.Done():
			return nil, errors.New("Stopped by administrator")
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, indexNowJobMaxBackoff)
	}
}
