'use client';

import { useState } from 'react';
import { toast } from 'react-hot-toast';
import ContactService from '@/services/contact.service';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';
import type { PublicLocale } from '@/lib/i18n/config';
import { getRepairPageCopy } from '@/lib/i18n/repair';

type RepairForm = {
  name: string;
  email: string;
  company: string;
  phone: string;
  brand: string;
  model: string;
  quantity: string;
  fault: string;
  urgency: string;
};

const INITIAL_FORM: RepairForm = { name: '', email: '', company: '', phone: '', brand: '', model: '', quantity: '1', fault: '', urgency: 'standard' };

export default function RepairRequestForm({ locale }: { locale: PublicLocale }) {
  const { t } = usePublicI18n();
  const copy = getRepairPageCopy(locale);
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof RepairForm, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await ContactService.submitContact({
        name: form.name,
        email: form.email,
        company: form.company,
        phone: form.phone,
        inquiry_type: 'repair',
        subject: `Repair evaluation: ${form.brand || 'Unknown brand'} ${form.model}`.trim(),
        message: [
          `Brand: ${form.brand || 'Not provided'}`,
          `Model / part number: ${form.model}`,
          `Quantity: ${form.quantity || '1'}`,
          `Priority: ${form.urgency}`,
          '',
          'Fault description:',
          form.fault,
          '',
          'Please reply to request nameplate, fault and damage photos if they were not supplied by email.',
        ].join('\n'),
      });
      toast.success(t('contact.success'));
      setForm(INITIAL_FORM);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('contact.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass = 'site-input mt-2 w-full px-4 py-3';
  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
      <h2 className="text-2xl font-black text-slate-950">{copy.formTitle}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{copy.formDescription}</p>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">{locale === 'zh' ? '姓名' : locale === 'es' ? 'Nombre completo' : locale === 'de' ? 'Vollständiger Name' : locale === 'fr' ? 'Nom complet' : locale === 'it' ? 'Nome completo' : locale === 'pt' ? 'Nome completo' : locale === 'ja' ? '氏名' : locale === 'ko' ? '성명' : locale === 'ru' ? 'Полное имя' : locale === 'ar' ? 'الاسم الكامل' : 'Full name'} *<input required value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} autoComplete="name" /></label>
        <label className="text-sm font-semibold text-slate-700">{locale === 'zh' ? '商务邮箱' : locale === 'es' ? 'Correo electrónico' : locale === 'de' ? 'Geschäftliche E-Mail' : locale === 'fr' ? 'E-mail professionnel' : locale === 'it' ? 'E-mail aziendale' : locale === 'pt' ? 'E-mail comercial' : locale === 'ja' ? 'ビジネスメール' : locale === 'ko' ? '회사 이메일' : locale === 'ru' ? 'Рабочая почта' : locale === 'ar' ? 'البريد الإلكتروني للعمل' : 'Business email'} *<input required type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={fieldClass} autoComplete="email" /></label>
        <label className="text-sm font-semibold text-slate-700">{locale === 'zh' ? '公司' : locale === 'es' ? 'Empresa' : locale === 'de' ? 'Unternehmen' : locale === 'fr' ? 'Entreprise' : locale === 'it' ? 'Azienda' : locale === 'pt' ? 'Empresa' : locale === 'ja' ? '会社' : locale === 'ko' ? '회사' : locale === 'ru' ? 'Компания' : locale === 'ar' ? 'الشركة' : 'Company'}<input value={form.company} onChange={(e) => set('company', e.target.value)} className={fieldClass} autoComplete="organization" /></label>
        <label className="text-sm font-semibold text-slate-700">{locale === 'zh' ? '电话 / WhatsApp' : locale === 'es' ? 'Teléfono / WhatsApp' : locale === 'de' ? 'Telefon / WhatsApp' : locale === 'fr' ? 'Téléphone / WhatsApp' : locale === 'it' ? 'Telefono / WhatsApp' : locale === 'pt' ? 'Telefone / WhatsApp' : locale === 'ja' ? '電話 / WhatsApp' : locale === 'ko' ? '전화 / WhatsApp' : locale === 'ru' ? 'Телефон / WhatsApp' : locale === 'ar' ? 'الهاتف / WhatsApp' : 'Phone / WhatsApp'}<input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={fieldClass} autoComplete="tel" /></label>
        <label className="text-sm font-semibold text-slate-700">{locale === 'zh' ? '品牌' : locale === 'es' ? 'Marca' : locale === 'de' ? 'Marke' : locale === 'fr' ? 'Marque' : locale === 'it' ? 'Marca' : locale === 'pt' ? 'Marca' : locale === 'ja' ? 'ブランド' : locale === 'ko' ? '브랜드' : locale === 'ru' ? 'Бренд' : locale === 'ar' ? 'العلامة التجارية' : 'Brand'}<input value={form.brand} onChange={(e) => set('brand', e.target.value)} className={fieldClass} placeholder="Siemens, FANUC, ABB..." /></label>
        <label className="text-sm font-semibold text-slate-700">{copy.modelLabel} *<input required value={form.model} onChange={(e) => set('model', e.target.value)} className={fieldClass} placeholder={copy.modelPlaceholder} /></label>
        <label className="text-sm font-semibold text-slate-700">{copy.quantityLabel}<input min="1" type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} className={fieldClass} /></label>
        <label className="text-sm font-semibold text-slate-700">{copy.priorityLabel}<select value={form.urgency} onChange={(e) => set('urgency', e.target.value)} className={`${fieldClass} site-select`}><option value="standard">{copy.standardPriority}</option><option value="production-stopped">{copy.stoppedPriority}</option><option value="planned-maintenance">{copy.maintenancePriority}</option></select></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">{copy.faultLabel} *<textarea required rows={7} value={form.fault} onChange={(e) => set('fault', e.target.value)} className={fieldClass} placeholder={copy.faultPlaceholder} /></label>
      </div>

      <div className="mt-5 rounded-md border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-slate-700">
        {copy.submitNote}
      </div>

      <button disabled={submitting} className="mt-6 w-full rounded-md bg-orange-700 px-6 py-4 font-bold text-white hover:bg-[#0b3e75] disabled:opacity-50">{submitting ? copy.submittingButton : copy.submitButton}</button>
    </form>
  );
}
