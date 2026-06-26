'use client';

import Link from 'next/link';
import { getSiteUrl } from '@/lib/url';
import {
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';

const footerNavigation = {
  products: [
    { name: 'FANUC Amplifiers', href: '/categories/servo-motors' },
    { name: 'Servo Motors', href: '/categories/servo-motors' },
    { name: 'Encoders', href: '/categories/servo-motors' },
    { name: 'PLC Modules', href: '/categories/io-modules' },
    { name: 'CNC Inverters', href: '/categories/power-supplies' },
  ],
  services: [
    { name: 'FANUC Parts Sales', href: '/about' },
    { name: 'Testing Service', href: '/about' },
    { name: 'Maintenance Service', href: '/about' },
    { name: 'Technical Support', href: '/contact' },
    { name: 'Global Shipping', href: '/contact' },
  ],
  company: [
    { name: 'About VIBO CNC', href: '/about' },
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
    { name: 'VIBO CNC Main Site', href: 'https://www.vibocnc.com', external: true },
    { name: 'FANUC Official', href: 'https://www.fanuc.com', external: true },
    { name: 'Industrial Partners', href: '/about' },
    { name: 'Authorized Dealers', href: '/contact' },
  ],
};

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
    } catch {
      // Fallback to relative navigation
      const qs = newsletterEmail && newsletterEmail.trim() ? `?email=${encodeURIComponent(newsletterEmail.trim())}` : '';
      window.location.href = `/contact${qs}`;
    }
  };
  return (
    <footer className="bg-slate-950 text-white">
      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8">
          {/* Company Info */}
          <div className="lg:col-span-2">
            <div className="flex items-center space-x-3 mb-6">
              <div className="bg-white text-slate-950 px-4 py-2 rounded-md font-black text-xl tracking-wide">
                <span className="text-[#003a78]">Vibo</span><span className="text-orange-500">cnc</span>
              </div>
              <div>
                <div className="text-xl font-bold">CNC Parts Hub</div>
                <div className="text-sm text-slate-400">Since 2005</div>
              </div>
            </div>

            <p className="text-slate-300 mb-6 max-w-md">
              VIBO CNC is a one-stop CNC solution supplier established in 2005 in Kunshan, China.
              We are selling automation components of AB, ABB, Fanuc, Mitsubishi, Siemens and
              other manufacturers with professional expertise.
            </p>

            {/* Contact Info */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <MapPinIcon className="h-5 w-5 text-orange-300 flex-shrink-0" />
                <span className="text-slate-300">
                  Kunshan, Jiangsu Province, China
                </span>
              </div>

              <div className="flex items-center space-x-3">
                <PhoneIcon className="h-5 w-5 text-orange-300 flex-shrink-0" />
                <span className="text-slate-300">+86 13348028050</span>
              </div>

              <div className="flex items-center space-x-3">
                <EnvelopeIcon className="h-5 w-5 text-orange-300 flex-shrink-0" />
                <span className="text-slate-300">sales@vibocnc.com</span>
              </div>

              <div className="flex items-center space-x-3">
                <ClockIcon className="h-5 w-5 text-orange-300 flex-shrink-0" />
                <span className="text-slate-300">Mon-Fri: 8:00 AM - 6:00 PM</span>
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
                    className="text-slate-300 hover:text-orange-200 transition-colors duration-200"
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
                    className="text-slate-300 hover:text-orange-200 transition-colors duration-200"
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
                    className="text-slate-300 hover:text-orange-200 transition-colors duration-200"
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
                    className="text-slate-300 hover:text-orange-200 transition-colors duration-200 flex items-center"
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
        <div className="mt-12 pt-8 border-t border-slate-800">
          <div className="max-w-md">
            <h3 className="text-lg font-semibold mb-4">Stay Updated</h3>
            <p className="text-slate-300 mb-4">
              Subscribe to our newsletter for the latest automation components and industry updates.
            </p>
            <form className="flex" onSubmit={handleSubscribe}>
              <input
                type="email"
                placeholder="Enter your email"
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                className="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-l-md focus:outline-none focus:ring-2 focus:ring-[#003a78] text-white placeholder-slate-400"
              />
              <button
                type="submit"
                className="px-6 py-2 bg-orange-500 text-white rounded-r-md hover:bg-[#003a78] transition-colors duration-200 font-semibold"
              >
                Subscribe
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="text-slate-400 text-sm">
              Copyright 2024 VIBO CNC. All rights reserved.
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 md:mt-0">
              <Link
                href="/privacy"
                className="text-slate-400 hover:text-white text-sm transition-colors duration-200"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-slate-400 hover:text-white text-sm transition-colors duration-200"
              >
                Terms of Service
              </Link>
              <Link
                href="/sitemap.xml"
                className="text-slate-400 hover:text-white text-sm transition-colors duration-200"
              >
                Sitemap
              </Link>
              <Link
                href="https://www.vibocnc.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white text-sm transition-colors duration-200 flex items-center"
              >
                vibocnc.com
                <svg className="w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
                </svg>
              </Link>
              <Link
                href="/products"
                className="text-slate-400 hover:text-white text-sm transition-colors duration-200"
              >
                Product Categories
              </Link>
              <Link
                href="/products"
                className="text-slate-400 hover:text-white text-sm transition-colors duration-200"
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
