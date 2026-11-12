export type TemplateId =
  | 'image_text'
  | 'card_grid'
  | 'cta_banner'
  | 'gallery'
  | 'faq'
  | 'stats_band'
  | 'steps'
  | 'logo_wall';

export type SectionBackground = 'white' | 'light' | 'brand' | 'dark' | 'image';

export type SectionStyle = {
  background: SectionBackground;
  backgroundImage: string;
  align: 'left' | 'center';
  spacing: 'compact' | 'normal' | 'spacious';
  columns: 2 | 3 | 4;
  imagePosition: 'left' | 'right';
  rounded: boolean;
};

export type TemplateItem = {
  title: string;
  text: string;
  image: string;
  value: string;
  href: string;
};

export type TemplateData = {
  template: TemplateId;
  kicker: string;
  secondaryText: string;
  secondaryHref: string;
  style: SectionStyle;
  items: TemplateItem[];
};

/** Resolved section content used by the renderer and the editor. */
export type TemplateSectionModel = TemplateData & {
  title: string;
  subtitle: string;
  description: string;
  image: string;
  buttonText: string;
  buttonHref: string;
};

export type ItemField = keyof TemplateItem;

export type TemplateDefinition = {
  id: TemplateId;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  usesImage: boolean;
  itemFields: ItemField[];
  itemLabel: { zh: string; en: string };
  styleOptions: Array<keyof SectionStyle>;
  sample: Omit<TemplateSectionModel, 'template'>;
};

export const DEFAULT_SECTION_STYLE: SectionStyle = {
  background: 'white',
  backgroundImage: '',
  align: 'left',
  spacing: 'normal',
  columns: 3,
  imagePosition: 'right',
  rounded: true,
};

const blankItem = (patch: Partial<TemplateItem>): TemplateItem => ({ title: '', text: '', image: '', value: '', href: '', ...patch });

const base = {
  title: '',
  kicker: '',
  subtitle: '',
  description: '',
  image: '',
  buttonText: '',
  buttonHref: '',
  secondaryText: '',
  secondaryHref: '',
  items: [] as TemplateItem[],
};

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    id: 'image_text',
    name: { zh: '图文左右', en: 'Image + text' },
    description: { zh: '一张大图配标题、正文、要点和按钮，图片可放左或右', en: 'Large image with heading, copy, checklist and buttons' },
    usesImage: true,
    itemFields: ['title'],
    itemLabel: { zh: '要点', en: 'Checklist item' },
    styleOptions: ['background', 'imagePosition', 'spacing', 'rounded'],
    sample: {
      ...base,
      kicker: 'Testing & repair',
      title: 'Every part is inspected before it ships',
      description: 'Our technicians power up and test drives, servo amplifiers, PCBs and controllers on dedicated test benches, so the part you receive is ready to install.',
      buttonText: 'Request a quote',
      buttonHref: '/contact',
      secondaryText: 'Our services',
      secondaryHref: '/about',
      style: { ...DEFAULT_SECTION_STYLE, background: 'white', imagePosition: 'right' },
      items: [
        blankItem({ title: 'Load-tested on matching controllers' }),
        blankItem({ title: '12-month warranty on tested parts' }),
        blankItem({ title: 'Photos and test video on request' }),
      ],
    },
  },
  {
    id: 'card_grid',
    name: { zh: '卡片网格', en: 'Card grid' },
    description: { zh: '2–4 列卡片，每张卡片可带图片、标题、说明和链接', en: '2–4 column cards with image, title, text and link' },
    usesImage: false,
    itemFields: ['image', 'title', 'text', 'href'],
    itemLabel: { zh: '卡片', en: 'Card' },
    styleOptions: ['background', 'columns', 'align', 'spacing', 'rounded'],
    sample: {
      ...base,
      kicker: 'What we offer',
      title: 'Complete support for your automation parts',
      description: 'From sourcing a discontinued board to repairing a failed drive, one team handles the whole job.',
      style: { ...DEFAULT_SECTION_STYLE, background: 'light', align: 'center', columns: 3 },
      items: [
        blankItem({ title: 'Parts sourcing', text: 'New, refurbished and obsolete parts from 20+ brands.', href: '/products' }),
        blankItem({ title: 'Repair service', text: 'Component-level repair with full function testing.', href: '/repair-request' }),
        blankItem({ title: 'Worldwide shipping', text: 'Export packaging and express delivery to 100+ countries.', href: '/shipping-policy' }),
      ],
    },
  },
  {
    id: 'cta_banner',
    name: { zh: 'CTA 横幅', en: 'Call-to-action banner' },
    description: { zh: '醒目的横幅，用于引导询价、联系或促销', en: 'Bold banner for quotes, contact or promotions' },
    usesImage: false,
    itemFields: [],
    itemLabel: { zh: '', en: '' },
    styleOptions: ['background', 'align', 'spacing', 'rounded'],
    sample: {
      ...base,
      title: 'Can’t find your part number?',
      description: 'Send us the label photo or model number. Our team replies within one business day with price and lead time.',
      buttonText: 'Get a quote',
      buttonHref: '/contact',
      secondaryText: 'WhatsApp us',
      secondaryHref: '/contact',
      style: { ...DEFAULT_SECTION_STYLE, background: 'brand', align: 'center' },
    },
  },
  {
    id: 'gallery',
    name: { zh: '图片画廊', en: 'Image gallery' },
    description: { zh: '多张图片网格，可加图片说明，适合车间/仓库/包装展示', en: 'Photo grid with captions for workshop, stock or packaging' },
    usesImage: false,
    itemFields: ['image', 'title'],
    itemLabel: { zh: '图片', en: 'Photo' },
    styleOptions: ['background', 'columns', 'align', 'spacing', 'rounded'],
    sample: {
      ...base,
      kicker: 'Inside our warehouse',
      title: 'Stock you can see',
      description: 'Thousands of parts on the shelf, labelled and ready to ship.',
      style: { ...DEFAULT_SECTION_STYLE, columns: 3, align: 'center' },
      items: [blankItem({ title: 'Warehouse' }), blankItem({ title: 'Test bench' }), blankItem({ title: 'Export packing' })],
    },
  },
  {
    id: 'faq',
    name: { zh: '常见问题 FAQ', en: 'FAQ accordion' },
    description: { zh: '可折叠的问答列表', en: 'Collapsible questions and answers' },
    usesImage: false,
    itemFields: ['title', 'text'],
    itemLabel: { zh: '问答', en: 'Question' },
    styleOptions: ['background', 'align', 'spacing', 'rounded'],
    sample: {
      ...base,
      kicker: 'FAQ',
      title: 'Frequently asked questions',
      style: { ...DEFAULT_SECTION_STYLE, background: 'light', align: 'center' },
      items: [
        blankItem({ title: 'Do you test parts before shipping?', text: 'Yes. Every tested part is powered up and checked on a matching system before dispatch.' }),
        blankItem({ title: 'What warranty do you offer?', text: 'Tested parts carry a 12-month warranty unless stated otherwise on the product page.' }),
        blankItem({ title: 'How fast is shipping?', text: 'In-stock parts usually ship within 1–2 business days by DHL, FedEx or UPS.' }),
      ],
    },
  },
  {
    id: 'stats_band',
    name: { zh: '数据统计条', en: 'Stats band' },
    description: { zh: '突出几个关键数字，例如年限、库存、客户数', en: 'Highlight key numbers such as years, stock or customers' },
    usesImage: false,
    itemFields: ['value', 'title', 'text'],
    itemLabel: { zh: '数据', en: 'Stat' },
    styleOptions: ['background', 'columns', 'align', 'spacing', 'rounded'],
    sample: {
      ...base,
      style: { ...DEFAULT_SECTION_STYLE, background: 'dark', columns: 4, align: 'center', spacing: 'compact' },
      items: [
        blankItem({ value: '15+', title: 'Years of experience' }),
        blankItem({ value: '50,000+', title: 'Parts in stock' }),
        blankItem({ value: '100+', title: 'Countries served' }),
        blankItem({ value: '12 mo', title: 'Warranty' }),
      ],
    },
  },
  {
    id: 'steps',
    name: { zh: '流程步骤', en: 'Process steps' },
    description: { zh: '编号步骤，展示下单/维修/发货流程', en: 'Numbered steps for ordering, repair or shipping' },
    usesImage: false,
    itemFields: ['title', 'text'],
    itemLabel: { zh: '步骤', en: 'Step' },
    styleOptions: ['background', 'columns', 'align', 'spacing', 'rounded'],
    sample: {
      ...base,
      kicker: 'How it works',
      title: 'From inquiry to delivery in four steps',
      style: { ...DEFAULT_SECTION_STYLE, columns: 4, align: 'center' },
      items: [
        blankItem({ title: 'Send the part number', text: 'Share the model, photo or label.' }),
        blankItem({ title: 'Get a quote', text: 'Price, condition and lead time within 24 hours.' }),
        blankItem({ title: 'Test & pack', text: 'We test, photograph and pack the part.' }),
        blankItem({ title: 'Fast delivery', text: 'Express shipping with tracking.' }),
      ],
    },
  },
  {
    id: 'logo_wall',
    name: { zh: 'Logo 墙', en: 'Logo wall' },
    description: { zh: '静态 logo 网格，适合合作伙伴/认证/支付方式', en: 'Static logo grid for partners, certifications or payments' },
    usesImage: false,
    itemFields: ['image', 'title', 'href'],
    itemLabel: { zh: 'Logo', en: 'Logo' },
    styleOptions: ['background', 'columns', 'align', 'spacing', 'rounded'],
    sample: {
      ...base,
      title: 'Brands we support',
      style: { ...DEFAULT_SECTION_STYLE, columns: 4, align: 'center' },
      items: [
        blankItem({ title: 'FANUC', image: '/images/brands/fanuc.svg' }),
        blankItem({ title: 'Siemens', image: '/images/brands/siemens.svg' }),
        blankItem({ title: 'ABB', image: '/images/brands/abb.svg' }),
        blankItem({ title: 'SICK', image: '/images/brands/sick.svg' }),
      ],
    },
  },
];

export function getTemplateDefinition(id: unknown): TemplateDefinition | undefined {
  return TEMPLATE_DEFINITIONS.find((t) => t.id === id);
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function readTemplateId(raw: unknown): TemplateId | undefined {
  const id = record(raw).template;
  return getTemplateDefinition(id) ? (id as TemplateId) : undefined;
}

export function normalizeStyle(raw: unknown): SectionStyle {
  const s = record(raw);
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const columns = Number(s.columns);
  return {
    background: pick(s.background, ['white', 'light', 'brand', 'dark', 'image'] as const, DEFAULT_SECTION_STYLE.background),
    backgroundImage: str(s.backgroundImage),
    align: pick(s.align, ['left', 'center'] as const, DEFAULT_SECTION_STYLE.align),
    spacing: pick(s.spacing, ['compact', 'normal', 'spacious'] as const, DEFAULT_SECTION_STYLE.spacing),
    columns: columns === 2 || columns === 4 ? columns : 3,
    imagePosition: pick(s.imagePosition, ['left', 'right'] as const, DEFAULT_SECTION_STYLE.imagePosition),
    rounded: s.rounded === undefined ? true : Boolean(s.rounded),
  };
}

type ContentLike = {
  title?: string;
  subtitle?: string;
  description?: string;
  image_url?: string;
  button_text?: string;
  button_url?: string;
  data?: unknown;
};

export function toTemplateModel(content: ContentLike): TemplateSectionModel | null {
  const data = record(content.data);
  const template = readTemplateId(data);
  if (!template) return null;
  const items = Array.isArray(data.items)
    ? (data.items as unknown[]).map((raw) => {
        const it = record(raw);
        return blankItem({ title: str(it.title), text: str(it.text), image: str(it.image), value: str(it.value), href: str(it.href) });
      })
    : [];
  return {
    template,
    kicker: str(data.kicker),
    secondaryText: str(data.secondaryText),
    secondaryHref: str(data.secondaryHref),
    style: normalizeStyle(data.style),
    items,
    title: str(content.title),
    subtitle: str(content.subtitle),
    description: str(content.description),
    image: str(content.image_url),
    buttonText: str(content.button_text),
    buttonHref: str(content.button_url),
  };
}

export function templateModelToPayload(model: TemplateSectionModel) {
  return {
    title: model.title,
    subtitle: model.subtitle,
    description: model.description,
    image_url: model.image,
    button_text: model.buttonText,
    button_url: model.buttonHref,
    data: {
      template: model.template,
      kicker: model.kicker,
      secondaryText: model.secondaryText,
      secondaryHref: model.secondaryHref,
      style: model.style,
      items: model.items,
    } satisfies TemplateData,
  };
}

export function sampleModel(id: TemplateId): TemplateSectionModel {
  const def = getTemplateDefinition(id)!;
  return { template: id, ...structuredClone(def.sample) };
}
