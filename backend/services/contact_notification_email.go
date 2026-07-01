package services

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

func BuildContactNotificationEmail(siteURL string, message models.ContactMessage) (subject, text, html string) {
	createdAt := ""
	if !message.CreatedAt.IsZero() {
		createdAt = message.CreatedAt.UTC().Format(time.RFC3339)
	}

	adminContactsPage := ""
	base := strings.TrimSpace(siteURL)
	if base != "" {
		base = strings.TrimRight(base, "/")
		adminContactsPage = base + "/admin/contacts"
	}

	customerName := fallbackStr(message.Name, "Customer")
	messageSubject := fallbackStr(message.Subject, "Contact message")
	subject = fmt.Sprintf("New contact message: %s", messageSubject)

	text = fmt.Sprintf(
		"New contact message\n\nName: %s\nEmail: %s\nPhone: %s\nCompany: %s\nInquiry type: %s\nSubject: %s\nCreated at: %s\nIP: %s\n\nMessage:\n%s\n\nAdmin: %s\n",
		fallbackStr(message.Name, "-"),
		fallbackStr(message.Email, "-"),
		fallbackStr(message.Phone, "-"),
		fallbackStr(message.Company, "-"),
		fallbackStr(message.InquiryType, "-"),
		messageSubject,
		fallbackStr(createdAt, "-"),
		fallbackStr(message.IPAddress, "-"),
		fallbackStr(message.Message, "-"),
		fallbackStr(adminContactsPage, ""),
	)

	adminBtn := ""
	if adminContactsPage != "" {
		adminBtn = fmt.Sprintf("<p style=\"margin:14px 0 0 0\"><a href=\"%s\" style=\"display:inline-block;background:#111827;color:#fff;text-decoration:none;font-weight:800;font-size:13px;padding:10px 12px;border-radius:10px\">Open contacts</a></p>", escapeAttr(adminContactsPage))
	}

	html = "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;line-height:1.6;color:#111827\">" +
		"<div style=\"padding:18px 20px;background:linear-gradient(135deg,#0ea5e9,#f97316);border-radius:14px 14px 0 0;color:#fff\">" +
		"<div style=\"font-size:18px;font-weight:800\">VIBO CNC Spare Parts</div>" +
		"<div style=\"font-size:13px;opacity:0.9;margin-top:4px\">New contact message</div>" +
		"</div>" +
		"<div style=\"border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:18px 20px;background:#fff\">" +
		fmt.Sprintf("<p style=\"margin:0 0 10px 0\"><b>%s</b> sent a contact message.</p>", escapeHTML(customerName)) +
		"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:separate;border-spacing:0 8px\">" +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Name</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(message.Name, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Email</td><td style=\"font-size:14px\"><a href=\"mailto:%s\" style=\"color:#111827\">%s</a></td></tr>", escapeAttr(message.Email), escapeHTML(fallbackStr(message.Email, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Phone</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(message.Phone, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Company</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(message.Company, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Inquiry type</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(message.InquiryType, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Subject</td><td style=\"font-size:14px;font-weight:800\">%s</td></tr>", escapeHTML(messageSubject)) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Created at</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(createdAt, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">IP</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(message.IPAddress, "-"))) +
		"</table>" +
		"<div style=\"margin-top:14px\">" +
		"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#111827;margin:0 0 8px 0\">Message</div>" +
		fmt.Sprintf("<div style=\"font-size:13px;color:#111827;white-space:pre-wrap;border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f9fafb\">%s</div>", escapeHTML(fallbackStr(message.Message, "-"))) +
		"</div>" +
		adminBtn +
		"</div>" +
		"</div>"

	return subject, text, html
}

func NotifyAdminContactMessage(db *gorm.DB, siteURL string, messageID uint) error {
	s, err := GetOrCreateEmailSetting(db)
	if err != nil {
		return err
	}
	if !s.Enabled || !s.ContactNotificationsEnabled {
		return nil
	}

	recipientInput := s.ContactNotificationEmails
	if strings.TrimSpace(recipientInput) == "" {
		recipientInput = s.OrderNotificationEmails
	}
	_, recipients, err := NormalizeEmailRecipients(recipientInput)
	if err != nil {
		return err
	}
	if len(recipients) == 0 {
		return errors.New("contact notification emails not configured")
	}

	var message models.ContactMessage
	if err := db.First(&message, messageID).Error; err != nil {
		return err
	}

	subj, txt, html := BuildContactNotificationEmail(siteURL, message)
	headerID := fmt.Sprintf("admin-contact:%d", message.ID)

	fails := 0
	var lastErr error
	for _, to := range recipients {
		if e := SendEmail(db, EmailSendOptions{To: to, Subject: subj, Text: txt, HTML: html, Headers: map[string]string{"X-Entity-Ref-ID": headerID}}); e != nil {
			fails++
			lastErr = e
		}
	}
	if fails > 0 {
		return fmt.Errorf("contact notification: failed to send to %d recipient(s): %v", fails, lastErr)
	}
	return nil
}
