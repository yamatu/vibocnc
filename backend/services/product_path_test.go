package services

import "testing"

func TestBuildProductPublicPathEscapesHash(t *testing.T) {
	got := BuildProductPublicPath("A97L-0001-0077#AN08-J")
	want := "/products/A97L-0001-0077%23AN08-J"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}
