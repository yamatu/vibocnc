import type { CommercePolicySetting } from '@/types';
import {
  commercePolicyCarriers,
  commercePolicyHandlingText,
  commercePolicyReturnShippingText,
  commercePolicyReturnWindowText,
  commercePolicyTransitText,
  resolveWarrantyPeriod,
} from '@/lib/commerce-policy';

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * Single source of the storefront FAQ.
 *
 * The visible page and the FAQPage structured data must never disagree (Google
 * only keeps the rich result when the answer is visible), so both render this
 * list. Every commercial promise — transit time, warranty length, return window
 * and who pays return freight — comes from the admin-editable commerce policy
 * instead of being typed into the copy.
 */
export function buildHomeFaqEntries(
  locale: string,
  policy?: CommercePolicySetting,
): FaqEntry[] {
  const zh = locale === 'zh';
  const carriers = commercePolicyCarriers(policy).join(', ');
  const transit = commercePolicyTransitText(policy);
  const handling = commercePolicyHandlingText(policy);
  const warranty = resolveWarrantyPeriod(undefined, policy);
  const returnWindow = commercePolicyReturnWindowText(policy);
  const returnShipping = commercePolicyReturnShippingText(policy, zh ? 'zh' : 'en');

  if (zh) {
    return [
      {
        question: '你们供应哪些工业自动化零部件？',
        answer:
          '我们常备超过 100,000 件工业自动化产品，覆盖 FANUC、Siemens、Mitsubishi、ABB、Allen-Bradley、Omron、Yaskawa、Schneider Electric 等品牌，包括 PCB 板、PLC 与 I/O 模块、HMI、伺服驱动器、电机、编码器、变频器、控制单元和电源。',
      },
      {
        question: '你们支持全球配送吗？',
        answer: `支持。订单通常在 ${handling} 内发出，通过 ${carriers} 等国际快递运输，预计运输时间 ${transit}（不含清关时间，具体取决于目的地与当地服务）。`,
      },
      {
        question: '退换货政策是什么？',
        answer: `自收货起 ${returnWindow} 内可申请退换货，${returnShipping}。请先联系我们获取退货地址与操作指引，并保留原包装与随附资料。`,
      },
      {
        question: '你们的质保政策是什么？',
        answer: `质保范围会根据产品成色和制造商条款，在每个产品页面或报价中明确说明。多数产品提供 ${warranty} 的 Vibocnc 质保支持，符合条件的新品也可能保留制造商质保。`,
      },
      {
        question: '如何确认产品是否原装以及成色？',
        answer:
          '我们供应原厂零部件，也会在有货时提供明确标注的兼容替代方案。品牌、成色、兼容性及随附资料会显示在报价或产品页面中，方便您下单前确认。',
      },
      {
        question: '如何获得技术支持？',
        answer:
          '您可通过 sales@vibocnc.com 或电话联系我们。团队可协助安装指导、故障排查、兼容性确认和替换建议。',
      },
      {
        question: '如何下单？',
        answer:
          '您可以直接通过网站、电子邮件或电话下单。我们支持 PayPal、银行转账及主要信用卡，并可为长期合作客户协商批量订单条款。',
      },
      {
        question: '批量采购有优惠吗？',
        answer:
          '有。批量订单和长期供货可获得定制报价，请把具体型号与数量发送给销售团队。',
      },
      {
        question: '如何确认零件与我的系统兼容？',
        answer:
          '请提供系统型号、当前零件号和应用信息，我们的技术团队会核对兼容性，并在需要时建议替代型号。',
      },
      {
        question: '支持哪些付款方式？',
        answer:
          '我们支持 PayPal、银行电汇以及 Visa、MasterCard、American Express 等主要信用卡；长期合作客户还可申请账期或采购订单。',
      },
      {
        question: '如何查询订单物流？',
        answer:
          '订单发出后，您会通过电子邮件收到物流信息，也可登录账户实时查看订单状态和运单号。',
      },
    ];
  }

  return [
    {
      question: 'What industrial automation parts do you stock?',
      answer:
        'We stock over 100,000 industrial automation items across brands such as FANUC, Siemens, Mitsubishi, ABB, Allen-Bradley, Omron, Yaskawa, Schneider Electric, and more. Our range includes PCB boards, PLC and I/O modules, HMI panels, servo drives, motors, encoders, inverters, control units, and power supplies.',
    },
    {
      question: 'Do you ship worldwide?',
      answer: `Yes. Orders normally ship within ${handling} and travel by express carrier such as ${carriers}, with an estimated transit time of ${transit} subject to customs clearance and local service availability.`,
    },
    {
      question: 'What is your return policy?',
      answer: `Returns are accepted within ${returnWindow} of delivery and ${returnShipping}. Contact us first for the return address and instructions, and keep the original packaging and included documentation.`,
    },
    {
      question: 'What is your warranty policy?',
      answer: `Warranty coverage is stated for each product or quotation and depends on condition and manufacturer terms. Many supplied parts include ${warranty} of Vibocnc warranty support, while eligible new items may retain the applicable manufacturer warranty.`,
    },
    {
      question: 'Are the parts genuine and how is their condition identified?',
      answer:
        'We supply genuine manufacturer parts as well as clearly identified compatible alternatives where available. Brand, condition, compatibility, and included documentation are shown on the quotation or product page so you can confirm the exact option before ordering.',
    },
    {
      question: 'How can I get technical support?',
      answer:
        'Our technical support team is available via email at sales@vibocnc.com or phone. We provide installation guidance, troubleshooting, compatibility assistance, and replacement recommendations.',
    },
    {
      question: 'How do I place an order?',
      answer:
        'You can place orders directly on our website, via email, or by phone. We accept PayPal, bank transfers, and major credit cards. For large orders, we offer flexible payment terms for established customers.',
    },
    {
      question: 'Do you offer quantity discounts?',
      answer:
        'Yes, we offer competitive quantity discounts for bulk orders. Contact our sales team for custom pricing on large quantities or long-term supply agreements.',
    },
    {
      question: 'How do I know if a part is compatible with my system?',
      answer:
        'Our technical team can help verify compatibility. Provide your system model, current part number, and application details. We maintain extensive compatibility databases and can suggest alternatives if needed.',
    },
    {
      question: 'What payment methods do you accept?',
      answer:
        'We accept PayPal, wire transfers, major credit cards (Visa, MasterCard, American Express), and for established customers, we offer terms payments and purchase orders.',
    },
    {
      question: 'How do I track my order?',
      answer:
        'Once your order ships, you will receive tracking information via email. You can also log into your account on our website to view order status and tracking details in real time.',
    },
  ];
}
