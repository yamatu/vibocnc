package services

import (
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestEbayBulkConfirmTaskPauseResume(t *testing.T) {
	task := &ebayBulkConfirmTask{Status: EbayBulkConfirmProcessing, Total: 2}
	task.cond = sync.NewCond(&task.mu)
	paused, err := task.pause()
	if err != nil || paused.Status != EbayBulkConfirmPaused {
		t.Fatalf("pause failed: status=%q err=%v", paused.Status, err)
	}
	resumed, err := task.resume()
	if err != nil || resumed.Status != EbayBulkConfirmProcessing {
		t.Fatalf("resume failed: status=%q err=%v", resumed.Status, err)
	}
}

func TestEbayBulkConfirmTaskFinish(t *testing.T) {
	task := &ebayBulkConfirmTask{Status: EbayBulkConfirmProcessing, Total: 2, Processed: 2}
	task.finish(EbayBulkConfirmCompleted, "completed")
	snapshot := task.snapshot()
	if snapshot.Status != EbayBulkConfirmCompleted || snapshot.ProgressPct != 100 {
		t.Fatalf("unexpected completed snapshot: %#v", snapshot)
	}
}

func TestEbayBulkConfirmTaskCountsSkippedItems(t *testing.T) {
	snapshot, err := StartEbayBulkConfirmTask([]uint{101}, "", nil, func(id uint, action string, userID *uint) (int, bool, error) {
		return http.StatusOK, true, nil
	})
	if err != nil {
		t.Fatalf("start task failed: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		current, ok := GetEbayBulkConfirmTaskSnapshot(snapshot.ID)
		if ok && current.Status == EbayBulkConfirmCompleted {
			if current.SkippedCount != 1 || current.FailedCount != 0 {
				t.Fatalf("unexpected skipped counters: %#v", current)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("task did not complete")
}
