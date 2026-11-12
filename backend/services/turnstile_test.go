package services

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVerifyTurnstileToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("secret") != "s3cret" {
			t.Errorf("secret not forwarded: %q", r.PostForm.Get("secret"))
		}
		if r.PostForm.Get("response") == "good" {
			_, _ = w.Write([]byte(`{"success":true}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":false,"error-codes":["invalid-input-response"]}`))
	}))
	defer srv.Close()
	orig := turnstileVerifyURL
	turnstileVerifyURL = srv.URL
	defer func() { turnstileVerifyURL = orig }()

	ctx := context.Background()
	if err := VerifyTurnstileToken(ctx, "s3cret", "good", "1.2.3.4"); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if err := VerifyTurnstileToken(ctx, "s3cret", "bad", ""); !errors.Is(err, ErrTurnstileRejected) {
		t.Fatalf("expected rejection, got %v", err)
	}
	if err := VerifyTurnstileToken(ctx, "s3cret", "  ", ""); !errors.Is(err, ErrTurnstileMissingToken) {
		t.Fatalf("expected missing token, got %v", err)
	}
}
