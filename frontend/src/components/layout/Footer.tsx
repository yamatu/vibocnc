'use client';

import Link from 'next/link';
import { getSiteUrl } from '@/lib/url';
import { 
  PhoneIcon, 
  EnvelopeIcon, 
  MapPinIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

const footerNavigation = {
  products: [
    { name: 'FANUC Amplifiers', href: '/products?search=amplifier' },
    { name: 'Servo Motors', href: '/products?search=servo%20motor' },
    { name: 'Encoders', href: '/products?search=encoder' },
    { name: 'PLC Modules', href: '/products?search=plc' },
    { name: 'CNC Inverters', href: '/products?search=inverter' },
  ],
  services: [
    { name: 'FANUC Parts Sales', href: '/about' },
    { name: 'Testing Service', href: '/about' },
    { name: 'Maintenance Service', href: '/about' },
    { name: 'Technical Support', href: '/contact' },
    { name: 'Global Shipping', href: '/contact' },
  ],
  company: [
    { name: 'About Vcocnc', href: '/about' },
    { name: 'Product Categories', href: '/products' },
    { name: 'FANUC Partners', href: '/about' },
    { name: 'Our Workshop', href: '/about' },
    { name: 'Company Profile', href: '/about' },
  ],
  support: [
    { name: 'Contact Us', href: '/contact' },
    { name: 'FAQ', href: '/faq' },
    { name: 'Documentation', href: '/docs' },
    { name: 'Warranty Policy', href: '/warranty-policy' },
    { name: 'Shipping Policy', href: '/shipping-policy' },
    { name: 'Technical Support', href: '/technical-support' },
    { name: 'Returns Policy', href: '/returns' },
  ],
  partners: [
    { name: 'Vcocnc Main Site', href: 'https://www.vcocnc.shop', external: true },
    { name: 'FANUC Official', href: 'https://www.fanuc.com', external: true },
    { name: 'Industrial Partners', href: '/about' },
    { name: 'Authorized Dealers', href: '/contact' },
  ],
};

import { useState } from 'react';

export function Footer() {
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const siteUrl = getSiteUrl();

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = new URL(siteUrl || window.location.origin);
      url.pathname = '/contact';
      if (newsletterEmail && newsletterEmail.trim()) {
        url.searchParams.set('email', newsletterEmail.trim());
      }
      window.location.href = url.toString();
    } catch (_) {
      // Fallback to relative navigation
      const qs = newsletterEmail && newsletterEmail.trim() ? `?email=${encodeURIComponent(newsletterEmail.trim())}` : '';
      window.location.href = `/contact${qs}`;
    }
  };
  return (
    <footer className="bg-gray-900 text-white">
      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8">
          {/* Company Info */}
          <div className="lg:col-span-2">
            <div className="flex items-center space-x-3 mb-6">
              <div className="bg-yellow-500 text-black px-4 py-2 rounded-lg font-bold text-xl">
                Vcocnc
              </div>
              <div>
                <div className="text-xl font-bold">CNC Solutions</div>
                <div className="text-sm text-gray-400">Since 2005</div>
              </div>
            </div>

            <p className="text-gray-300 mb-6 max-w-md">
              Vcocnc is a one-stop CNC solution supplier established in 2005 in Kunshan, China.
              We are selling automation components of AB, ABB, Fanuc, Mitsubishi, Siemens and
              other manufacturers with professional expertise.
            </p>

            {/* Contact Info */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <MapPinIcon className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                <span className="text-gray-300">
                  Kunshan, Jiangsu Province, China
                </span>
              </div>

              <div className="flex items-center space-x-3">
                <PhoneIcon className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                <span className="text-gray-300">+86 13348028050</span>
              </div>

              <div className="flex items-center space-x-3">
                <EnvelopeIcon className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                <span className="text-gray-300">sales@vcocncspare.com</span>
              </div>

              <div className="flex items-center space-x-3">
                <ClockIcon className="h-5 w-5 text-yellow-400 flex-shrink-0" />
                <span className="text-gray-300">Mon-Fri: 8:00 AM - 6:00 PM</span>
              </div>
            </div>
          </div>

          {/* Products */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Products</h3>
            <ul className="space-y-2">
              {footerNavigation.products.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="text-gray-300 hover:text-white transition-colors duration-200"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Services */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Services</h3>
            <ul className="space-y-2">
              {footerNavigation.services.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="text-gray-300 hover:text-white transition-colors duration-200"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Support</h3>
            <ul className="space-y-2">
              {footerNavigation.support.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="text-gray-300 hover:text-white transition-colors duration-200"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Partners & Links */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Partners</h3>
            <ul className="space-y-2">
              {footerNavigation.partners.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="text-gray-300 hover:text-white transition-colors duration-200 flex items-center"
                  >
                    {item.name}
                    {item.external && (
                      <svg className="w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                        <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
                      </svg>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Newsletter Signup */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="max-w-md">
            <h3 className="text-lg font-semibold mb-4">Stay Updated</h3>
            <p className="text-gray-300 mb-4">
              Subscribe to our newsletter for the latest automation components and industry updates.
            </p>
            <form className="flex" onSubmit={handleSubscribe}>
              <input
                type="email"
                placeholder="Enter your email"
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-l-md focus:outline-none focus:ring-2 focus:ring-yellow-500 text-white placeholder-gray-400"
              />
              <button
                type="submit"
                className="px-6 py-2 bg-yellow-500 text-black rounded-r-md hover:bg-yellow-600 transition-colors duration-200 font-semibold"
              >
                Subscribe
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="text-gray-400 text-sm">
              © 2024 Vcocnc. All rights reserved.
            </div>
            
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 md:mt-0">
              <Link
                href="/privacy"
                className="text-gray-400 hover:text-white text-sm transition-colors duration-200"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-gray-400 hover:text-white text-sm transition-colors duration-200"
              >
                Terms of Service
              </Link>
              <Link
                href="/sitemap.xml"
                className="text-gray-400 hover:text-white text-sm transition-colors duration-200"
              >
                Sitemap
              </Link>
              <Link
                href="https://www.vcocnc.shop"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white text-sm transition-colors duration-200 flex items-center"
              >
                Vcocnc.shop
                <svg className="w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
                </svg>
              </Link>
              <Link
                href="/products"
                className="text-gray-400 hover:text-white text-sm transition-colors duration-200"
              >
                Product Categories
              </Link>
              <Link
                href="/products"
                className="text-gray-400 hover:text-white text-sm transition-colors duration-200"
              >
                All Products
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
