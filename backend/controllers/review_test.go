package controllers

import (
	"strings"
	"testing"

	"fanuc-backend/models"
)

func TestApplyReviewStatusKeepsApprovalFlagInSync(t *testing.T) {
	var r models.ProductReview
	applyReviewStatus(&r, models.ReviewStatusApproved)
	if !r.IsApproved || r.ApprovedAt == nil {
		t.Fatalf("approved review must be public: %+v", r)
	}
	applyReviewStatus(&r, models.ReviewStatusRejected)
	if r.IsApproved || r.ApprovedAt != nil {
		t.Fatalf("rejected review must be hidden: %+v", r)
	}
}

func TestValidateReviewFields(t *testing.T) {
	ok := "Works exactly as described."
	cases := []struct {
		name, title, content string
		rating               int
		wantErr              bool
	}{
		{"Ann", "", ok, 5, false},
		{"Ann", "", ok, 0, true},
		{"Ann", "", ok, 6, true},
		{"", "", ok, 4, true},
		{"Ann", "", "short", 4, true},
		{"Ann", "", strings.Repeat("x", reviewContentMaxLen+1), 4, true},
		{"Ann", strings.Repeat("t", reviewTitleMaxLen+1), ok, 4, true},
	}
	for i, tc := range cases {
		if got := validateReviewFields(tc.name, tc.title, tc.content, tc.rating) != ""; got != tc.wantErr {
			t.Errorf("case %d: wantErr=%v got=%v", i, tc.wantErr, got)
		}
	}
}
