package controllers

import "testing"

func TestPreferExistingDescriptionKeepsManualCopy(t *testing.T) {
	manual := "Hand-written description.\n\nSecond paragraph."
	imported := "<p>Imported competitor copy</p>"

	if got := preferExistingDescription(manual, imported); got != manual {
		t.Fatalf("manual description must win, got %q", got)
	}
	if got := preferExistingDescription("", imported); got != imported {
		t.Fatalf("empty description must accept imported copy, got %q", got)
	}
	if got := preferExistingDescription(manual, ""); got != manual {
		t.Fatalf("missing imported copy must not clear the description, got %q", got)
	}
	if got := preferExistingDescription("  ", imported); got != imported {
		t.Fatalf("whitespace-only description must accept imported copy, got %q", got)
	}
}
