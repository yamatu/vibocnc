package services

import (
	"strings"
	"testing"
)

func TestStripModelAnnotation(t *testing.T) {
	cases := map[string]string{
		"ACS355-03U-08A8-4-(ACS355-SERIES)": "ACS355-03U-08A8-4",
		"ACS355-03U-08A8-4 (ACS355 Series)": "ACS355-03U-08A8-4",
		"A06B-6079-H101":                    "A06B-6079-H101",
		"(ONLY NOTE)":                       "(ONLY NOTE)",
	}
	for in, want := range cases {
		if got := stripModelAnnotation(in); got != want {
			t.Errorf("stripModelAnnotation(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMetaTitleHasNoDanglingSeparator(t *testing.T) {
	title := BuildSafeMetaTitle(
		"ABB ACS355-03U-08A8-4-(ACS355-SERIES) Variable Frequency Drive | Vibocnc",
		"ABB ACS355-03U-08A8-4 | Vibocnc",
	)
	if strings.HasSuffix(title, "|") || strings.Contains(title, "(ACS355") {
		t.Fatalf("unexpected title %q", title)
	}
	if got := NormalizeMetaTitle("ABB ACS355-03U-08A8-4-(ACS355-SERIES) Variable Frequency Drive | Vibocnc"); strings.HasSuffix(got, "|") {
		t.Fatalf("clipped title keeps separator: %q", got)
	}
}

func TestSkeletonUsesDriveWordingForVFD(t *testing.T) {
	out := BuildProductContentSkeleton(ContentSkeletonInput{
		BrandName: "ABB",
		Model:     "ACS355-03U-08A8-4-(ACS355-SERIES)",
		PartType:  "Variable Frequency Drive",
	})
	all := out.Description + out.CompatibilityInfo + out.InstallationGuide + out.MetaTitle
	for _, bad := range []string{"axis assignment", "amplifier rating", "(ACS355"} {
		if strings.Contains(all, bad) {
			t.Errorf("VFD copy should not contain %q", bad)
		}
	}
	if !strings.Contains(out.MetaTitle, "ABB ACS355-03U-08A8-4 Variable Frequency Drive") {
		t.Errorf("meta title = %q", out.MetaTitle)
	}
}
