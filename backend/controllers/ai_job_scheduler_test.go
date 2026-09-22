package controllers

import (
	"context"
	"testing"
	"time"
)

// The task ceiling is what the administrator configures as "run four tasks at
// the same time": a further task must not start until a running one finishes.
func TestAIJobGateAdmitsOnlyTheConfiguredNumberOfTasks(t *testing.T) {
	gate := &aiTaskGate{limit: 2}
	releaseFirst, ok := gate.tryAcquire(2)
	if !ok {
		t.Fatal("the first task was not admitted although two slots were free")
	}
	releaseSecond, ok := gate.tryAcquire(2)
	if !ok {
		t.Fatal("the second task was not admitted although two slots were free")
	}
	if _, ok := gate.tryAcquire(2); ok {
		t.Fatal("a third task was admitted although the ceiling is two")
	}
	releaseFirst()
	releaseThird, ok := gate.tryAcquire(2)
	if !ok {
		t.Fatal("the slot released by a finished task was not handed to the next task")
	}
	releaseSecond()
	releaseThird()
}

// Raising the ceiling must admit waiting tasks immediately: a new value takes
// effect without a restart.
func TestAIJobGateAppliesANewCeilingToWaitingTasks(t *testing.T) {
	gate := &aiTaskGate{limit: 1}
	releaseOnly, ok := gate.tryAcquire(1)
	if !ok {
		t.Fatal("the only slot was not granted")
	}
	admitted := make(chan struct{}, 1)
	go func() {
		release, granted := gate.acquire(context.Background(), 1)
		if !granted {
			return
		}
		admitted <- struct{}{}
		release()
	}()
	waitForAITaskWaiters(t, gate, 1)
	select {
	case <-admitted:
		t.Fatal("a task was admitted while the only slot was still taken")
	case <-time.After(50 * time.Millisecond):
	}
	gate.applyLimit(2)
	select {
	case <-admitted:
	case <-time.After(2 * time.Second):
		t.Fatal("raising the ceiling did not admit the waiting task")
	}
	releaseOnly()
}

// One long task must not starve the queue: a released slot goes to the task that
// has been waiting longest.
func TestAIJobGateHandsASlotOverInArrivalOrder(t *testing.T) {
	gate := &aiTaskGate{limit: 1}
	releaseHolder, ok := gate.tryAcquire(1)
	if !ok {
		t.Fatal("the only slot was not granted")
	}
	order := make(chan string, 2)
	started := 0
	for _, name := range []string{"first", "second"} {
		name := name
		started++
		go func() {
			release, granted := gate.acquire(context.Background(), 1)
			if !granted {
				return
			}
			order <- name
			release()
		}()
		waitForAITaskWaiters(t, gate, started)
	}
	releaseHolder()
	if got := <-order; got != "first" {
		t.Fatalf("a freed slot went to %q, want the longest waiting task first", got)
	}
	if got := <-order; got != "second" {
		t.Fatalf("the second waiter woke as %q", got)
	}
}

// The provider-request ceiling is derived, not configured: it must follow the
// tasks x per-task-workers rule the settings imply, and stay bounded.
func TestProviderRequestLimitFollowsTasksTimesWorkers(t *testing.T) {
	cases := []struct {
		jobs    int
		workers int
		want    int
	}{
		{jobs: 4, workers: 2, want: 8},
		{jobs: 1, workers: 1, want: 1},
		{jobs: 4, workers: 8, want: 32},
		{jobs: 4, workers: 50, want: 32},
		{jobs: 16, workers: 1, want: 16},
		// Zero or missing settings fall back to the defaults instead of
		// dropping the ceiling to nothing.
		{jobs: 0, workers: 0, want: 8},
	}
	for _, test := range cases {
		if got := providerRequestLimitFor(test.jobs, test.workers); got != test.want {
			t.Fatalf("providerRequestLimitFor(%d, %d) = %d, want %d", test.jobs, test.workers, got, test.want)
		}
	}
}

func waitForAITaskWaiters(t *testing.T, gate *aiTaskGate, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		gate.mu.Lock()
		got := len(gate.waiters)
		gate.mu.Unlock()
		if got >= want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("the gate never reached %d waiting tasks", want)
}
