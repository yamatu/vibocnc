// Shared homepage defaults used by both public rendering and the admin editor.
// This avoids the admin page starting from an empty state when DB has no rows yet.

export type HeroCTA = { text: string; href: string };
export type HeroSlide = {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  cta: { primary: HeroCTA; secondary: HeroCTA };
};

export type HeroSectionData = {
  autoPlayMs?: number;
  slides: HeroSlide[];
};

export const DEFAULT_HERO_DATA: HeroSectionData = {
  autoPlayMs: 6000,
  slides: [
    {
      id: 1,
      title: 'VIBO CNC Industrial Parts Supply',
      subtitle: 'Automation Components, Tested and Ready to Ship',
      description:
        'VIBO CNC supplies tested automation components including system units, circuit boards, PLC modules, HMI panels, inverters, encoders, amplifiers, servo motors and servo drives for global maintenance teams.',
      image: 'https://s2.loli.net/2025/08/26/Vo4JfbtW5H2GMEN.png',
      cta: {
        primary: { text: 'Browse Products', href: '/products' },
        secondary: { text: 'Learn More', href: '/about' },
      },
    },
    {
      id: 2,
      title: '5,000sqm Testing and Stock Facility',
      subtitle: 'Deep Inventory for CNC Maintenance',
      description:
        'Our team manages more than 100,000 stocked industrial parts with inspection, packaging and export processes built for urgent CNC repair and replacement orders.',
      image: 'https://s2.loli.net/2025/08/26/17MRNhXEcrKTdDY.png',
      cta: {
        primary: { text: 'View Facility', href: '/about' },
        secondary: { text: 'Contact Us', href: '/contact' },
      },
    },
    {
      id: 3,
      title: '20+ Years Industrial Service',
      subtitle: 'Sales, Testing and Maintenance Support',
      description:
        'Our sales and technical teams coordinate sourcing, testing, packing and international shipping so factories can keep production equipment running with less downtime.',
      image: 'https://s2.loli.net/2025/08/26/17MRNhXEcrKTdDY.png',
      cta: {
        primary: { text: 'Get Support', href: '/contact' },
        secondary: { text: 'Browse Products', href: '/products' },
      },
    },
  ],
};

export type CompanyStatItem = {
  id: number;
  icon: string;
  value: number;
  suffix: string;
  label: string;
  description: string;
  color: string;
};

export type CompanyStatsData = {
  headerTitle: string;
  headerDescription: string;
  stats: CompanyStatItem[];
  ctaTitle: string;
  ctaDescription: string;
  ctaPrimary: HeroCTA;
  ctaSecondary: HeroCTA;
};

export const DEFAULT_COMPANY_STATS_DATA: CompanyStatsData = {
  headerTitle: 'VIBO CNC - One-Stop Industrial Parts Supplier',
  headerDescription:
    'We supply automation components including system units, circuit boards, PLC, HMI, inverters, encoders, amplifiers, servo motors and servo drives from major industrial manufacturers.',
  stats: [
    {
      id: 1,
      icon: 'calendar',
      value: 18,
      suffix: '+',
      label: 'Years Experience',
      description: 'Established in 2005 in Kunshan, China',
      color: 'text-teal-700',
    },
    {
      id: 2,
      icon: 'building',
      value: 5000,
      suffix: 'sqm',
      label: 'Workshop Facility',
      description: 'Modern infrastructure for quality service',
      color: 'text-teal-700',
    },
    {
      id: 3,
      icon: 'users',
      value: 37,
      suffix: '',
      label: 'Total Employees',
      description: '27 workers and 10 sales professionals',
      color: 'text-teal-700',
    },
    {
      id: 4,
      icon: 'shield',
      value: 3,
      suffix: '',
      label: 'Top Fanuc Supplier',
      description: 'One of top 3 suppliers in China',
      color: 'text-teal-700',
    },
    {
      id: 5,
      icon: 'cog',
      value: 100000,
      suffix: '+',
      label: 'Items in Stock',
      description: 'Comprehensive inventory management',
      color: 'text-teal-700',
    },
    {
      id: 6,
      icon: 'truck',
      value: 100,
      suffix: '',
      label: 'Daily Parcels',
      description: '50-100 parcels shipped daily',
      color: 'text-teal-700',
    },
    {
      id: 7,
      icon: 'globe',
      value: 200,
      suffix: 'M',
      label: 'Yearly Turnover',
      description: 'Annual revenue in millions',
      color: 'text-teal-700',
    },
    {
      id: 8,
      icon: 'clock',
      value: 365,
      suffix: ' days',
      label: 'Professional Service',
      description: 'Sales, testing and maintenance',
      color: 'text-teal-700',
    },
  ],
  ctaTitle: 'Ready to Experience Professional Service?',
  ctaDescription:
    'We have a professional team to provide services including sales, testing and maintenance. Join thousands of satisfied customers worldwide.',
  ctaPrimary: { text: 'Contact Our Experts', href: '/contact' },
  ctaSecondary: { text: 'Browse Products', href: '/products' },
};

export type WorkshopFacilityItem = {
  id: number;
  icon: string;
  title: string;
  description: string;
  image: string;
  features: string[];
};

export type WorkshopCapabilityItem = {
  icon: string;
  title: string;
  description: string;
};

export type WorkshopStatsBlock = {
  items: Array<{ value: string; title: string; subtitle: string }>;
  ctaTitle: string;
  ctaDescription: string;
  ctaPrimary: HeroCTA;
  ctaSecondary: HeroCTA;
};

export type WorkshopSectionData = {
  headerTitle: string;
  headerDescription: string;
  facilities: WorkshopFacilityItem[];
  capabilities: WorkshopCapabilityItem[];
  statsBlock: WorkshopStatsBlock;
};

export const DEFAULT_WORKSHOP_SECTION_DATA: WorkshopSectionData = {
  headerTitle: '5,000sqm Modern Workshop Facility',
  headerDescription:
    'Our facility combines structured inventory, inspection benches and export packing to deliver dependable CNC spare parts and service.',
  facilities: [
    {
      id: 1,
      icon: 'beaker',
      title: 'Testing & Quality Control',
      description:
        'Testing equipment and inspection procedures help verify parts before they leave our facility.',
      image: 'https://s2.loli.net/2025/09/01/ZxuFKAvIM3zUHj4.jpg',
      features: [
        'Automated testing systems',
        'Quality certification process',
        'Performance validation',
        'Compliance verification',
      ],
    },
    {
      id: 2,
      icon: 'archive',
      title: 'Organized Storage',
      description:
        'Climate-controlled warehouse with systematic inventory management for optimal part preservation.',
      image: 'https://s2.loli.net/2025/09/01/pxWRrVkNlO8Ugm4.jpg',
      features: [
        'Climate-controlled environment',
        'Systematic organization',
        'Real-time inventory tracking',
        'Secure storage protocols',
      ],
    },
    {
      id: 3,
      icon: 'wrench',
      title: 'Repair & Refurbishment',
      description:
        'Professional repair and refurbishment support for critical CNC and automation components.',
      image: 'https://s2.loli.net/2025/09/01/wMHu93Fv5egJ6pn.jpg',
      features: [
        'Certified technicians',
        'Original FANUC procedures',
        'Advanced diagnostic tools',
        'Quality assurance testing',
      ],
    },
    {
      id: 4,
      icon: 'shield',
      title: 'Secure Packaging',
      description:
        'Professional packaging ensures safe delivery of sensitive electronic components worldwide.',
      image: 'https://s2.loli.net/2025/09/01/3Rli1zNOEm5sA4T.jpg',
      features: [
        'Anti-static packaging',
        'Shock-resistant materials',
        'Custom protective solutions',
        'International shipping standards',
      ],
    },
  ],
  capabilities: [
    { icon: 'cog', title: 'Advanced Manufacturing', description: 'Precision manufacturing with cutting-edge technology' },
    { icon: 'clipboard', title: 'Quality Assurance', description: 'Rigorous testing and certification processes' },
    { icon: 'truck', title: 'Global Logistics', description: 'Worldwide shipping and distribution network' },
    { icon: 'check', title: 'ISO Certified', description: 'International quality management standards' },
  ],
  statsBlock: {
    items: [
      { value: '5,000', title: 'Square Meters', subtitle: 'Modern facility space' },
      { value: '24/7', title: 'Operations', subtitle: 'Continuous production' },
      { value: 'ISO', title: 'Certified', subtitle: 'Quality standards' },
    ],
    ctaTitle: 'Experience Our World-Class Facility',
    ctaDescription:
      'Schedule a virtual tour or visit our facility to see how we manage inspection, storage and export packing.',
    ctaPrimary: { text: 'Schedule Tour', href: '/contact' },
    ctaSecondary: { text: 'Learn More', href: '/about' },
  },
};

export type ServiceItem = {
  id: number;
  icon: string;
  title: string;
  description: string;
  features: string[];
  color: string;
  href?: string;
};

export type ProcessStep = { step: string; title: string; description: string };

export type ServicesSectionData = {
  headerTitle: string;
  headerDescription: string;
  services: ServiceItem[];
  processTitle: string;
  processDescription: string;
  processSteps: ProcessStep[];
  ctaTitle: string;
  ctaDescription: string;
  ctaPrimary: HeroCTA;
  ctaSecondary: HeroCTA;
  ctaBadges: string[];
};

export const DEFAULT_SERVICES_SECTION_DATA: ServicesSectionData = {
  headerTitle: 'Comprehensive CNC Parts Services',
  headerDescription:
    'From parts supply to technical support, we provide end-to-end support for industrial automation maintenance requirements.',
  services: [
    {
      id: 1,
      icon: 'cog',
      title: 'Automation Parts Supply',
      description:
        'Comprehensive inventory including servo motors, drives, encoders, control systems and electronic modules.',
      features: ['Tested parts', 'Fast delivery', 'Competitive pricing', 'Quality guarantee'],
      color: 'bg-teal-600',
      href: '/contact',
    },
    {
      id: 2,
      icon: 'wrench',
      title: 'Repair Services',
      description:
        'Professional repair and refurbishment services for CNC and automation components.',
      features: ['Expert technicians', 'Original procedures', 'Quality testing', 'Warranty included'],
      color: 'bg-green-500',
      href: '/contact',
    },
    {
      id: 3,
      icon: 'phone',
      title: 'Technical Support',
      description:
        'Technical assistance from automation parts specialists for troubleshooting and sourcing guidance.',
      features: ['24/7 availability', 'Certified specialists', 'Remote diagnostics', 'Quick response'],
      color: 'bg-purple-500',
      href: '/contact',
    },
    {
      id: 4,
      icon: 'truck',
      title: 'Global Shipping',
      description:
        'Worldwide shipping and logistics services ensuring safe delivery of sensitive electronic components.',
      features: ['Global coverage', 'Secure packaging', 'Express delivery', 'Tracking included'],
      color: 'bg-orange-500',
      href: '/contact',
    },
    {
      id: 5,
      icon: 'shield',
      title: 'Quality Assurance',
      description:
        'Rigorous testing and quality control processes for sensitive industrial components.',
      features: ['ISO certified', 'Comprehensive testing', 'Quality documentation', 'Compliance verification'],
      color: 'bg-red-500',
      href: '/contact',
    },
    {
      id: 6,
      icon: 'cap',
      title: 'Training & Education',
      description:
        'Professional training support for industrial systems operation, maintenance and troubleshooting.',
      features: ['Certified instructors', 'Hands-on training', 'Custom programs', 'Certification available'],
      color: 'bg-indigo-500',
      href: '/contact',
    },
  ],
  processTitle: 'Our Service Process',
  processDescription:
    'We follow a systematic approach to keep sourcing, inspection and delivery predictable.',
  processSteps: [
    {
      step: '01',
      title: 'Consultation',
      description:
        'We analyze your requirements and provide practical recommendations for automation parts sourcing.',
    },
    {
      step: '02',
      title: 'Solution Design',
      description:
        'Our engineers design customized solutions tailored to your specific industrial applications.',
    },
    {
      step: '03',
      title: 'Implementation',
      description:
        'Professional installation and integration services ensuring optimal system performance.',
    },
    {
      step: '04',
      title: 'Support',
      description:
        'Ongoing technical support and maintenance services to keep your systems running smoothly.',
    },
  ],
  ctaTitle: 'Ready to Get Started?',
  ctaDescription:
    'Contact our experts today to discuss your automation parts needs and delivery requirements.',
  ctaPrimary: { text: 'Contact Us Today', href: '/contact' },
  ctaSecondary: { text: 'Browse Products', href: '/products' },
  ctaBadges: ['24/7 Support Available', 'Worldwide Service', 'Quality Guaranteed'],
};

export type FeaturedProductsSectionData = {
  headerTitle: string;
  headerDescription: string;
  ctaText: string;
  ctaHref: string;
};

export const DEFAULT_FEATURED_PRODUCTS_SECTION_DATA: FeaturedProductsSectionData = {
  headerTitle: 'Featured Industrial Automation Parts',
  headerDescription:
    'Discover popular CNC and automation parts selected for reliability, availability and industrial maintenance use.',
  ctaText: 'View All Products',
  ctaHref: '/products',
};

export function getDefaultDataBySectionKey(key: string): any | null {
  if (key === 'hero_section') return DEFAULT_HERO_DATA;
  if (key === 'company_stats') return DEFAULT_COMPANY_STATS_DATA;
  if (key === 'workshop_section') return DEFAULT_WORKSHOP_SECTION_DATA;
  if (key === 'services_section') return DEFAULT_SERVICES_SECTION_DATA;
  if (key === 'featured_products') return DEFAULT_FEATURED_PRODUCTS_SECTION_DATA;
  return null;
}
