package controllers

// ---------------------------------------------------------------------------
// Two ceilings, two different questions.
//
// 1. aiOptimizationJobSlots answers "how many optimisation tasks run at the same
//    time". That is the administrator's max_concurrent_jobs (default 4): four
//    jobs - product SEO, category optimisation, specification research - work
//    side by side, and every further job stays queued in the database until one
//    of the four finishes. A job holds one slot for its whole lifetime, because
//    that is what a task is, and ai_job_scheduler.go hands a released slot to
//    the oldest queued job.
//
// 2. aiTaskSlots answers "how many provider requests may be in flight at once".
//    This is a safety valve, not the task limit, and it is derived from the two
//    settings that describe real traffic: max_concurrent_jobs x
//    seo_job_concurrency, capped by aiProviderRequestHardCap. Four tasks of two
//    workers each can therefore really use their workers instead of serialising
//    on four requests. It is taken per provider request, at the two leaves that
//    issue one (doRequestAIAgentMessageStream and requestAIAgentMessage); those
//    two never call each other, so one request can never take a slot twice,
//    which would deadlock the gate.
//
// Assistant chat turns take a provider request slot but never a task slot: they
// are interactive, and queueing a turn behind four background jobs would make
// the assistant look hung.
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
	// or out of range, so a ceiling can never accidentally become unlimited.
	aiTaskDefaultMaxConcurrent = 4
	aiTaskMinMaxConcurrent     = 1
	// aiTaskMaxMaxConcurrent keeps a mistaken edit from switching the ceiling
	// off entirely.
	aiTaskMaxMaxConcurrent = 16
	// aiProviderRequestHardCap bounds the derived provider-request ceiling: one
	// task's worker count may be configured up to 50, and that must not open
	// hundreds of simultaneous provider connections.
	aiProviderRequestHardCap = 32
	// aiProviderRequestFallbackWorkers mirrors the seo_job_concurrency default
	// for the case where the setting row cannot be read.
	aiProviderRequestFallbackWorkers = 2
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

// aiTaskSlots bounds simultaneous provider requests; aiOptimizationJobSlots
// bounds simultaneous optimisation tasks.
var (
	aiTaskSlots            = &aiTaskGate{limit: aiTaskDefaultMaxConcurrent}
	aiOptimizationJobSlots = &aiTaskGate{limit: aiTaskDefaultMaxConcurrent}
)

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

// aiTaskConcurrencyLimit reads how many optimisation tasks may run at the same
// time (max_concurrent_jobs). A missing column or an unreachable database falls
// back to the default instead of blocking every task.
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

// aiProviderRequestWorkers reads how many provider requests one task may issue
// in parallel (seo_job_concurrency).
func aiProviderRequestWorkers(db *gorm.DB) int {
	if db == nil {
		db = config.GetDB()
	}
	if db == nil {
		return aiProviderRequestFallbackWorkers
	}
	var raw int
	if err := db.Model(&models.AIAgentSetting{}).Order("id ASC").Limit(1).Pluck("seo_job_concurrency", &raw).Error; err != nil {
		return aiProviderRequestFallbackWorkers
	}
	if raw < aiTaskMinMaxConcurrent {
		return aiProviderRequestFallbackWorkers
	}
	if raw > maxAISEOProviderRequests {
		return maxAISEOProviderRequests
	}
	return raw
}

// providerRequestLimitFor is the rule the two settings imply, kept pure so the
// relationship between them stays testable.
func providerRequestLimitFor(jobs, workers int) int {
	if jobs < aiTaskMinMaxConcurrent {
		jobs = aiTaskDefaultMaxConcurrent
	}
	if workers < aiTaskMinMaxConcurrent {
		workers = aiProviderRequestFallbackWorkers
	}
	limit := jobs * workers
	if limit < aiTaskMinMaxConcurrent {
		limit = aiTaskMinMaxConcurrent
	}
	if limit > aiProviderRequestHardCap {
		limit = aiProviderRequestHardCap
	}
	return limit
}

// aiProviderRequestLimit is the derived ceiling on simultaneous provider
// requests: task slots x per-task workers.
func aiProviderRequestLimit(db *gorm.DB) int {
	return providerRequestLimitFor(aiTaskConcurrencyLimit(db), aiProviderRequestWorkers(db))
}

// aiTaskGateHasFreeSlot reports whether a provider request would start right now
// without waiting. Callers use it to tell the administrator up front what the
// assistant is waiting for; admission itself still happens in acquire, so a race
// between the two only costs a message, never correctness.
func aiTaskGateHasFreeSlot(db *gorm.DB) bool {
	return aiTaskSlots.hasFreeSlot(aiProviderRequestLimit(db))
}

// setGlobalAITaskLimit applies a new ceiling immediately: the task ceiling is
// updated, the derived request ceiling with it, and any job that was waiting for
// a free slot is dispatched now.
func setGlobalAITaskLimit(limit int) {
	normalized := normalizedAITaskConcurrency(limit)
	aiOptimizationJobSlots.applyLimit(normalized)
	aiTaskSlots.applyLimit(aiProviderRequestLimit(config.GetDB()))
	dispatchQueuedAISEOJobsAsync()
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

// tryAcquire takes a slot only if one is free right now, and never waits. The
// task dispatcher uses it so a job that does not fit stays queued instead of
// parking a goroutine on the gate.
func (g *aiTaskGate) tryAcquire(limit int) (func(), bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if limit >= aiTaskMinMaxConcurrent {
		g.limit = limit
	}
	if g.active >= g.limit {
		return nil, false
	}
	g.active++
	return g.release, true
}

// hasFreeSlot reports whether a slot would be granted right now, without
// changing the gate.
func (g *aiTaskGate) hasFreeSlot(limit int) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if limit < aiTaskMinMaxConcurrent {
		limit = g.limit
	}
	return g.active < limit
}

func (g *aiTaskGate) release() {
	g.mu.Lock()
	if g.active > 0 {
		g.active--
	}
	// Wake exactly one waiter. Waking all of them makes every waiter re-check
	// the limit in a thundering herd, and whichever goroutine the scheduler runs
	// first wins: a task with many workers can repeatedly outrun a small task, so
	// the queue would starve instead of draining first-in first-out.
	var next chan struct{}
	if g.active < g.limit && len(g.waiters) > 0 {
		next = g.waiters[0]
		g.waiters = g.waiters[1:]
	}
	g.mu.Unlock()
	if next != nil {
		wakeAITaskWaiters([]chan struct{}{next})
	}
}

// acquireAITaskSlotForRequest takes one provider request slot.
//
// The task ceiling is enforced by the dispatcher, not here: holding a provider
// slot for a job's whole lifetime let one long job - a 30,000 item category task
// runs for days - occupy a permanent share of the ceiling and make every other
// task wait behind it. This gate only bounds how many requests the running tasks
// may have in flight together.
//
// The returned release function is always safe to call, so a caller does not
// have to branch on whether the slot was granted before an expired context.
func acquireAITaskSlotForRequest(db *gorm.DB) func() {
	release, acquired := aiTaskSlots.acquire(context.Background(), aiProviderRequestLimit(db))
	if !acquired {
		return func() {}
	}
	return release
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

// aiTaskGateStatus is the live occupancy shown in the admin UI: how many
// optimisation tasks out of how many allowed are running, and how many provider
// requests the running tasks have in flight.
type aiTaskGateStatus struct {
	// Task slots: max_concurrent_jobs optimisation tasks, running now.
	Limit       int   `json:"limit"`
	Active      int   `json:"active"`
	Available   int   `json:"available"`
	QueuedJobs  int64 `json:"queued_jobs"`
	RunningJobs int64 `json:"running_jobs"`
	// GeneratingChats is informational: an assistant turn takes a request slot,
	// never a task slot.
	GeneratingChats int64 `json:"generating_chats"`
	// Provider request slots: tasks x per-task workers.
	RequestsLimit  int `json:"requests_limit"`
	RequestsActive int `json:"requests_active"`
}

// aiTaskGateSnapshot combines the persisted job counts with the live provider
// request occupancy so the administrator can tell "4/4 tasks running, 7 queued"
// from "4/4 running, nothing waiting".
func aiTaskGateSnapshot(db *gorm.DB) aiTaskGateStatus {
	if db == nil {
		db = config.GetDB()
	}
	limit := aiTaskConcurrencyLimit(db)
	status := aiTaskGateStatus{Limit: limit, RequestsLimit: aiProviderRequestLimit(db)}
	aiTaskSlots.mu.Lock()
	status.RequestsActive = aiTaskSlots.active
	aiTaskSlots.mu.Unlock()
	if db == nil {
		status.Available = limit
		return status
	}
	var running int64
	db.Model(&models.AIAgentSEOJob{}).Where("status = ?", "running").Count(&running)
	db.Model(&models.AIAgentSEOJob{}).Where("status = ?", "queued").Count(&status.QueuedJobs)
	db.Model(&models.AIAgentConversation{}).Where("status = ?", "generating").Count(&status.GeneratingChats)
	status.RunningJobs = running
	status.Active = int(running)
	status.Available = limit - status.Active
	if status.Available < 0 {
		status.Available = 0
	}
	return status
}

// aiTaskConcurrencyLimitForResponse is a small helper for handlers that need the
// configured task ceiling without holding the gate lock.
func aiTaskConcurrencyLimitForResponse(db *gorm.DB) int {
	return aiTaskConcurrencyLimit(db)
}
