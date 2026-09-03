package services

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fanuc-backend/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	EbayDraftJSONTaskUploading  = "uploading"
	EbayDraftJSONTaskQueued     = "queued"
	EbayDraftJSONTaskProcessing = "processing"
	EbayDraftJSONTaskPaused     = "paused"
	EbayDraftJSONTaskCompleted  = "completed"
	EbayDraftJSONTaskWithErrors = "completed_with_errors"
	EbayDraftJSONTaskFailed     = "failed"
	EbayDraftJSONTaskCancelled  = "cancelled"

	// The limits are enforced here as well as in the HTTP controller so the
	// service remains safe when called by another transport.
	EbayDraftJSONMaxFileSize  int64 = 1024 << 20 // 1 GiB
	EbayDraftJSONChunkSize    int64 = 5 << 20    // 5 MiB
	EbayDraftJSONMaxChunkSize int64 = 8 << 20    // 8 MiB
	maxEbayDraftJSONItemBytes       = 32 << 20   // protect the worker from one giant object

	ebayDraftJSONTaskLimit  = 25
	ebayDraftJSONErrorLimit = 100
	ebayDraftJSONUploadTTL  = 24 * time.Hour
)

var (
	ErrEbayDraftJSONTaskNotFound = errors.New("JSON import task not found")
	ErrEbayDraftJSONOffset       = errors.New("offset_mismatch")
	ErrEbayDraftJSONUploadStatus = errors.New("invalid_upload_status")
	ErrEbayDraftJSONUploadSize   = errors.New("upload_incomplete")
	errEbayDraftJSONPaused       = errors.New("JSON import task paused")
	errEbayDraftJSONStopped      = errors.New("JSON import task stopped")
)

// EbayDraftJSONImportTaskSnapshot is the stable API representation shared by
// the legacy single-request endpoint and the resumable upload endpoints.
type EbayDraftJSONImportTaskSnapshot struct {
	ID            string     `json:"id"`
	Status        string     `json:"status"`
	Filename      string     `json:"filename"`
	FileSize      int64      `json:"file_size"`
	UploadedBytes int64      `json:"uploaded_bytes"`
	ChunkSize     int64      `json:"chunk_size"`
	InputOffset   int64      `json:"input_offset"`
	ProgressPct   float64    `json:"progress_pct"`
	Processed     int        `json:"processed"`
	Created       int        `json:"created"`
	Skipped       int        `json:"skipped"`
	Failed        int        `json:"failed"`
	Message       string     `json:"message,omitempty"`
	Error         string     `json:"error,omitempty"`
	Errors        []string   `json:"errors,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	StartedAt     *time.Time `json:"started_at,omitempty"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// ebayDraftJSONImportTask remains as a small in-process mirror for older
// callers. Durable workers always persist their state in the database.
type ebayDraftJSONImportTask struct {
	mu             sync.RWMutex
	cond           *sync.Cond
	pauseRequested bool

	db            *gorm.DB
	workerToken   string
	Fingerprint   string
	InputOffset   int64
	UploadedBytes int64
	ChunkSize     int64

	ID          string
	Status      string
	Filename    string
	FilePath    string
	FileSize    int64
	ProgressPct float64
	Processed   int
	Created     int
	Skipped     int
	Failed      int
	Message     string
	Error       string
	Errors      []string
	CreatedAt   time.Time
	StartedAt   *time.Time
	CompletedAt *time.Time
	UpdatedAt   time.Time
}

type ebayDraftJSONImportManager struct {
	mu    sync.RWMutex
	order []string
	tasks map[string]*ebayDraftJSONImportTask
}

var ebayDraftJSONImports = &ebayDraftJSONImportManager{
	order: make([]string, 0, ebayDraftJSONTaskLimit),
	tasks: make(map[string]*ebayDraftJSONImportTask),
}

var (
	ebayDraftJSONDBMu           sync.RWMutex
	ebayDraftJSONDB             *gorm.DB
	ebayDraftJSONStartMu        sync.Mutex
	ebayDraftJSONGlobalWorkerMu sync.Mutex
	ebayDraftJSONUploadLocks    sync.Map // task id -> *sync.Mutex
	ebayDraftJSONWorkerLocks    sync.Map // task id -> *sync.Mutex
)

func setEbayDraftJSONDB(db *gorm.DB) {
	ebayDraftJSONDBMu.Lock()
	ebayDraftJSONDB = db
	ebayDraftJSONDBMu.Unlock()
}

func currentEbayDraftJSONDB() *gorm.DB {
	ebayDraftJSONDBMu.RLock()
	defer ebayDraftJSONDBMu.RUnlock()
	return ebayDraftJSONDB
}

func ebayJSONUploadLock(id string) *sync.Mutex {
	value, _ := ebayDraftJSONUploadLocks.LoadOrStore(id, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func ebayJSONWorkerLock(id string) *sync.Mutex {
	value, _ := ebayDraftJSONWorkerLocks.LoadOrStore(id, &sync.Mutex{})
	return value.(*sync.Mutex)
}

func ebayJSONUploadRoot() string {
	root := strings.TrimSpace(os.Getenv("UPLOAD_PATH"))
	if root == "" {
		root = "./uploads"
	}
	return root
}

func ebayJSONTempDir() string {
	return filepath.Join(ebayJSONUploadRoot(), ".imports", "ebay-json")
}

func normalizeEbayJSONFilename(value string) string {
	value = strings.ReplaceAll(value, "\\", "/")
	value = filepath.Base(strings.TrimSpace(value))
	if value == "" {
		return "ebay-import-drafts.json"
	}
	value = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, value)
	if len(value) > 255 {
		runes := []rune(value)
		if len(runes) > 255 {
			value = string(runes[:255])
		}
	}
	return value
}

func validEbayJSONFingerprint(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func snapshotFromEbayJSONModel(row models.EbayImportJSONTask) EbayDraftJSONImportTaskSnapshot {
	errorsList := make([]string, 0, ebayDraftJSONErrorLimit)
	if strings.TrimSpace(row.ErrorsJSON) != "" {
		_ = json.Unmarshal([]byte(row.ErrorsJSON), &errorsList)
	}
	return EbayDraftJSONImportTaskSnapshot{
		ID: row.ID, Status: row.Status, Filename: row.Filename, FileSize: row.FileSize,
		UploadedBytes: row.UploadedBytes, ChunkSize: row.ChunkSize, InputOffset: row.InputOffset,
		ProgressPct: row.ProgressPct, Processed: row.Processed, Created: row.Created,
		Skipped: row.Skipped, Failed: row.Failed, Message: row.Message, Error: row.Error,
		Errors: errorsList, CreatedAt: row.CreatedAt, StartedAt: row.StartedAt,
		CompletedAt: row.CompletedAt, UpdatedAt: row.UpdatedAt,
	}
}

func runtimeFromEbayJSONModel(row models.EbayImportJSONTask, db *gorm.DB, workerToken string) *ebayDraftJSONImportTask {
	task := &ebayDraftJSONImportTask{
		db: db, workerToken: workerToken, Fingerprint: row.Fingerprint,
		InputOffset: row.InputOffset, UploadedBytes: row.UploadedBytes, ChunkSize: row.ChunkSize,
		ID: row.ID, Status: row.Status, Filename: row.Filename, FilePath: row.FilePath,
		FileSize: row.FileSize, ProgressPct: row.ProgressPct, Processed: row.Processed,
		Created: row.Created, Skipped: row.Skipped, Failed: row.Failed, Message: row.Message,
		Error: row.Error, CreatedAt: row.CreatedAt, StartedAt: row.StartedAt,
		CompletedAt: row.CompletedAt, UpdatedAt: row.UpdatedAt,
		Errors: make([]string, 0, ebayDraftJSONErrorLimit),
	}
	if strings.TrimSpace(row.ErrorsJSON) != "" {
		_ = json.Unmarshal([]byte(row.ErrorsJSON), &task.Errors)
	}
	task.cond = sync.NewCond(&task.mu)
	return task
}

// CreateEbayDraftJSONImportTask creates (or returns) a resumable upload slot.
// A matching unfinished upload is returned idempotently for browser retries.
func CreateEbayDraftJSONImportTask(db *gorm.DB, filename string, fileSize int64, fingerprint string, createdByID uint) (EbayDraftJSONImportTaskSnapshot, error) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("db is nil")
	}
	if fileSize < 0 || fileSize > EbayDraftJSONMaxFileSize {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("JSON file size is outside the 1 GiB limit")
	}
	filename = normalizeEbayJSONFilename(filename)
	if !strings.EqualFold(filepath.Ext(filename), ".json") {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("Only .json files are supported")
	}
	fingerprint = strings.TrimSpace(fingerprint)
	if !validEbayJSONFingerprint(fingerprint) {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("invalid upload fingerprint")
	}
	setEbayDraftJSONDB(db)
	ebayDraftJSONStartMu.Lock()
	defer ebayDraftJSONStartMu.Unlock()

	activeStatuses := []string{EbayDraftJSONTaskUploading, EbayDraftJSONTaskQueued, EbayDraftJSONTaskProcessing, EbayDraftJSONTaskPaused}
	var active models.EbayImportJSONTask
	err := db.Where("status IN ?", activeStatuses).Order("created_at DESC").First(&active).Error
	if err == nil {
		if active.Status == EbayDraftJSONTaskUploading {
			stat, statErr := os.Stat(active.FilePath)
			expired := !active.UpdatedAt.IsZero() && time.Since(active.UpdatedAt) > ebayDraftJSONUploadTTL
			fingerprintMatches := strings.EqualFold(active.Fingerprint, fingerprint) ||
				(fingerprint != "" && active.Fingerprint == "")
			same := strings.EqualFold(active.Filename, filename) && active.FileSize == fileSize && fingerprintMatches
			fileValid := statErr == nil && stat.Size() >= active.UploadedBytes && stat.Size() <= active.FileSize
			if same && fileValid && !expired {
				if active.Fingerprint == "" && fingerprint != "" {
					if updateErr := db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ?", active.ID, EbayDraftJSONTaskUploading).
						Update("fingerprint", fingerprint).Error; updateErr != nil {
						return EbayDraftJSONImportTaskSnapshot{}, updateErr
					}
					active.Fingerprint = fingerprint
				}
				return snapshotFromEbayJSONModel(active), nil
			}
			if expired || os.IsNotExist(statErr) || (statErr == nil && (stat.Size() < active.UploadedBytes || stat.Size() > active.FileSize)) {
				now := time.Now().UTC()
				_ = db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ?", active.ID, EbayDraftJSONTaskUploading).
					Updates(map[string]interface{}{"status": EbayDraftJSONTaskCancelled, "message": "expired or missing upload cancelled", "completed_at": &now, "updated_at": &now})
				_ = os.Remove(active.FilePath)
			} else {
				return EbayDraftJSONImportTaskSnapshot{}, errors.New("another eBay JSON import task is active")
			}
		} else {
			return EbayDraftJSONImportTaskSnapshot{}, errors.New("another eBay JSON import task is active")
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return EbayDraftJSONImportTaskSnapshot{}, err
	}

	if err := os.MkdirAll(ebayJSONTempDir(), 0o750); err != nil {
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	taskID := uuid.NewString()
	filePath := filepath.Join(ebayJSONTempDir(), taskID+".json")
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	_ = file.Close()
	now := time.Now().UTC()
	row := models.EbayImportJSONTask{
		ID: taskID, Status: EbayDraftJSONTaskUploading, Filename: filename, FileSize: fileSize,
		ChunkSize: EbayDraftJSONChunkSize, Fingerprint: fingerprint, FilePath: filePath,
		Message: "waiting for JSON chunks", CreatedByID: createdByID, CreatedAt: now, UpdatedAt: now,
		ErrorsJSON: "[]",
	}
	if err := db.Create(&row).Error; err != nil {
		_ = os.Remove(filePath)
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	return snapshotFromEbayJSONModel(row), nil
}

// StartEbayDraftJSONImportTask is the legacy compatibility path. It writes a
// complete request into the same durable file and queues it.
func StartEbayDraftJSONImportTask(db *gorm.DB, src io.Reader, filename string, fileSize int64) (EbayDraftJSONImportTaskSnapshot, error) {
	if src == nil {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("JSON file is required")
	}
	if fileSize < 0 {
		fileSize = 0
	}
	task, err := CreateEbayDraftJSONImportTask(db, filename, fileSize, "", 0)
	if err != nil {
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	lock := ebayJSONUploadLock(task.ID)
	lock.Lock()
	filePath := filePathForEbayJSONTask(db, task.ID)
	resetNow := time.Now().UTC()
	reset := db.Model(&models.EbayImportJSONTask{}).
		Where("id = ? AND status = ?", task.ID, EbayDraftJSONTaskUploading).
		Updates(map[string]interface{}{"uploaded_bytes": 0, "progress_pct": 0, "updated_at": &resetNow, "message": "restarting JSON upload"})
	if reset.Error != nil {
		lock.Unlock()
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("JSON upload task is no longer accepting data")
	}
	file, err := os.OpenFile(filePath, os.O_RDWR, 0o600)
	if err != nil {
		lock.Unlock()
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	copyErr := file.Truncate(0)
	if copyErr == nil {
		_, _ = file.Seek(0, io.SeekStart)
	}
	written := int64(0)
	if copyErr == nil {
		written, copyErr = io.Copy(file, io.LimitReader(src, EbayDraftJSONMaxFileSize+1))
	}
	if copyErr == nil && written > EbayDraftJSONMaxFileSize {
		copyErr = errors.New("JSON file exceeds the 1 GiB limit")
	}
	if copyErr == nil && fileSize > 0 && written != fileSize {
		copyErr = fmt.Errorf("JSON file size mismatch: received %d bytes, expected %d", written, fileSize)
	}
	if copyErr == nil && written == 0 {
		copyErr = errors.New("JSON file is empty")
	}
	if copyErr == nil {
		copyErr = file.Sync()
	}
	_ = file.Close()
	lock.Unlock()
	if copyErr != nil {
		now := time.Now().UTC()
		_ = db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ?", task.ID, EbayDraftJSONTaskUploading).
			Updates(map[string]interface{}{"status": EbayDraftJSONTaskCancelled, "message": "legacy JSON upload failed", "error": copyErr.Error(), "completed_at": &now, "updated_at": &now})
		_ = os.Remove(filePath)
		return EbayDraftJSONImportTaskSnapshot{}, copyErr
	}
	if fileSize == 0 {
		fileSize = written
	}
	now := time.Now().UTC()
	progress := 0.0
	if fileSize > 0 {
		progress = minFloat64(99.9, float64(written)*100/float64(fileSize))
	}
	result := db.Model(&models.EbayImportJSONTask{}).
		Where("id = ? AND status = ?", task.ID, EbayDraftJSONTaskUploading).
		Updates(map[string]interface{}{"file_size": fileSize, "uploaded_bytes": written, "progress_pct": progress, "updated_at": &now, "message": "upload complete"})
	if result.Error != nil || result.RowsAffected == 0 {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("failed to persist JSON upload progress")
	}
	return CompleteEbayDraftJSONImportTask(db, task.ID)
}

func filePathForEbayJSONTask(db *gorm.DB, taskID string) string {
	var row models.EbayImportJSONTask
	if db != nil && db.First(&row, "id = ?", strings.TrimSpace(taskID)).Error == nil && strings.TrimSpace(row.FilePath) != "" {
		return row.FilePath
	}
	return filepath.Join(ebayJSONTempDir(), strings.TrimSpace(taskID)+".json")
}

// UploadEbayDraftJSONChunk appends one sequential chunk. Re-sending an
// identical already-written chunk is idempotent if a proxy dropped a response.
func UploadEbayDraftJSONChunk(db *gorm.DB, taskID string, offset int64, chunk []byte) (EbayDraftJSONImportTaskSnapshot, error) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("db is nil")
	}
	if offset < 0 {
		return EbayDraftJSONImportTaskSnapshot{}, fmt.Errorf("%w: invalid offset", ErrEbayDraftJSONOffset)
	}
	if len(chunk) == 0 || int64(len(chunk)) > EbayDraftJSONMaxChunkSize {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("JSON chunk must be between 1 byte and 8 MiB")
	}
	taskID = strings.TrimSpace(taskID)
	lock := ebayJSONUploadLock(taskID)
	lock.Lock()
	defer lock.Unlock()
	var row models.EbayImportJSONTask
	if err := db.First(&row, "id = ?", taskID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return EbayDraftJSONImportTaskSnapshot{}, ErrEbayDraftJSONTaskNotFound
		}
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	if row.Status != EbayDraftJSONTaskUploading {
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: task is %s", ErrEbayDraftJSONUploadStatus, row.Status)
	}
	if offset > row.FileSize || int64(len(chunk)) > row.FileSize-offset {
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: chunk exceeds declared file size", ErrEbayDraftJSONUploadSize)
	}
	file, err := os.OpenFile(row.FilePath, os.O_RDWR, 0o600)
	if err != nil {
		return snapshotFromEbayJSONModel(row), err
	}
	defer file.Close()
	if offset < row.UploadedBytes && offset+int64(len(chunk)) <= row.UploadedBytes {
		existing := make([]byte, len(chunk))
		if _, readErr := file.ReadAt(existing, offset); readErr == nil && bytes.Equal(existing, chunk) {
			return snapshotFromEbayJSONModel(row), nil
		}
	}
	if offset != row.UploadedBytes {
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: server expects offset %d", ErrEbayDraftJSONOffset, row.UploadedBytes)
	}
	written, writeErr := file.WriteAt(chunk, offset)
	if writeErr != nil {
		return snapshotFromEbayJSONModel(row), writeErr
	}
	if written != len(chunk) {
		return snapshotFromEbayJSONModel(row), io.ErrShortWrite
	}
	if err := file.Sync(); err != nil {
		return snapshotFromEbayJSONModel(row), err
	}
	next := offset + int64(len(chunk))
	now := time.Now().UTC()
	progress := 0.0
	if row.FileSize > 0 {
		progress = minFloat64(99.9, float64(next)*100/float64(row.FileSize))
	}
	result := db.Model(&models.EbayImportJSONTask{}).
		Where("id = ? AND status = ? AND uploaded_bytes = ?", row.ID, EbayDraftJSONTaskUploading, offset).
		Updates(map[string]interface{}{"uploaded_bytes": next, "progress_pct": progress, "message": "uploading JSON", "updated_at": &now})
	if result.Error != nil {
		return snapshotFromEbayJSONModel(row), result.Error
	}
	if result.RowsAffected == 0 {
		_ = db.First(&row, "id = ?", row.ID).Error
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: upload progress changed", ErrEbayDraftJSONOffset)
	}
	row.UploadedBytes = next
	row.ProgressPct = progress
	row.UpdatedAt = now
	row.Message = "uploading JSON"
	return snapshotFromEbayJSONModel(row), nil
}

// CompleteEbayDraftJSONImportTask queues an uploaded file. Repeated calls are
// idempotent and return the current state.
func CompleteEbayDraftJSONImportTask(db *gorm.DB, taskID string) (EbayDraftJSONImportTaskSnapshot, error) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("db is nil")
	}
	taskID = strings.TrimSpace(taskID)
	lock := ebayJSONUploadLock(taskID)
	lock.Lock()
	defer lock.Unlock()
	var row models.EbayImportJSONTask
	if err := db.First(&row, "id = ?", taskID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return EbayDraftJSONImportTaskSnapshot{}, ErrEbayDraftJSONTaskNotFound
		}
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	if row.Status == EbayDraftJSONTaskQueued || row.Status == EbayDraftJSONTaskProcessing || row.Status == EbayDraftJSONTaskPaused || row.Status == EbayDraftJSONTaskCompleted || row.Status == EbayDraftJSONTaskWithErrors {
		return snapshotFromEbayJSONModel(row), nil
	}
	if row.Status != EbayDraftJSONTaskUploading {
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: task is %s", ErrEbayDraftJSONUploadStatus, row.Status)
	}
	if row.FileSize <= 0 || row.UploadedBytes != row.FileSize {
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: uploaded %d of %d bytes", ErrEbayDraftJSONUploadSize, row.UploadedBytes, row.FileSize)
	}
	stat, err := os.Stat(row.FilePath)
	if err != nil || stat.Size() != row.FileSize {
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: uploaded file is incomplete", ErrEbayDraftJSONUploadSize)
	}
	now := time.Now().UTC()
	result := db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ?", row.ID, EbayDraftJSONTaskUploading).
		Updates(map[string]interface{}{"status": EbayDraftJSONTaskQueued, "message": "queued for background processing", "updated_at": &now})
	if result.Error != nil {
		return snapshotFromEbayJSONModel(row), result.Error
	}
	if result.RowsAffected == 0 {
		_ = db.First(&row, "id = ?", row.ID).Error
		return snapshotFromEbayJSONModel(row), fmt.Errorf("%w: task state changed", ErrEbayDraftJSONUploadStatus)
	}
	row.Status = EbayDraftJSONTaskQueued
	row.Message = "queued for background processing"
	row.UpdatedAt = now
	go runPersistentEbayDraftJSONImportTask(db, row.ID)
	return snapshotFromEbayJSONModel(row), nil
}

func LoadEbayDraftJSONImportTask(db *gorm.DB, taskID string) (EbayDraftJSONImportTaskSnapshot, bool) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, false
	}
	setEbayDraftJSONDB(db)
	var row models.EbayImportJSONTask
	if err := db.First(&row, "id = ?", strings.TrimSpace(taskID)).Error; err != nil {
		return EbayDraftJSONImportTaskSnapshot{}, false
	}
	return snapshotFromEbayJSONModel(row), true
}

func LoadLatestEbayDraftJSONImportTask(db *gorm.DB) (EbayDraftJSONImportTaskSnapshot, bool) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, false
	}
	setEbayDraftJSONDB(db)
	var row models.EbayImportJSONTask
	if err := db.Order("created_at DESC").First(&row).Error; err != nil {
		return EbayDraftJSONImportTaskSnapshot{}, false
	}
	return snapshotFromEbayJSONModel(row), true
}

func PauseEbayDraftJSONImportTaskByDB(db *gorm.DB, taskID string) (EbayDraftJSONImportTaskSnapshot, error) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("db is nil")
	}
	taskID = strings.TrimSpace(taskID)
	now := time.Now().UTC()
	result := db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status IN ?", taskID, []string{EbayDraftJSONTaskQueued, EbayDraftJSONTaskProcessing}).
		Updates(map[string]interface{}{"status": EbayDraftJSONTaskPaused, "worker_token": "", "message": "paused by administrator", "updated_at": &now})
	if result.Error != nil {
		return EbayDraftJSONImportTaskSnapshot{}, result.Error
	}
	if result.RowsAffected == 0 {
		if task, ok := LoadEbayDraftJSONImportTask(db, taskID); ok {
			return task, errors.New("only queued or processing tasks can be paused")
		}
		return EbayDraftJSONImportTaskSnapshot{}, ErrEbayDraftJSONTaskNotFound
	}
	if task, ok := ebayDraftJSONImports.get(taskID); ok {
		task.update(func(value *ebayDraftJSONImportTask) {
			value.pauseRequested = true
			value.Status = EbayDraftJSONTaskPaused
			value.Message = "paused by administrator"
		})
		task.signal()
	}
	task, _ := LoadEbayDraftJSONImportTask(db, taskID)
	return task, nil
}

func ResumeEbayDraftJSONImportTaskByDB(db *gorm.DB, taskID string) (EbayDraftJSONImportTaskSnapshot, error) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("db is nil")
	}
	taskID = strings.TrimSpace(taskID)
	now := time.Now().UTC()
	result := db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ?", taskID, EbayDraftJSONTaskPaused).
		Updates(map[string]interface{}{"status": EbayDraftJSONTaskQueued, "worker_token": "", "message": "queued for resume", "updated_at": &now})
	if result.Error != nil {
		return EbayDraftJSONImportTaskSnapshot{}, result.Error
	}
	if result.RowsAffected == 0 {
		if task, ok := LoadEbayDraftJSONImportTask(db, taskID); ok {
			return task, errors.New("only paused tasks can be resumed")
		}
		return EbayDraftJSONImportTaskSnapshot{}, ErrEbayDraftJSONTaskNotFound
	}
	if task, ok := ebayDraftJSONImports.get(taskID); ok {
		task.update(func(value *ebayDraftJSONImportTask) { value.pauseRequested = false })
		task.signal()
	}
	go runPersistentEbayDraftJSONImportTask(db, taskID)
	task, _ := LoadEbayDraftJSONImportTask(db, taskID)
	return task, nil
}

func CancelEbayDraftJSONImportTask(db *gorm.DB, taskID string) (EbayDraftJSONImportTaskSnapshot, error) {
	if db == nil {
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("db is nil")
	}
	taskID = strings.TrimSpace(taskID)
	var row models.EbayImportJSONTask
	if err := db.First(&row, "id = ?", taskID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return EbayDraftJSONImportTaskSnapshot{}, ErrEbayDraftJSONTaskNotFound
		}
		return EbayDraftJSONImportTaskSnapshot{}, err
	}
	if row.Status == EbayDraftJSONTaskCompleted || row.Status == EbayDraftJSONTaskWithErrors || row.Status == EbayDraftJSONTaskCancelled {
		return snapshotFromEbayJSONModel(row), errors.New("task cannot be cancelled in its current state")
	}
	now := time.Now().UTC()
	if err := db.Model(&models.EbayImportJSONTask{}).Where("id = ?", taskID).
		Updates(map[string]interface{}{"status": EbayDraftJSONTaskCancelled, "worker_token": "", "message": "cancelled by administrator", "completed_at": &now, "updated_at": &now}).Error; err != nil {
		return snapshotFromEbayJSONModel(row), err
	}
	if row.Status != EbayDraftJSONTaskProcessing {
		_ = os.Remove(row.FilePath)
	}
	task, _ := LoadEbayDraftJSONImportTask(db, taskID)
	return task, nil
}

// Compatibility wrappers used by the original controller and older clients.
func GetEbayDraftJSONImportTask(taskID string) (EbayDraftJSONImportTaskSnapshot, bool) {
	if db := currentEbayDraftJSONDB(); db != nil {
		if task, ok := LoadEbayDraftJSONImportTask(db, taskID); ok {
			return task, true
		}
	}
	return ebayDraftJSONImports.getSnapshot(strings.TrimSpace(taskID))
}

func GetLatestEbayDraftJSONImportTask() (EbayDraftJSONImportTaskSnapshot, bool) {
	if db := currentEbayDraftJSONDB(); db != nil {
		if task, ok := LoadLatestEbayDraftJSONImportTask(db); ok {
			return task, true
		}
	}
	return ebayDraftJSONImports.latestSnapshot()
}

func PauseEbayDraftJSONImportTask(taskID string) (EbayDraftJSONImportTaskSnapshot, error) {
	if db := currentEbayDraftJSONDB(); db != nil {
		return PauseEbayDraftJSONImportTaskByDB(db, taskID)
	}
	task, ok := ebayDraftJSONImports.get(strings.TrimSpace(taskID))
	if !ok {
		return EbayDraftJSONImportTaskSnapshot{}, ErrEbayDraftJSONTaskNotFound
	}
	return task.pause()
}

func ResumeEbayDraftJSONImportTask(taskID string) (EbayDraftJSONImportTaskSnapshot, error) {
	if db := currentEbayDraftJSONDB(); db != nil {
		return ResumeEbayDraftJSONImportTaskByDB(db, taskID)
	}
	task, ok := ebayDraftJSONImports.get(strings.TrimSpace(taskID))
	if !ok {
		return EbayDraftJSONImportTaskSnapshot{}, ErrEbayDraftJSONTaskNotFound
	}
	return task.resume()
}

func runPersistentEbayDraftJSONImportTask(db *gorm.DB, taskID string) {
	if db == nil {
		return
	}
	// Only one large import is allowed at a time. This prevents a restart with
	// several queued rows (or two browser tabs) from saturating the database and
	// remote image services.
	ebayDraftJSONGlobalWorkerMu.Lock()
	defer ebayDraftJSONGlobalWorkerMu.Unlock()
	lock := ebayJSONWorkerLock(taskID)
	lock.Lock()
	defer lock.Unlock()
	workerToken := uuid.NewString()
	now := time.Now().UTC()
	claim := db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ?", taskID, EbayDraftJSONTaskQueued).
		Updates(map[string]interface{}{"status": EbayDraftJSONTaskProcessing, "worker_token": workerToken, "started_at": &now, "message": "loading JSON import", "updated_at": &now})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}
	var row models.EbayImportJSONTask
	if err := db.First(&row, "id = ?", taskID).Error; err != nil {
		return
	}
	task := runtimeFromEbayJSONModel(row, db, workerToken)
	task.Status = EbayDraftJSONTaskProcessing
	task.StartedAt = &now
	task.Message = "loading duplicate index"
	ebayDraftJSONImports.add(task)
	persistEbayDraftJSONRuntimeProgress(task)

	err := processEbayDraftJSONImportFile(context.Background(), db, task)
	var current models.EbayImportJSONTask
	if loadErr := db.First(&current, "id = ?", taskID).Error; loadErr != nil {
		return
	}
	if current.Status == EbayDraftJSONTaskPaused || current.Status == EbayDraftJSONTaskCancelled || errors.Is(err, errEbayDraftJSONPaused) || errors.Is(err, errEbayDraftJSONStopped) {
		if current.Status == EbayDraftJSONTaskCancelled {
			_ = os.Remove(current.FilePath)
		}
		return
	}
	if err != nil {
		task.update(func(value *ebayDraftJSONImportTask) {
			appendEbayDraftJSONTaskError(value, err.Error())
			value.Error = err.Error()
		})
	}
	completedAt := time.Now().UTC()
	runtimeSnapshot := task.snapshot()
	status := EbayDraftJSONTaskCompleted
	message := "completed"
	errorMessage := ""
	if err != nil {
		status = EbayDraftJSONTaskFailed
		message = err.Error()
		errorMessage = err.Error()
	} else if runtimeSnapshot.Failed > 0 {
		status = EbayDraftJSONTaskWithErrors
		message = "completed with item errors"
	} else if strings.HasPrefix(runtimeSnapshot.Message, "parsed JSON after repairing ") {
		message = runtimeSnapshot.Message
	}
	errorsJSON, _ := json.Marshal(runtimeSnapshot.Errors)
	updates := map[string]interface{}{
		"status": status, "worker_token": "", "message": message, "error": errorMessage,
		"errors_json": string(errorsJSON), "completed_at": &completedAt, "updated_at": &completedAt,
	}
	if err == nil {
		updates["progress_pct"] = 100
	}
	result := db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ? AND worker_token = ?", taskID, EbayDraftJSONTaskProcessing, workerToken).Updates(updates)
	if result.Error == nil && result.RowsAffected > 0 {
		_ = os.Remove(current.FilePath)
	}
	task.update(func(value *ebayDraftJSONImportTask) {
		value.Status = status
		value.Message = message
		value.Error = errorMessage
		value.CompletedAt = &completedAt
		value.UpdatedAt = completedAt
		if err == nil {
			value.ProgressPct = 100
		}
	})
}

// ResumeEbayDraftJSONImportTasks restores jobs after a process restart.
func ResumeEbayDraftJSONImportTasks(db *gorm.DB) {
	if db == nil {
		return
	}
	setEbayDraftJSONDB(db)
	if !db.Migrator().HasTable(&models.EbayImportJSONTask{}) {
		return
	}
	now := time.Now().UTC()
	cleanupStaleEbayJSONUploads(db, now)
	_ = db.Model(&models.EbayImportJSONTask{}).Where("status = ?", EbayDraftJSONTaskProcessing).
		Updates(map[string]interface{}{"status": EbayDraftJSONTaskQueued, "worker_token": "", "message": "queued after service restart", "updated_at": &now})
	var jobs []models.EbayImportJSONTask
	if err := db.Where("status = ?", EbayDraftJSONTaskQueued).Order("created_at ASC").Find(&jobs).Error; err != nil {
		return
	}
	for _, job := range jobs {
		if _, err := os.Stat(job.FilePath); err != nil {
			_ = db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ?", job.ID, EbayDraftJSONTaskQueued).
				Updates(map[string]interface{}{"status": EbayDraftJSONTaskFailed, "message": "uploaded JSON file is missing", "error": "uploaded JSON file is missing", "completed_at": &now, "updated_at": &now})
			continue
		}
		go runPersistentEbayDraftJSONImportTask(db, job.ID)
	}
}

func cleanupStaleEbayJSONUploads(db *gorm.DB, now time.Time) {
	cutoff := now.Add(-ebayDraftJSONUploadTTL)
	var stale []models.EbayImportJSONTask
	if err := db.Where("status = ? AND updated_at < ?", EbayDraftJSONTaskUploading, cutoff).Find(&stale).Error; err != nil {
		return
	}
	for _, row := range stale {
		if result := db.Model(&models.EbayImportJSONTask{}).
			Where("id = ? AND status = ?", row.ID, EbayDraftJSONTaskUploading).
			Updates(map[string]interface{}{"status": EbayDraftJSONTaskCancelled, "message": "expired upload cancelled", "completed_at": &now, "updated_at": &now}); result.Error == nil && result.RowsAffected > 0 {
			_ = os.Remove(row.FilePath)
		}
	}
}

func processEbayDraftJSONImportFile(ctx context.Context, db *gorm.DB, task *ebayDraftJSONImportTask) error {
	if db == nil || task == nil {
		return errors.New("invalid JSON import task")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	file, err := os.Open(task.FilePath)
	if err != nil {
		return err
	}
	defer file.Close()

	updateEbayDraftJSONTaskHeartbeat(task, task.InputOffset, "loading duplicate index")
	listingKeys, sourceURLs, err := loadExistingEbayDraftImportKeys(db)
	if err != nil {
		return err
	}
	fingerprints, err := loadExistingEbayDraftImportFingerprints(db)
	if err != nil {
		return err
	}
	reader := bufio.NewReaderSize(file, 64*1024)
	if prefix, peekErr := reader.Peek(3); peekErr == nil && bytes.Equal(prefix, []byte{0xef, 0xbb, 0xbf}) {
		_, _ = reader.Discard(3)
	}
	repairReader := newEbayJSONRepairReader(reader)
	decoder := json.NewDecoder(repairReader)
	decoder.UseNumber()
	updateEbayDraftJSONTaskHeartbeat(task, 0, "parsing JSON file")
	processItem := func(raw map[string]any) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := task.waitIfPaused(ctx); err != nil {
			return err
		}
		updateEbayDraftJSONTaskHeartbeat(task, decoder.InputOffset(), "processing product")
		normalized := NormalizeEbayImportDraftPayload(raw)
		listingKey, sourceURL := ebayDraftImportKeys(normalized)
		fingerprint := ebayDraftImportFingerprint(normalized)
		// A completed task-item marker is durable evidence that this source
		// object was already handled. On a worker restart, advance the byte
		// cursor without incrementing counters a second time.
		if fingerprint != "" {
			var previous models.EbayImportJSONTaskItem
			itemErr := db.Where("task_id = ? AND fingerprint = ? AND status = ?", task.ID, fingerprint, "completed").First(&previous).Error
			if itemErr == nil {
				updateEbayDraftJSONTaskOffset(task, decoder.InputOffset(), "skipped previously processed item")
				return nil
			}
			if !errors.Is(itemErr, gorm.ErrRecordNotFound) {
				return itemErr
			}
		}
		if fingerprint != "" && fingerprints[fingerprint] {
			if err := recordEbayJSONTaskItem(db, task.ID, fingerprint, nil, "completed", ""); err != nil {
				return err
			}
			updateEbayDraftJSONTaskProgress(task, decoder.InputOffset(), 0, 1, 0, "skipped previously imported item")
			return nil
		}
		if (listingKey != "" && listingKeys[listingKey]) || (sourceURL != "" && sourceURLs[sourceURL]) {
			if fingerprint != "" {
				if err := recordEbayJSONTaskItem(db, task.ID, fingerprint, nil, "completed", ""); err != nil {
					return err
				}
			}
			updateEbayDraftJSONTaskProgress(task, decoder.InputOffset(), 0, 1, 0, "skipped duplicate")
			return nil
		}
		built := BuildEbayImportDraftWithContext(ctx, db, normalized)
		draft := built.Draft
		if len(built.Errors) > 0 {
			draft.FailureReason = strings.Join(built.Errors, "; ")
		}
		var duplicate bool
		var createdID *uint
		err = db.Transaction(func(tx *gorm.DB) error {
			var previous models.EbayImportJSONTaskItem
			if findErr := tx.Where("task_id = ? AND fingerprint = ?", task.ID, fingerprint).First(&previous).Error; findErr == nil {
				duplicate = true
				return nil
			} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
				return findErr
			}
			// If a worker crashed after creating a draft but before its marker,
			// the canonical raw payload is a safe fallback identity.
			if fingerprint != "" && listingKey == "" && sourceURL == "" {
				var existing models.EbayImportDraft
				rawPayloadCondition := "raw_payload = ?"
				if strings.EqualFold(tx.Dialector.Name(), "mysql") {
					rawPayloadCondition = "BINARY raw_payload = BINARY ?"
				}
				if findErr := tx.Select("id").Where(rawPayloadCondition, draft.RawPayload).First(&existing).Error; findErr == nil {
					duplicate = true
					createdID = &existing.ID
					return tx.Create(&models.EbayImportJSONTaskItem{TaskID: task.ID, Fingerprint: fingerprint, Status: "completed", DraftID: createdID}).Error
				} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
					return findErr
				}
			}
			if createErr := tx.Create(&draft).Error; createErr != nil {
				return createErr
			}
			createdID = &draft.ID
			return tx.Create(&models.EbayImportJSONTaskItem{TaskID: task.ID, Fingerprint: fingerprint, Status: "completed", DraftID: createdID}).Error
		})
		if err != nil {
			updateEbayDraftJSONTaskProgress(task, decoder.InputOffset(), 0, 0, 1, err.Error())
			return nil
		}
		if duplicate {
			updateEbayDraftJSONTaskProgress(task, decoder.InputOffset(), 0, 1, 0, "skipped duplicate")
			return nil
		}
		if listingKey != "" {
			listingKeys[listingKey] = true
		}
		if sourceURL != "" {
			sourceURLs[sourceURL] = true
		}
		if fingerprint != "" {
			fingerprints[fingerprint] = true
		}
		updateEbayDraftJSONTaskProgress(task, decoder.InputOffset(), 1, 0, 0, "importing")
		return nil
	}

	parseErr := decodeEbayDraftJSONDocument(decoder, processItem)
	if parseErr == nil && repairReader.RepairedSeparators() > 0 {
		repaired := repairReader.RepairedSeparators()
		task.update(func(value *ebayDraftJSONImportTask) {
			value.Message = fmt.Sprintf("parsed JSON after repairing %d missing object separators", repaired)
			value.UpdatedAt = time.Now().UTC()
		})
		persistEbayDraftJSONRuntimeProgress(task)
	}
	return parseErr
}

// ebayJSONRepairReader tolerates a narrowly defined exporter defect: two
// object elements in an array are concatenated as `}{` (optionally with
// whitespace) instead of being separated by `,`. It never changes text inside
// JSON strings and only inserts a comma when the current container is an array,
// so malformed object properties and concatenated root documents still fail.
type ebayJSONRepairReader struct {
	source          *bufio.Reader
	stack           []byte
	inString        bool
	escaped         bool
	lastSignificant byte
	pending         byte
	hasPending      bool
	sourceErr       error
	repairs         int
}

func newEbayJSONRepairReader(source io.Reader) *ebayJSONRepairReader {
	if buffered, ok := source.(*bufio.Reader); ok {
		return &ebayJSONRepairReader{source: buffered, stack: make([]byte, 0, 16)}
	}
	return &ebayJSONRepairReader{source: bufio.NewReaderSize(source, 64*1024), stack: make([]byte, 0, 16)}
}

func (reader *ebayJSONRepairReader) RepairedSeparators() int {
	return reader.repairs
}

func (reader *ebayJSONRepairReader) currentContainer() byte {
	if len(reader.stack) == 0 {
		return 0
	}
	return reader.stack[len(reader.stack)-1]
}

func (reader *ebayJSONRepairReader) shouldRepair(next byte) bool {
	return !reader.inString && next == '{' && reader.lastSignificant == '}' && reader.currentContainer() == '['
}

func isEbayJSONWhitespace(value byte) bool {
	return value == ' ' || value == '\t' || value == '\r' || value == '\n'
}

func (reader *ebayJSONRepairReader) consume(value byte) {
	if reader.inString {
		if reader.escaped {
			reader.escaped = false
			return
		}
		switch value {
		case '\\':
			reader.escaped = true
		case '"':
			reader.inString = false
		}
		return
	}

	switch value {
	case '"':
		reader.inString = true
	case '[', '{':
		reader.stack = append(reader.stack, value)
	case ']', '}':
		if len(reader.stack) > 0 {
			reader.stack = reader.stack[:len(reader.stack)-1]
		}
	}
	if !isEbayJSONWhitespace(value) {
		reader.lastSignificant = value
	}
}

func (reader *ebayJSONRepairReader) Read(destination []byte) (int, error) {
	if len(destination) == 0 {
		return 0, nil
	}
	written := 0
	for written < len(destination) {
		if reader.hasPending {
			value := reader.pending
			reader.hasPending = false
			destination[written] = value
			written++
			reader.consume(value)
			continue
		}
		if reader.sourceErr != nil {
			if written > 0 {
				return written, nil
			}
			return 0, reader.sourceErr
		}
		value, err := reader.source.ReadByte()
		if err != nil {
			reader.sourceErr = err
			continue
		}
		if reader.shouldRepair(value) {
			reader.repairs++
			reader.pending = value
			reader.hasPending = true
			// The inserted comma is now the previous significant token; the
			// pending `{` will update the stack on the next iteration.
			reader.lastSignificant = ','
			destination[written] = ','
			written++
			continue
		}
		destination[written] = value
		written++
		reader.consume(value)
	}
	return written, nil
}

func recordEbayJSONTaskItem(db *gorm.DB, taskID, fingerprint string, draftID *uint, status, message string) error {
	if strings.TrimSpace(fingerprint) == "" {
		return nil
	}
	item := models.EbayImportJSONTaskItem{TaskID: taskID, Fingerprint: fingerprint, DraftID: draftID, Status: status, Error: message}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&item).Error
}

func ebayDraftImportFingerprint(raw map[string]any) string {
	if len(raw) == 0 {
		return ""
	}
	payload, err := json.Marshal(raw)
	if err != nil {
		return ""
	}
	hash := sha256.Sum256(payload)
	return hex.EncodeToString(hash[:])
}

// decodeEbayDraftJSONDocument accepts root arrays and products/items/results/
// data arrays nested in an object. It also rejects trailing data from a
// truncated or concatenated upload.
func decodeEbayDraftJSONDocument(decoder *json.Decoder, process func(map[string]any) error) error {
	token, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	var found bool
	switch value := token.(type) {
	case json.Delim:
		switch value {
		case '[':
			found = true
			if err := decodeEbayDraftJSONArray(decoder, process); err != nil {
				return err
			}
		case '{':
			found, err = decodeEbayDraftJSONObjectAfterOpen(decoder, process, 0)
			if err != nil {
				return err
			}
		default:
			return errors.New("JSON root must be an array or object")
		}
	default:
		return errors.New("JSON root must be an array or object")
	}
	if !found {
		return errors.New("JSON must contain a products, items, results, or data array")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("JSON contains trailing data")
		}
		return fmt.Errorf("invalid trailing JSON: %w", err)
	}
	return nil
}

func decodeEbayDraftJSONObjectAfterOpen(decoder *json.Decoder, process func(map[string]any) error, depth int) (bool, error) {
	if depth > 4 {
		return false, errors.New("JSON nesting is too deep")
	}
	found := false
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return false, fmt.Errorf("invalid JSON object: %w", err)
		}
		key, ok := keyToken.(string)
		if !ok {
			return false, errors.New("JSON object contains an invalid key")
		}
		isArrayKey := strings.EqualFold(key, "products") || strings.EqualFold(key, "items") || strings.EqualFold(key, "results") || strings.EqualFold(key, "data")
		valueToken, err := decoder.Token()
		if err != nil {
			return false, fmt.Errorf("invalid JSON value for %s: %w", key, err)
		}
		if !isArrayKey {
			if err := discardJSONValue(decoder, valueToken, depth); err != nil {
				return false, err
			}
			continue
		}
		delim, ok := valueToken.(json.Delim)
		if !ok {
			return false, fmt.Errorf("%s must be a JSON array", key)
		}
		switch delim {
		case '[':
			found = true
			if err := decodeEbayDraftJSONArray(decoder, process); err != nil {
				return false, err
			}
		case '{':
			nestedFound, nestedErr := decodeEbayDraftJSONObjectAfterOpen(decoder, process, depth+1)
			if nestedErr != nil {
				return false, nestedErr
			}
			found = found || nestedFound
		default:
			return false, fmt.Errorf("%s must be a JSON array", key)
		}
	}
	if _, err := decoder.Token(); err != nil {
		return false, err
	}
	return found, nil
}

func discardJSONValue(decoder *json.Decoder, token json.Token, depth int) error {
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	if depth > 8 {
		return errors.New("JSON nesting is too deep")
	}
	switch delim {
	case '[':
		for decoder.More() {
			valueToken, err := decoder.Token()
			if err != nil {
				return err
			}
			if err := discardJSONValue(decoder, valueToken, depth+1); err != nil {
				return err
			}
		}
		_, err := decoder.Token()
		return err
	case '{':
		for decoder.More() {
			if _, err := decoder.Token(); err != nil { // object key
				return err
			}
			valueToken, err := decoder.Token()
			if err != nil {
				return err
			}
			if err := discardJSONValue(decoder, valueToken, depth+1); err != nil {
				return err
			}
		}
		_, err := decoder.Token()
		return err
	default:
		return nil
	}
}

func decodeEbayDraftJSONArray(decoder *json.Decoder, process func(map[string]any) error) error {
	for decoder.More() {
		var raw json.RawMessage
		if err := decoder.Decode(&raw); err != nil {
			return fmt.Errorf("invalid product JSON: %w", err)
		}
		if len(raw) > maxEbayDraftJSONItemBytes {
			return fmt.Errorf("product JSON item exceeds %d MiB", maxEbayDraftJSONItemBytes/(1<<20))
		}
		var item map[string]any
		itemDecoder := json.NewDecoder(bytes.NewReader(raw))
		itemDecoder.UseNumber()
		if err := itemDecoder.Decode(&item); err != nil {
			return fmt.Errorf("invalid product JSON: %w", err)
		}
		if len(item) == 0 {
			continue
		}
		if err := process(item); err != nil {
			return err
		}
	}
	_, err := decoder.Token()
	return err
}

func loadExistingEbayDraftImportKeys(db *gorm.DB) (map[string]bool, map[string]bool, error) {
	var rows []struct {
		SourceSite string
		ListingID  string
		SourceURL  string
	}
	if err := db.Model(&models.EbayImportDraft{}).Select("source_site", "listing_id", "source_url").Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	listingKeys := make(map[string]bool, len(rows))
	sourceURLs := make(map[string]bool, len(rows))
	for _, row := range rows {
		if key := normalizeEbayDraftListingKey(row.SourceSite, row.ListingID); key != "" {
			listingKeys[key] = true
		}
		if value := normalizeEbayDraftSourceURL(row.SourceURL); value != "" {
			sourceURLs[value] = true
		}
	}
	return listingKeys, sourceURLs, nil
}

func loadExistingEbayDraftImportFingerprints(db *gorm.DB) (map[string]bool, error) {
	fingerprints := make(map[string]bool)
	var values []string
	if err := db.Model(&models.EbayImportJSONTaskItem{}).
		Where("status = ? AND fingerprint IS NOT NULL AND TRIM(fingerprint) <> ''", "completed").
		Distinct("fingerprint").
		Pluck("fingerprint", &values).Error; err != nil {
		return nil, err
	}
	for _, value := range values {
		if value = strings.ToLower(strings.TrimSpace(value)); value != "" {
			fingerprints[value] = true
		}
	}
	return fingerprints, nil
}

func ebayDraftImportKeys(raw map[string]any) (string, string) {
	site := firstLegacyString(raw["source_site"], raw["site"])
	listingID := firstLegacyString(raw["listing_id"], raw["product_id"], raw["ebay_item_id"], raw["id"])
	sourceURL := firstLegacyString(raw["source_url"], raw["product_url"])
	return normalizeEbayDraftListingKey(site, listingID), normalizeEbayDraftSourceURL(sourceURL)
}

func normalizeEbayDraftListingKey(site, listingID string) string {
	listingID = strings.ToLower(strings.TrimSpace(listingID))
	if listingID == "" {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(site)) + "|" + listingID
}

func normalizeEbayDraftSourceURL(value string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(value), "/"))
}

func updateEbayDraftJSONTaskProgress(task *ebayDraftJSONImportTask, offset int64, created, skipped, failed int, message string) {
	now := time.Now().UTC()
	task.update(func(value *ebayDraftJSONImportTask) {
		value.Processed++
		value.Created += created
		value.Skipped += skipped
		value.Failed += failed
		value.InputOffset = offset
		if value.FileSize > 0 {
			value.ProgressPct = minFloat64(99.9, float64(offset)*100/float64(value.FileSize))
		}
		value.Message = message
		value.UpdatedAt = now
		if failed > 0 && message != "" {
			appendEbayDraftJSONTaskError(value, message)
		}
	})
	persistEbayDraftJSONRuntimeProgress(task)
}

// updateEbayDraftJSONTaskOffset advances the durable cursor without changing
// item counters. It is used when replaying an item whose task marker already
// exists after a service restart.
func updateEbayDraftJSONTaskOffset(task *ebayDraftJSONImportTask, offset int64, message string) {
	now := time.Now().UTC()
	task.update(func(value *ebayDraftJSONImportTask) {
		value.InputOffset = offset
		if value.FileSize > 0 {
			value.ProgressPct = minFloat64(99.9, float64(offset)*100/float64(value.FileSize))
		}
		value.Message = message
		value.UpdatedAt = now
	})
	persistEbayDraftJSONRuntimeProgress(task)
}

func updateEbayDraftJSONTaskHeartbeat(task *ebayDraftJSONImportTask, offset int64, message string) {
	now := time.Now().UTC()
	task.update(func(value *ebayDraftJSONImportTask) {
		value.InputOffset = offset
		if value.FileSize > 0 {
			value.ProgressPct = minFloat64(99.9, float64(offset)*100/float64(value.FileSize))
		}
		if !value.pauseRequested {
			value.Status = EbayDraftJSONTaskProcessing
			value.Message = message
		}
		value.UpdatedAt = now
	})
	persistEbayDraftJSONRuntimeProgress(task)
}

func persistEbayDraftJSONRuntimeProgress(task *ebayDraftJSONImportTask) {
	if task == nil || task.db == nil || strings.TrimSpace(task.workerToken) == "" {
		return
	}
	task.mu.RLock()
	errorsJSON, _ := json.Marshal(task.Errors)
	updates := map[string]interface{}{
		"input_offset": task.InputOffset, "progress_pct": task.ProgressPct, "processed": task.Processed,
		"created": task.Created, "skipped": task.Skipped, "failed": task.Failed,
		"message": task.Message, "errors_json": string(errorsJSON), "updated_at": task.UpdatedAt,
	}
	task.mu.RUnlock()
	_ = task.db.Model(&models.EbayImportJSONTask{}).Where("id = ? AND status = ? AND worker_token = ?", task.ID, EbayDraftJSONTaskProcessing, task.workerToken).Updates(updates).Error
}

func appendEbayDraftJSONTaskError(task *ebayDraftJSONImportTask, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if len(task.Errors) >= ebayDraftJSONErrorLimit {
		task.Errors = task.Errors[1:]
	}
	task.Errors = append(task.Errors, message)
}

func (manager *ebayDraftJSONImportManager) hasActive() bool {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	for _, task := range manager.tasks {
		task.mu.RLock()
		active := task.Status == EbayDraftJSONTaskQueued || task.Status == EbayDraftJSONTaskProcessing || task.Status == EbayDraftJSONTaskPaused
		task.mu.RUnlock()
		if active {
			return true
		}
	}
	return false
}

func (manager *ebayDraftJSONImportManager) add(task *ebayDraftJSONImportTask) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.tasks[task.ID] = task
	manager.order = append([]string{task.ID}, manager.order...)
	for len(manager.order) > ebayDraftJSONTaskLimit {
		oldest := manager.order[len(manager.order)-1]
		manager.order = manager.order[:len(manager.order)-1]
		delete(manager.tasks, oldest)
	}
}

func (manager *ebayDraftJSONImportManager) getSnapshot(taskID string) (EbayDraftJSONImportTaskSnapshot, bool) {
	manager.mu.RLock()
	task, ok := manager.tasks[taskID]
	manager.mu.RUnlock()
	if !ok {
		return EbayDraftJSONImportTaskSnapshot{}, false
	}
	return task.snapshot(), true
}

func (manager *ebayDraftJSONImportManager) get(taskID string) (*ebayDraftJSONImportTask, bool) {
	manager.mu.RLock()
	defer manager.mu.RUnlock()
	task, ok := manager.tasks[taskID]
	return task, ok
}

func (manager *ebayDraftJSONImportManager) latestSnapshot() (EbayDraftJSONImportTaskSnapshot, bool) {
	manager.mu.RLock()
	if len(manager.order) == 0 {
		manager.mu.RUnlock()
		return EbayDraftJSONImportTaskSnapshot{}, false
	}
	task := manager.tasks[manager.order[0]]
	manager.mu.RUnlock()
	if task == nil {
		return EbayDraftJSONImportTaskSnapshot{}, false
	}
	return task.snapshot(), true
}

func (task *ebayDraftJSONImportTask) update(fn func(*ebayDraftJSONImportTask)) {
	task.mu.Lock()
	defer task.mu.Unlock()
	fn(task)
}

func (task *ebayDraftJSONImportTask) signal() {
	task.mu.Lock()
	if task.cond != nil {
		task.cond.Broadcast()
	}
	task.mu.Unlock()
}

func (task *ebayDraftJSONImportTask) waitIfPaused(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if task.db != nil {
		var row struct {
			Status      string
			WorkerToken string
		}
		if err := task.db.Model(&models.EbayImportJSONTask{}).Select("status", "worker_token").First(&row, "id = ?", task.ID).Error; err != nil {
			return err
		}
		if row.Status == EbayDraftJSONTaskPaused {
			return errEbayDraftJSONPaused
		}
		if row.Status != EbayDraftJSONTaskProcessing || row.WorkerToken != task.workerToken {
			return errEbayDraftJSONStopped
		}
		return nil
	}
	task.mu.Lock()
	defer task.mu.Unlock()
	for task.pauseRequested {
		if err := ctx.Err(); err != nil {
			return err
		}
		if task.cond == nil {
			return errEbayDraftJSONPaused
		}
		task.Status = EbayDraftJSONTaskPaused
		task.Message = "paused"
		task.UpdatedAt = time.Now().UTC()
		task.cond.Wait()
	}
	if task.Status == EbayDraftJSONTaskPaused {
		task.Status = EbayDraftJSONTaskProcessing
		task.Message = "resumed"
		task.UpdatedAt = time.Now().UTC()
	}
	return nil
}

func (task *ebayDraftJSONImportTask) pause() (EbayDraftJSONImportTaskSnapshot, error) {
	task.mu.Lock()
	if task.Status != EbayDraftJSONTaskQueued && task.Status != EbayDraftJSONTaskProcessing && task.Status != EbayDraftJSONTaskPaused {
		task.mu.Unlock()
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("only queued or processing tasks can be paused")
	}
	task.pauseRequested = true
	task.Status = EbayDraftJSONTaskPaused
	task.Message = "pause requested; waiting for current product"
	task.UpdatedAt = time.Now().UTC()
	task.mu.Unlock()
	return task.snapshot(), nil
}

func (task *ebayDraftJSONImportTask) resume() (EbayDraftJSONImportTaskSnapshot, error) {
	task.mu.Lock()
	if task.Status != EbayDraftJSONTaskPaused || !task.pauseRequested {
		task.mu.Unlock()
		return EbayDraftJSONImportTaskSnapshot{}, errors.New("task is not paused")
	}
	task.pauseRequested = false
	task.Status = EbayDraftJSONTaskProcessing
	task.Message = "resuming"
	task.UpdatedAt = time.Now().UTC()
	if task.cond != nil {
		task.cond.Broadcast()
	}
	task.mu.Unlock()
	return task.snapshot(), nil
}

func (task *ebayDraftJSONImportTask) snapshot() EbayDraftJSONImportTaskSnapshot {
	task.mu.RLock()
	defer task.mu.RUnlock()
	return EbayDraftJSONImportTaskSnapshot{
		ID: task.ID, Status: task.Status, Filename: task.Filename, FileSize: task.FileSize,
		UploadedBytes: task.UploadedBytes, ChunkSize: task.ChunkSize, InputOffset: task.InputOffset,
		ProgressPct: task.ProgressPct, Processed: task.Processed, Created: task.Created,
		Skipped: task.Skipped, Failed: task.Failed, Message: task.Message, Error: task.Error,
		Errors: append([]string(nil), task.Errors...), CreatedAt: task.CreatedAt, StartedAt: task.StartedAt,
		CompletedAt: task.CompletedAt, UpdatedAt: task.UpdatedAt,
	}
}

func minFloat64(left, right float64) float64 {
	if left < right {
		return left
	}
	return right
}
