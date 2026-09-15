package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/utils"

	"gorm.io/gorm"
)

// PayPalAPIClient talks to the PayPal Orders v2 and Webhooks v1 APIs.
//
// It is intentionally separate from PayPalRefundClient (which only handles
// refunds) so the payment flow can create and capture orders server-side. The
// browser never decides the amount or whether an order is paid.
type PayPalAPIClient struct {
	BaseURL      string
	ClientID     string
	ClientSecret string
	WebhookID    string
	Mode         string
	HTTPClient   *http.Client
}

// PayPalOrderDetails is the server-verified subset of a PayPal order/capture.
type PayPalOrderDetails struct {
	OrderID     string
	Status      string
	ReferenceID string
	Amount      float64
	Currency    string
	CaptureID   string
	PayerID     string
	PayerEmail  string
	RawJSON     string
}

// NewPayPalAPIClientFromSettings loads the single-row PayPal setting and
// returns a ready client plus the setting itself.
func NewPayPalAPIClientFromSettings(db *gorm.DB) (*PayPalAPIClient, *models.PayPalSetting, error) {
	if db == nil {
		return nil, nil, errors.New("db is nil")
	}
	var setting models.PayPalSetting
	if err := db.First(&setting, 1).Error; err != nil {
		return nil, nil, fmt.Errorf("load PayPal settings: %w", err)
	}

	clientID := setting.ClientIDSandbox
	secretEnc := setting.ClientSecretSandboxEnc
	baseURL := "https://api-m.sandbox.paypal.com"
	if setting.Mode == "live" {
		clientID = setting.ClientIDLive
		secretEnc = setting.ClientSecretLiveEnc
		baseURL = "https://api-m.paypal.com"
	}
	if strings.TrimSpace(clientID) == "" || strings.TrimSpace(secretEnc) == "" {
		return nil, nil, fmt.Errorf("PayPal %s Client ID and Secret are required", setting.Mode)
	}
	secret, err := utils.DecryptSecret(secretEnc)
	if err != nil {
		return nil, nil, fmt.Errorf("decrypt PayPal Client Secret: %w", err)
	}

	return &PayPalAPIClient{
		BaseURL:      baseURL,
		ClientID:     strings.TrimSpace(clientID),
		ClientSecret: strings.TrimSpace(secret),
		WebhookID:    strings.TrimSpace(setting.WebhookID),
		Mode:         setting.Mode,
		HTTPClient:   NewPublicHTTPClient(30 * time.Second),
	}, &setting, nil
}

func (client *PayPalAPIClient) httpClient() *http.Client {
	if client != nil && client.HTTPClient != nil {
		return client.HTTPClient
	}
	return NewPublicHTTPClient(30 * time.Second)
}

func (client *PayPalAPIClient) accessToken(ctx context.Context) (string, error) {
	form := url.Values{"grant_type": {"client_credentials"}}
	endpoint := strings.TrimRight(client.BaseURL, "/") + "/v1/oauth2/token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(client.ClientID, client.ClientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.httpClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("request PayPal access token: %w", err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return "", readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("PayPal authentication failed (%d): %s", resp.StatusCode, paypalErrorMessage(raw))
	}
	var token paypalAccessTokenResponse
	if err := json.Unmarshal(raw, &token); err != nil || strings.TrimSpace(token.AccessToken) == "" {
		return "", errors.New("PayPal authentication response did not include an access token")
	}
	return token.AccessToken, nil
}

// CreateOrder creates a PayPal order for an authoritative server-side amount.
// referenceID is echoed back by PayPal (reference_id + custom_id) so the
// webhook and capture steps can bind the payment to our internal order.
func (client *PayPalAPIClient) CreateOrder(ctx context.Context, amount float64, currency, referenceID, requestID string) (string, string, error) {
	if client == nil || strings.TrimSpace(client.BaseURL) == "" {
		return "", "", errors.New("PayPal client is not configured")
	}
	if amount <= 0 {
		return "", "", errors.New("PayPal order amount must be positive")
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		currency = "USD"
	}
	accessToken, err := client.accessToken(ctx)
	if err != nil {
		return "", "", err
	}

	payload := map[string]any{
		"intent": "CAPTURE",
		"purchase_units": []map[string]any{
			{
				"reference_id": referenceID,
				"custom_id":    referenceID,
				"description":  "Industrial Automation Parts Order " + referenceID,
				"amount": map[string]string{
					"currency_code": currency,
					"value":         formatPayPalAmount(amount),
				},
			},
		},
		"application_context": map[string]string{
			"shipping_preference": "NO_SHIPPING",
			"user_action":         "PAY_NOW",
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	endpoint := strings.TrimRight(client.BaseURL, "/") + "/v2/checkout/orders"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(requestID) != "" {
		req.Header.Set("PayPal-Request-Id", strings.TrimSpace(requestID))
	}
	resp, err := client.httpClient().Do(req)
	if err != nil {
		return "", "", fmt.Errorf("call PayPal create order API: %w", err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if readErr != nil {
		return "", "", readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", string(raw), fmt.Errorf("PayPal create order failed (%d): %s", resp.StatusCode, paypalErrorMessage(raw))
	}
	var decoded struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return "", string(raw), fmt.Errorf("decode PayPal create order response: %w", err)
	}
	if strings.TrimSpace(decoded.ID) == "" {
		return "", string(raw), errors.New("PayPal create order response did not include an order id")
	}
	return decoded.ID, string(raw), nil
}

// CaptureOrder captures a previously created PayPal order and returns the
// resulting capture details. When PayPal reports the order is already
// captured, it falls back to fetching the existing capture so the call is
// idempotent.
func (client *PayPalAPIClient) CaptureOrder(ctx context.Context, paypalOrderID, requestID string) (*PayPalOrderDetails, error) {
	if client == nil || strings.TrimSpace(client.BaseURL) == "" {
		return nil, errors.New("PayPal client is not configured")
	}
	paypalOrderID = strings.TrimSpace(paypalOrderID)
	if paypalOrderID == "" {
		return nil, errors.New("PayPal order id is required")
	}
	accessToken, err := client.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(client.BaseURL, "/") + "/v2/checkout/orders/" + url.PathEscape(paypalOrderID) + "/capture"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader("{}"))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(requestID) != "" {
		req.Header.Set("PayPal-Request-Id", strings.TrimSpace(requestID))
	}
	resp, err := client.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("call PayPal capture API: %w", err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if readErr != nil {
		return nil, readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusUnprocessableEntity && strings.Contains(strings.ToUpper(string(raw)), "ORDER_ALREADY_CAPTURED") {
			return client.GetOrder(ctx, paypalOrderID)
		}
		return nil, fmt.Errorf("PayPal capture failed (%d): %s", resp.StatusCode, paypalErrorMessage(raw))
	}
	return parsePayPalOrder(raw)
}

// GetOrder fetches a PayPal order (with any existing captures) so callers can
// verify reference/amount/currency before trusting it.
func (client *PayPalAPIClient) GetOrder(ctx context.Context, paypalOrderID string) (*PayPalOrderDetails, error) {
	if client == nil || strings.TrimSpace(client.BaseURL) == "" {
		return nil, errors.New("PayPal client is not configured")
	}
	paypalOrderID = strings.TrimSpace(paypalOrderID)
	if paypalOrderID == "" {
		return nil, errors.New("PayPal order id is required")
	}
	accessToken, err := client.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	endpoint := strings.TrimRight(client.BaseURL, "/") + "/v2/checkout/orders/" + url.PathEscape(paypalOrderID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := client.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("call PayPal get order API: %w", err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if readErr != nil {
		return nil, readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("PayPal get order failed (%d): %s", resp.StatusCode, paypalErrorMessage(raw))
	}
	return parsePayPalOrder(raw)
}

type paypalOrderPayload struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Payer  struct {
		PayerID      string `json:"payer_id"`
		EmailAddress string `json:"email_address"`
	} `json:"payer"`
	PurchaseUnits []struct {
		ReferenceID string `json:"reference_id"`
		CustomID    string `json:"custom_id"`
		Amount      struct {
			Value        string `json:"value"`
			CurrencyCode string `json:"currency_code"`
		} `json:"amount"`
		Payments struct {
			Captures []struct {
				ID     string `json:"id"`
				Status string `json:"status"`
				Amount struct {
					Value        string `json:"value"`
					CurrencyCode string `json:"currency_code"`
				} `json:"amount"`
			} `json:"captures"`
		} `json:"payments"`
	} `json:"purchase_units"`
}

func parsePayPalOrder(raw []byte) (*PayPalOrderDetails, error) {
	var payload paypalOrderPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode PayPal order response: %w", err)
	}
	details := &PayPalOrderDetails{
		OrderID:    strings.TrimSpace(payload.ID),
		Status:     strings.ToUpper(strings.TrimSpace(payload.Status)),
		PayerID:    strings.TrimSpace(payload.Payer.PayerID),
		PayerEmail: strings.TrimSpace(payload.Payer.EmailAddress),
		RawJSON:    string(raw),
	}
	if len(payload.PurchaseUnits) > 0 {
		unit := payload.PurchaseUnits[0]
		details.ReferenceID = strings.TrimSpace(unit.ReferenceID)
		if details.ReferenceID == "" {
			details.ReferenceID = strings.TrimSpace(unit.CustomID)
		}
		if unit.Amount.Value != "" {
			if v, err := strconv.ParseFloat(unit.Amount.Value, 64); err == nil {
				details.Amount = v
			}
			details.Currency = strings.ToUpper(strings.TrimSpace(unit.Amount.CurrencyCode))
		}
		if len(unit.Payments.Captures) > 0 {
			capture := unit.Payments.Captures[0]
			details.CaptureID = strings.TrimSpace(capture.ID)
			if capture.Amount.Value != "" {
				if v, err := strconv.ParseFloat(capture.Amount.Value, 64); err == nil {
					details.Amount = v
				}
				details.Currency = strings.ToUpper(strings.TrimSpace(capture.Amount.CurrencyCode))
			}
			if strings.TrimSpace(capture.Status) != "" {
				details.Status = strings.ToUpper(strings.TrimSpace(capture.Status))
			}
		}
	}
	if details.OrderID == "" {
		return nil, errors.New("PayPal order response did not include an order id")
	}
	return details, nil
}

// VerifyWebhookSignature asks PayPal to verify an inbound webhook signature.
// The cert URL is validated to belong to PayPal before being forwarded.
func (client *PayPalAPIClient) VerifyWebhookSignature(ctx context.Context, transmissionID, transmissionTime, certURL, authAlgo, transmissionSig string, event []byte) error {
	if client == nil {
		return errors.New("PayPal client is not configured")
	}
	if client.WebhookID == "" {
		return errors.New("PayPal webhook id is not configured")
	}
	if strings.TrimSpace(transmissionID) == "" || strings.TrimSpace(transmissionSig) == "" ||
		strings.TrimSpace(transmissionTime) == "" || strings.TrimSpace(authAlgo) == "" {
		return errors.New("missing PayPal webhook signature headers")
	}
	if !isPayPalCertURL(certURL) {
		return errors.New("PayPal webhook cert url is not a PayPal host")
	}

	accessToken, err := client.accessToken(ctx)
	if err != nil {
		return err
	}

	var eventJSON json.RawMessage = event
	// The event must be embedded as a JSON object, not a string.
	if !json.Valid(eventJSON) {
		return errors.New("PayPal webhook event is not valid JSON")
	}

	payload := map[string]any{
		"transmission_id":   strings.TrimSpace(transmissionID),
		"transmission_time": strings.TrimSpace(transmissionTime),
		"cert_url":          strings.TrimSpace(certURL),
		"auth_algo":         strings.TrimSpace(authAlgo),
		"transmission_sig":  strings.TrimSpace(transmissionSig),
		"webhook_id":        client.WebhookID,
		"webhook_event":     eventJSON,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(client.BaseURL, "/") + "/v1/notifications/verify-webhook-signature"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("call PayPal verify webhook API: %w", err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("PayPal webhook verification failed (%d): %s", resp.StatusCode, paypalErrorMessage(raw))
	}
	var decoded struct {
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return fmt.Errorf("decode PayPal webhook verification: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(decoded.VerificationStatus), "SUCCESS") {
		return fmt.Errorf("PayPal rejected webhook signature: %s", strings.TrimSpace(decoded.VerificationStatus))
	}
	return nil
}

func isPayPalCertURL(certURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(certURL))
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "paypal.com" || strings.HasSuffix(host, ".paypal.com")
}

// formatPayPalAmount renders a float as a PayPal amount string with 2 decimals.
func formatPayPalAmount(amount float64) string {
	return strconv.FormatFloat(amount, 'f', 2, 64)
}
