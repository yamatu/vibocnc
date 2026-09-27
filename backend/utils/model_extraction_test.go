package utils

import (
	"strings"
	"testing"
)

// TestExtractModelFromTextCoversKnownFamilies pins the part-number families that
// a marketplace listing title is expected to yield. A draft with no model can
// never be identified, so a family that stops matching here silently turns those
// listings back into unreviewable rows.
func TestExtractModelFromTextCoversKnownFamilies(t *testing.T) {
	cases := []struct {
		name  string
		title string
		want  string
	}{
		{"fanuc amplifier", "FANUC A06B-6079-H208 Servo Amplifier Module TESTED", "A06B-6079-H208"},
		{"fanuc pcb", "Fanuc A02B-0120-C041 PCB Board free shipping", "A02B-0120-C041"},
		{"fanuc pulse coder", "FANUC A860-2000-T301 Pulse Coder encoder", "A860-2000-T301"},
		{"siemens s7", "Siemens 6ES7215-1AG40-0XB0 SIMATIC S7-1200 CPU 1215C", "6ES7215-1AG40-0XB0"},
		{"mitsubishi servo", "Mitsubishi MR-J4-40A MELSERVO Servo Drive 400W", "MR-J4-40A"},
		{"yaskawa drive", "Yaskawa SGDV-2R8A01A Servo Pack tested working", "SGDV-2R8A01A"},
		{"yaskawa motor", "USED Yaskawa SGMJV-04ADE6S AC Servo Motor", "SGMJV-04ADE6S"},
		{"omron plc", "Omron CJ2M-CPU31 PLC CPU Unit original", "CJ2M-CPU31"},
		{"allen bradley", "Allen-Bradley 1756-L61 ControlLogix Processor unit", "1756-L61"},
		{"abb module", "ABB DSQC-664 DSQC 664 module new", "DSQC-664"},
		{"lowercase title", "fanuc a06b-6079-h208 servo amplifier", "A06B-6079-H208"},
		{"model in the middle", "Industrial part A06B-6079-H208 amplifier FANUC", "A06B-6079-H208"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ExtractModelFromText(tc.title); got != tc.want {
				t.Fatalf("ExtractModelFromText(%q) = %q, want %q", tc.title, got, tc.want)
			}
		})
	}
}

// TestExtractModelFromTextRejectsProse is the guard that makes this safe to run
// over a title. A wrong model is worse than no model: it is what the AI's
// reading of the listing is compared against, so a guess would reject a correct
// identification as a mismatch.
func TestExtractModelFromTextRejectsProse(t *testing.T) {
	prose := []string{
		"",
		"   ",
		"Lot of 5 FANUC Servo Motors USED",
		"NEW-2024-LOT industrial automation parts",
		"USED-AS-IS no returns accepted",
		"SHIPS-FROM-USA fast free delivery",
		"Free shipping worldwide, best price guarantee",
		"Tested and working, pulled from a working machine",
		"Servo Amplifier Module for CNC machine",
	}
	for _, title := range prose {
		t.Run(title, func(t *testing.T) {
			if got := ExtractModelFromText(title); got != "" {
				t.Fatalf("ExtractModelFromText(%q) = %q, want no match", title, got)
			}
		})
	}
}

// TestParseModelFromFilenameStillAllowsLooseFormat keeps media filename parsing
// on its historical behavior: filenames are machine-made, so the unstructured
// fallback still applies there even though titles no longer use it.
func TestParseModelFromFilenameStillAllowsLooseFormat(t *testing.T) {
	cases := []struct {
		filename string
		want     string
	}{
		{"A02B-0120-C041MAR_$_57.jpg", "A02B-0120-C041MAR"},
		{"A06B-6220-H006.png", "A06B-6220-H006"},
		{"A860-2000-T301_image.jpg", "A860-2000-T301"},
		{"MR-J4-40A.jpg", "MR-J4-40A"},
		{"6ES7215-1AG40-0XB0.png", "6ES7215-1AG40-0XB0"},
		{"1756-L61_main.jpg", "1756-L61"},
		{"some-weird-part.jpg", "SOME-WEIRD-PART"},
		{"no-model-here.jpeg", "NO-MODEL-HERE"},
	}
	for _, tc := range cases {
		t.Run(tc.filename, func(t *testing.T) {
			if got := ParseModelFromFilename(tc.filename); got != tc.want {
				t.Fatalf("ParseModelFromFilename(%q) = %q, want %q", tc.filename, got, tc.want)
			}
		})
	}
}

// TestExtractModelFromTextIgnoresExtension confirms titles are not run through
// filename extension stripping, which would truncate a title containing a dot.
func TestExtractModelFromTextIgnoresExtension(t *testing.T) {
	title := "FANUC A06B-6079-H208. Tested, working pull."
	if got := ExtractModelFromText(title); got != "A06B-6079-H208" {
		t.Fatalf("ExtractModelFromText(%q) = %q, want %q", title, got, "A06B-6079-H208")
	}
}

// TestExtractModelFromTextHandlesSellerSpacing covers the shapes sellers actually
// type when they retype a model for a listing title: spaces instead of hyphens,
// or all separators dropped to save characters. A miss here is what leaves a
// scraped draft with no identifier, which blocks it from AI review entirely.
func TestExtractModelFromTextHandlesSellerSpacing(t *testing.T) {
	cases := map[string]string{
		"A06B 6079 H208":   "A06B-6079-H208",
		"A06B6079H208":     "A06B-6079-H208",
		"A16B22030880":     "A16B-2203-0880",
		"A16B22030880/04A": "A16B-2203-0880",
		"A16B2203":         "A16B-2203",
		"A8602000T301":     "A860-2000-T301",
		"A8602000":         "A860-2000",
		"A02B0120C041":     "A02B-0120-C041",
		"A02B0120":         "A02B-0120",
		"MR J4 40A":        "MR-J4-40A",
		"MRJ440A":          "MR-J4-40A",
		"SGDV 2R8A01A":     "SGDV-2R8A01A",
	}
	for input, want := range cases {
		if got := ExtractModelFromText(input); got != want {
			t.Errorf("ExtractModelFromText(%q) = %q, want %q", input, got, want)
		}
	}
}

// TestExtractModelFromTextDoesNotTruncateDashlessModel guards the subtle failure
// where a shorter alternative earlier in the family list matches first, silently
// dropping the tail of a longer model.
func TestExtractModelFromTextDoesNotTruncateDashlessModel(t *testing.T) {
	if got := ExtractModelFromText("A06B6079H208"); got != "A06B-6079-H208" {
		t.Fatalf("got %q, the trailing group was dropped", got)
	}
	if got := ExtractModelFromText("A16B22030880"); got != "A16B-2203-0880" {
		t.Fatalf("got %q, the second group was truncated", got)
	}
	// A trailing hyphen would compare unequal to the same model written normally.
	for _, input := range []string{"A8602000", "A02B0120", "A16B2203"} {
		if got := ExtractModelFromText(input); strings.HasSuffix(got, "-") {
			t.Fatalf("ExtractModelFromText(%q) = %q, trailing separator", input, got)
		}
	}
}
