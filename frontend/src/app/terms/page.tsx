import { Metadata } from 'next';
import Layout from '@/components/layout/Layout';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service | VIBO CNC - FANUC CNC Parts & Automation Components',
  description: 'Read our terms and conditions for purchasing FANUC CNC parts and automation components from VIBO CNC. Learn about our policies and guidelines.',
  keywords: 'terms of service, conditions, FANUC parts, CNC components, automation, VIBO CNC, purchase policy',
  openGraph: {
    title: 'Terms of Service | VIBO CNC',
    description: 'Read our terms and conditions for purchasing FANUC CNC parts and automation components.',
    type: 'website',
    url: 'https://www.vibocnc.com/terms',
  },
  alternates: {
    canonical: 'https://www.vibocnc.com/terms',
  },
};

export default function TermsPage() {
  return (
    <Layout>
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav className="flex mb-8" aria-label="Breadcrumb">
            <ol className="inline-flex items-center space-x-1 md:space-x-3">
              <li className="inline-flex items-center">
                <Link href="/" className="text-gray-700 hover:text-blue-600">
                  Home
                </Link>
              </li>
              <li>
                <div className="flex items-center">
                  <span className="mx-2 text-gray-400">/</span>
                  <span className="text-gray-500">Terms of Service</span>
                </div>
              </li>
            </ol>
          </nav>

          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Terms of Service</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-gray-600 mb-6">
                <strong>Last updated:</strong> {new Date().toLocaleDateString()}
              </p>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Acceptance of Terms</h2>
                <p className="text-gray-700">
                  By accessing and using VIBO CNC's website and services, you accept and agree to be bound by
                  these Terms of Service. If you do not agree to these terms, please do not use our services
                  for purchasing FANUC CNC parts and automation components.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. Products and Services</h2>
                <p className="text-gray-700 mb-4">
                  VIBO CNC specializes in providing high-quality FANUC CNC parts and automation components including:
                </p>
                <ul className="list-disc pl-6 text-gray-700 mb-4">
                  <li>FANUC Amplifiers and Servo Motors</li>
                  <li>CNC Control Systems and Modules</li>
                  <li>Encoders and Feedback Systems</li>
                  <li>PLC Modules and Industrial Automation Components</li>
                  <li>Technical Support and Maintenance Services</li>
                </ul>
                <p className="text-gray-700">
                  All products are subject to availability and we reserve the right to modify or discontinue
                  any product without notice.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Pricing and Payment</h2>
                <p className="text-gray-700 mb-4">
                  All prices are listed in USD and are subject to change without notice. Payment terms include:
                </p>
                <ul className="list-disc pl-6 text-gray-700">
                  <li>Payment must be made in full before shipment</li>
                  <li>We accept major credit cards, bank transfers, and approved payment methods</li>
                  <li>Prices do not include shipping, taxes, or customs duties</li>
                  <li>Special pricing may apply for bulk orders of FANUC parts</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Shipping and Delivery</h2>
                <p className="text-gray-700 mb-4">
                  We provide global shipping for FANUC CNC parts and automation components:
                </p>
                <ul className="list-disc pl-6 text-gray-700">
                  <li>Shipping costs are calculated based on destination and package weight</li>
                  <li>Delivery times vary by location and shipping method selected</li>
                  <li>Risk of loss transfers to buyer upon delivery to carrier</li>
                  <li>International shipments may be subject to customs delays and duties</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Returns and Warranties</h2>
                <p className="text-gray-700 mb-4">
                  Our return and warranty policy for FANUC parts includes:
                </p>
                <ul className="list-disc pl-6 text-gray-700">
                  <li>30-day return policy for unused items in original packaging</li>
                  <li>Warranty terms vary by product and manufacturer specifications</li>
                  <li>Custom or special-order items may not be returnable</li>
                  <li>Return shipping costs are the responsibility of the buyer unless item is defective</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Intellectual Property</h2>
                <p className="text-gray-700">
                  All content on this website, including product descriptions, images, and technical specifications
                  for FANUC parts, is protected by copyright and other intellectual property laws. FANUC is a
                  registered trademark of FANUC Corporation.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Limitation of Liability</h2>
                <p className="text-gray-700">
                  VIBO CNC's liability is limited to the purchase price of the products. We are not liable for
                  indirect, incidental, or consequential damages arising from the use of FANUC CNC parts or
                  automation components purchased from us.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Technical Support</h2>
                <p className="text-gray-700">
                  We provide technical support for FANUC parts and automation components to help ensure
                  proper installation and operation. Support is available during business hours and may
                  include product specifications, compatibility guidance, and troubleshooting assistance.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">9. Governing Law</h2>
                <p className="text-gray-700">
                  These terms are governed by the laws of China. Any disputes will be resolved through
                  arbitration in Kunshan, Jiangsu Province, China.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">10. Contact Information</h2>
                <p className="text-gray-700 mb-4">
                  For questions about these Terms of Service or our FANUC parts and services:
                </p>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-700"><strong>Email:</strong> sales@vibocnc.com</p>
                  <p className="text-gray-700"><strong>Phone:</strong> +86 13348028050</p>
                  <p className="text-gray-700"><strong>Address:</strong> Kunshan, Jiangsu Province, China</p>
                  <p className="text-gray-700"><strong>Business Hours:</strong> Mon-Fri: 8:00 AM - 6:00 PM (CST)</p>
                </div>
              </section>
            </div>

            {/* Related Links */}
            <div className="mt-12 pt-8 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Related Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Link
                  href="/privacy"
                  className="block p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <h4 className="font-semibold text-blue-900">Privacy Policy</h4>
                  <p className="text-blue-700 text-sm">How we protect your data</p>
                </Link>
                <Link
                  href="/warranty"
                  className="block p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                >
                  <h4 className="font-semibold text-green-900">Warranty Info</h4>
                  <p className="text-green-700 text-sm">Product warranty details</p>
                </Link>
                <Link
                  href="/returns"
                  className="block p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
                >
                  <h4 className="font-semibold text-purple-900">Returns Policy</h4>
                  <p className="text-purple-700 text-sm">Return and exchange info</p>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
