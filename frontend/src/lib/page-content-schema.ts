import { enMessages } from '@/lib/i18n/messages-en';
import { PAGE_SECTION_KEYS, type EditablePage, type PageField, type PageSchema } from '@/lib/page-content';

const en = (key: string): string => (enMessages as Record<string, string>)[key] || '';
const DEFAULT_ABOUT_IMAGE = '/uploads/media/605e31d297c79d19079f3710453bde878143e088eeaa5ad1bddfd1a45af9b7dc.png';

function text(key: string, zh: string, label: string, i18nKey: string, type: 'text' | 'textarea' = 'text'): PageField {
  return { key, type, zh, en: label, fallback: en(i18nKey), i18nKey };
}

function plain(key: string, zh: string, label: string, fallback: string, type: 'text' | 'textarea' = 'text'): PageField {
  return { key, type, zh, en: label, fallback };
}

function image(key: string, zh: string, label: string, fallback = ''): PageField {
  return { key, type: 'image', zh, en: label, fallback };
}

export const ABOUT_PAGE_SCHEMA: PageSchema = {
  page: 'about',
  sectionKey: PAGE_SECTION_KEYS.about,
  path: '/about',
  zh: '关于我们',
  en: 'About page',
  groups: [
    {
      zh: '页面顶部',
      en: 'Hero',
      fields: [
        text('heroKicker', '小标签', 'Kicker', 'about.kicker'),
        text('heroTitle', '大标题', 'Title', 'about.title'),
        text('heroSubtitle', '副标题', 'Subtitle', 'about.subtitle', 'textarea'),
        image('heroImage', '顶部背景图（可选）', 'Background image (optional)'),
      ],
    },
    {
      zh: '公司概况',
      en: 'Company profile',
      fields: [
        text('profileTitle', '标题', 'Title', 'about.profile'),
        text('profileText1', '第一段', 'Paragraph 1', 'about.profileDescription', 'textarea'),
        text('profileText2', '第二段', 'Paragraph 2', 'about.warehouseDescription', 'textarea'),
        plain('profileStat1Value', '数据 1 数值', 'Stat 1 value', '15+'),
        text('profileStat1Label', '数据 1 名称', 'Stat 1 label', 'about.years'),
        plain('profileStat2Value', '数据 2 数值', 'Stat 2 value', '20+'),
        text('profileStat2Label', '数据 2 名称', 'Stat 2 label', 'about.topSupplier'),
        image('profileImage', '公司图片', 'Company image', DEFAULT_ABOUT_IMAGE),
      ],
    },
    {
      zh: '仓库与库存',
      en: 'Facility & stock',
      fields: [
        text('facilityTitle', '标题', 'Title', 'about.warehouse'),
        text('facilityText', '说明', 'Text', 'about.warehouseDescription', 'textarea'),
        plain('stat1Value', '数据 1 数值', 'Stat 1 value', '3,500'),
        text('stat1Label', '数据 1 名称', 'Stat 1 label', 'about.workshop'),
        plain('stat2Value', '数据 2 数值', 'Stat 2 value', '37'),
        text('stat2Label', '数据 2 名称', 'Stat 2 label', 'about.employees'),
        plain('stat3Value', '数据 3 数值', 'Stat 3 value', '100K+'),
        text('stat3Label', '数据 3 名称', 'Stat 3 label', 'about.items'),
        plain('stat4Value', '数据 4 数值', 'Stat 4 value', '50-100'),
        text('stat4Label', '数据 4 名称', 'Stat 4 label', 'about.parcels'),
      ],
    },
    {
      zh: '专业服务',
      en: 'Services',
      fields: [
        text('servicesTitle', '标题', 'Title', 'about.services'),
        text('servicesText', '说明', 'Text', 'about.servicesDescription', 'textarea'),
        text('service1Title', '服务 1 标题', 'Service 1 title', 'about.sales'),
        text('service1Text', '服务 1 说明', 'Service 1 text', 'about.salesDescription', 'textarea'),
        text('service2Title', '服务 2 标题', 'Service 2 title', 'about.testing'),
        text('service2Text', '服务 2 说明', 'Service 2 text', 'about.testingDescription', 'textarea'),
        text('service3Title', '服务 3 标题', 'Service 3 title', 'about.maintenance'),
        text('service3Text', '服务 3 说明', 'Service 3 text', 'about.maintenanceDescription', 'textarea'),
      ],
    },
    {
      zh: '经验与信任',
      en: 'Experience',
      fields: [
        text('experienceTitle', '标题', 'Title', 'about.experience'),
        text('experienceText', '说明', 'Text', 'about.experienceDescription', 'textarea'),
        text('trustTitle', '信任标题', 'Trust title', 'about.trustedPartner'),
        text('trustText', '信任说明', 'Trust text', 'about.trustedDescription'),
        image('experienceImage', '车间图片', 'Workshop image', DEFAULT_ABOUT_IMAGE),
      ],
    },
  ],
};

export const CONTACT_PAGE_SCHEMA: PageSchema = {
  page: 'contact',
  sectionKey: PAGE_SECTION_KEYS.contact,
  path: '/contact',
  zh: '联系我们',
  en: 'Contact page',
  groups: [
    {
      zh: '页面顶部',
      en: 'Hero',
      fields: [
        text('heroKicker', '小标签', 'Kicker', 'contact.kicker'),
        text('heroTitle', '大标题', 'Title', 'contact.title'),
        text('heroText', '介绍文字', 'Intro text', 'contact.description', 'textarea'),
        image('heroImage', '顶部背景图（可选）', 'Background image (optional)'),
      ],
    },
    {
      zh: '联系方式',
      en: 'Contact details',
      fields: [
        text('infoTitle', '区块标题', 'Section title', 'contact.getInTouch'),
        plain('address', '地址', 'Address', 'Kunshan, Jiangsu Province\nChina', 'textarea'),
        plain('phone', '电话', 'Phone', '+86 13301553506'),
        plain('email', '邮箱', 'Email', 'flora@vibocnc.com'),
        plain('hours', '营业时间', 'Business hours', 'Monday - Friday: 8:00 AM - 6:00 PM\nSaturday: 9:00 AM - 5:00 PM\nSunday: Closed', 'textarea'),
        plain('facility', '设施', 'Facility', '3,500 sqm Inspection & Service Facility'),
        text('serviceArea', '服务范围', 'Service area', 'product.worldwideShipping'),
      ],
    },
    {
      zh: '留言表单',
      en: 'Message form',
      fields: [text('formTitle', '表单标题', 'Form title', 'contact.sendTitle')],
    },
    {
      zh: '选择我们的理由',
      en: 'Why choose us',
      fields: [
        text('whyTitle', '标题', 'Title', 'contact.whyChoose'),
        text('why1Title', '理由 1 标题', 'Reason 1 title', 'contact.fastResponse'),
        text('why1Text', '理由 1 说明', 'Reason 1 text', 'contact.fastResponseDescription', 'textarea'),
        text('why2Title', '理由 2 标题', 'Reason 2 title', 'contact.largeInventory'),
        text('why2Text', '理由 2 说明', 'Reason 2 text', 'contact.largeInventoryDescription', 'textarea'),
        text('why3Title', '理由 3 标题', 'Reason 3 title', 'contact.globalShipping'),
        text('why3Text', '理由 3 说明', 'Reason 3 text', 'contact.globalShippingDescription', 'textarea'),
      ],
    },
  ],
};

export const PAGE_SCHEMAS: Record<EditablePage, PageSchema> = {
  about: ABOUT_PAGE_SCHEMA,
  contact: CONTACT_PAGE_SCHEMA,
};
