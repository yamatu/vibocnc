'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { ContactService } from '@/services';
import PublicLayout from '@/components/layout/PublicLayout';
import {
  MapPinIcon,
  PhoneIcon,
  EnvelopeIcon,
  ClockIcon,
  BuildingOfficeIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline';

const contactPageSchema = {
  "@context": "https://schema.org",
  "@type": "ContactPage",
  "name": "Contact VIBO CNC",
  "description": "Get in touch with VIBO CNC for FANUC parts inquiries, technical support, and quotes.",
  "url": "https://www.vibocnc.com/contact",
  "mainEntity": {
    "@type": "Organization",
    "name": "VIBO CNC",
    "telephone": "+86-13348028050",
    "email": "sales@vibocnc.com",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Kunshan",
      "addressRegion": "Jiangsu",
      "addressCountry": "CN"
    },
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "opens": "08:00",
        "closes": "18:00"
      },
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Saturday"],
        "opens": "09:00",
        "closes": "17:00"
      }
    ]
  }
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.vibocnc.com" },
    { "@type": "ListItem", "position": 2, "name": "Contact", "item": "https://www.vibocnc.com/contact" }
  ]
};

function ContactContent() {
  const searchParams = useSearchParams();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    subject: '',
    message: '',
    inquiry_type: 'general'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Prefill email from query string (e.g., /contact?email=foo@bar.com)
  useEffect(() => {
    const email = searchParams?.get('email') || '';
    if (email) {
      setFormData((prev) => ({ ...prev, email }));
    }
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await ContactService.submitContact(formData);

      toast.success('Thank you for your message! We will get back to you soon.');
      setFormData({
        name: '',
        email: '',
        company: '',
        phone: '',
        subject: '',
        message: '',
        inquiry_type: 'general'
      });
    } catch (error: any) {
      console.error('Error submitting form:', error);
      toast.error(error.message || 'Failed to send message. Please check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PublicLayout>
      {/* Contact Page Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@graph": [contactPageSchema, breadcrumbSchema] }) }}
      />
      {/* Hero Section */}
      <section className="site-page-hero py-24">
        <div className="site-hero-inner max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="site-hero-kicker mb-5">Contact VIBO CNC</div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6">Contact Us</h1>
            <p className="text-xl md:text-2xl text-blue-100 max-w-3xl mx-auto">
              Get in touch with our expert team for all your automation needs
            </p>
          </div>
        </div>
      </section>

      {/* Contact Information & Form */}
      <section className="site-page-shell py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Contact Information */}
            <div className="lg:col-span-1">
              <h2 className="text-2xl font-bold text-gray-900 mb-8">Get in Touch</h2>

              <div className="space-y-6">
                <div className="flex items-start space-x-4">
                  <MapPinIcon className="h-6 w-6 text-[#0b3e75] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Address</h3>
                    <p className="text-gray-600">
                      Kunshan, Jiangsu Province<br />
                      China
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <PhoneIcon className="h-6 w-6 text-[#0b3e75] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Phone</h3>
                    <p className="text-gray-600">+86 13348028050</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <EnvelopeIcon className="h-6 w-6 text-[#0b3e75] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Email</h3>
                    <p className="text-gray-600">sales@vibocnc.com</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <ClockIcon className="h-6 w-6 text-[#0b3e75] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Business Hours</h3>
                    <p className="text-gray-600">
                      Monday - Friday: 8:00 AM - 6:00 PM<br />
                      Saturday: 9:00 AM - 5:00 PM<br />
                      Sunday: Closed
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <BuildingOfficeIcon className="h-6 w-6 text-[#0b3e75] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Facility</h3>
                    <p className="text-gray-600">5,000 sqm Workshop</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <GlobeAltIcon className="h-6 w-6 text-[#0b3e75] mt-1 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900">Service Area</h3>
                    <p className="text-gray-600">Worldwide Shipping</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <div className="site-detail-panel p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Send us a Message</h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        id="name"
                        name="name"
                        required
                        value={formData.name}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder="Your full name"
                      />
                    </div>

                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        id="email"
                        name="email"
                        required
                        value={formData.email}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder="your.email@company.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-2">
                        Company Name
                      </label>
                      <input
                        type="text"
                        id="company"
                        name="company"
                        value={formData.company}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder="Your company name"
                      />
                    </div>

                    <div>
                      <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        id="phone"
                        name="phone"
                        value={formData.phone}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="inquiry_type" className="block text-sm font-medium text-gray-700 mb-2">
                        Inquiry Type
                      </label>
                      <select
                        id="inquiry_type"
                        name="inquiry_type"
                        value={formData.inquiry_type}
                        onChange={handleChange}
                        className="site-select w-full px-4 py-3"
                      >
                        <option value="general">General Inquiry</option>
                        <option value="parts">Parts Request</option>
                        <option value="repair">Repair Service</option>
                        <option value="support">Technical Support</option>
                        <option value="quote">Request Quote</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                        Subject *
                      </label>
                      <input
                        type="text"
                        id="subject"
                        name="subject"
                        required
                        value={formData.subject}
                        onChange={handleChange}
                        className="site-input w-full px-4 py-3"
                        placeholder="Brief subject of your inquiry"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                      Message *
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      required
                      rows={6}
                      value={formData.message}
                      onChange={handleChange}
                      className="site-input w-full px-4 py-3"
                      placeholder="Please provide details about your requirements, including part numbers if available..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="site-primary-action w-full px-8 py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? 'Sending Message...' : 'Send Message'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Why Choose VIBO CNC?
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6">
              <div className="site-subtle-card w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <ClockIcon className="h-8 w-8 text-[#0b3e75]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Fast Response</h3>
              <p className="text-gray-600">
                Quick response time with professional technical support and quotations within 24 hours.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="site-subtle-card w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <BuildingOfficeIcon className="h-8 w-8 text-[#0b3e75]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Large Inventory</h3>
              <p className="text-gray-600">
                100,000+ items in stock with daily shipments of 50-100 parcels worldwide.
              </p>
            </div>

            <div className="text-center p-6">
              <div className="site-subtle-card w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <GlobeAltIcon className="h-8 w-8 text-[#0b3e75]" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Global Shipping</h3>
              <p className="text-gray-600">
                Worldwide shipping with various transportation options to meet your delivery needs.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

export default function Contact() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-10">Loading...</div>}>
      <ContactContent />
    </Suspense>
  );
}
