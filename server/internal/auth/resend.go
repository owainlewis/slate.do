package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"strings"
	"time"
)

const resendAPIURL = "https://api.resend.com/emails"

type PasswordResetSender interface {
	SendPasswordReset(ctx context.Context, email string, resetURL string, idempotencyKey string) error
}

type ResendSender struct {
	apiKey string
	from   string
	client *http.Client
	apiURL string
}

func NewResendSender(apiKey string, from string, client *http.Client) *ResendSender {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &ResendSender{
		apiKey: strings.TrimSpace(apiKey),
		from:   strings.TrimSpace(from),
		client: client,
		apiURL: resendAPIURL,
	}
}

func (s *ResendSender) SendPasswordReset(ctx context.Context, email string, resetURL string, idempotencyKey string) error {
	if s == nil || s.apiKey == "" || s.from == "" {
		return fmt.Errorf("resend sender is not configured")
	}
	payload := struct {
		From    string   `json:"from"`
		To      []string `json:"to"`
		Subject string   `json:"subject"`
		HTML    string   `json:"html"`
		Text    string   `json:"text"`
	}{
		From:    s.from,
		To:      []string{email},
		Subject: "Reset your Slate password",
		HTML:    fmt.Sprintf(`<p>We received a request to reset your Slate password.</p><p><a href="%s">Choose a new password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this email.</p>`, html.EscapeString(resetURL)),
		Text:    fmt.Sprintf("Reset your Slate password:\n\n%s\n\nThis link expires in one hour. If you did not request this, you can ignore this email.\n", resetURL),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "slate.do/1.0")
	req.Header.Set("Idempotency-Key", idempotencyKey)
	response, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("send password reset: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
		return fmt.Errorf("send password reset: resend returned status %d", response.StatusCode)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	return nil
}
