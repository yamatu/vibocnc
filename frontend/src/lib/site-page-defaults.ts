export interface SitePageDefault {
  pageKey: string;
  title: string;
  summary: string;
  metaDescription: string;
  metaKeywords: string;
  content: string;
}

export const sitePageDefaults: SitePageDefault[] = [
  { pageKey: 'privacy', title: 'Privacy Policy', summary: 'How Vibocnc collects, uses, and protects personal information.', metaDescription: 'Learn how Vibocnc protects personal information and handles data for customers purchasing CNC and industrial automation parts.', metaKeywords: 'privacy policy, data protection, CNC parts, Vibocnc', content: `## Information We Collect

We collect information you provide when placing an order, requesting a quote, contacting support, creating an account, or subscribing to updates. This may include your name, company, email address, phone number, billing and shipping details, and order information.

## How We Use Information

- Process orders, payments, shipping, and customer service requests
- Respond to product, compatibility, and technical support questions
- Improve website security, performance, and customer experience
- Send service updates or marketing messages when permitted

## Data Sharing

We share information only with service providers needed to operate our business, such as payment processors, shipping carriers, hosting providers, and email services. We do not sell personal information.

## Data Security and Retention

We use reasonable technical and organizational safeguards. Information is retained only as long as needed for business, legal, tax, fraud-prevention, and support purposes.

## Your Choices

You may request access, correction, or deletion of personal information where applicable. You may unsubscribe from marketing messages at any time.

## Contact

For privacy questions, contact [sales@vibocnc.com](mailto:sales@vibocnc.com).` },
  { pageKey: 'terms', title: 'Terms of Service', summary: 'Terms that apply when using the Vibocnc website and purchasing products.', metaDescription: 'Read Vibocnc terms for orders, payment, shipping, returns, warranties, website use, and industrial automation parts purchases.', metaKeywords: 'terms of service, CNC parts terms, Vibocnc purchase policy', content: `## Acceptance of Terms

By using this website or purchasing from Vibocnc, you agree to these terms. Product quotations, invoices, and separately agreed written terms may also apply.

## Products and Availability

Product descriptions and compatibility information are provided in good faith. Availability, condition, lead time, and specifications should be confirmed before purchase when they are critical to your application.

## Pricing and Payment

Prices may change before an order is confirmed. Shipping, taxes, duties, and customs charges are excluded unless stated otherwise. Payment must follow the terms shown on the accepted quotation or invoice.

## Shipping and Delivery

Delivery dates are estimates unless expressly guaranteed in writing. Risk transfers according to the shipping terms on the order documents.

## Returns and Warranty

Returns require prior authorization and are subject to the published returns and warranty policies. Special-order, configured, used, or opened items may have additional restrictions.

## Limitation of Liability

To the extent permitted by law, liability is limited to the amount paid for the affected product. Vibocnc is not responsible for indirect or consequential loss, production downtime, or incorrect installation.

## Contact

Questions may be sent to [sales@vibocnc.com](mailto:sales@vibocnc.com).` },
  { pageKey: 'warranty-policy', title: 'Warranty Policy', summary: 'Coverage, exclusions, and claims process for products supplied by Vibocnc.', metaDescription: 'Review warranty coverage, exclusions, and the claims process for Vibocnc industrial automation and CNC parts.', metaKeywords: 'warranty policy, FANUC parts warranty, CNC repair claim', content: `## Coverage

- Standard coverage is 12 months unless the quotation or product page states otherwise
- Coverage applies to verified functional defects under normal operating conditions
- Repair, replacement, or another appropriate remedy is determined after inspection

Warranty coverage depends on the product condition, manufacturer, and quotation.

## Exclusions

- Incorrect installation, wiring, storage, or operation
- Physical damage, contamination, moisture, surge, or overheating
- Unauthorized repair, modification, or disassembly
- Normal wear or failure elsewhere in the machine

## Claims Process

1. Contact us with your order number, product SKU, and serial number when available.
2. Provide a clear fault description plus photos or video where possible.
3. Follow the issued return and packaging instructions.
4. We inspect the item and confirm the available remedy.

Do not return an item until return instructions are issued. See our [Returns & Refunds Policy](/returns) for return eligibility and refund terms.

## Contact

Email [sales@vibocnc.com](mailto:sales@vibocnc.com) for warranty support.` },
  { pageKey: 'shipping-policy', title: 'Shipping Policy', summary: 'Shipping destinations, handling times, carriers, tracking, and customs information.', metaDescription: 'Shipping policy for Vibocnc orders, including handling, worldwide delivery, tracking, packaging, duties, and customs.', metaKeywords: 'shipping policy, CNC parts delivery, worldwide industrial parts shipping', content: `## Handling Times

In-stock items are normally dispatched within 1-2 business days after payment and order verification. Lead times for backordered or special-order products are confirmed separately.

## Destinations and Carriers

We ship worldwide using established express and freight carriers selected according to destination, package size, and urgency. Tracking details are provided when available.

## Packaging

Electronic products are packed with suitable anti-static and protective materials. Customers should report visible transit damage promptly and retain the original packaging.

## Duties and Customs

Unless otherwise agreed, import duties, taxes, brokerage charges, and customs requirements are the recipient's responsibility.` },
  { pageKey: 'returns', title: 'Returns Policy', summary: 'Eligibility, authorization, inspection, and refund terms for product returns.', metaDescription: 'Read Vibocnc return eligibility, authorization, inspection, refund, and shipping requirements for CNC and automation parts.', metaKeywords: 'returns policy, CNC parts return, industrial parts refund', content: `## Return Authorization

Contact us before returning any product. Unauthorized returns may be refused. Provide the order number, SKU, reason for return, and product condition.

## Eligibility

Unused standard-stock products may be eligible for return when requested within 30 days of delivery. Special-order, configured, damaged, installed, opened, or used products may not be returnable unless defective.

## Inspection and Refunds

Returned products are inspected before a refund or credit is approved. Original shipping charges, import costs, and return shipping are generally non-refundable unless the return results from our error or a confirmed defect.

## Packaging

Use protective packaging appropriate for industrial electronics and include all accessories supplied with the product.` },
  { pageKey: 'technical-support', title: 'Technical Support', summary: 'Product selection, compatibility, troubleshooting, and remote support.', metaDescription: 'Get product selection, compatibility, troubleshooting, and remote technical support for CNC and industrial automation parts.', metaKeywords: 'technical support, CNC troubleshooting, industrial automation support', content: `## How We Help

- Product identification and replacement selection
- Compatibility and specification review
- Installation and troubleshooting guidance
- Remote review of fault descriptions, photos, and video

## Before Contacting Support

Prepare the product SKU, machine model, control model, alarm code, serial number, and a description of recent changes or failure conditions.

## Contact

Email [sales@vibocnc.com](mailto:sales@vibocnc.com) or call [+86 13348028050](tel:+8613348028050).` },
];

export function getSitePageDefault(pageKey: string) {
  return sitePageDefaults.find((page) => page.pageKey === pageKey);
}
