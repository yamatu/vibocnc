package controllers

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestTrailingDebouncerCoalescesBursts(t *testing.T) {
	var calls int32
	d := newTrailingDebouncer(30*time.Millisecond, func() { atomic.AddInt32(&calls, 1) })
	for i := 0; i < 20; i++ {
		d.Trigger()
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(80 * time.Millisecond)
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("burst of triggers ran fn %d times, want 1", got)
	}
	d.Trigger()
	time.Sleep(80 * time.Millisecond)
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("later trigger should run again, got %d calls", got)
	}
}
