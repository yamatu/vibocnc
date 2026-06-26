'use client';

import { useMemo, useRef, useState } from 'react';
import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { CheckoutFormData } from '@/app/checkout/page';
import { Combobox } from '@headlessui/react';
import {
  UserIcon,
  EnvelopeIcon,
  PhoneIcon,
  MapPinIcon,
  DocumentTextIcon
} from '@heroicons/react/24/outline';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';

type ShippingCountryOption = { country_code: string; country_name: string };

interface CheckoutFormProps {
  register: UseFormRegister<CheckoutFormData>;
  errors: FieldErrors<CheckoutFormData>;
  onSubmit: () => void;
	isProcessing: boolean;
	sameAsShipping: boolean;
	setSameAsShipping: (value: boolean) => void;
	shippingRates?: ShippingCountryOption[];
	shippingRatesLoading?: boolean;
	shippingCountryValue: string;
	onShippingCountryChange: (countryCode: string) => void;
}

export default function CheckoutForm({
  register,
  errors,
  onSubmit,
  isProcessing,
  sameAsShipping,
  setSameAsShipping,
	shippingRates = [],
	shippingRatesLoading = false,
	shippingCountryValue,
	onShippingCountryChange,
}: CheckoutFormProps) {
	const [countryQuery, setCountryQuery] = useState('');
	const countryButtonRef = useRef<HTMLButtonElement | null>(null);

	const selectedCountry = useMemo(() => {
		const code = String(shippingCountryValue || '').toUpperCase();
		return shippingRates.find((c) => String(c.country_code || '').toUpperCase() === code) || null;
	}, [shippingCountryValue, shippingRates]);

	const filteredCountries = useMemo(() => {
		const q = countryQuery.trim().toLowerCase();
		if (!q) return shippingRates;
		return shippingRates.filter((c) => {
			const code = String(c.country_code || '').toLowerCase();
			const name = String(c.country_name || '').toLowerCase();
			return code.includes(q) || name.includes(q);
		});
	}, [countryQuery, shippingRates]);

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="site-form-heading mb-6">
        <UserIcon className="h-6 w-6" />
        <h2 className="text-xl font-semibold text-gray-900">Customer Information</h2>
      </div>

      {/* Customer Name */}
      <div>
        <label htmlFor="customer_name" className="block text-sm font-medium text-gray-700 mb-2">
          Full Name *
        </label>
        <div className="relative">
          <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            id="customer_name"
            {...register('customer_name')}
            className={`site-input w-full pl-10 pr-3 py-2.5 ${
              errors.customer_name ? 'border-red-300' : ''
            }`}
            placeholder="Enter your full name"
          />
        </div>
        {errors.customer_name && (
          <p className="mt-1 text-sm text-red-600">{errors.customer_name.message}</p>
        )}
      </div>

      {/* Email */}
      <div>
        <label htmlFor="customer_email" className="block text-sm font-medium text-gray-700 mb-2">
          Email Address *
        </label>
        <div className="relative">
          <EnvelopeIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="email"
            id="customer_email"
            {...register('customer_email')}
            className={`site-input w-full pl-10 pr-3 py-2.5 ${
              errors.customer_email ? 'border-red-300' : ''
            }`}
            placeholder="Enter your email address"
          />
        </div>
        {errors.customer_email && (
          <p className="mt-1 text-sm text-red-600">{errors.customer_email.message}</p>
        )}
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="customer_phone" className="block text-sm font-medium text-gray-700 mb-2">
          Phone Number *
        </label>
        <div className="relative">
          <PhoneIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="tel"
            id="customer_phone"
            {...register('customer_phone')}
            className={`site-input w-full pl-10 pr-3 py-2.5 ${
              errors.customer_phone ? 'border-red-300' : ''
            }`}
            placeholder="Enter your phone number"
          />
        </div>
        {errors.customer_phone && (
          <p className="mt-1 text-sm text-red-600">{errors.customer_phone.message}</p>
        )}
      </div>

      {/* Shipping Address */}
      <div>
        <label htmlFor="shipping_address" className="block text-sm font-medium text-gray-700 mb-2">
          Shipping Address *
        </label>
        <div className="relative">
          <MapPinIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <textarea
            id="shipping_address"
            {...register('shipping_address')}
            rows={3}
            className={`site-input w-full pl-10 pr-3 py-2.5 resize-none ${
              errors.shipping_address ? 'border-red-300' : ''
            }`}
            placeholder="Enter your complete shipping address"
          />
        </div>
        {errors.shipping_address && (
          <p className="mt-1 text-sm text-red-600">{errors.shipping_address.message}</p>
        )}
      </div>

	  {/* Shipping Country */}
	  <div>
		<label htmlFor="shipping_country" className="block text-sm font-medium text-gray-700 mb-2">
		  Shipping Country *
		</label>
		{/* Keep form field registered for validation */}
		<input type="hidden" {...register('shipping_country')} value={shippingCountryValue || ''} readOnly />

		<Combobox
			value={selectedCountry}
			onChange={(c: ShippingCountryOption | null) => {
				const code = String(c?.country_code || '').toUpperCase();
				onShippingCountryChange(code);
				setCountryQuery('');
			}}
		>
			{({ open }) => (
				<div className="relative">
					<div className="site-input relative w-full cursor-default overflow-hidden text-left">
						<MapPinIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
						<Combobox.Input
							id="shipping_country"
							className={`w-full pl-10 pr-10 py-2 text-sm outline-none ${
								errors.shipping_country ? 'border-red-300' : 'border-gray-300'
							}`}
							displayValue={(c: ShippingCountryOption | null) => (c ? `${c.country_name} (${c.country_code})` : '')}
							onChange={(event) => setCountryQuery(event.target.value)}
							onFocus={() => {
								if (!open) countryButtonRef.current?.click();
							}}
							placeholder={shippingRatesLoading ? 'Loading countries...' : 'Select or search country'}
						/>
						<Combobox.Button ref={countryButtonRef} className="absolute inset-y-0 right-0 flex items-center pr-3">
							<ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
						</Combobox.Button>
					</div>

					<Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none">
						{shippingRatesLoading ? (
							<div className="px-3 py-2 text-gray-500">Loading...</div>
						) : filteredCountries.length === 0 ? (
							<div className="px-3 py-2 text-gray-500">No matches</div>
						) : (
							filteredCountries.map((c) => (
								<Combobox.Option
									key={c.country_code}
									value={c}
									className={({ active }) =>
										`relative cursor-default select-none py-2 pl-9 pr-3 ${active ? 'bg-blue-50 text-blue-950' : 'text-gray-900'}`
									}
								>
									{({ selected }) => (
										<>
											<span className={`block truncate ${selected ? 'font-semibold' : 'font-normal'}`}>
												{c.country_name} ({c.country_code})
											</span>
											{selected ? (
												<span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-800">
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
		{errors.shipping_country && (
		  <p className="mt-1 text-sm text-red-600">{String(errors.shipping_country.message || 'Country is required')}</p>
		)}
	  </div>

      {/* Same as Shipping Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="same_as_shipping"
          checked={sameAsShipping}
          onChange={(e) => setSameAsShipping(e.target.checked)}
          className="h-4 w-4 border-gray-300 rounded"
        />
        <label htmlFor="same_as_shipping" className="ml-2 text-sm text-gray-700">
          Billing address is the same as shipping address
        </label>
      </div>

      {/* Billing Address */}
      <div>
        <label htmlFor="billing_address" className="block text-sm font-medium text-gray-700 mb-2">
          Billing Address *
        </label>
        <div className="relative">
          <MapPinIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <textarea
            id="billing_address"
            {...register('billing_address')}
            rows={3}
            disabled={sameAsShipping}
            className={`site-input w-full pl-10 pr-3 py-2.5 resize-none ${
              errors.billing_address ? 'border-red-300' : ''
            } ${sameAsShipping ? 'bg-gray-50 text-gray-500' : ''}`}
            placeholder={sameAsShipping ? 'Same as shipping address' : 'Enter your billing address'}
          />
        </div>
        {errors.billing_address && (
          <p className="mt-1 text-sm text-red-600">{errors.billing_address.message}</p>
        )}
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
          Order Notes (Optional)
        </label>
        <div className="relative">
          <DocumentTextIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <textarea
            id="notes"
            {...register('notes')}
            rows={3}
            className="site-input w-full pl-10 pr-3 py-2.5 resize-none"
            placeholder="Any special instructions or notes for your order"
          />
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isProcessing}
        className="site-primary-action w-full px-4 py-3 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isProcessing ? (
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            Processing...
          </div>
        ) : (
          'Proceed to Payment'
        )}
      </button>

      <p className="text-xs text-gray-500 text-center">
        By proceeding, you agree to our Terms of Service and Privacy Policy
      </p>
    </form>
  );
}
