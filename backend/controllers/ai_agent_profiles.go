package controllers

import (
	"errors"
	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/utils"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const aiAgentProfileNameMaxRunes = 80
const aiAgentAPIKeyMaxRunes = 4096
const aiAgentProfileLimit = 20

var aiAgentModelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/+#@()+-]{0,119}$`)
var aiAgentReasoningEffortPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

const aiAgentAPIModeStandard = "standard_chat"
const aiAgentAPIModeReasoning = "reasoning_chat"

var errActiveAIProfile = errors.New("active AI profile cannot be deleted")
var errAIProfileNeedsAPIKey = errors.New("active AI profile needs an API key while the assistant is enabled")
var errAIProfileNameConflict = errors.New("AI profile name already exists")
var errAIProfileLimitReached = errors.New("AI profile limit reached")
var errAIProfileKeyUnavailable = errors.New("active AI profile key is unavailable")
var errAIProfileCrossProviderKeyReuse = errors.New("active AI profile key belongs to another provider")

type aiAgentProfileMutationRequest struct {
	Name              *string `json:"name"`
	BaseURL           *string `json:"base_url"`
	APIKey            *string `json:"api_key"`
	ClearAPIKey       bool    `json:"clear_api_key"`
	ReuseActiveAPIKey bool    `json:"reuse_active_api_key"`
	Model             *string `json:"model"`
	APIMode           *string `json:"api_mode"`
	ReasoningEffort   *string `json:"reasoning_effort"`
	TimeoutSeconds    *int    `json:"timeout_seconds"`
}

func isMissingAIAgentProfileIDError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unknown column") && strings.Contains(message, "ai_profile_id")
}

func hasAIAgentSEOJobProfileIDColumn(db *gorm.DB) bool {
	return db != nil && db.Migrator().HasColumn(&models.AIAgentSEOJob{}, "AIProfileID")
}

func normalizeAIAgentProfileName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > aiAgentProfileNameMaxRunes {
		return "", fmt.Errorf("profile name must contain 1-%d characters", aiAgentProfileNameMaxRunes)
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return "", errors.New("profile name cannot contain control characters")
		}
	}
	return value, nil
}

func normalizeAIAgentBaseURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	parsed, err := url.Parse(value)
	if err != nil || parsed == nil || parsed.Hostname() == "" || parsed.Opaque != "" ||
		(parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return "", errors.New("AI base URL must be a valid HTTP(S) URL without credentials, query parameters, or fragments")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func aiAgentProviderOrigin(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed == nil {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	host := strings.ToLower(parsed.Hostname())
	port := parsed.Port()
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return scheme + "://" + host
}

func normalizeAIAgentModel(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !aiAgentModelPattern.MatchString(value) {
		return "", errors.New("model must contain 1-120 letters, numbers, or supported identifier characters")
	}
	return value, nil
}

func normalizeAIAgentReasoningEffort(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "", nil
	}
	if !aiAgentReasoningEffortPattern.MatchString(value) {
		return "", errors.New("reasoning effort must contain at most 32 lowercase letters, numbers, underscores, or hyphens")
	}
	return value, nil
}

func normalizeAIAgentAPIMode(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value != aiAgentAPIModeStandard && value != aiAgentAPIModeReasoning {
		return "", errors.New("API mode must be standard_chat or reasoning_chat")
	}
	return value, nil
}

func normalizeAIAgentAPIKey(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len([]rune(value)) > aiAgentAPIKeyMaxRunes {
		return "", fmt.Errorf("API key cannot exceed %d characters", aiAgentAPIKeyMaxRunes)
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return "", errors.New("API key cannot contain control characters")
		}
	}
	return value, nil
}

func validateAIAgentTimeout(value int) error {
	if value < 15 || value > 180 {
		return errors.New("timeout must be between 15 and 180 seconds")
	}
	return nil
}

func getActiveAIAgentProfile(db *gorm.DB, setting *models.AIAgentSetting) (*models.AIAgentProfile, error) {
	if setting.ActiveProfileID == nil || *setting.ActiveProfileID == 0 {
		return nil, nil
	}
	var profile models.AIAgentProfile
	if err := db.First(&profile, *setting.ActiveProfileID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	return &profile, nil
}

func getActiveAIAgentProfileForUpdate(tx *gorm.DB, setting *models.AIAgentSetting) (*models.AIAgentProfile, error) {
	if setting.ActiveProfileID == nil || *setting.ActiveProfileID == 0 {
		return nil, nil
	}
	var profile models.AIAgentProfile
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&profile, *setting.ActiveProfileID).Error; errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	return &profile, nil
}

func getAIAgentSettingForUpdate(tx *gorm.DB) (*models.AIAgentSetting, error) {
	return getOrCreateAIAgentSetting(tx.Clauses(clause.Locking{Strength: "UPDATE"}))
}

func copyAIAgentProfileToSetting(setting *models.AIAgentSetting, profile *models.AIAgentProfile) {
	setting.BaseURL = profile.BaseURL
	setting.APIKeyEnc = profile.APIKeyEnc
	setting.Model = profile.Model
	setting.APIMode = profile.APIMode
	if setting.APIMode == "" {
		setting.APIMode = aiAgentAPIModeStandard
	}
	setting.ReasoningEffort = profile.ReasoningEffort
	setting.TimeoutSeconds = profile.TimeoutSeconds
}

func copyAIAgentSettingToProfile(setting *models.AIAgentSetting, profile *models.AIAgentProfile) {
	profile.BaseURL = setting.BaseURL
	profile.APIKeyEnc = setting.APIKeyEnc
	profile.Model = setting.Model
	profile.APIMode = setting.APIMode
	if profile.APIMode == "" {
		profile.APIMode = aiAgentAPIModeStandard
	}
	profile.ReasoningEffort = setting.ReasoningEffort
	profile.TimeoutSeconds = setting.TimeoutSeconds
}

// loadEffectiveAIAgentSetting overlays the active profile onto a copy of the
// singleton. Callers retain all global business/queue settings while provider
// calls use the selected profile. A missing profile falls back to legacy fields.
func loadEffectiveAIAgentSetting(db *gorm.DB) (*models.AIAgentSetting, *models.AIAgentProfile, error) {
	setting, err := getOrCreateAIAgentSetting(db)
	if err != nil {
		return nil, nil, err
	}
	profile, err := getActiveAIAgentProfile(db, setting)
	if err != nil {
		return nil, nil, err
	}
	if profile == nil {
		return setting, nil, nil
	}
	effective := *setting
	copyAIAgentProfileToSetting(&effective, profile)
	return &effective, profile, nil
}

func applyAIAgentProfileMutation(profile *models.AIAgentProfile, req aiAgentProfileMutationRequest, creating bool) error {
	if req.Name != nil {
		name, err := normalizeAIAgentProfileName(*req.Name)
		if err != nil {
			return err
		}
		profile.Name = name
	} else if creating {
		return errors.New("profile name is required")
	}

	if req.BaseURL != nil {
		baseURL, err := normalizeAIAgentBaseURL(*req.BaseURL)
		if err != nil {
			return err
		}
		profile.BaseURL = baseURL
	} else if creating {
		profile.BaseURL = "https://api.openai.com/v1"
	}

	if req.Model != nil {
		model, err := normalizeAIAgentModel(*req.Model)
		if err != nil {
			return err
		}
		profile.Model = model
	} else if creating {
		profile.Model = "gpt-5.6-terra"
	}

	if req.APIMode != nil {
		apiMode, err := normalizeAIAgentAPIMode(*req.APIMode)
		if err != nil {
			return err
		}
		profile.APIMode = apiMode
	} else if creating {
		profile.APIMode = aiAgentAPIModeStandard
	}

	if req.ReasoningEffort != nil {
		effort, err := normalizeAIAgentReasoningEffort(*req.ReasoningEffort)
		if err != nil {
			return err
		}
		profile.ReasoningEffort = effort
	} else if creating {
		profile.ReasoningEffort = "medium"
	}

	if req.TimeoutSeconds != nil {
		if err := validateAIAgentTimeout(*req.TimeoutSeconds); err != nil {
			return err
		}
		profile.TimeoutSeconds = *req.TimeoutSeconds
	} else if creating {
		profile.TimeoutSeconds = 75
	}

	if req.ClearAPIKey {
		profile.APIKeyEnc = ""
	}
	if req.APIKey != nil {
		apiKey, err := normalizeAIAgentAPIKey(*req.APIKey)
		if err != nil {
			return err
		}
		if apiKey != "" {
			encrypted, err := utils.EncryptSecret(apiKey)
			if err != nil {
				// %w keeps utils.ErrEncryptionKey* reachable so the handler can
				// report the environment problem instead of "Invalid AI profile".
				return fmt.Errorf("could not encrypt AI API key: %w", err)
			}
			profile.APIKeyEnc = encrypted
		}
	}
	return nil
}

func parseAIAgentProfileID(c *gin.Context) (uint, bool) {
	value, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || value == 0 || value > uint64(^uint(0)) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI profile ID"})
		return 0, false
	}
	return uint(value), true
}

func aiAgentProfileNameExists(db *gorm.DB, name string, excludeID uint) (bool, error) {
	query := db.Model(&models.AIAgentProfile{}).Where("LOWER(name) = LOWER(?)", name)
	if excludeID > 0 {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (ac *AIAgentController) ListProfiles(c *gin.Context) {
	setting, err := getOrCreateAIAgentSetting(config.GetDB())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load AI settings", Error: err.Error()})
		return
	}
	var profiles []models.AIAgentProfile
	if err := config.GetDB().Order("name ASC, id ASC").Find(&profiles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load AI profiles", Error: err.Error()})
		return
	}
	responses := make([]models.AIAgentProfileResponse, 0, len(profiles))
	for index := range profiles {
		responses = append(responses, profiles[index].ToResponse(setting.ActiveProfileID))
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: responses})
}

func (ac *AIAgentController) CreateProfile(c *gin.Context) {
	var req aiAgentProfileMutationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI profile", Error: err.Error()})
		return
	}
	profile := models.AIAgentProfile{}
	if err := applyAIAgentProfileMutation(&profile, req, true); err != nil {
		if respondSecretEncryptionFailure(c, "AI API Key", err) {
			return
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI profile", Error: err.Error()})
		return
	}
	if req.ReuseActiveAPIKey && (req.ClearAPIKey || (req.APIKey != nil && strings.TrimSpace(*req.APIKey) != "")) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Choose either a new API key or reuse the active profile key"})
		return
	}

	var activeProfileID *uint
	err := config.GetDB().Transaction(func(tx *gorm.DB) error {
		setting, err := getAIAgentSettingForUpdate(tx)
		if err != nil {
			return err
		}
		activeProfile, err := getActiveAIAgentProfileForUpdate(tx, setting)
		if err != nil {
			return err
		}
		var profileCount int64
		if err := tx.Model(&models.AIAgentProfile{}).Count(&profileCount).Error; err != nil {
			return err
		}
		if profileCount >= aiAgentProfileLimit {
			return errAIProfileLimitReached
		}
		exists, err := aiAgentProfileNameExists(tx, profile.Name, 0)
		if err != nil {
			return err
		}
		if exists {
			return errAIProfileNameConflict
		}
		if req.ReuseActiveAPIKey {
			effective := *setting
			if activeProfile != nil {
				copyAIAgentProfileToSetting(&effective, activeProfile)
			}
			if aiAgentProviderOrigin(profile.BaseURL) != aiAgentProviderOrigin(effective.BaseURL) {
				return errAIProfileCrossProviderKeyReuse
			}
			profile.APIKeyEnc = effective.APIKeyEnc
			if profile.APIKeyEnc == "" {
				return errAIProfileKeyUnavailable
			}
		}
		activeProfileID = setting.ActiveProfileID
		return tx.Create(&profile).Error
	})
	if errors.Is(err, errAIProfileLimitReached) {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "AI profile limit reached"})
		return
	}
	if errors.Is(err, errAIProfileNameConflict) {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "An AI profile with this name already exists"})
		return
	}
	if errors.Is(err, errAIProfileCrossProviderKeyReuse) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "The active API key can only be reused with the same provider host"})
		return
	}
	if errors.Is(err, errAIProfileKeyUnavailable) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "The active AI profile does not have an API key to reuse"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to create AI profile", Error: err.Error()})
		return
	}
	c.JSON(http.StatusCreated, models.APIResponse{Success: true, Message: "AI profile created", Data: profile.ToResponse(activeProfileID)})
}

func (ac *AIAgentController) UpdateProfile(c *gin.Context) {
	profileID, ok := parseAIAgentProfileID(c)
	if !ok {
		return
	}
	var req aiAgentProfileMutationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI profile", Error: err.Error()})
		return
	}
	db := config.GetDB()
	var profile models.AIAgentProfile
	var setting *models.AIAgentSetting
	var requestErr error
	err := db.Transaction(func(tx *gorm.DB) error {
		currentSetting, err := getAIAgentSettingForUpdate(tx)
		if err != nil {
			return err
		}
		setting = currentSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&profile, profileID).Error; err != nil {
			return err
		}
		if err := applyAIAgentProfileMutation(&profile, req, false); err != nil {
			requestErr = err
			return err
		}
		exists, err := aiAgentProfileNameExists(tx, profile.Name, profile.ID)
		if err != nil {
			return err
		}
		if exists {
			return errAIProfileNameConflict
		}
		isActive := setting.ActiveProfileID != nil && *setting.ActiveProfileID == profile.ID
		if isActive && setting.Enabled && profile.APIKeyEnc == "" {
			return errAIProfileNeedsAPIKey
		}
		if err := tx.Save(&profile).Error; err != nil {
			return err
		}
		if isActive {
			copyAIAgentProfileToSetting(setting, &profile)
			return tx.Save(setting).Error
		}
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "AI profile not found"})
		return
	}
	if requestErr != nil {
		if respondSecretEncryptionFailure(c, "AI API Key", requestErr) {
			return
		}
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid AI profile", Error: requestErr.Error()})
		return
	}
	if errors.Is(err, errAIProfileNameConflict) {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "An AI profile with this name already exists"})
		return
	}
	if errors.Is(err, errAIProfileNeedsAPIKey) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Save an API key before clearing the active AI profile credential"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to update AI profile", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "AI profile updated", Data: profile.ToResponse(setting.ActiveProfileID)})
}

func (ac *AIAgentController) DeleteProfile(c *gin.Context) {
	profileID, ok := parseAIAgentProfileID(c)
	if !ok {
		return
	}
	db := config.GetDB()
	err := db.Transaction(func(tx *gorm.DB) error {
		setting, err := getAIAgentSettingForUpdate(tx)
		if err != nil {
			return err
		}
		if setting.ActiveProfileID != nil && *setting.ActiveProfileID == profileID {
			return errActiveAIProfile
		}
		var profile models.AIAgentProfile
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&profile, profileID).Error; err != nil {
			return err
		}
		result := tx.Delete(&profile)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	if errors.Is(err, errActiveAIProfile) {
		c.JSON(http.StatusConflict, models.APIResponse{Success: false, Message: "Switch to another AI profile before deleting the active profile"})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "AI profile not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to delete AI profile", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "AI profile deleted"})
}

func (ac *AIAgentController) ActivateProfile(c *gin.Context) {
	profileID, ok := parseAIAgentProfileID(c)
	if !ok {
		return
	}
	db := config.GetDB()
	var profile models.AIAgentProfile
	var setting *models.AIAgentSetting
	err := db.Transaction(func(tx *gorm.DB) error {
		currentSetting, err := getAIAgentSettingForUpdate(tx)
		if err != nil {
			return err
		}
		setting = currentSetting
		if err := tx.First(&profile, profileID).Error; err != nil {
			return err
		}
		if setting.Enabled && profile.APIKeyEnc == "" {
			return errAIProfileNeedsAPIKey
		}
		setting.ActiveProfileID = &profile.ID
		copyAIAgentProfileToSetting(setting, &profile)
		return tx.Save(setting).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, models.APIResponse{Success: false, Message: "AI profile not found"})
		return
	}
	if errors.Is(err, errAIProfileNeedsAPIKey) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Save an API key before activating this profile while the AI assistant is enabled"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to activate AI profile", Error: err.Error()})
		return
	}
	response := setting.ToResponse()
	response.ActiveProfileName = profile.Name
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "AI profile activated", Data: response})
}
