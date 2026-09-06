package models

import (
	"gorm.io/gorm/schema"
	"sync"
	"testing"
)

func TestAISEOProfileSQLColumnNames(t *testing.T) {
	s, err := schema.Parse(&AIAgentSEOJob{}, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	for field, want := range map[string]string{"AIProfileID": "ai_profile_id", "AIProfileName": "ai_profile_name"} {
		if got := s.LookUpField(field).DBName; got != want {
			t.Fatalf("%s maps to %s; SQL reads %s", field, got, want)
		}
	}
}
