package services

import (
	"strings"
	"testing"
)

// Scraped listings are HTML, and the storefront renders the description as
// plain text. Anything that leaves markup in the stored description is visible
// to a customer, so these tests pin the shapes real eBay payloads contain.
func TestSanitizeListingDescriptionRemovesMarkup(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		want    []string
		notWant []string
	}{
		{
			name:    "block markup with inline styles",
			input:   `<div style="font-family:Arial;color:#333"><p>Servo amplifier</p></div>`,
			want:    []string{"Servo amplifier"},
			notWant: []string{"<", ">", "font-family", "color:"},
		},
		{
			name:    "script body is removed with the tag",
			input:   `<p>Module</p><script>var price=99; alert("x");</script><p>200V input</p>`,
			want:    []string{"Module", "200V input"},
			notWant: []string{"var price", "alert", "script"},
		},
		{
			name:    "style body is removed with the tag",
			input:   `<style>.a{color:red;font-size:12px}</style><p>Drive unit</p>`,
			want:    []string{"Drive unit"},
			notWant: []string{"font-size", ".a{", "style"},
		},
		{
			name:    "images carry no text",
			input:   `<p>PCB board</p><img src="x.jpg" alt=""><br><br><p>Tested</p>`,
			want:    []string{"PCB board", "Tested"},
			notWant: []string{"<img", "x.jpg"},
		},
		{
			name:    "html entities are decoded once",
			input:   `<p>A06B&nbsp;6079&nbsp;H208 &amp; cable</p>`,
			want:    []string{"A06B 6079 H208 & cable"},
			notWant: []string{"&nbsp;", "&amp;"},
		},
		{
			name:    "double-escaped entities are decoded",
			input:   `<p>A06B&amp;nbsp;6079</p>`,
			want:    []string{"A06B"},
			notWant: []string{"&amp;", "nbsp"},
		},
		{
			name:    "list items stay separate lines",
			input:   `<ul><li>Input 200V</li><li>Output 2kW</li></ul>`,
			want:    []string{"Input 200V\n\nOutput 2kW"},
			notWant: []string{"<li", "Input 200VOutput"},
		},
		{
			name:    "seller boilerplate is dropped",
			input:   "<p>Servo motor</p>\nAdd to cart now\nFree shipping worldwide!\n© 2024 Seller\n<p>Rated 3kW</p>",
			want:    []string{"Servo motor", "Rated 3kW"},
			notWant: []string{"Add to cart", "Free shipping", "2024 Seller", "©"},
		},
		{
			name:    "decoration lines are dropped",
			input:   "----\n****\nServo drive\n=====",
			want:    []string{"Servo drive"},
			notWant: []string{"----", "****", "====="},
		},
		{
			name:    "unterminated script is dropped to the end",
			input:   `<p>Amplifier</p><script>var a=1; var b=2;`,
			want:    []string{"Amplifier"},
			notWant: []string{"var a", "script"},
		},
		{
			name:    "html comments are dropped",
			input:   `<p>Drive</p><!-- tracking pixel here --><p>New</p>`,
			want:    []string{"Drive", "New"},
			notWant: []string{"tracking", "<!--"},
		},
		{
			name:    "plain text is left as product copy",
			input:   "FANUC A06B-6079-H208 servo amplifier.\nInput 200V, output 2kW.",
			want:    []string{"FANUC A06B-6079-H208 servo amplifier.", "Input 200V, output 2kW."},
			notWant: []string{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SanitizeListingDescription(tc.input)
			for _, want := range tc.want {
				if !strings.Contains(got, want) {
					t.Errorf("sanitized description %q does not contain %q", got, want)
				}
			}
			for _, notWant := range tc.notWant {
				if strings.Contains(got, notWant) {
					t.Errorf("sanitized description %q still contains %q", got, notWant)
				}
			}
		})
	}
}

// Sanitizing an already-clean description must not change it, so the function is
// safe to apply at more than one layer of the pipeline.
func TestSanitizeListingDescriptionIsIdempotent(t *testing.T) {
	inputs := []string{
		`<div><p>Servo amplifier</p><script>x=1;</script></div>`,
		"A06B-6079-H208\n\nInput 200V\nOutput 2kW",
		"",
		"   ",
		"<p></p><div></div>",
		"Add to cart now",
	}
	for _, input := range inputs {
		once := SanitizeListingDescription(input)
		twice := SanitizeListingDescription(once)
		if once != twice {
			t.Errorf("not idempotent for %q: once=%q twice=%q", input, once, twice)
		}
	}
}

// A description that is only markup or only boilerplate carries no product
// information; returning the markup would be worse than returning nothing,
// because the caller can then fall back to generated copy.
func TestSanitizeListingDescriptionDropsEmptyResults(t *testing.T) {
	empty := []string{
		`<div></div>`,
		`<script>var x=1;</script>`,
		`<style>.a{}</style>`,
		`<img src="a.jpg">`,
		"<br><br><br>",
		"&nbsp;&nbsp;",
		"Add to cart",
	}
	for _, input := range empty {
		if got := SanitizeListingDescription(input); got != "" {
			t.Errorf("SanitizeListingDescription(%q) = %q, want empty", input, got)
		}
	}
}

func TestSanitizeListingTitleRemovesMarkup(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		want    string
		notWant []string
	}{
		{
			name:    "br tag in title becomes a space",
			input:   "FANUC<br>A06B-6079-H208 Servo Drive",
			want:    "FANUC A06B-6079-H208 Servo Drive",
			notWant: []string{"<br>", "FANUC  A06B"},
		},
		{
			name:  "entity is decoded",
			input: "FANUC &amp; Mitsubishi cable",
			want:  "FANUC & Mitsubishi cable",
		},
		{
			name:    "tags are removed",
			input:   `<span class="x">Servo</span> <b>amplifier</b>`,
			want:    "Servo amplifier",
			notWant: []string{"<span", "</b>"},
		},
		{
			name:    "whitespace is collapsed to one line",
			input:   "FANUC   A06B-6079-H208\n\n  Servo",
			want:    "FANUC A06B-6079-H208 Servo",
			notWant: []string{"\n"},
		},
		{
			name:  "a leading dash is preserved because a model can start with one",
			input: "-A06B-6079-H208 Servo Drive",
			want:  "-A06B-6079-H208 Servo Drive",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SanitizeListingTitle(tc.input)
			if tc.want != "" && got != tc.want {
				t.Errorf("SanitizeListingTitle(%q) = %q, want %q", tc.input, got, tc.want)
			}
			for _, notWant := range tc.notWant {
				if strings.Contains(got, notWant) {
					t.Errorf("SanitizeListingTitle(%q) = %q, still contains %q", tc.input, got, notWant)
				}
			}
		})
	}
}

func TestShortenListingDescription(t *testing.T) {
	long := "This is a replacement servo amplifier for FANUC systems. It supports 200V input. " +
		"It is tested before dispatch and ships with a warranty. Every unit is inspected."
	short := ShortenListingDescription(long, 100)
	if len([]rune(short)) > 101 {
		t.Errorf("short description is %d runes, want about 100", len([]rune(short)))
	}
	if !strings.HasPrefix(long, strings.TrimSuffix(short, "…")) {
		t.Errorf("short description %q is not a prefix of the source", short)
	}
	// It must not cut mid-word.
	if strings.HasSuffix(strings.TrimSuffix(short, "…"), " ") {
		t.Errorf("short description %q has trailing space before the ellipsis", short)
	}

	if got := ShortenListingDescription("Short text", 100); got != "Short text" {
		t.Errorf("a description under the limit was changed: %q", got)
	}
	if got := ShortenListingDescription("", 100); got != "" {
		t.Errorf("empty description became %q", got)
	}
}
