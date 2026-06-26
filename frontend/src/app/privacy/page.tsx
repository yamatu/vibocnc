import { Metadata } from 'next';
import Layout from '@/components/layout/Layout';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | VIBO CNC - FANUC CNC Parts & Automation Components',
  description: 'Learn about how VIBO CNC protects your privacy and handles your personal information when you shop for FANUC CNC parts and automation components.',
  keywords: 'privacy policy, data protection, FANUC parts, CNC components, automation, VIBO CNC',
  openGraph: {
    title: 'Privacy Policy | VIBO CNC',
    description: 'Learn about how VIBO CNC protects your privacy and handles your personal information.',
    type: 'website',
    url: 'https://www.vibocnc.com/privacy',
  },
  alternates: {
    canonical: 'https://www.vibocnc.com/privacy',
  },
};

export default function PrivacyPage() {
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
                  <span className="text-gray-500">Privacy Policy</span>
                </div>
              </li>
            </ol>
          </nav>

          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">Privacy Policy</h1>

            <div className="prose prose-lg max-w-none">
              <p className="text-gray-600 mb-6">
                <strong>Last updated:</strong> {new Date().toLocaleDateString()}
              </p>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">1. Information We Collect</h2>
                <p className="text-gray-700 mb-4">
                  At VIBO CNC, we collect information you provide directly to us, such as when you:
                </p>
                <ul className="list-disc pl-6 text-gray-700 mb-4">
                  <li>Create an account or make a purchase</li>
                  <li>Subscribe to our newsletter</li>
                  <li>Contact us for support or inquiries</li>
                  <li>Browse our website and interact with our content</li>
                </ul>
                <p className="text-gray-700">
                  This may include your name, email address, phone number, shipping address,
                  payment information, and details about your FANUC CNC parts and automation component needs.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">2. How We Use Your Information</h2>
                <p className="text-gray-700 mb-4">We use the information we collect to:</p>
                <ul className="list-disc pl-6 text-gray-700">
                  <li>Process and fulfill your orders for FANUC parts and CNC components</li>
                  <li>Provide customer support and technical assistance</li>
                  <li>Send you important updates about your orders and our services</li>
                  <li>Improve our website and product offerings</li>
                  <li>Comply with legal obligations and protect our rights</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">3. Information Sharing</h2>
                <p className="text-gray-700 mb-4">
                  We do not sell, trade, or otherwise transfer your personal information to third parties
                  without your consent, except as described in this policy:
                </p>
                <ul className="list-disc pl-6 text-gray-700">
                  <li>With service providers who assist us in operating our website and conducting business</li>
                  <li>When required by law or to protect our rights and safety</li>
                  <li>In connection with a business transfer or merger</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">4. Data Security</h2>
                <p className="text-gray-700">
                  We implement appropriate security measures to protect your personal information against
                  unauthorized access, alteration, disclosure, or destruction. However, no method of
                  transmission over the internet is 100% secure.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">5. Cookies and Tracking</h2>
                <p className="text-gray-700">
                  We use cookies and similar tracking technologies to enhance your browsing experience,
                  analyze website traffic, and understand user preferences for FANUC parts and automation components.
                </p>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">6. Your Rights</h2>
                <p className="text-gray-700 mb-4">You have the right to:</p>
                <ul className="list-disc pl-6 text-gray-700">
                  <li>Access and update your personal information</li>
                  <li>Request deletion of your data</li>
                  <li>Opt out of marketing communications</li>
                  <li>Request a copy of your data</li>
                </ul>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">7. Contact Us</h2>
                <p className="text-gray-700 mb-4">
                  If you have any questions about this Privacy Policy or our data practices, please contact us:
                </p>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-gray-700"><strong>Email:</strong> sales@vibocnc.com</p>
                  <p className="text-gray-700"><strong>Phone:</strong> +86 13348028050</p>
                  <p className="text-gray-700"><strong>Address:</strong> Kunshan, Jiangsu Province, China</p>
                </div>
              </section>

              <section className="mb-8">
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">8. Changes to This Policy</h2>
                <p className="text-gray-700">
                  We may update this Privacy Policy from time to time. We will notify you of any changes
                  by posting the new Privacy Policy on this page and updating the "Last updated" date.
                </p>
              </section>
            </div>

            {/* Related Links */}
            <div className="mt-12 pt-8 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Related Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link
                  href="/terms"
                  className="block p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <h4 className="font-semibold text-blue-900">Terms of Service</h4>
                  <p className="text-blue-700 text-sm">Read our terms and conditions</p>
                </Link>
                <Link
                  href="/contact"
                  className="block p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                >
                  <h4 className="font-semibold text-green-900">Contact Us</h4>
                  <p className="text-green-700 text-sm">Get in touch with our team</p>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
