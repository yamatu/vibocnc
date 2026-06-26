package services

import (
	"fmt"
	"strings"
	"time"

	"fanuc-backend/models"
)

func carrierTrackingURL(carrier string, tracking string) string {
	c := strings.ToLower(strings.TrimSpace(carrier))
	t := strings.TrimSpace(tracking)
	if t == "" {
		return ""
	}
	switch {
	case strings.Contains(c, "dhl"):
		return fmt.Sprintf("https://www.dhl.com/global-en/home/tracking.html?tracking-id=%s", t)
	case strings.Contains(c, "fedex"):
		return fmt.Sprintf("https://www.fedex.com/fedextrack/?trknbr=%s", t)
	case strings.Contains(c, "ups"):
		return fmt.Sprintf("https://www.ups.com/track?tracknum=%s", t)
	case strings.Contains(c, "usps"):
		return fmt.Sprintf("https://tools.usps.com/go/TrackConfirmAction?tLabels=%s", t)
	default:
		return ""
	}
}

func BuildShipmentNotificationEmail(siteURL string, order models.Order) (subject, text, html string) {
	orderNo := order.OrderNumber
	if orderNo == "" {
		orderNo = fmt.Sprintf("ORDER-%d", order.ID)
	}
	carrier := strings.TrimSpace(order.ShippingCarrier)
	tracking := strings.TrimSpace(order.TrackingNumber)
	trackPage := ""
	if strings.TrimSpace(siteURL) != "" {
		trackPage = strings.TrimRight(siteURL, "/") + "/orders/track/" + orderNo
	}
	carrierURL := carrierTrackingURL(carrier, tracking)

	shippedAt := ""
	if order.ShippedAt != nil {
		shippedAt = order.ShippedAt.UTC().Format(time.RFC3339)
	}

	subject = fmt.Sprintf("Your order %s has shipped", orderNo)

	// Build items list
	itemLines := make([]string, 0)
	if len(order.Items) > 0 {
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
			itemLines = append(itemLines, fmt.Sprintf("- %s | %s x%d", sku, name, it.Quantity))
		}
	}

	itemsText := ""
	if len(itemLines) > 0 {
		itemsText = "\nItems:\n" + strings.Join(itemLines, "\n") + "\n"
	}

	text = fmt.Sprintf(
		"VIBO CNC\n\nGood news - your order %s has shipped.\n\nCarrier: %s\nTracking number: %s\n%s\nTrack your order: %s\n%s\n\nIf you have any questions, reply to this email.\n\n--\nVIBO CNC Spare Parts\n",
		orderNo,
		fallbackStr(carrier, "(not specified)"),
		fallbackStr(tracking, "(not specified)"),
		itemsText,
		fallbackStr(trackPage, ""),
		optionalLine("Carrier tracking", carrierURL),
	)

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
					"</tr>")
		}

		itemsHTML = "<div style=\"margin-top:14px\">" +
			"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#111827;margin:0 0 8px 0\">Items in this shipment</div>" +
			"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden\">" +
			"<tr>" +
			"<th align=\"left\" style=\"padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">SKU</th>" +
			"<th align=\"left\" style=\"padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">Item</th>" +
			"<th align=\"right\" style=\"padding:8px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">Qty</th>" +
			"</tr>" +
			strings.Join(rows, "") +
			"</table>" +
			"</div>"
	}

	html = "<div style=\"font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;line-height:1.6;color:#111827\">" +
		"<div style=\"padding:18px 20px;background:linear-gradient(135deg,#f59e0b,#fbbf24);border-radius:14px 14px 0 0;\">" +
		"<div style=\"font-size:18px;font-weight:800\">VIBO CNC Spare Parts</div>" +
		"<div style=\"font-size:13px;opacity:0.9;margin-top:4px\">Shipping update</div>" +
		"</div>" +
		"<div style=\"border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:18px 20px;background:#fff\">" +
		fmt.Sprintf("<p style=\"margin:0 0 10px 0\">Good news - your order <b>%s</b> has shipped.</p>", escapeHTML(orderNo)) +
		"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;border-collapse:separate;border-spacing:0 8px\">" +
		fmt.Sprintf("<tr><td style=\"width:160px;color:#6b7280;font-size:13px\">Carrier</td><td style=\"font-size:14px;font-weight:700\">%s</td></tr>", escapeHTML(fallbackStr(carrier, "-"))) +
		fmt.Sprintf("<tr><td style=\"width:160px;color:#6b7280;font-size:13px\">Tracking number</td><td style=\"font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace\">%s</td></tr>", escapeHTML(fallbackStr(tracking, "-")))

	// Optional rows/links
	shippedRow := ""
	if shippedAt != "" {
		shippedRow = fmt.Sprintf("<tr><td style=\"width:160px;color:#6b7280;font-size:13px\">Shipped at</td><td style=\"font-size:14px\">%s</td></tr>", escapeHTML(shippedAt))
	}
	trackBtn := ""
	if trackPage != "" {
		trackBtn = fmt.Sprintf("<p style=\"margin:14px 0 0 0\"><a href=\"%s\" style=\"display:inline-block;background:#111827;color:#fff;text-decoration:none;font-weight:800;font-size:13px;padding:10px 12px;border-radius:10px\">Track order</a></p>", escapeAttr(trackPage))
	}
	carrierLink := ""
	if carrierURL != "" {
		carrierLink = fmt.Sprintf("<p style=\"margin:10px 0 0 0\"><a href=\"%s\" style=\"color:#111827\">Carrier tracking page</a></p>", escapeAttr(carrierURL))
	}

	html = html +
		shippedRow +
		"</table>" +
		itemsHTML +
		trackBtn +
		carrierLink +
		"<p style=\"margin:14px 0 0 0;font-size:12px;color:#6b7280\">If you have any questions, reply to this email.</p>" +
		"</div>" +
		"</div>"

	return subject, text, html
}

func fallbackStr(s, fb string) string {
	ss := strings.TrimSpace(s)
	if ss == "" {
		return fb
	}
	return ss
}

func optionalLine(label, url string) string {
	if strings.TrimSpace(url) == "" {
		return ""
	}
	return fmt.Sprintf("%s: %s\n", label, url)
}

func escapeHTML(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;")
	return r.Replace(s)
}

func escapeAttr(s string) string {
	return escapeHTML(strings.TrimSpace(s))
}
