package controllers

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/config"
	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
)

type EmailController struct{}

var aliMailMailboxFolders = []gin.H{
	{"id": "2", "key": "inbox", "name": "收件箱", "label": "Inbox"},
	{"id": "1", "key": "sent", "name": "发件箱", "label": "Sent"},
	{"id": "5", "key": "drafts", "name": "草稿箱", "label": "Drafts"},
	{"id": "3", "key": "junk", "name": "垃圾箱", "label": "Junk"},
	{"id": "6", "key": "deleted", "name": "已删除", "label": "Deleted"},
}

// Public: GET /api/v1/public/email/config
func (ec *EmailController) GetPublicConfig(c *gin.Context) {
	db := config.GetDB()
	s, err := services.GetOrCreateEmailSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load email settings", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: s.ToPublicConfig()})
}

type sendCodeRequest struct {
	Email   string `json:"email" binding:"required,email"`
	Purpose string `json:"purpose" binding:"required"` // register | reset
}

// Public: POST /api/v1/public/email/send-code
func (ec *EmailController) SendCode(c *gin.Context) {
	var req sendCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	p := strings.ToLower(strings.TrimSpace(req.Purpose))
	if p != string(services.PurposeRegister) && p != string(services.PurposeReset) {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid purpose", Error: "purpose must be register or reset"})
		return
	}

	db := config.GetDB()
	if err := services.CreateAndSendVerificationCode(db, req.Email, services.VerificationPurpose(p)); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to send code", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Verification code sent"})
}

// Admin settings

type EmailSettingsResponse struct {
	models.EmailSetting
	HasSMTPPassword        bool `json:"has_smtp_password"`
	HasResendAPIKey        bool `json:"has_resend_api_key"`
	HasAliMailClientSecret bool `json:"has_alimail_client_secret"`
}

// Admin: GET /api/v1/admin/email/settings
func (ec *EmailController) GetSettings(c *gin.Context) {
	db := config.GetDB()
	s, err := services.GetOrCreateEmailSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load email settings", Error: err.Error()})
		return
	}
	hasPass := strings.TrimSpace(s.SMTPPassword) != ""
	hasResend := strings.TrimSpace(s.ResendAPIKey) != ""
	hasAliMailSecret := strings.TrimSpace(s.AliMailClientSecret) != ""
	// Do not return the password.
	s.SMTPPassword = ""
	s.ResendAPIKey = ""
	s.ResendWebhookSecret = ""
	s.AliMailClientSecret = ""
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: EmailSettingsResponse{EmailSetting: *s, HasSMTPPassword: hasPass, HasResendAPIKey: hasResend, HasAliMailClientSecret: hasAliMailSecret}})
}

type updateEmailSettingsRequest struct {
	Enabled                          *bool   `json:"enabled"`
	Provider                         *string `json:"provider"`
	FromName                         *string `json:"from_name"`
	FromEmail                        *string `json:"from_email"`
	ReplyTo                          *string `json:"reply_to"`
	SMTPHost                         *string `json:"smtp_host"`
	SMTPPort                         *int    `json:"smtp_port"`
	SMTPUsername                     *string `json:"smtp_username"`
	SMTPPassword                     *string `json:"smtp_password"`
	SMTPTLSMode                      *string `json:"smtp_tls_mode"`
	ResendAPIKey                     *string `json:"resend_api_key"`
	ResendWebhookSecret              *string `json:"resend_webhook_secret"`
	AliMailEndpoint                  *string `json:"alimail_endpoint"`
	AliMailClientID                  *string `json:"alimail_client_id"`
	AliMailClientSecret              *string `json:"alimail_client_secret"`
	AliMailAccountEmail              *string `json:"alimail_account_email"`
	VerificationEnabled              *bool   `json:"verification_enabled"`
	MarketingEnabled                 *bool   `json:"marketing_enabled"`
	ShippingNotificationsEnabled     *bool   `json:"shipping_notifications_enabled"`
	OrderNotificationsEnabled        *bool   `json:"order_notifications_enabled"`
	OrderCreatedNotificationsEnabled *bool   `json:"order_created_notifications_enabled"`
	OrderPaidNotificationsEnabled    *bool   `json:"order_paid_notifications_enabled"`
	OrderNotificationEmails          *string `json:"order_notification_emails"`
	ContactNotificationsEnabled      *bool   `json:"contact_notifications_enabled"`
	ContactNotificationEmails        *string `json:"contact_notification_emails"`
	CodeExpiryMinutes                *int    `json:"code_expiry_minutes"`
	CodeResendSeconds                *int    `json:"code_resend_seconds"`
}

// Admin: PUT /api/v1/admin/email/settings
func (ec *EmailController) UpdateSettings(c *gin.Context) {
	var req updateEmailSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	s, err := services.GetOrCreateEmailSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load email settings", Error: err.Error()})
		return
	}

	if req.Enabled != nil {
		s.Enabled = *req.Enabled
	}
	if req.Provider != nil {
		p := strings.ToLower(strings.TrimSpace(*req.Provider))
		if p == "" {
			p = "smtp"
		}
		s.Provider = p
	}
	if req.FromName != nil {
		s.FromName = strings.TrimSpace(*req.FromName)
	}
	if req.FromEmail != nil {
		s.FromEmail = strings.TrimSpace(*req.FromEmail)
	}
	if req.ReplyTo != nil {
		s.ReplyTo = strings.TrimSpace(*req.ReplyTo)
	}
	if req.SMTPHost != nil {
		h := strings.TrimSpace(*req.SMTPHost)
		// If host includes scheme/path, sanitize it. Keep host:port if provided.
		// Port inside SMTP host will override smtp_port when sending.
		if strings.Contains(h, "://") {
			if hostOnly, _ := services.NormalizeSMTPHostInput(h); hostOnly != "" {
				// NormalizeSMTPHostInput strips port; so instead keep the original host:port by extracting URL host.
				// As a simple approach: strip scheme and path manually.
				u := strings.SplitN(h, "://", 2)
				h = u[len(u)-1]
				if i := strings.IndexByte(h, '/'); i >= 0 {
					h = h[:i]
				}
			}
		} else {
			if i := strings.IndexByte(h, '/'); i >= 0 {
				h = h[:i]
			}
		}
		s.SMTPHost = strings.TrimSpace(h)
	}
	if req.SMTPPort != nil {
		s.SMTPPort = *req.SMTPPort
	}
	// Note: if SMTPHost contains an explicit port (host:port), SendEmail will use it.
	if req.SMTPUsername != nil {
		s.SMTPUsername = strings.TrimSpace(*req.SMTPUsername)
	}
	if req.SMTPTLSMode != nil {
		m := strings.ToLower(strings.TrimSpace(*req.SMTPTLSMode))
		if m == "" {
			m = "starttls"
		}
		s.SMTPTLSMode = m
	}
	if req.SMTPPassword != nil {
		// If empty string, keep existing (unless allow_clear=1)
		if *req.SMTPPassword == "" {
			if c.Query("allow_clear") == "1" {
				s.SMTPPassword = ""
			}
		} else {
			if err := services.UpdateSMTPPassword(db, s, *req.SMTPPassword); err != nil {
				c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save password", Error: err.Error()})
				return
			}
		}
	}
	if req.ResendAPIKey != nil {
		if *req.ResendAPIKey == "" {
			if c.Query("allow_clear") == "1" {
				s.ResendAPIKey = ""
			}
		} else {
			if err := services.UpdateResendAPIKey(db, s, strings.TrimSpace(*req.ResendAPIKey)); err != nil {
				c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save Resend API key", Error: err.Error()})
				return
			}
		}
	}
	if req.ResendWebhookSecret != nil {
		if *req.ResendWebhookSecret == "" {
			if c.Query("allow_clear") == "1" {
				s.ResendWebhookSecret = ""
			}
		} else {
			if err := services.UpdateResendWebhookSecret(db, s, strings.TrimSpace(*req.ResendWebhookSecret)); err != nil {
				c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save webhook secret", Error: err.Error()})
				return
			}
		}
	}
	if req.AliMailEndpoint != nil {
		endpoint := strings.TrimSpace(*req.AliMailEndpoint)
		if endpoint == "" {
			endpoint = "https://alimail-cn.aliyuncs.com"
		}
		s.AliMailEndpoint = endpoint
	}
	if req.AliMailClientID != nil {
		s.AliMailClientID = strings.TrimSpace(*req.AliMailClientID)
	}
	if req.AliMailAccountEmail != nil {
		s.AliMailAccountEmail = strings.TrimSpace(*req.AliMailAccountEmail)
	}
	if req.AliMailClientSecret != nil {
		if *req.AliMailClientSecret == "" {
			if c.Query("allow_clear") == "1" {
				s.AliMailClientSecret = ""
			}
		} else {
			if err := services.UpdateAliMailClientSecret(db, s, strings.TrimSpace(*req.AliMailClientSecret)); err != nil {
				c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save AliMail secret", Error: err.Error()})
				return
			}
		}
	}
	if req.VerificationEnabled != nil {
		s.VerificationEnabled = *req.VerificationEnabled
	}
	if req.MarketingEnabled != nil {
		s.MarketingEnabled = *req.MarketingEnabled
	}
	if req.ShippingNotificationsEnabled != nil {
		s.ShippingNotificationsEnabled = *req.ShippingNotificationsEnabled
	}
	legacyTouched := false
	newTouched := false
	if req.OrderNotificationsEnabled != nil {
		legacyTouched = true
		s.OrderNotificationsEnabled = *req.OrderNotificationsEnabled
	}
	if req.OrderCreatedNotificationsEnabled != nil {
		newTouched = true
		s.OrderCreatedNotificationsEnabled = *req.OrderCreatedNotificationsEnabled
	}
	if req.OrderPaidNotificationsEnabled != nil {
		newTouched = true
		s.OrderPaidNotificationsEnabled = *req.OrderPaidNotificationsEnabled
	}
	// If frontend still uses legacy switch, treat it as "enable both".
	if legacyTouched && !newTouched {
		s.OrderCreatedNotificationsEnabled = s.OrderNotificationsEnabled
		s.OrderPaidNotificationsEnabled = s.OrderNotificationsEnabled
	}
	if newTouched {
		s.OrderNotificationsEnabled = s.OrderCreatedNotificationsEnabled || s.OrderPaidNotificationsEnabled
	}
	if req.OrderNotificationEmails != nil {
		normalized, _, err := services.NormalizeEmailRecipients(*req.OrderNotificationEmails)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid notification emails", Error: err.Error()})
			return
		}
		s.OrderNotificationEmails = normalized
	}
	if req.ContactNotificationsEnabled != nil {
		s.ContactNotificationsEnabled = *req.ContactNotificationsEnabled
	}
	if req.ContactNotificationEmails != nil {
		normalized, _, err := services.NormalizeEmailRecipients(*req.ContactNotificationEmails)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid contact notification emails", Error: err.Error()})
			return
		}
		s.ContactNotificationEmails = normalized
	}
	if req.CodeExpiryMinutes != nil {
		s.CodeExpiryMinutes = *req.CodeExpiryMinutes
	}
	if req.CodeResendSeconds != nil {
		s.CodeResendSeconds = *req.CodeResendSeconds
	}

	if err := db.Save(s).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to save email settings", Error: err.Error()})
		return
	}

	hasPass := strings.TrimSpace(s.SMTPPassword) != ""
	hasResend := strings.TrimSpace(s.ResendAPIKey) != ""
	hasAliMailSecret := strings.TrimSpace(s.AliMailClientSecret) != ""
	s.SMTPPassword = ""
	s.ResendAPIKey = ""
	s.ResendWebhookSecret = ""
	s.AliMailClientSecret = ""
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Saved", Data: EmailSettingsResponse{EmailSetting: *s, HasSMTPPassword: hasPass, HasResendAPIKey: hasResend, HasAliMailClientSecret: hasAliMailSecret}})
}

type sendTestEmailRequest struct {
	To string `json:"to" binding:"required,email"`
}

type sendEmailRequest struct {
	To      string `json:"to" binding:"required,email"`
	Subject string `json:"subject" binding:"required"`
	HTML    string `json:"html"`
	Text    string `json:"text"`
}

// Admin: POST /api/v1/admin/email/test
func (ec *EmailController) SendTest(c *gin.Context) {
	var req sendTestEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	err := services.SendEmail(db, services.EmailSendOptions{
		To:      req.To,
		Subject: "Test email from VIBO CNC",
		Text:    "This is a test email from VIBO CNC admin panel.",
		HTML:    "<p>This is a <b>test email</b> from VIBO CNC admin panel.</p>",
		Headers: map[string]string{"X-Entity-Ref-ID": "test-email"},
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to send", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Sent"})
}

// Admin: POST /api/v1/admin/email/send
func (ec *EmailController) Send(c *gin.Context) {
	var req sendEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}
	db := config.GetDB()
	err := services.SendEmail(db, services.EmailSendOptions{
		To:      req.To,
		Subject: req.Subject,
		Text:    req.Text,
		HTML:    req.HTML,
		Headers: map[string]string{"X-Entity-Ref-ID": "admin-send"},
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to send", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Sent"})
}

func (ec *EmailController) MailboxConfig(c *gin.Context) {
	db := config.GetDB()
	s, err := services.GetOrCreateEmailSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
		return
	}
	accountEmail := strings.TrimSpace(s.AliMailAccountEmail)
	if accountEmail == "" {
		accountEmail = strings.TrimSpace(s.FromEmail)
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: gin.H{
		"enabled":       s.Enabled,
		"provider":      s.Provider,
		"account_email": accountEmail,
		"from_email":    s.FromEmail,
		"from_name":     s.FromName,
		"reply_to":      s.ReplyTo,
		"folders":       aliMailMailboxFolders,
		"can_read":      strings.EqualFold(strings.TrimSpace(s.Provider), "alimail"),
	}})
}

func (ec *EmailController) MailboxFolders(c *gin.Context) {
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: aliMailMailboxFolders})
}

func (ec *EmailController) MailboxMessages(c *gin.Context) {
	client, accountEmail, err := getAliMailMailboxClient()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Mailbox is not configured", Error: err.Error()})
		return
	}
	folderID := strings.TrimSpace(c.Param("folderID"))
	if folderID == "" {
		folderID = "2"
	}
	cursor := c.Query("cursor")
	size, _ := strconv.Atoi(c.DefaultQuery("size", "30"))

	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	out, err := client.ListMessages(ctx, accountEmail, folderID, cursor, size)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to load mailbox messages", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: out})
}

func (ec *EmailController) MailboxMessage(c *gin.Context) {
	client, accountEmail, err := getAliMailMailboxClient()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Mailbox is not configured", Error: err.Error()})
		return
	}
	messageID := strings.TrimSpace(c.Param("messageID"))
	if messageID == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing message ID", Error: "missing_message_id"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	out, err := client.GetMessage(ctx, accountEmail, messageID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to load message", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: out})
}

func (ec *EmailController) MailboxAttachments(c *gin.Context) {
	client, accountEmail, err := getAliMailMailboxClient()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Mailbox is not configured", Error: err.Error()})
		return
	}
	messageID := strings.TrimSpace(c.Param("messageID"))
	if messageID == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing message ID", Error: "missing_message_id"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()
	out, err := client.ListAttachments(ctx, accountEmail, messageID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to load attachments", Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "OK", Data: out})
}

func (ec *EmailController) MailboxAttachmentDownload(c *gin.Context) {
	client, accountEmail, err := getAliMailMailboxClient()
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Mailbox is not configured", Error: err.Error()})
		return
	}
	messageID := strings.TrimSpace(c.Param("messageID"))
	attachmentID := strings.TrimSpace(c.Param("attachmentID"))
	if messageID == "" || attachmentID == "" {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Missing attachment parameters", Error: "missing_attachment_parameters"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	body, contentType, filename, err := client.DownloadAttachment(ctx, accountEmail, messageID, attachmentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to download attachment", Error: err.Error()})
		return
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	c.Data(http.StatusOK, contentType, body)
}

func getAliMailMailboxClient() (*services.AliMailClient, string, error) {
	db := config.GetDB()
	s, err := services.GetOrCreateEmailSetting(db)
	if err != nil {
		return nil, "", err
	}
	if !s.Enabled {
		return nil, "", fmt.Errorf("email is disabled")
	}
	if !strings.EqualFold(strings.TrimSpace(s.Provider), "alimail") {
		return nil, "", fmt.Errorf("mailbox requires provider=alimail")
	}
	accountEmail := strings.TrimSpace(s.AliMailAccountEmail)
	if accountEmail == "" {
		accountEmail = strings.TrimSpace(s.FromEmail)
	}
	if accountEmail == "" {
		return nil, "", fmt.Errorf("alimail account email is required")
	}
	secret, err := services.GetDecryptedAliMailClientSecret(s)
	if err != nil {
		return nil, "", err
	}
	client := services.NewAliMailClient(s.AliMailEndpoint, s.AliMailClientID, secret)
	return client, accountEmail, nil
}

type broadcastRequest struct {
	Subject string `json:"subject" binding:"required"`
	HTML    string `json:"html" binding:"required"`
	Text    string `json:"text"`
	TestTo  string `json:"test_to"` // optional email
	Limit   int    `json:"limit"`
}

// Admin: POST /api/v1/admin/email/broadcast
func (ec *EmailController) Broadcast(c *gin.Context) {
	var req broadcastRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Invalid request", Error: err.Error()})
		return
	}

	db := config.GetDB()
	s, err := services.GetOrCreateEmailSetting(db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load settings", Error: err.Error()})
		return
	}
	if !s.Enabled || !s.MarketingEnabled {
		c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Email marketing is disabled"})
		return
	}

	if req.TestTo != "" {
		// test send only
		err := services.SendEmail(db, services.EmailSendOptions{
			To:      req.TestTo,
			Subject: req.Subject,
			Text:    req.Text,
			HTML:    req.HTML,
			Headers: map[string]string{"X-Entity-Ref-ID": "marketing-test"},
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, models.APIResponse{Success: false, Message: "Failed to send", Error: err.Error()})
			return
		}
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Test email sent"})
		return
	}

	var customers []models.Customer
	q := db.Model(&models.Customer{}).Where("is_active = ?", true)
	if err := q.Order("id ASC").Find(&customers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResponse{Success: false, Message: "Failed to load customers", Error: err.Error()})
		return
	}
	limit := req.Limit
	if limit <= 0 || limit > len(customers) {
		limit = len(customers)
	}

	sent := 0
	failed := 0
	for i := 0; i < limit; i++ {
		cust := customers[i]
		to := cust.Email
		if strings.TrimSpace(to) == "" {
			continue
		}

		html := strings.ReplaceAll(req.HTML, "{{full_name}}", cust.FullName)
		html = strings.ReplaceAll(html, "{{email}}", cust.Email)
		text := strings.ReplaceAll(req.Text, "{{full_name}}", cust.FullName)
		text = strings.ReplaceAll(text, "{{email}}", cust.Email)

		headers := map[string]string{
			"X-Entity-Ref-ID": fmt.Sprintf("marketing:%d", cust.ID),
		}
		if s.ReplyTo != "" {
			headers["List-Unsubscribe"] = fmt.Sprintf("<mailto:%s?subject=unsubscribe>", s.ReplyTo)
		}

		if err := services.SendEmail(db, services.EmailSendOptions{To: to, Subject: req.Subject, Text: text, HTML: html, Headers: headers}); err != nil {
			failed++
			continue
		}
		sent++
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Message: "Broadcast finished", Data: gin.H{"sent": sent, "failed": failed, "total": limit}})
}
