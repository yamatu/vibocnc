package controllers

import (
	"sync"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Task dispatcher.
//
// Starting a job is not just "spawn a goroutine": a job first has to win one of
// the aiOptimizationJobSlots task slots, and the one that cannot stays queued in
// the database. Every entry point - start selected, start candidates, start
// category, start spec research, one-click fix, resume, container restart - goes
// through dispatchQueuedAISEOJobs, so the ceiling holds however the job was
// created. When a job finishes, pauses or fails, its slot is released and the
// dispatcher is woken to hand it to the oldest queued job: first in, first out,
// so a queue of small jobs cannot be starved by one large job.
// ---------------------------------------------------------------------------

// aiJobDispatchMu serialises dispatch passes so two wake-ups cannot both admit
// the same queued job: the loser's claim would fail, but it would have taken a
// task slot for nothing.
var aiJobDispatchMu sync.Mutex

// claimAIAgentSEOJob moves one queued job to running and returns its worker
// token. The token fences every later write, so an old worker whose job was
// paused, resumed or restarted can never apply a result again.
func claimAIAgentSEOJob(jobID string) (string, bool) {
	db := config.GetDB()
	if db == nil {
		return "", false
	}
	now := time.Now().UTC()
	workerToken := uuid.NewString()
	claim := db.Model(&models.AIAgentSEOJob{}).
		Where("id = ? AND status = ?", jobID, "queued").
		Updates(map[string]interface{}{"status": "running", "started_at": &now, "worker_token": workerToken})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return "", false
	}
	return workerToken, true
}

// dispatchQueuedAISEOJobs starts as many queued jobs as the task slots allow,
// oldest first, and returns. Jobs that do not fit stay queued; releasing a slot
// calls this again.
func dispatchQueuedAISEOJobs() {
	db := config.GetDB()
	if db == nil {
		return
	}
	aiJobDispatchMu.Lock()
	defer aiJobDispatchMu.Unlock()

	limit := aiTaskConcurrencyLimit(db)
	var jobIDs []string
	if err := db.Model(&models.AIAgentSEOJob{}).
		Where("status = ?", "queued").
		Order("created_at ASC").
		Pluck("id", &jobIDs).Error; err != nil {
		return
	}
	for _, jobID := range jobIDs {
		release, acquired := aiOptimizationJobSlots.tryAcquire(limit)
		if !acquired {
			return
		}
		workerToken, claimed := claimAIAgentSEOJob(jobID)
		if !claimed {
			// Another pass or a resume endpoint took this job first.
			release()
			continue
		}
		go runDispatchedAISEOJob(jobID, workerToken, release)
	}
}

// dispatchQueuedAISEOJobsAsync is what handlers and finishing workers call: it
// never blocks the caller, so a worker can release its own slot first.
func dispatchQueuedAISEOJobsAsync() {
	go dispatchQueuedAISEOJobs()
}

// runDispatchedAISEOJob runs one claimed job and, whatever the outcome, gives
// its task slot back and wakes the dispatcher for the next queued job.
func runDispatchedAISEOJob(jobID, workerToken string, release func()) {
	defer func() {
		release()
		dispatchQueuedAISEOJobsAsync()
	}()
	runAIAgentSEOJob(jobID, workerToken)
}
