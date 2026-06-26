package services

import (
	"errors"
	"fmt"
	"net/mail"
	"sort"
	"strings"
	"time"

	"fanuc-backend/models"

	"gorm.io/gorm"
)

// NormalizeEmailRecipients parses a comma/semicolon/newline separated list of emails,
// validates them, deduplicates, and returns a normalized storage string.
func NormalizeEmailRecipients(input string) (normalized string, recipients []string, err error) {
	parts := strings.FieldsFunc(input, func(r rune) bool {
		switch r {
		case ',', ';', '\n', '\r', '\t', ' ':
			return true
		default:
			return false
		}
	})

	seen := map[string]struct{}{}
	for _, p := range parts {
		e := strings.ToLower(strings.TrimSpace(p))
		if e == "" {
			continue
		}
		addr, e2 := mail.ParseAddress(e)
		if e2 != nil || addr == nil || strings.TrimSpace(addr.Address) == "" {
			return "", nil, fmt.Errorf("invalid email: %s", e)
		}
		val := strings.ToLower(strings.TrimSpace(addr.Address))
		if val == "" {
			continue
		}
		if _, ok := seen[val]; ok {
			continue
		}
		seen[val] = struct{}{}
		recipients = append(recipients, val)
	}

	sort.Strings(recipients)
	normalized = strings.Join(recipients, ", ")
	return normalized, recipients, nil
}

func BuildOrderNotificationEmail(siteURL string, order models.Order, event string) (subject, text, html string) {
	orderNo := strings.TrimSpace(order.OrderNumber)
	if orderNo == "" {
		orderNo = fmt.Sprintf("ORDER-%d", order.ID)
	}

	currency := strings.TrimSpace(order.Currency)
	if currency == "" {
		currency = "USD"
	}

	createdAt := ""
	if !order.CreatedAt.IsZero() {
		createdAt = order.CreatedAt.UTC().Format(time.RFC3339)
	}

	trackPage := ""
	adminOrderPage := ""
	base := strings.TrimSpace(siteURL)
	if base != "" {
		base = strings.TrimRight(base, "/")
		trackPage = base + "/orders/track/" + orderNo
		adminOrderPage = base + "/admin/orders/" + fmt.Sprintf("%d", order.ID)
	}

	formatMoney := func(v float64) string {
		return fmt.Sprintf("%.2f %s", v, currency)
	}

	eventTitle := strings.ToLower(strings.TrimSpace(event))
	if eventTitle == "paid" {
		subject = fmt.Sprintf("Order paid %s (%s)", orderNo, formatMoney(order.TotalAmount))
	} else {
		subject = fmt.Sprintf("New order created %s (%s)", orderNo, formatMoney(order.TotalAmount))
	}

	// Items
	itemLines := make([]string, 0)
	for _, it := range order.Items {
		sku := ""
		name := ""
		if it.Product != nil {
			sku = it.Product.SKU
			name = it.Product.Name
		}
		if strings.TrimSpace(sku) == "" {
			sku = fmt.Sprintf("PID-%d", it.ProductID)
		}
		if strings.TrimSpace(name) == "" {
			name = "Product"
		}
		itemLines = append(itemLines, fmt.Sprintf("- %s | %s x%d | %s", sku, name, it.Quantity, formatMoney(it.TotalPrice)))
	}

	itemsText := ""
	if len(itemLines) > 0 {
		itemsText = "\nItems:\n" + strings.Join(itemLines, "\n") + "\n"
	}

	text = fmt.Sprintf(
		"Order notification (%s)\n\nOrder: %s\nCreated at: %s\nPayment status: %s\nPayment method: %s\nTotal: %s\nSubtotal: %s\nDiscount: %s\n\nCustomer: %s\nEmail: %s\nPhone: %s\n\nShipping address:\n%s\n\nBilling address:\n%s\n\nNotes:\n%s\n%s\nAdmin: %s\nTrack: %s\n",
		eventTitle,
		orderNo,
		fallbackStr(createdAt, "-"),
		fallbackStr(strings.TrimSpace(order.PaymentStatus), "-"),
		fallbackStr(strings.TrimSpace(order.PaymentMethod), "-"),
		formatMoney(order.TotalAmount),
		formatMoney(order.SubtotalAmount),
		formatMoney(order.DiscountAmount),
		fallbackStr(strings.TrimSpace(order.CustomerName), "-"),
		fallbackStr(strings.TrimSpace(order.CustomerEmail), "-"),
		fallbackStr(strings.TrimSpace(order.CustomerPhone), "-"),
		fallbackStr(strings.TrimSpace(order.ShippingAddress), "-"),
		fallbackStr(strings.TrimSpace(order.BillingAddress), "-"),
		fallbackStr(strings.TrimSpace(order.Notes), "-"),
		itemsText,
		fallbackStr(adminOrderPage, ""),
		fallbackStr(trackPage, ""),
	)

	escapeMultiline := func(s string) string {
		lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
		out := make([]string, 0, len(lines))
		for _, l := range lines {
			out = append(out, escapeHTML(l))
		}
		return strings.Join(out, "<br/>")
	}

	// Items HTML table
	itemsHTML := ""
	if len(order.Items) > 0 {
		rows := make([]string, 0, len(order.Items))
		for _, it := range order.Items {
			sku := ""
			name := ""
			if it.Product != nil {
				sku = it.Product.SKU
				name = it.Product.Name
			}
			if strings.TrimSpace(sku) == "" {
				sku = fmt.Sprintf("PID-%d", it.ProductID)
			}
			if strings.TrimSpace(name) == "" {
				name = "Product"
			}

			rows = append(rows,
				"<tr>"+
					"<td style=\"padding:8px 10px;border-top:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;color:#111827;\">"+escapeHTML(sku)+"</td>"+
					"<td style=\"padding:8px 10px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;\">"+escapeHTML(name)+"</td>"+
					fmt.Sprintf("<td style=\"padding:8px 10px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;text-align:right;\">%d</td>", it.Quantity)+
					"<td style=\"padding:8px 10px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;text-align:right;\">"+escapeHTML(formatMoney(it.TotalPrice))+"</td>"+
					"</tr>")
		}

		itemsHTML = "<div style=\"margin-top:14px\">" +
			"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#111827;margin:0 0 8px 0\">Items</div>" +
			"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden\">" +
			"<tr>" +
			"<th align=\"left\" style=\"padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">SKU</th>" +
			"<th align=\"left\" style=\"padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">Item</th>" +
			"<th align=\"right\" style=\"padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">Qty</th>" +
			"<th align=\"right\" style=\"padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">Total</th>" +
			"</tr>" +
			strings.Join(rows, "") +
			"</table>" +
			"</div>"
	}

	adminBtn := ""
	if adminOrderPage != "" {
		adminBtn = fmt.Sprintf("<p style=\"margin:14px 0 0 0\"><a href=\"%s\" style=\"display:inline-block;background:#111827;color:#fff;text-decoration:none;font-weight:800;font-size:13px;padding:10px 12px;border-radius:10px\">Open in admin</a></p>", escapeAttr(adminOrderPage))
	}
	trackBtn := ""
	if trackPage != "" {
		trackBtn = fmt.Sprintf("<p style=\"margin:10px 0 0 0\"><a href=\"%s\" style=\"color:#111827\">Public tracking page</a></p>", escapeAttr(trackPage))
	}

	headerLine := "New order"
	headerSub := "Order created"
	if eventTitle == "paid" {
		headerLine = "Order paid"
		headerSub = "Payment confirmed"
	}

	html = "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;line-height:1.6;color:#111827\">" +
		"<div style=\"padding:18px 20px;background:linear-gradient(135deg,#0ea5e9,#22c55e);border-radius:14px 14px 0 0;\">" +
		"<div style=\"font-size:18px;font-weight:800\">VIBO CNC Spare Parts</div>" +
		"<div style=\"font-size:13px;opacity:0.9;margin-top:4px\">" + escapeHTML(headerLine) + "</div>" +
		"</div>" +
		"<div style=\"border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:18px 20px;background:#fff\">" +
		fmt.Sprintf("<p style=\"margin:0 0 10px 0\">%s: <b>%s</b>.</p>", escapeHTML(headerSub), escapeHTML(orderNo)) +
		"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:separate;border-spacing:0 8px\">" +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Created at</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(createdAt, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Payment status</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(strings.TrimSpace(order.PaymentStatus), "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Payment method</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(strings.TrimSpace(order.PaymentMethod), "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Total</td><td style=\"font-size:14px;font-weight:800\">%s</td></tr>", escapeHTML(formatMoney(order.TotalAmount))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Subtotal</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(formatMoney(order.SubtotalAmount))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Discount</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(formatMoney(order.DiscountAmount))) +
		"</table>" +
		"<div style=\"margin-top:14px\">" +
		"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#111827;margin:0 0 8px 0\">Customer</div>" +
		"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:separate;border-spacing:0 8px\">" +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Name</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(strings.TrimSpace(order.CustomerName), "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Email</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(strings.TrimSpace(order.CustomerEmail), "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px\">Phone</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(fallbackStr(strings.TrimSpace(order.CustomerPhone), "-"))) +
		"</table>" +
		"</div>" +
		"<div style=\"margin-top:14px\">" +
		"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#111827;margin:0 0 8px 0\">Addresses</div>" +
		"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:separate;border-spacing:0 10px\">" +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px;vertical-align:top\">Shipping</td><td style=\"font-size:13px\">%s</td></tr>", escapeMultiline(fallbackStr(strings.TrimSpace(order.ShippingAddress), "-"))) +
		fmt.Sprintf("<tr><td style=\"width:180px;color:#6b7280;font-size:13px;vertical-align:top\">Billing</td><td style=\"font-size:13px\">%s</td></tr>", escapeMultiline(fallbackStr(strings.TrimSpace(order.BillingAddress), "-"))) +
		"</table>" +
		"</div>" +
		itemsHTML +
		"<div style=\"margin-top:14px\">" +
		"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#111827;margin:0 0 8px 0\">Notes</div>" +
		fmt.Sprintf("<div style=\"font-size:13px;color:#111827;white-space:pre-wrap\">%s</div>", escapeHTML(fallbackStr(strings.TrimSpace(order.Notes), "-"))) +
		"</div>" +
		adminBtn +
		trackBtn +
		"</div>" +
		"</div>"

	return subject, text, html
}

func NotifyAdminOrderCreated(db *gorm.DB, siteURL string, orderID uint) error {
	return notifyAdminOrderEvent(db, siteURL, orderID, "created")
}

func NotifyAdminOrderPaid(db *gorm.DB, siteURL string, orderID uint) error {
	return notifyAdminOrderEvent(db, siteURL, orderID, "paid")
}

// Legacy name: kept for compatibility.
func NotifyAdminNewOrderPaid(db *gorm.DB, siteURL string, orderID uint) error {
	return NotifyAdminOrderPaid(db, siteURL, orderID)
}

func notifyAdminOrderEvent(db *gorm.DB, siteURL string, orderID uint, event string) error {
	s, err := GetOrCreateEmailSetting(db)
	if err != nil {
		return err
	}
	if !s.Enabled {
		return nil
	}

	createdEnabled := s.OrderCreatedNotificationsEnabled
	paidEnabled := s.OrderPaidNotificationsEnabled
	// Backward compatibility: old switch enables both when new toggles aren't used.
	if !createdEnabled && !paidEnabled && s.OrderNotificationsEnabled {
		createdEnabled = true
		paidEnabled = true
	}
	if strings.ToLower(strings.TrimSpace(event)) == "paid" {
		if !paidEnabled {
			return nil
		}
	} else {
		if !createdEnabled {
			return nil
		}
	}

	_, recipients, err := NormalizeEmailRecipients(s.OrderNotificationEmails)
	if err != nil {
		return err
	}
	if len(recipients) == 0 {
		return errors.New("order notification emails not configured")
	}

	var order models.Order
	if err := db.Preload("Items.Product").First(&order, orderID).Error; err != nil {
		return err
	}

	subj, txt, html := BuildOrderNotificationEmail(siteURL, order, event)
	evt := strings.ToLower(strings.TrimSpace(event))
	if evt == "" {
		evt = "created"
	}
	headerID := fmt.Sprintf("admin-order-%s:%s:%d", evt, orderNoForHeader(order), order.ID)

	fails := 0
	var lastErr error
	for _, to := range recipients {
		if e := SendEmail(db, EmailSendOptions{To: to, Subject: subj, Text: txt, HTML: html, Headers: map[string]string{"X-Entity-Ref-ID": headerID}}); e != nil {
			fails++
			lastErr = e
		}
	}
	if fails > 0 {
		return fmt.Errorf("order notification: failed to send to %d recipient(s): %v", fails, lastErr)
	}
	return nil
}

func orderNoForHeader(order models.Order) string {
	if strings.TrimSpace(order.OrderNumber) != "" {
		return order.OrderNumber
	}
	return fmt.Sprintf("%d", order.ID)
}
