package controllers

import (
	"context"
	"net/url"
	"strings"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"
	"fanuc-backend/utils"
)

const deepSeekAPIHost = "api.deepseek.com"

func init() {
	services.SetDeepSeekSearchKeyProvider(deepSeekWebSearchKey)
}

// The search key is only ever sent to the official DeepSeek host, so relays
// and look-alike hosts can never enable web search.
func isDeepSeekBaseURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed.Scheme == "https" && strings.EqualFold(parsed.Hostname(), deepSeekAPIHost)
}

// deepSeekWebSearchKey picks the active profile when it has DeepSeek web search
// enabled, otherwise the oldest enabled DeepSeek profile, so a non-DeepSeek
// model can still write content while DeepSeek supplies the search results.
// The assistant master switch also gates this paid API.
func deepSeekWebSearchKey(ctx context.Context) (string, bool) {
	db := config.GetDB()
	if db == nil {
		return "", false
	}
	if ctx == nil {
		ctx = context.Background()
	}
	db = db.WithContext(ctx)
	var setting models.AIAgentSetting
	if err := db.First(&setting, 1).Error; err != nil || !setting.Enabled {
		return "", false
	}
	var profiles []models.AIAgentProfile
	if err := db.Where("web_search_enabled = ?", true).Order("id ASC").Find(&profiles).Error; err != nil {
		return "", false
	}
	profile := selectDeepSeekWebSearchProfile(profiles, setting.ActiveProfileID)
	if profile == nil {
		return "", false
	}
	key, err := utils.DecryptSecret(profile.APIKeyEnc)
	if err != nil {
		return "", false
	}
	return key, strings.TrimSpace(key) != ""
}

func selectDeepSeekWebSearchProfile(profiles []models.AIAgentProfile, activeProfileID *uint) *models.AIAgentProfile {
	var fallback *models.AIAgentProfile
	for index := range profiles {
		profile := &profiles[index]
		if !profile.WebSearchEnabled || profile.APIKeyEnc == "" || !isDeepSeekBaseURL(profile.BaseURL) {
			continue
		}
		if activeProfileID != nil && *activeProfileID == profile.ID {
			return profile
		}
		if fallback == nil {
			fallback = profile
		}
	}
	return fallback
}
