package controllers

// ---------------------------------------------------------------------------
// Global AI task gate.
//
// Before this file every AI background task started the moment it was
// requested: a product SEO job, a category optimization job, a spec research
// job or an assistant turn each spawned its own goroutine, and the only
// throttle was the *per-job* worker count (AIAgentSetting.SEOJobConcurrency).
// That knob bounds how many provider requests one task issues, not how many
// tasks exist: four tasks of two workers each still open eight simultaneous
// provider requests, and four simultaneous jobs is what the server, the
// database and the provider actually feel.
//
// aiTaskSlots is the missing global ceiling. Every AI task kind takes one slot
// for its whole lifetime, so at most max_concurrent_jobs tasks run at once. A
// task that cannot get a slot stays in its queued state and waits here; nothing
// is lost, because the job row in the database - not the goroutine - is the
// queue of record.
// ---------------------------------------------------------------------------

import (
	"context"
	"sync"

	"fanuc-backend/config"
	"fanuc-backend/models"

	"gorm.io/gorm"
)

const (
	// aiTaskDefaultMaxConcurrent is used when the setting is missing, unreadable
	// or out of range, so the gate can never accidentally become unlimited.
	aiTaskDefaultMaxConcurrent = 4
	aiTaskMinMaxConcurrent     = 1
	// aiTaskMaxMaxConcurrent keeps a mistaken edit from switching the gate off.
	aiTaskMaxMaxConcurrent = 16
)

// aiTaskGate is a counting semaphore with a mutable limit. Waiters are woken by
// the release path and re-check the limit themselves, so lowering the limit
// while tasks are waiting can never over-admit.
type aiTaskGate struct {
	mu      sync.Mutex
	limit   int
	active  int
	waiters []chan struct{}
}

var aiTaskSlots = &aiTaskGate{limit: aiTaskDefaultMaxConcurrent}

// normalizedAITaskConcurrency clamps the administrator's value into the range
// the gate understands, falling back to the default rather than to "unlimited".
func normalizedAITaskConcurrency(value int) int {
	switch {
	case value < aiTaskMinMaxConcurrent:
		return aiTaskDefaultMaxConcurrent
	case value > aiTaskMaxMaxConcurrent:
		return aiTaskMaxMaxConcurrent
	default:
		return value
	}
}

// aiTaskConcurrencyLimit reads the global task ceiling. A missing column or an
// unreachable database falls back to the default instead of blocking every
// task.
func aiTaskConcurrencyLimit(db *gorm.DB) int {
	if db == nil {
		db = config.GetDB()
	}
	if db == nil {
		return aiTaskDefaultMaxConcurrent
	}
	var raw int
	if err := db.Model(&models.AIAgentSetting{}).Order("id ASC").Limit(1).Pluck("max_concurrent_jobs", &raw).Error; err != nil {
		return aiTaskDefaultMaxConcurrent
	}
	return normalizedAITaskConcurrency(raw)
}

// acquireGlobalAITaskSlot blocks until a global task slot is free. The returned
// release function must be called exactly once, normally with defer. The second
// return value is false when ctx expired first, in which case no slot is held.
func acquireGlobalAITaskSlot(ctx context.Context, db *gorm.DB) (func(), bool) {
	return aiTaskSlots.acquire(ctx, aiTaskConcurrencyLimit(db))
}

// setGlobalAITaskLimit applies a new ceiling immediately, waking waiters when
// the ceiling grew so an administrator who raises the limit does not have to
// wait for the next release.
func setGlobalAITaskLimit(limit int) {
	aiTaskSlots.applyLimit(normalizedAITaskConcurrency(limit))
}

func (g *aiTaskGate) acquire(ctx context.Context, limit int) (func(), bool) {
	g.applyLimit(limit)
	for {
		g.mu.Lock()
		if g.active < g.limit {
			g.active++
			g.mu.Unlock()
			return g.release, true
		}
		waiter := make(chan struct{}, 1)
		g.waiters = append(g.waiters, waiter)
		g.mu.Unlock()

		select {
		case <-waiter:
		case <-ctx.Done():
			g.mu.Lock()
			g.removeWaiter(waiter)
			g.mu.Unlock()
			return nil, false
		}
	}
}

func (g *aiTaskGate) release() {
	g.mu.Lock()
	if g.active > 0 {
		g.active--
	}
	waiters := g.waiters
	g.waiters = nil
	g.mu.Unlock()
	wakeAITaskWaiters(waiters)
}

func (g *aiTaskGate) applyLimit(limit int) {
	if limit < aiTaskMinMaxConcurrent {
		return
	}
	g.mu.Lock()
	g.limit = limit
	var waiters []chan struct{}
	if g.active < g.limit {
		waiters = g.waiters
		g.waiters = nil
	}
	g.mu.Unlock()
	wakeAITaskWaiters(waiters)
}

func (g *aiTaskGate) removeWaiter(target chan struct{}) {
	for index, waiter := range g.waiters {
		if waiter == target {
			g.waiters = append(g.waiters[:index], g.waiters[index+1:]...)
			return
		}
	}
}

func wakeAITaskWaiters(waiters []chan struct{}) {
	for _, waiter := range waiters {
		select {
		case waiter <- struct{}{}:
		default:
		}
	}
}

// aiTaskGateStatus is the live occupancy shown in the admin UI.
type aiTaskGateStatus struct {
	Limit           int   `json:"limit"`
	Active          int   `json:"active"`
	Available       int   `json:"available"`
	QueuedJobs      int64 `json:"queued_jobs"`
	RunningJobs     int64 `json:"running_jobs"`
	GeneratingChats int64 `json:"generating_chats"`
}

// aiTaskGateSnapshot combines the in-process gate with the persisted job counts
// so the administrator can tell "4/4 running, 7 queued" from "4/4 running,
// nothing waiting".
func aiTaskGateSnapshot(db *gorm.DB) aiTaskGateStatus {
	aiTaskSlots.mu.Lock()
	active := aiTaskSlots.active
	limit := aiTaskSlots.limit
	aiTaskSlots.mu.Unlock()

	available := limit - active
	if available < 0 {
		available = 0
	}
	status := aiTaskGateStatus{Limit: limit, Active: active, Available: available}

	if db == nil {
		db = config.GetDB()
	}
	if db == nil {
		return status
	}
	db.Model(&models.AIAgentSEOJob{}).Where("status = ?", "queued").Count(&status.QueuedJobs)
	db.Model(&models.AIAgentSEOJob{}).Where("status = ?", "running").Count(&status.RunningJobs)
	db.Model(&models.AIAgentConversation{}).Where("status = ?", "generating").Count(&status.GeneratingChats)
	return status
}

// aiTaskConcurrencyLimitForResponse is a small helper for handlers that need the
// configured ceiling without holding the gate lock.
func aiTaskConcurrencyLimitForResponse(db *gorm.DB) int {
	return aiTaskConcurrencyLimit(db)
}
