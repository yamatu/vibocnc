export type EmailModuleType = 'new_arrivals' | 'promotion' | 'replacement' | 'repair_quote';

export type EmailModule = {
  id: string;
  type: EmailModuleType;

  title: string;
  body: string;
  bullets: string[];

  ctaLabel: string;
  ctaUrl: string;

  // Optional fields per module
  badge?: string;
  highlight?: string;
};

export function baseTwoColumnTemplate(opts: {
  subject: string;
  previewText?: string;
  greeting?: string;
  modulesHtml: string;
  rightCardTitle?: string;
  rightLines?: string[];
  primaryUrl?: string;
  primaryLabel?: string;
  secondaryUrl?: string;
  secondaryLabel?: string;
  footerEmail?: string;
  footerPhone?: string;
}): string {
  const {
    subject,
    previewText = '',
    greeting = 'Hello {{full_name}},',
    modulesHtml,
    rightCardTitle = 'Quick Info',
    rightLines = ['Shipping: 24-72h dispatch (most items)', 'Warranty: 3-12 months', 'Service: repair / exchange'],
    primaryUrl = 'https://www.vibocnc.com/products',
    primaryLabel = 'Browse Products',
    secondaryUrl = 'https://www.vibocnc.com/contact',
    secondaryLabel = 'Contact Us',
    footerEmail = 'sales@vibocnc.com',
    footerPhone = '+86 13348028050',
  } = opts;

  const rightList = rightLines
    .filter(Boolean)
    .map((l) => `<div style="margin:6px 0;">${escapeHtml(l)}</div>`)
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
    <style>
      body { margin:0; padding:0; background:#f6f7fb; }
      a { color:#111827; }
      @media (max-width: 640px) {
        .container { width:100% !important; }
        .col { display:block !important; width:100% !important; }
        .col + .col { margin-top:14px !important; }
        .pad { padding:16px !important; }
      }
    </style>
  </head>
  <body>
    <!-- Preview text (hidden) -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(previewText)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
            <tr>
              <td class="pad" style="padding:22px 24px;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#111827;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;">VIBO CNC Spare Parts</div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;opacity:0.9;margin-top:4px;">FANUC CNC Parts • Repair • Exchange</div>
              </td>
            </tr>

            <tr>
              <td class="pad" style="padding:22px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="col" width="62%" valign="top" style="padding-right:14px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;">${greeting}</div>
                      <div style="margin-top:12px;">${modulesHtml}</div>

                      <div style="margin-top:16px;">
                        <a href="${escapeAttr(primaryUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:14px;padding:12px 16px;border-radius:10px;">${escapeHtml(primaryLabel)}</a>
                      </div>

                      <div style="margin-top:12px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;font-size:12px;line-height:1.6;">
                        Need help finding a part? Reply to this email with your part number and photos.
                      </div>
                    </td>

                    <td class="col" width="38%" valign="top" style="padding-left:14px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8e1;border:1px solid #fde68a;border-radius:12px;">
                        <tr>
                          <td style="padding:14px 14px 12px 14px;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#111827;">${escapeHtml(rightCardTitle)}</div>
                            <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#374151;line-height:1.6;">${rightList}</div>
                            <div style="margin-top:12px;border-top:1px dashed #f59e0b;opacity:0.6;"></div>
                            <div style="margin-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#374151;line-height:1.6;">
                              <div><b>Email:</b> ${escapeHtml(footerEmail)}</div>
                              <div><b>WhatsApp:</b> ${escapeHtml(footerPhone)}</div>
                              <div><b>Website:</b> vibocnc.com</div>
                            </div>
                            <div style="margin-top:14px;">
                              <a href="${escapeAttr(secondaryUrl)}" style="display:block;text-align:center;background:#f59e0b;color:#111827;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:13px;padding:10px 12px;border-radius:10px;">${escapeHtml(secondaryLabel)}</a>
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
                <div style="font-family:Arial,Helvetica,sans-serif;color:#6b7280;font-size:12px;line-height:1.6;">VIBO CNC Spare Parts • ${escapeHtml(footerEmail)}</div>
                <div style="margin-top:6px;font-family:Arial,Helvetica,sans-serif;color:#9ca3af;font-size:11px;line-height:1.6;">You received this email because you are a customer of VIBO CNC.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderModule(m: EmailModule): string {
  const badge = m.badge ? `<span style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;background:#fef3c7;border:1px solid #fde68a;color:#92400e;padding:4px 8px;border-radius:999px;margin-left:10px;">${escapeHtml(m.badge)}</span>` : '';
  const bullets = (m.bullets || []).filter((b) => b.trim() !== '');
  const bulletHtml = bullets.length
    ? `<ul style="margin:10px 0 0 18px;padding:0;font-family:Arial,Helvetica,sans-serif;color:#374151;font-size:14px;line-height:1.6;">
        ${bullets.map((b) => `<li style="margin:6px 0;">${escapeHtml(b)}</li>`).join('')}
      </ul>`
    : '';

  const highlight = m.highlight
    ? `<div style="margin-top:10px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111827;">
        ${escapeHtml(m.highlight)}
      </div>`
    : '';

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin:0 0 14px 0;">
    <tr>
      <td style="padding:14px 14px 12px 14px;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;color:#111827;">${escapeHtml(m.title)}${badge}</div>
        <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;color:#374151;font-size:14px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(m.body)}</div>
        ${highlight}
        ${bulletHtml}
        <div style="margin-top:12px;">
          <a href="${escapeAttr(m.ctaUrl)}" style="display:inline-block;background:#f59e0b;color:#111827;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:13px;padding:10px 12px;border-radius:10px;">${escapeHtml(m.ctaLabel)}</a>
        </div>
      </td>
    </tr>
  </table>`;
}

export function defaultModule(type: EmailModuleType): Omit<EmailModule, 'id'> {
  switch (type) {
    case 'new_arrivals':
      return {
        type,
        title: 'New Arrivals (Ready to Ship)',
        badge: 'NEW',
        body: 'We just added fresh FANUC stock. If you need quick delivery, reply with part numbers and quantities.',
        bullets: ['Servo drives / amplifiers', 'PCB boards', 'I/O modules', 'Motors & encoders'],
        ctaLabel: 'View new stock',
        ctaUrl: 'https://www.vibocnc.com/products',
      };
    case 'promotion':
      return {
        type,
        title: 'Limited-time Promotion',
        badge: 'SALE',
        body: 'Save on selected items this week. We can also quote bundle pricing for multiple part numbers.',
        bullets: ['Bulk discount available', 'Fast worldwide shipping', 'Warranty included'],
        highlight: 'TIP: Add your coupon code / discount details here.',
        ctaLabel: 'Get a quote',
        ctaUrl: 'https://www.vibocnc.com/contact',
      };
    case 'replacement':
      return {
        type,
        title: 'Out-of-stock Replacement Suggestions',
        badge: 'ALT',
        body: 'If your part is discontinued or unavailable, we can recommend compatible alternatives or exchange units.',
        bullets: ['Compatibility check by part number', 'Cross-reference options', 'Exchange & repair available'],
        ctaLabel: 'Send part number',
        ctaUrl: 'https://www.vibocnc.com/contact',
      };
    case 'repair_quote':
      return {
        type,
        title: 'Repair Quote (FANUC)',
        badge: 'REPAIR',
        body: 'We provide repair service for FANUC drives/PCBs. Send photos of the label and fault description to get a quote.',
        bullets: ['Diagnostics + repair', 'Turnaround 3-7 working days', 'Warranty after repair'],
        highlight: 'TIP: Add target model and symptoms here.',
        ctaLabel: 'Request repair quote',
        ctaUrl: 'https://www.vibocnc.com/contact',
      };
  }
}

export function buildEmailHtml(subject: string, modules: EmailModule[]): { html: string; text: string } {
  const modulesHtml = modules.map(renderModule).join('\n');
  const html = baseTwoColumnTemplate({
    subject,
    previewText: subject,
    modulesHtml,
  });

  const textLines: string[] = [];
  textLines.push('VIBO CNC Spare Parts');
  textLines.push('');
  for (const m of modules) {
    textLines.push(m.title);
    textLines.push(m.body);
    for (const b of m.bullets || []) {
      if (b.trim()) textLines.push(`- ${b.trim()}`);
    }
    textLines.push(m.ctaLabel + ': ' + m.ctaUrl);
    textLines.push('');
  }
  textLines.push('Contact: sales@vibocnc.com');

  return { html, text: textLines.join('\n') };
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/\s+/g, ' ').trim();
}
