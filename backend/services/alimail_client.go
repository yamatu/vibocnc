package services

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"fanuc-backend/models"
)

const defaultAliMailEndpoint = "https://alimail-cn.aliyuncs.com"

type aliMailTokenCacheEntry struct {
	token     string
	expiresAt time.Time
}

var (
	aliMailTokenCacheMu sync.Mutex
	aliMailTokenCache   = map[string]aliMailTokenCacheEntry{}
)

type AliMailClient struct {
	Endpoint     string
	ClientID     string
	ClientSecret string
	HTTPClient   *http.Client
}

type aliMailTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	Error       string `json:"error"`
	ErrorCode   string `json:"error_code"`
	ErrorDesc   string `json:"error_description"`
	Message     string `json:"message"`
}

type aliMailAddress struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type aliMailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type aliMailMessageBody struct {
	BodyText string `json:"bodyText,omitempty"`
	BodyHTML string `json:"bodyHtml,omitempty"`
}

type aliMailMessageRequest struct {
	Subject                string             `json:"subject"`
	From                   aliMailAddress     `json:"from"`
	ToRecipients           []aliMailAddress   `json:"toRecipients"`
	ReplyTo                []aliMailAddress   `json:"replyTo,omitempty"`
	Body                   aliMailMessageBody `json:"body"`
	InternetMessageID      string             `json:"internetMessageId,omitempty"`
	InternetMessageHeaders []aliMailHeader    `json:"internetMessageHeaders,omitempty"`
}

type aliMailCreateMessageRequest struct {
	Message aliMailMessageRequest `json:"message"`
}

type aliMailMessageResponse struct {
	ID      string `json:"id"`
	Message string `json:"message"`
	Code    string `json:"code"`
	Request string `json:"requestId"`
}

type aliMailCreateMessageResponse struct {
	Message aliMailMessageResponse `json:"message"`
	Code    string                 `json:"code"`
	Request string                 `json:"requestId"`
}

type aliMailSendMessageRequest struct {
	SaveToSentItems bool `json:"saveToSentItems"`
}

func NewAliMailClient(endpoint, clientID, clientSecret string) *AliMailClient {
	return &AliMailClient{
		Endpoint:     normalizeAliMailEndpoint(endpoint),
		ClientID:     strings.TrimSpace(clientID),
		ClientSecret: strings.TrimSpace(clientSecret),
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func normalizeAliMailEndpoint(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = defaultAliMailEndpoint
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	return strings.TrimRight(endpoint, "/")
}

func (c *AliMailClient) cacheKey() string {
	return c.Endpoint + "|" + c.ClientID
}

func (c *AliMailClient) getAccessToken(ctx context.Context) (string, error) {
	if c.ClientID == "" || c.ClientSecret == "" {
		return "", errors.New("alimail app id and secret are required")
	}

	key := c.cacheKey()
	now := time.Now()
	aliMailTokenCacheMu.Lock()
	if entry, ok := aliMailTokenCache[key]; ok && entry.token != "" && now.Before(entry.expiresAt.Add(-2*time.Minute)) {
		token := entry.token
		aliMailTokenCacheMu.Unlock()
		return token, nil
	}
	aliMailTokenCacheMu.Unlock()

	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("client_secret", c.ClientSecret)
	form.Set("grant_type", "client_credentials")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint+"/oauth2/v2.0/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	body, status, err := c.do(req)
	if err != nil {
		return "", err
	}

	var tokenResp aliMailTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("failed to parse alimail token response: %w", err)
	}
	if status < 200 || status >= 300 || strings.TrimSpace(tokenResp.AccessToken) == "" {
		return "", fmt.Errorf("alimail token request failed: status=%d error=%s message=%s", status, firstNonEmpty(tokenResp.Error, tokenResp.ErrorCode), firstNonEmpty(tokenResp.ErrorDesc, tokenResp.Message, string(body)))
	}

	expiresIn := tokenResp.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	expiresAt := time.Now().Add(time.Duration(expiresIn) * time.Second)

	aliMailTokenCacheMu.Lock()
	aliMailTokenCache[key] = aliMailTokenCacheEntry{token: tokenResp.AccessToken, expiresAt: expiresAt}
	aliMailTokenCacheMu.Unlock()

	return tokenResp.AccessToken, nil
}

func (c *AliMailClient) CreateDraft(ctx context.Context, accountEmail string, payload aliMailMessageRequest) (string, error) {
	token, err := c.getAccessToken(ctx)
	if err != nil {
		return "", err
	}

	raw, err := json.Marshal(aliMailCreateMessageRequest{Message: payload})
	if err != nil {
		return "", err
	}
	path := fmt.Sprintf("%s/v2/users/%s/messages", c.Endpoint, url.PathEscape(strings.TrimSpace(accountEmail)))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, path, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	body, status, err := c.do(req)
	if err != nil {
		return "", err
	}
	var out aliMailCreateMessageResponse
	if len(body) > 0 {
		_ = json.Unmarshal(body, &out)
	}
	if status < 200 || status >= 300 || strings.TrimSpace(out.Message.ID) == "" {
		return "", fmt.Errorf("alimail create draft failed: status=%d code=%s message=%s", status, out.Code, firstNonEmpty(out.Message.Message, string(body)))
	}
	return out.Message.ID, nil
}

func (c *AliMailClient) SendDraft(ctx context.Context, accountEmail, messageID string) error {
	token, err := c.getAccessToken(ctx)
	if err != nil {
		return err
	}

	path := fmt.Sprintf("%s/v2/users/%s/messages/%s/send", c.Endpoint, url.PathEscape(strings.TrimSpace(accountEmail)), url.PathEscape(strings.TrimSpace(messageID)))
	raw, err := json.Marshal(aliMailSendMessageRequest{SaveToSentItems: true})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	body, status, err := c.do(req)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		var out aliMailMessageResponse
		_ = json.Unmarshal(body, &out)
		return fmt.Errorf("alimail send draft failed: status=%d code=%s message=%s", status, out.Code, firstNonEmpty(out.Message, string(body)))
	}
	return nil
}

func (c *AliMailClient) do(req *http.Request) ([]byte, int, error) {
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func sendAliMailEmail(s *models.EmailSetting, opts EmailSendOptions) error {
	secret, err := GetDecryptedAliMailClientSecret(s)
	if err != nil {
		return err
	}

	fromEmail := strings.TrimSpace(s.FromEmail)
	if fromEmail == "" {
		return errors.New("from_email is required")
	}
	accountEmail := strings.TrimSpace(s.AliMailAccountEmail)
	if accountEmail == "" {
		accountEmail = fromEmail
	}
	if accountEmail == "" {
		return errors.New("alimail account email is required")
	}

	text := strings.TrimSpace(opts.Text)
	html := strings.TrimSpace(opts.HTML)
	if text == "" && html == "" {
		text = "(no content)"
	}

	headers := make([]aliMailHeader, 0, len(opts.Headers)+1)
	for name, value := range opts.Headers {
		name = strings.TrimSpace(name)
		value = strings.TrimSpace(value)
		if name == "" || value == "" {
			continue
		}
		headers = append(headers, aliMailHeader{Name: name, Value: value})
	}

	payload := aliMailMessageRequest{
		Subject: opts.Subject,
		From: aliMailAddress{
			Email: fromEmail,
			Name:  strings.TrimSpace(s.FromName),
		},
		ToRecipients: []aliMailAddress{{Email: strings.TrimSpace(opts.To)}},
		Body: aliMailMessageBody{
			BodyText: text,
			BodyHTML: html,
		},
		InternetMessageID:      buildAliMailMessageID(fromEmail),
		InternetMessageHeaders: headers,
	}
	if replyTo := strings.TrimSpace(s.ReplyTo); replyTo != "" {
		payload.ReplyTo = []aliMailAddress{{Email: replyTo}}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	client := NewAliMailClient(s.AliMailEndpoint, s.AliMailClientID, secret)
	draftID, err := client.CreateDraft(ctx, accountEmail, payload)
	if err != nil {
		return err
	}
	return client.SendDraft(ctx, accountEmail, draftID)
}

func buildAliMailMessageID(fromEmail string) string {
	domain := "vibocnc.local"
	if i := strings.LastIndex(fromEmail, "@"); i >= 0 && i+1 < len(fromEmail) {
		domain = fromEmail[i+1:]
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return fmt.Sprintf("<%d@%s>", time.Now().UnixNano(), domain)
	}
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), hex.EncodeToString(random), domain)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}
