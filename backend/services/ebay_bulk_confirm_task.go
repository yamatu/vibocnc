package services

import (
	"context"
	"errors"
	"log"
	"strings"
	"sync"
	"time"

	"fanuc-backend/config"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type EbayBulkConfirmTaskStatus string

const (
	EbayBulkConfirmQueued     EbayBulkConfirmTaskStatus = "queued"
	EbayBulkConfirmProcessing EbayBulkConfirmTaskStatus = "processing"
	EbayBulkConfirmPaused     EbayBulkConfirmTaskStatus = "paused"
	EbayBulkConfirmCompleted  EbayBulkConfirmTaskStatus = "completed"
	EbayBulkConfirmFailed     EbayBulkConfirmTaskStatus = "failed"

	ebayBulkConfirmMaxTasks = 20
)

type EbayBulkConfirmItemResult struct {
	ID         uint   `json:"id"`
	Success    bool   `json:"success"`
	Skipped    bool   `json:"skipped,omitempty"`
	StatusCode int    `json:"status_code"`
	Error      string `json:"error,omitempty"`
}

type EbayBulkConfirmTaskSnapshot struct {
	ID           string                      `json:"id"`
	Status       EbayBulkConfirmTaskStatus   `json:"status"`
	Total        int                         `json:"total"`
	Processed    int                         `json:"processed"`
	SuccessCount int                         `json:"success_count"`
	FailedCount  int                         `json:"failed_count"`
	SkippedCount int                         `json:"skipped_count"`
	ProgressPct  float64                     `json:"progress_pct"`
	Message      string                      `json:"message,omitempty"`
	CurrentID    uint                        `json:"current_id,omitempty"`
	Results      []EbayBulkConfirmItemResult `json:"results,omitempty"`
	StartedAt    *time.Time                  `json:"started_at,omitempty"`
	CompletedAt  *time.Time                  `json:"completed_at,omitempty"`
	CreatedAt    time.Time                   `json:"created_at"`
	UpdatedAt    time.Time                   `json:"updated_at"`
}

type EbayDraftConfirmFunc func(id uint, action string, userID *uint) (statusCode int, skipped bool, err error)

type ebayBulkConfirmTask struct {
	mu             sync.RWMutex
	cond           *sync.Cond
	pauseRequested bool

	ID           string
	Status       EbayBulkConfirmTaskStatus
	IDs          []uint
	Action       string
	UserID       *uint
	Total        int
	Processed    int
	SuccessCount int
	FailedCount  int
	SkippedCount int
	ProgressPct  float64
	Message      string
	CurrentID    uint
	Results      []EbayBulkConfirmItemResult
	StartedAt    *time.Time
	CompletedAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type ebayBulkConfirmManager struct {
	mu    sync.RWMutex
	order []string
	tasks map[string]*ebayBulkConfirmTask
}

var ebayBulkConfirmTasks = &ebayBulkConfirmManager{
	order: make([]string, 0, ebayBulkConfirmMaxTasks),
	tasks: make(map[string]*ebayBulkConfirmTask),
}

// StartEbayBulkConfirmTask creates an async task that confirms drafts in the background.
// The confirmFn callback is the actual confirm logic (typically from the controller).
func StartEbayBulkConfirmTask(ids []uint, action string, userID *uint, confirmFn EbayDraftConfirmFunc) (EbayBulkConfirmTaskSnapshot, error) {
	if len(ids) == 0 {
		return EbayBulkConfirmTaskSnapshot{}, errors.New("at least one draft ID is required")
	}
	if ebayBulkConfirmTasks.hasActive() {
		return EbayBulkConfirmTaskSnapshot{}, errors.New("another bulk draft import task is already running")
	}
	taskID := uuid.NewString()
	now := time.Now()

	task := &ebayBulkConfirmTask{
		ID:        taskID,
		Status:    EbayBulkConfirmQueued,
		IDs:       ids,
		Action:    action,
		UserID:    userID,
		Total:     len(ids),
		Results:   make([]EbayBulkConfirmItemResult, 0, len(ids)),
		Message:   "queued",
		CreatedAt: now,
		UpdatedAt: now,
	}
	task.cond = sync.NewCond(&task.mu)

	ebayBulkConfirmTasks.add(task)

	go runEbayBulkConfirmTask(taskID, confirmFn)

	return task.snapshot(), nil
}

func GetEbayBulkConfirmTaskSnapshot(taskID string) (EbayBulkConfirmTaskSnapshot, bool) {
	return ebayBulkConfirmTasks.getSnapshot(taskID)
}

func GetLatestEbayBulkConfirmTaskSnapshot() (EbayBulkConfirmTaskSnapshot, bool) {
	return ebayBulkConfirmTasks.latestSnapshot()
}

func PauseEbayBulkConfirmTask(taskID string) (EbayBulkConfirmTaskSnapshot, error) {
	task, ok := ebayBulkConfirmTasks.get(strings.TrimSpace(taskID))
	if !ok {
		return EbayBulkConfirmTaskSnapshot{}, errors.New("bulk draft import task not found")
	}
	return task.pause()
}

func ResumeEbayBulkConfirmTask(taskID string) (EbayBulkConfirmTaskSnapshot, error) {
	task, ok := ebayBulkConfirmTasks.get(strings.TrimSpace(taskID))
	if !ok {
		return EbayBulkConfirmTaskSnapshot{}, errors.New("bulk draft import task not found")
	}
	return task.resume()
}

func runEbayBulkConfirmTask(taskID string, confirmFn EbayDraftConfirmFunc) {
	task, ok := ebayBulkConfirmTasks.get(taskID)
	if !ok {
		return
	}

	now := time.Now()
	task.update(func(t *ebayBulkConfirmTask) {
		if t.pauseRequested {
			t.Status = EbayBulkConfirmPaused
			t.Message = "paused"
		} else {
			t.Status = EbayBulkConfirmProcessing
			t.Message = "processing"
		}
		t.StartedAt = &now
		t.UpdatedAt = now
	})

	for i, id := range task.IDs {
		if err := task.waitIfPaused(context.Background()); err != nil {
			task.finish(EbayBulkConfirmFailed, err.Error())
			return
		}
		task.update(func(t *ebayBulkConfirmTask) {
			t.CurrentID = id
			t.Message = "importing draft"
			t.UpdatedAt = time.Now()
		})
		statusCode, skipped, err := confirmFn(id, task.Action, task.UserID)

		itemResult := EbayBulkConfirmItemResult{
			ID:         id,
			StatusCode: statusCode,
		}
		if err != nil {
			itemResult.Success = false
			itemResult.Error = err.Error()
		} else {
			itemResult.Success = true
			itemResult.Skipped = skipped
		}

		task.update(func(t *ebayBulkConfirmTask) {
			t.Processed = i + 1
			t.Results = append(t.Results, itemResult)
			if itemResult.Skipped {
				t.SkippedCount++
			} else if itemResult.Success {
				t.SuccessCount++
			} else {
				t.FailedCount++
			}
			if t.Total > 0 {
				t.ProgressPct = float64(t.Processed) / float64(t.Total) * 100
			}
			t.Message = "processing"
			t.UpdatedAt = time.Now()
		})
	}

	task.finish(EbayBulkConfirmCompleted, "completed")
}

// ---------- Auto-import daemon ----------

const (
	ebayAutoImportInterval  = 2 * time.Minute
	ebayAutoImportBatchSize = 50
)

var ebayAutoImportConfirmFn EbayDraftConfirmFunc

// StartEbayAutoImportDaemon starts a background goroutine that periodically
// auto-imports eligible pending drafts (new_unique + taxonomy matched + has category + has SKU).
func StartEbayAutoImportDaemon(confirmFn EbayDraftConfirmFunc) {
	ebayAutoImportConfirmFn = confirmFn
	go func() {
		time.Sleep(30 * time.Second)
		log.Println("[ebay-auto-import] daemon started")
		ticker := time.NewTicker(ebayAutoImportInterval)
		defer ticker.Stop()

		runEbayAutoImportCycle()
		for range ticker.C {
			runEbayAutoImportCycle()
		}
	}()
}

func runEbayAutoImportCycle() {
	if ebayAutoImportConfirmFn == nil {
		return
	}
	if ebayBulkConfirmTasks.hasActive() {
		return
	}

	db := getAutoImportDB()
	if db == nil {
		return
	}

	type draftCandidate struct {
		ID               uint
		NormalizedModel  string
		NormalizedPartNo string
		NormalizedMPN    string
	}

	var candidates []draftCandidate
	err := db.Table("ebay_import_drafts").
		Select("id, normalized_model, normalized_part_number, normalized_mpn").
		Where("status = ? AND taxonomy_status = ? AND match_status = ?",
			EbayDraftStatusPending, EbayDraftTaxonomyMatched, EbayDraftMatchNewUnique,
		).
		Where("suggested_category_id IS NOT NULL AND suggested_category_id > 0").
		Order("created_at ASC").
		Limit(ebayAutoImportBatchSize).
		Find(&candidates).Error
	if err != nil {
		log.Printf("[ebay-auto-import] query error: %v", err)
		return
	}

	if len(candidates) == 0 {
		return
	}

	log.Printf("[ebay-auto-import] found %d eligible drafts", len(candidates))

	success := 0
	for _, c := range candidates {
		sku := strings.TrimSpace(c.NormalizedModel)
		if sku == "" {
			sku = strings.TrimSpace(c.NormalizedPartNo)
		}
		if sku == "" {
			sku = strings.TrimSpace(c.NormalizedMPN)
		}
		if sku == "" {
			continue
		}

		_, skipped, err := ebayAutoImportConfirmFn(c.ID, "create_new", nil)
		if err != nil {
			log.Printf("[ebay-auto-import] draft #%d failed: %v", c.ID, err)
			continue
		}
		if !skipped {
			success++
		}
	}

	if success > 0 {
		log.Printf("[ebay-auto-import] imported %d/%d drafts", success, len(candidates))
	}
}

// ---------- Manager helpers ----------

func (t *ebayBulkConfirmTask) update(fn func(*ebayBulkConfirmTask)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	fn(t)
}

func (t *ebayBulkConfirmTask) snapshot() EbayBulkConfirmTaskSnapshot {
	t.mu.RLock()
	defer t.mu.RUnlock()

	results := make([]EbayBulkConfirmItemResult, len(t.Results))
	copy(results, t.Results)

	return EbayBulkConfirmTaskSnapshot{
		ID:           t.ID,
		Status:       t.Status,
		Total:        t.Total,
		Processed:    t.Processed,
		SuccessCount: t.SuccessCount,
		FailedCount:  t.FailedCount,
		SkippedCount: t.SkippedCount,
		ProgressPct:  t.ProgressPct,
		Message:      t.Message,
		CurrentID:    t.CurrentID,
		Results:      results,
		StartedAt:    t.StartedAt,
		CompletedAt:  t.CompletedAt,
		CreatedAt:    t.CreatedAt,
		UpdatedAt:    t.UpdatedAt,
	}
}

func (m *ebayBulkConfirmManager) add(task *ebayBulkConfirmTask) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.tasks[task.ID] = task
	m.order = append(m.order, task.ID)

	for len(m.order) > ebayBulkConfirmMaxTasks {
		oldID := m.order[0]
		old, ok := m.tasks[oldID]
		if !ok {
			m.order = m.order[1:]
			continue
		}
		old.mu.RLock()
		status := old.Status
		old.mu.RUnlock()
		if status != EbayBulkConfirmCompleted && status != EbayBulkConfirmFailed {
			break
		}
		m.order = m.order[1:]
		delete(m.tasks, oldID)
	}
}

func (m *ebayBulkConfirmManager) get(taskID string) (*ebayBulkConfirmTask, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task, ok := m.tasks[taskID]
	return task, ok
}

func (m *ebayBulkConfirmManager) getSnapshot(taskID string) (EbayBulkConfirmTaskSnapshot, bool) {
	task, ok := m.get(taskID)
	if !ok {
		return EbayBulkConfirmTaskSnapshot{}, false
	}
	return task.snapshot(), true
}

func (m *ebayBulkConfirmManager) latestSnapshot() (EbayBulkConfirmTaskSnapshot, bool) {
	m.mu.RLock()
	if len(m.order) == 0 {
		m.mu.RUnlock()
		return EbayBulkConfirmTaskSnapshot{}, false
	}
	task := m.tasks[m.order[len(m.order)-1]]
	m.mu.RUnlock()
	if task == nil {
		return EbayBulkConfirmTaskSnapshot{}, false
	}
	return task.snapshot(), true
}

func (m *ebayBulkConfirmManager) hasActive() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, task := range m.tasks {
		task.mu.RLock()
		active := task.Status == EbayBulkConfirmQueued || task.Status == EbayBulkConfirmProcessing || task.Status == EbayBulkConfirmPaused
		task.mu.RUnlock()
		if active {
			return true
		}
	}
	return false
}

func (t *ebayBulkConfirmTask) waitIfPaused(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	for t.pauseRequested {
		if err := ctx.Err(); err != nil {
			return err
		}
		t.Status = EbayBulkConfirmPaused
		t.Message = "paused"
		t.UpdatedAt = time.Now()
		t.cond.Wait()
	}
	if t.Status == EbayBulkConfirmPaused {
		t.Status = EbayBulkConfirmProcessing
		t.Message = "resumed"
		t.UpdatedAt = time.Now()
	}
	return nil
}

func (t *ebayBulkConfirmTask) pause() (EbayBulkConfirmTaskSnapshot, error) {
	t.mu.Lock()
	if t.Status != EbayBulkConfirmQueued && t.Status != EbayBulkConfirmProcessing && t.Status != EbayBulkConfirmPaused {
		t.mu.Unlock()
		return EbayBulkConfirmTaskSnapshot{}, errors.New("only queued or processing tasks can be paused")
	}
	t.pauseRequested = true
	t.Status = EbayBulkConfirmPaused
	t.Message = "pause requested; waiting for current draft"
	t.UpdatedAt = time.Now()
	t.mu.Unlock()
	return t.snapshot(), nil
}

func (t *ebayBulkConfirmTask) resume() (EbayBulkConfirmTaskSnapshot, error) {
	t.mu.Lock()
	if t.Status != EbayBulkConfirmPaused || !t.pauseRequested {
		t.mu.Unlock()
		return EbayBulkConfirmTaskSnapshot{}, errors.New("task is not paused")
	}
	t.pauseRequested = false
	t.Status = EbayBulkConfirmProcessing
	t.Message = "resuming"
	t.UpdatedAt = time.Now()
	t.cond.Broadcast()
	t.mu.Unlock()
	return t.snapshot(), nil
}

func (t *ebayBulkConfirmTask) finish(status EbayBulkConfirmTaskStatus, message string) {
	finishedAt := time.Now()
	t.update(func(task *ebayBulkConfirmTask) {
		task.Status = status
		task.Message = message
		task.CurrentID = 0
		task.CompletedAt = &finishedAt
		task.UpdatedAt = finishedAt
		if status == EbayBulkConfirmCompleted {
			task.ProgressPct = 100
		}
	})
}

func getAutoImportDB() *gorm.DB {
	defer func() { recover() }()
	return config.GetDB()
}
