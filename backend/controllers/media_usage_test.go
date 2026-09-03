package controllers

import "testing"

func TestProductImageURLMatchesMedia(t *testing.T) {
	relative := "media/abc123.jpg"
	assetURL := "/uploads/media/abc123.jpg"
	cases := []struct {
		url  string
		want bool
	}{
		{url: assetURL, want: true},
		{url: "https://vibocnc.com/uploads/media/abc123.jpg", want: true},
		{url: "https://www.vibocnc.com/uploads/media/abc123.jpg?size=large", want: true},
		{url: "uploads/media/abc123.jpg", want: true},
		{url: "media/abc123.jpg", want: true},
		{url: "https://example.com/uploads/media/abc123.jpg", want: false},
		{url: "/uploads/media/other.jpg", want: false},
	}
	for _, testCase := range cases {
		if got := productImageURLMatchesMedia(testCase.url, assetURL, relative); got != testCase.want {
			t.Fatalf("productImageURLMatchesMedia(%q) = %v, want %v", testCase.url, got, testCase.want)
		}
	}
}
