'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Combobox } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';

import { ShippingRateService, type ShippingQuote } from '@/services/shipping-rate.service';
import { useAdminI18n } from '@/lib/admin-i18n';

type Country = { country_code: string; country_name: string; currency: string };

export default function ShippingQuoteCalculator(props: {
	weightKg?: number;
	price?: number;
	defaultCountryCode?: string;
	onSetPrice?: (nextPrice: number) => void;
}) {
	const { locale, t } = useAdminI18n();
	const { weightKg = 0, price = 0, defaultCountryCode = 'US', onSetPrice } = props;
	const w = Number(weightKg || 0);

	const [countries, setCountries] = useState<Country[]>([]);
	const [loadingCountries, setLoadingCountries] = useState(false);
	const [carrier, setCarrier] = useState('');
	const [serviceCode, setServiceCode] = useState('');
	const [countryCode, setCountryCode] = useState('');
	const [countryQuery, setCountryQuery] = useState('');
	const countryButtonRef = useRef<HTMLButtonElement | null>(null);
	const [quote, setQuote] = useState<ShippingQuote | null>(null);
	const [loadingQuote, setLoadingQuote] = useState(false);
	const [quoteError, setQuoteError] = useState<string>('');
	const [autoApply, setAutoApply] = useState(true);
	const [appliedFee, setAppliedFee] = useState(0);

	const selectedCountry = useMemo(() => {
		const code = String(countryCode || '').toUpperCase();
		if (!code) return null;
		return countries.find((c) => String(c.country_code || '').toUpperCase() === code) || null;
	}, [countries, countryCode]);

	const filteredCountries = useMemo(() => {
		const q = countryQuery.trim().toLowerCase();
		if (!q) return countries;
		return countries.filter((c) => {
			const code = String(c.country_code || '').toLowerCase();
			const name = String(c.country_name || '').toLowerCase();
			return code.includes(q) || name.includes(q);
		});
	}, [countryQuery, countries]);

	useEffect(() => {
		let alive = true;
		(async () => {
			setLoadingCountries(true);
			try {
				const list = (await ShippingRateService.publicCountries({
					carrier: carrier || undefined,
					service: carrier ? (serviceCode || undefined) : undefined,
				})) as any as Country[];
				if (!alive) return;
				const raw = Array.isArray(list) ? list : [];
				// If multiple carrier service codes exist, /countries can include duplicates.
				// Deduplicate by country_code for a simpler UX.
				const seen = new Set<string>();
				const uniq: Country[] = [];
				for (const c of raw) {
					const code = String(c?.country_code || '').toUpperCase();
					if (!code) continue;
					if (seen.has(code)) continue;
					seen.add(code);
					uniq.push(c);
				}
				setCountries(uniq);
			} catch (e: any) {
				if (!alive) return;
				setCountries([]);
				console.warn('Failed to load shipping countries', e);
			} finally {
				if (alive) setLoadingCountries(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [carrier, serviceCode]);

	useEffect(() => {
		if (countryCode) return;
		if (!countries.length) return;
		const preferred = (defaultCountryCode || '').toUpperCase();
		const found = countries.find((c) => c.country_code === preferred);
		setCountryCode(found?.country_code || countries[0].country_code);
	}, [countries, countryCode, defaultCountryCode]);

	useEffect(() => {
		// When switching carrier/service, reset selection so list matches.
		setCountryCode('');
		setCountryQuery('');
		setQuote(null);
		setQuoteError('');
	}, [carrier, serviceCode]);

	useEffect(() => {
		let alive = true;
		(async () => {
			setQuote(null);
			setQuoteError('');
			if (!countryCode || !w || w <= 0) return;
			setLoadingQuote(true);
			try {
				const q = await ShippingRateService.quote(countryCode, w, {
					carrier: carrier || undefined,
					service: carrier ? (serviceCode || undefined) : undefined,
				});
				if (!alive) return;
				setQuote(q);
			} catch (e: any) {
				if (!alive) return;
				const msg = String(e?.message || '');
				if (/not\s*found|template/i.test(msg)) {
					setQuoteError(
						t(
							'shipping.calc.notFoundHint',
							locale === 'zh'
								? '未找到该国家的运费模板。请在 Shipping Rates 导入该国家（或把该国家加入 CountryZones）后重试。'
								: 'No shipping template found for this country. Import this country in Shipping Rates (or add it to CountryZones) and retry.'
						)
					);
				} else {
					setQuoteError(msg || 'Failed to calculate shipping');
				}
			} finally {
				if (alive) setLoadingQuote(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [countryCode, w, carrier, serviceCode, locale, t]);

	const shippingFee = Number(quote?.shipping_fee || 0);
	const billingWeightKg = Number((quote as any)?.billing_weight_kg || (quote as any)?.billingWeight || 0);

	const calcNextPrice = useCallback((nextFee: number) => {
		const base = Number(price || 0) - Number(appliedFee || 0);
		return Number((base + Number(nextFee || 0)).toFixed(2));
	}, [appliedFee, price]);

	const nextPriceWithShipping = useMemo(() => {
		return calcNextPrice(shippingFee);
		 
	}, [calcNextPrice, shippingFee]);

	useEffect(() => {
		if (!autoApply) return;
		if (!quote || shippingFee <= 0) return;
		if (!onSetPrice) return;
		if (Number(price || 0) <= 0) return;
		if (shippingFee === appliedFee) return;
		const nextPrice = calcNextPrice(shippingFee);
		onSetPrice(nextPrice);
		setAppliedFee(shippingFee);
	}, [autoApply, quote, shippingFee, onSetPrice, price, appliedFee, countryCode, w, calcNextPrice]);

	return (
		<div className="bg-white shadow rounded-lg p-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h3 className="text-lg font-medium text-gray-900">{t('shipping.calc.title', '运费预览（按重量）')}</h3>
					<p className="mt-1 text-sm text-gray-500">{t('shipping.calc.subtitle', '根据已配置模板预览运费，并可自动加到标价。')}</p>
				</div>
			</div>

			<div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
				<div>
					<label className="block text-sm font-medium text-gray-700 mb-1">{t('shipping.calc.carrier', locale === 'zh' ? '承运商' : 'Carrier')}</label>
					<select
						value={carrier}
						onChange={(e) => setCarrier(e.target.value)}
						className="block w-full px-3 py-2 border border-gray-300 rounded-md"
					>
						<option value="">{t('shipping.calc.carrier.default', locale === 'zh' ? '默认(按国家模板)' : 'Default (country templates)')}</option>
						<option value="FEDEX">FEDEX</option>
						<option value="DHL">DHL</option>
					</select>
					{carrier && (
						<>
							<input
								value={serviceCode}
								onChange={(e) => setServiceCode(e.target.value)}
								className="mt-2 block w-full px-3 py-2 border border-gray-300 rounded-md"
								placeholder={t('shipping.calc.servicePh', locale === 'zh' ? '服务代码（可选，IP/IE...）' : 'Service code (optional, IP/IE...)')}
							/>
							<p className="mt-1 text-xs text-gray-500">
								{t('shipping.calc.serviceHint', locale === 'zh' ? '留空会自动匹配该承运商可用模板；填错不会阻塞计算。' : 'Leave blank to auto-match available templates; mismatches won\'t block calculation.')}
							</p>
						</>
					)}
				</div>
				<div>
					<label className="block text-sm font-medium text-gray-700 mb-1">{t('shipping.calc.country', '国家')}</label>
					<Combobox
						value={selectedCountry}
						onChange={(c: Country | null) => {
							const code = String(c?.country_code || '').toUpperCase();
							setCountryCode(code);
							setCountryQuery('');
						}}
						disabled={loadingCountries || countries.length === 0}
					>
						{({ open }) => (
							<div className="relative">
								<div className="relative w-full cursor-default overflow-hidden rounded-md bg-white text-left border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
									<Combobox.Input
										className="w-full px-3 pr-10 py-2 text-sm outline-none"
										displayValue={(c: Country | null) => (c ? `${c.country_name} (${c.country_code})` : '')}
										onChange={(event) => setCountryQuery(event.target.value)}
										onFocus={() => {
											if (!open) countryButtonRef.current?.click();
										}}
										placeholder={loadingCountries ? t('common.loading', '加载中...') : t('shipping.calc.countrySearchPh', locale === 'zh' ? '搜索国家（代码/名称）' : 'Search country (code/name)')}
									/>
									<Combobox.Button ref={countryButtonRef} className="absolute inset-y-0 right-0 flex items-center pr-3">
										<ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
									</Combobox.Button>
								</div>

								<Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none">
									{loadingCountries ? (
										<div className="px-3 py-2 text-gray-500">{t('common.loading', '加载中...')}</div>
									) : filteredCountries.length === 0 ? (
										<div className="px-3 py-2 text-gray-500">{t('common.empty', locale === 'zh' ? '无匹配国家' : 'No matches')}</div>
									) : (
										filteredCountries.map((c) => (
											<Combobox.Option
												key={c.country_code}
												value={c}
												className={({ active }) =>
													`relative cursor-default select-none py-2 pl-9 pr-3 ${active ? 'bg-blue-50 text-blue-900' : 'text-gray-900'}`
												}
											>
												{({ selected }) => (
													<>
														<span className={`block truncate ${selected ? 'font-semibold' : 'font-normal'}`}>
															{c.country_name} ({c.country_code})
														</span>
														{selected ? (
															<span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
																<CheckIcon className="h-5 w-5" aria-hidden="true" />
															</span>
														) : null}
													</>
												)}
											</Combobox.Option>
										))
									)}
								</Combobox.Options>
							</div>
						)}
					</Combobox>
				</div>

				<div>
					<label className="block text-sm font-medium text-gray-700 mb-1">{t('shipping.calc.weight', '重量(kg)')}</label>
					<div className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-900">{w > 0 ? w : '-'}</div>
				</div>

				<div>
					<label className="block text-sm font-medium text-gray-700 mb-1">{t('shipping.calc.shippingFee', '运费')}</label>
					<div className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-900">
						{loadingQuote ? t('common.loading', '加载中...') : quote ? `${quote.currency || 'USD'} ${shippingFee.toFixed(2)}` : '-'}
					</div>
				</div>
			</div>

			{quoteError && (
				<div className="mt-3 text-sm text-red-600">{quoteError}</div>
			)}

			{!loadingCountries && countries.length === 0 && (
				<div className="mt-3 text-sm text-amber-700">
					{t(
						'shipping.calc.noCountriesHint',
						locale === 'zh'
							? '当前没有可用国家。请先在运费模板导入国家规则，并检查白名单是否至少包含一个国家。'
							: 'No available countries. Import shipping templates first and make sure whitelist includes at least one country.'
					)}
				</div>
			)}

			{quote && (
				<div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800 grid grid-cols-1 gap-2 sm:grid-cols-2">
					<div className="sm:col-span-2">
						{t('shipping.calc.source', locale === 'zh' ? '运费来源' : 'Rate source')}: 
						{quote.source === 'carrier'
							? `${quote.carrier || carrier || 'CARRIER'}${quote.service_code ? ` / ${quote.service_code}` : ''}`
							: quote.source === 'default_fallback'
								? t('shipping.calc.sourceFallback', locale === 'zh' ? '承运商模板缺失，已回退到默认国家模板' : 'Carrier template missing, fell back to default country template')
								: t('shipping.calc.sourceDefault', locale === 'zh' ? '默认国家模板' : 'Default country template')}
					</div>
					<div>{t('shipping.calc.ratePerKg', '每公斤价格')}: {Number(quote.rate_per_kg || 0).toFixed(3)}</div>
					<div>{t('shipping.calc.baseQuote', '基础运费')}: {Number(quote.base_quote || 0).toFixed(2)}</div>
					<div>{t('shipping.calc.additionalFee', '附加费')}: {Number(quote.additional_fee || 0).toFixed(2)}</div>
					<div>
						{t('shipping.calc.billingWeight', '计费重量')}: {billingWeightKg ? Number(billingWeightKg).toFixed(3) : '-'}
						{w > 0 && w < 21 ? <span className="ml-2 text-gray-500">{t('shipping.calc.roundUpHint', '（<21kg 向上取整）')}</span> : null}
					</div>
					<div>{t('shipping.calc.priceWithShipping', '标价 + 运费')}: {nextPriceWithShipping.toFixed(2)}</div>
					{quote.source === 'default_fallback' && (
						<div className="sm:col-span-2 text-amber-700">
							{t(
								'shipping.calc.fallbackTip',
								locale === 'zh'
									? '提示：当前国家未找到该承运商模板。若你需要严格按 FEDEX/DHL 计费，请在运费模板中补该国家的 CountryZones。'
									: 'Tip: No carrier template for this country. To enforce FEDEX/DHL-only pricing, add this country in carrier CountryZones.'
							)}
						</div>
					)}
				</div>
			)}

			<div className="mt-4 flex items-center gap-2">
				<label className="inline-flex items-center gap-2 text-sm text-gray-700">
					<input
						type="checkbox"
						checked={autoApply}
						onChange={(e) => {
							setAutoApply(e.target.checked);
							if (!e.target.checked) setAppliedFee(0);
						}}
						className="h-4 w-4"
						disabled={!onSetPrice}
					/>
					{t('shipping.calc.autoApply', '自动加到标价')}
				</label>
				<button
					type="button"
					disabled={!quote || shippingFee <= 0 || !onSetPrice}
					onClick={() => {
						if (!quote || shippingFee <= 0 || !onSetPrice) return;
						const nextPrice = calcNextPrice(shippingFee);
						onSetPrice(nextPrice);
						setAppliedFee(shippingFee);
						toast.success(`${t('common.save', '保存')}: ${nextPrice.toFixed(2)} (${t('shipping.calc.shippingFee', '运费')} ${shippingFee.toFixed(2)})`);
					}}
					className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
				>
					{t('shipping.calc.setPrice', '设置：标价 = 原价 + 运费')}
				</button>
				<span className="text-xs text-gray-500">{t('shipping.calc.helperNote', '后台助手：以当前标价为基准，避免重复叠加。')}</span>
			</div>
		</div>
	);
}
