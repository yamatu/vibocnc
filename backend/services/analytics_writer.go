package services

import (
	"fanuc-backend/config"
	"fanuc-backend/models"
	"log"
	"sync"
	"time"

	"gorm.io/gorm"
)

// ---------------------------------------------------------------------------
// Analytics runtime tuning
//
// Every tracked page view used to (a) run a SELECT against analytics_settings
// and (b) perform a single-row INSERT. At even modest traffic that doubles the
// query volume for purely observational data. We now:
//   - cache the "is tracking enabled" flag for a short TTL, and
//   - buffer visitor logs and flush them in batches.
// ---------------------------------------------------------------------------

const (
	// trackingCacheTTL keeps settings changes visible within ~30s while
	// eliminating one SELECT per page view.
	trackingCacheTTL = 30 * time.Second

	// visitorLogQueueSize bounds memory if the database is slow.
	visitorLogQueueSize = 4096
	// Flush thresholds for the batched writer.
	visitorLogBatchSize     = 100
	visitorLogFlushInterval = 2 * time.Second
)

var (
	trackingCacheMu   sync.RWMutex
	trackingCacheVal  bool
	trackingCacheAt   time.Time
	trackingCacheInit bool
)

// IsTrackingEnabled returns the cached analytics tracking flag. It only hits the
// database when the cached value is missing or stale.
func IsTrackingEnabled(db *gorm.DB) bool {
	if db == nil {
		return false
	}

	trackingCacheMu.RLock()
	if trackingCacheInit && time.Since(trackingCacheAt) < trackingCacheTTL {
		val := trackingCacheVal
		trackingCacheMu.RUnlock()
		return val
	}
	trackingCacheMu.RUnlock()

	s, err := GetOrCreateAnalyticsSetting(db)
	if err != nil {
		// Fail closed: never start writing analytics rows when the setting
		// cannot be read (e.g. DB hiccup).
		return false
	}

	trackingCacheMu.Lock()
	trackingCacheVal = s.TrackingEnabled
	trackingCacheAt = time.Now()
	trackingCacheInit = true
	trackingCacheMu.Unlock()

	return s.TrackingEnabled
}

// InvalidateTrackingCache forces the next IsTrackingEnabled call to re-read the
// setting. Call this whenever analytics settings are updated.
func InvalidateTrackingCache() {
	trackingCacheMu.Lock()
	trackingCacheInit = false
	trackingCacheMu.Unlock()
}

// ---------------------------------------------------------------------------
// Batched visitor log writer
// ---------------------------------------------------------------------------

var (
	visitorLogQueue  = make(chan models.VisitorLog, visitorLogQueueSize)
	visitorLogStart  sync.Once
	visitorLogDropMu sync.Mutex
	visitorLogDrops  int
)

// EnqueueVisitorLog queues a visitor log for batch insertion. It never blocks:
// if the queue is full the record is dropped and counted, because analytics must
// not become a backpressure source for live traffic.
func EnqueueVisitorLog(entry models.VisitorLog) {
	select {
	case visitorLogQueue <- entry:
	default:
		visitorLogDropMu.Lock()
		visitorLogDrops++
		drops := visitorLogDrops
		visitorLogDropMu.Unlock()
		if drops%500 == 1 {
			log.Printf("analytics: visitor log queue full, dropped %d records so far", drops)
		}
	}
}

// StartVisitorLogWriter launches the single background flusher. Safe to call
// multiple times.
func StartVisitorLogWriter() {
	visitorLogStart.Do(func() {
		go func() {
			ticker := time.NewTicker(visitorLogFlushInterval)
			defer ticker.Stop()

			batch := make([]models.VisitorLog, 0, visitorLogBatchSize)
			flush := func() {
				if len(batch) == 0 {
					return
				}
				db := config.GetDB()
				if db == nil {
					batch = batch[:0]
					return
				}
				if err := db.CreateInBatches(batch, visitorLogBatchSize).Error; err != nil {
					log.Printf("analytics: failed to persist %d visitor logs: %v", len(batch), err)
				}
				batch = batch[:0]
			}

			for {
				select {
				case entry := <-visitorLogQueue:
					batch = append(batch, entry)
					if len(batch) >= visitorLogBatchSize {
						flush()
					}
				case <-ticker.C:
					flush()
				}
			}
		}()
	})
}
