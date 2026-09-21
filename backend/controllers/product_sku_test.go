package controllers

import (
	"strings"
	"testing"
)

func TestSanitizeSKUForCompare(t *testing.T) {
	// 这些等价对必须在忽略大小写后折叠为同一结果（与 SQL 端 ci 排序规则一致）
	pairs := []struct{ a, b string }{
		{"FP0-E16RS-A-(B)", "FP0-E16RS-A\u00A0-(B)"}, // NBSP
		{"FP0-A80-A-(B)", "FP0-A80-A\u00A0-(B)"},     // NBSP
		{"FX3U-16MR-ES", "FX3U-16MR/ES"},             // 斜杠
		{"ABC-123", "ABC 123"},                       // 空格
		{"ABC-123", "ABC/123"},                       // 斜杠
	}
	for _, p := range pairs {
		gotA, gotB := sanitizeSKUForCompare(p.a), sanitizeSKUForCompare(p.b)
		if !strings.EqualFold(gotA, gotB) {
			t.Fatalf("sanitize mismatch: %q->%q vs %q->%q", p.a, gotA, p.b, gotB)
		}
	}
	if got := sanitizeSKUForCompare(" Ab-C/D\u00A0E "); got != "AbCDE" {
		t.Fatalf("unexpected sanitize result: %q", got)
	}
	if got := sanitizeSKUForCompare(""); got != "" {
		t.Fatalf("empty input must stay empty, got %q", got)
	}
	if got := sanitizeSKUForCompare("A\u202fB\u2009C"); got != "ABC" {
		t.Fatalf("unicode spaces not stripped: %q", got)
	}
}
