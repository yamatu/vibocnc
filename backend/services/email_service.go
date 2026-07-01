package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"fanuc-backend/models"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/gomail.v2"
	"gorm.io/gorm"
)

const (
	encPrefix = "enc:"
)

func getSettingsEncryptionKey() []byte {
	k := strings.TrimSpace(os.Getenv("SETTINGS_ENCRYPTION_KEY"))
	if k == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(k))
	return sum[:]
}

func encryptString(plain string) (string, error) {
	key := getSettingsEncryptionKey()
	if len(key) == 0 {
		return plain, nil
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(plain), nil)
	payload := append(nonce, ciphertext...)
	return encPrefix + base64.StdEncoding.EncodeToString(payload), nil
}

func decryptString(val string) (string, error) {
	if !strings.HasPrefix(val, encPrefix) {
		return val, nil
	}
	key := getSettingsEncryptionKey()
	if len(key) == 0 {
		return "", errors.New("SETTINGS_ENCRYPTION_KEY is not set")
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(val, encPrefix))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted payload")
	}
	nonce := raw[:gcm.NonceSize()]
	ciphertext := raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func normalizeSMTPHostAndPort(host string, port int) (string, int) {
	h := strings.TrimSpace(host)
	if h == "" {
		return "", port
	}

	// If the admin pasted a web URL like https://mail.example.com:8443/, extract the host part.
	if strings.Contains(h, "://") {
		if u, err := url.Parse(h); err == nil {
			if u.Host != "" {
				h = u.Host
			}
		}
	}
	// Strip any remaining path.
	if i := strings.IndexByte(h, '/'); i >= 0 {
		h = h[:i]
	}

	// If host includes an explicit port, that port always wins.
	if strings.Contains(h, ":") {
		if hostOnly, portStr, err := net.SplitHostPort(h); err == nil {
			p := 0
			fmt.Sscanf(portStr, "%d", &p)
			if p > 0 {
				return strings.TrimSpace(hostOnly), p
			}
			return strings.TrimSpace(hostOnly), port
		}
		// If SplitHostPort fails (e.g. missing port), fall through and use provided port.
	}

	return strings.TrimSpace(h), port
}

// NormalizeSMTPHostInput parses user input for SMTP host.
// Accepts inputs like "mail.example.com", "mail.example.com:587", or "https://mail.example.com:8443/".
// Returns host without port/path and the port found in the input (0 if none).
func NormalizeSMTPHostInput(input string) (string, int) {
	h, p := normalizeSMTPHostAndPort(input, 0)
	return h, p
}

func GetOrCreateEmailSetting(db *gorm.DB) (*models.EmailSetting, error) {
	var s models.EmailSetting
	if err := db.First(&s, 1).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			s = models.EmailSetting{
				ID:                               1,
				Enabled:                          false,
				Provider:                         "smtp",
				SMTPTLSMode:                      "starttls",
				SMTPPort:                         587,
				FromName:                         "VIBO CNC",
				AliMailEndpoint:                  defaultAliMailEndpoint,
				CodeExpiryMinutes:                10,
				CodeResendSeconds:                60,
				VerificationEnabled:              false,
				MarketingEnabled:                 false,
				ShippingNotificationsEnabled:     true,
				OrderNotificationsEnabled:        false,
				OrderCreatedNotificationsEnabled: false,
				OrderPaidNotificationsEnabled:    false,
				OrderNotificationEmails:          "",
				ContactNotificationsEnabled:      true,
				ContactNotificationEmails:        "",
			}
			if e := db.Create(&s).Error; e != nil {
				return nil, e
			}
		} else {
			return nil, err
		}
	}
	return &s, nil
}

type EmailSendOptions struct {
	To      string
	Subject string
	Text    string
	HTML    string
	Headers map[string]string
}

func SendEmail(db *gorm.DB, opts EmailSendOptions) error {
	s, err := GetOrCreateEmailSetting(db)
	if err != nil {
		return err
	}
	if !s.Enabled {
		return errors.New("email is disabled")
	}
	provider := strings.ToLower(strings.TrimSpace(s.Provider))
	if provider == "" {
		provider = "smtp"
	}
	if provider == "resend" {
		return sendResendEmail(db, s, opts)
	}
	if provider == "alimail" {
		return sendAliMailEmail(s, opts)
	}
	if provider != "smtp" {
		return fmt.Errorf("unsupported email provider: %s", s.Provider)
	}
	host, port := normalizeSMTPHostAndPort(s.SMTPHost, s.SMTPPort)
	if host == "" || port == 0 {
		return errors.New("smtp is not configured")
	}
	if s.FromEmail == "" {
		return errors.New("from_email is required")
	}
	pass, err := decryptString(s.SMTPPassword)
	if err != nil {
		return err
	}

	msg := gomail.NewMessage()
	msg.SetHeader("From", msg.FormatAddress(s.FromEmail, s.FromName))
	msg.SetHeader("To", opts.To)
	msg.SetHeader("Subject", opts.Subject)
	if s.ReplyTo != "" {
		msg.SetHeader("Reply-To", s.ReplyTo)
	}
	for k, v := range opts.Headers {
		msg.SetHeader(k, v)
	}

	text := strings.TrimSpace(opts.Text)
	html := strings.TrimSpace(opts.HTML)
	if text == "" && html == "" {
		text = "(no content)"
	}
	if html != "" {
		msg.SetBody("text/html", html)
		if text != "" {
			msg.AddAlternative("text/plain", text)
		}
	} else {
		msg.SetBody("text/plain", text)
	}

	d := gomail.NewDialer(host, port, s.SMTPUsername, pass)
	tlsMode := strings.ToLower(strings.TrimSpace(s.SMTPTLSMode))
	if tlsMode == "ssl" {
		d.SSL = true
	}
	// starttls is default for gomail when SSL=false.
	// For "none", some servers allow plain on port 25.
	// We keep gomail default behavior; users can set port/tls mode accordingly.

	return d.DialAndSend(msg)
}

func sendResendEmail(db *gorm.DB, s *models.EmailSetting, opts EmailSendOptions) error {
	apiKey, err := GetDecryptedResendAPIKey(s)
	if err != nil {
		return err
	}
	if s.FromEmail == "" {
		return errors.New("from_email is required")
	}
	client := NewResendClient(apiKey)

	from := s.FromEmail
	if s.FromName != "" {
		from = fmt.Sprintf("%s <%s>", s.FromName, s.FromEmail)
	}

	req := ResendSendEmailRequest{
		From:    from,
		To:      []string{opts.To},
		Subject: opts.Subject,
		HTML:    opts.HTML,
		Text:    opts.Text,
		ReplyTo: s.ReplyTo,
		Headers: opts.Headers,
	}
	_, err = client.SendEmail(req)
	return err
}

type VerificationPurpose string

const (
	PurposeRegister   VerificationPurpose = "register"
	PurposeReset      VerificationPurpose = "reset"
	PurposeAdminReset VerificationPurpose = "admin_reset"
)

func GenerateVerificationCode() (string, error) {
	// 6 digits
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	val := int(b[0])<<16 | int(b[1])<<8 | int(b[2])
	code := fmt.Sprintf("%06d", val%1000000)
	return code, nil
}

func CreateAndSendVerificationCode(db *gorm.DB, email string, purpose VerificationPurpose) error {
	s, err := GetOrCreateEmailSetting(db)
	if err != nil {
		return err
	}
	if !s.Enabled {
		return errors.New("email is disabled")
	}
	if !s.VerificationEnabled {
		return errors.New("email verification is disabled")
	}

	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		return errors.New("email is required")
	}

	// basic resend throttling
	var last models.EmailVerificationCode
	if err := db.Where("email = ? AND purpose = ?", normalizedEmail, string(purpose)).Order("created_at DESC").First(&last).Error; err == nil {
		min := s.CodeResendSeconds
		if min <= 0 {
			min = 60
		}
		if time.Since(last.CreatedAt) < time.Duration(min)*time.Second {
			return fmt.Errorf("please wait %d seconds before requesting another code", min)
		}
	}

	code, err := GenerateVerificationCode()
	if err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	expMin := s.CodeExpiryMinutes
	if expMin <= 0 {
		expMin = 10
	}
	rec := models.EmailVerificationCode{
		Email:     normalizedEmail,
		Purpose:   string(purpose),
		CodeHash:  string(hash),
		ExpiresAt: time.Now().Add(time.Duration(expMin) * time.Minute),
	}
	if err := db.Create(&rec).Error; err != nil {
		return err
	}

	subject := "Your VIBO CNC verification code"
	if purpose == PurposeReset || purpose == PurposeAdminReset {
		subject = "Reset your VIBO CNC password"
	}

	text := fmt.Sprintf(
		"VIBO CNC\n\nYour verification code is: %s\n\nThis code expires in %d minutes.\nIf you did not request this, you can ignore this email.\n\n--\nVIBO CNC Spare Parts\n",
		code, expMin,
	)
	html := fmt.Sprintf(
		"<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;line-height:1.5;color:#111\">"+
			"<h2 style=\"margin:0 0 12px 0\">VIBO CNC Verification Code</h2>"+
			"<p style=\"margin:0 0 14px 0\">Use the code below to continue:</p>"+
			"<div style=\"font-size:28px;font-weight:700;letter-spacing:6px;background:#fff8e1;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;display:inline-block\">%s</div>"+
			"<p style=\"margin:14px 0 0 0;font-size:13px;color:#555\">Expires in %d minutes. If you did not request this, you can ignore this email.</p>"+
			"<hr style=\"border:none;border-top:1px solid #eee;margin:18px 0\"/>"+
			"<div style=\"font-size:12px;color:#777\">VIBO CNC Spare Parts</div>"+
			"</div>",
		code, expMin,
	)

	headers := map[string]string{
		"X-Entity-Ref-ID": fmt.Sprintf("verify:%s:%d", string(purpose), rec.ID),
	}

	return SendEmail(db, EmailSendOptions{To: normalizedEmail, Subject: subject, Text: text, HTML: html, Headers: headers})
}

func VerifyEmailCode(db *gorm.DB, email string, purpose VerificationPurpose, code string) error {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))
	if normalizedEmail == "" {
		return errors.New("invalid or expired code")
	}
	normalizedCode := strings.TrimSpace(code)
	if normalizedCode == "" {
		return errors.New("invalid or expired code")
	}

	var rec models.EmailVerificationCode
	if err := db.Where("email = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?", normalizedEmail, string(purpose), time.Now()).
		Order("created_at DESC").First(&rec).Error; err != nil {
		return errors.New("invalid or expired code")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(rec.CodeHash), []byte(normalizedCode)); err != nil {
		return errors.New("invalid or expired code")
	}
	now := time.Now()
	if err := db.Model(&models.EmailVerificationCode{}).Where("id = ?", rec.ID).Update("used_at", &now).Error; err != nil {
		return err
	}
	return nil
}

func UpdateSMTPPassword(db *gorm.DB, setting *models.EmailSetting, newPassword string) error {
	enc, err := encryptString(newPassword)
	if err != nil {
		return err
	}
	setting.SMTPPassword = enc
	return nil
}

func UpdateResendAPIKey(db *gorm.DB, setting *models.EmailSetting, apiKey string) error {
	enc, err := encryptString(apiKey)
	if err != nil {
		return err
	}
	setting.ResendAPIKey = enc
	return nil
}

func UpdateResendWebhookSecret(db *gorm.DB, setting *models.EmailSetting, secret string) error {
	enc, err := encryptString(secret)
	if err != nil {
		return err
	}
	setting.ResendWebhookSecret = enc
	return nil
}

func UpdateAliMailClientSecret(db *gorm.DB, setting *models.EmailSetting, secret string) error {
	enc, err := encryptString(secret)
	if err != nil {
		return err
	}
	setting.AliMailClientSecret = enc
	return nil
}

func GetDecryptedResendAPIKey(setting *models.EmailSetting) (string, error) {
	if setting == nil {
		return "", errors.New("missing settings")
	}
	apiKey, err := decryptString(setting.ResendAPIKey)
	if err != nil {
		return "", err
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return "", errors.New("resend api key is not configured")
	}
	return apiKey, nil
}

func GetDecryptedAliMailClientSecret(setting *models.EmailSetting) (string, error) {
	if setting == nil {
		return "", errors.New("missing settings")
	}
	secret, err := decryptString(setting.AliMailClientSecret)
	if err != nil {
		return "", err
	}
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return "", errors.New("alimail secret is not configured")
	}
	return secret, nil
}
