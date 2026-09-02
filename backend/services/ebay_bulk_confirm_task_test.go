package services

import (
	"sync"
	"testing"
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
