'use client';

import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, MinusIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '@/store/cart.store';
import { formatCurrency, getDefaultProductImageWithSku, getProductImageUrl, toProductPathId } from '@/lib/utils';

export function CartSidebar() {
  const {
    isOpen,
    closeCart,
    items,
    total,
    itemCount,
    updateQuantity,
    removeItem,
    clearCart,
  } = useCart();

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={closeCart}>
        <Transition.Child
          as={Fragment}
          enter="ease-in-out duration-500"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in-out duration-500"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-500 sm:duration-700"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-500 sm:duration-700"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-md">
                  <div className="flex h-full flex-col overflow-y-scroll bg-white shadow-xl">
                    {/* Header */}
                    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
                      <div className="flex items-start justify-between">
                        <Dialog.Title className="text-lg font-medium text-gray-900">
                          Shopping Cart ({itemCount} {itemCount === 1 ? 'item' : 'items'})
                        </Dialog.Title>
                        <div className="ml-3 flex h-7 items-center space-x-2">
                          {items.length > 0 && (
                            <button
                              type="button"
                              className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                              onClick={() => {
                                if (window.confirm('Clear all items from your cart?')) {
                                  clearCart();
                                }
                              }}
                            >
                              Clear All
                            </button>
                          )}
                          <button
                            type="button"
                            className="relative -m-2 p-2 text-gray-400 hover:text-gray-500"
                            onClick={closeCart}
                          >
                            <span className="absolute -inset-0.5" />
                            <span className="sr-only">Close panel</span>
                            <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {/* Cart Items */}
                      <div className="mt-8">
                        <div className="flow-root">
                          {items.length === 0 ? (
                            <div className="text-center py-12">
                              <div className="text-gray-400 mb-4">
                                <svg
                                  className="mx-auto h-12 w-12"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                                  />
                                </svg>
                              </div>
                              <p className="text-gray-500">Your cart is empty</p>
                              <Link
                                href="/products"
                                className="site-primary-action mt-4 px-6 py-2"
                                onClick={closeCart}
                              >
                                Continue Shopping
                              </Link>
                            </div>
                          ) : (
                            <ul role="list" className="-my-6 divide-y divide-gray-200">
                              {items.map((item) => (
                                <li key={item.product.id} className="flex py-6">
                                  <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-md border border-gray-200">
                                    <Image
                                      src={getProductImageUrl(item.product.image_urls || [], getDefaultProductImageWithSku(item.product.sku, '/images/default-product.svg'))}
                                      alt={`${item.product.name} - ${item.product.sku} FANUC Part`}
                                      width={96}
                                      height={96}
                                      className="h-full w-full object-cover object-center"
                                      loading="lazy"
                                    />
                                  </div>

                                  <div className="ml-4 flex flex-1 flex-col">
                                    <div>
                                      <div className="flex justify-between text-base font-medium text-gray-900">
                                        <h3>
                                          <Link
                                             href={`/products/${toProductPathId(item.product.sku)}`}

                                            onClick={closeCart}
                                            className="hover:text-[#0b3e75]"
                                          >
                                            {item.product.name}
                                          </Link>
                                        </h3>
                                        <p className="ml-4">{formatCurrency(item.product.price)}</p>
                                      </div>
                                      <p className="mt-1 text-sm text-gray-500">
                                        SKU: {item.product.sku}
                                      </p>
                                    </div>
                                    
                                    <div className="flex flex-1 items-end justify-between text-sm">
                                      <div className="flex items-center space-x-2">
                                        <button
                                          onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                          className="p-1 text-gray-400 hover:text-gray-600"
                                          disabled={item.quantity <= 1}
                                        >
                                          <MinusIcon className="h-4 w-4" />
                                        </button>
                                        
                                        <span className="text-gray-500 min-w-[2rem] text-center">
                                          {item.quantity}
                                        </span>
                                        
                                        <button
                                          onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                          className="p-1 text-gray-400 hover:text-gray-600"
                                        >
                                          <PlusIcon className="h-4 w-4" />
                                        </button>
                                      </div>

                                      <div className="flex">
                                        <button
                                          type="button"
                                          onClick={() => removeItem(item.product.id)}
                                          className="font-medium text-red-600 hover:text-red-500"
                                        >
                                          <TrashIcon className="h-4 w-4" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer */}
                    {items.length > 0 && (
                      <div className="border-t border-gray-200 px-4 py-6 sm:px-6">
                        <div className="flex justify-between text-base font-medium text-gray-900">
                          <p>Subtotal</p>
                          <p>{formatCurrency(total)}</p>
                        </div>
                        <p className="mt-0.5 text-sm text-gray-500">
                          Shipping calculated at checkout.
                        </p>
                        <div className="mt-6 space-y-3">
                          <Link
                            href="/checkout/guest"
                            className="site-primary-action px-6 py-3 text-base"
                            onClick={closeCart}
                          >
                            Buy Now
                          </Link>
                          <Link
                            href="/checkout"
                            className="flex items-center justify-center rounded-md border border-gray-300 bg-white px-6 py-3 text-base font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
                            onClick={closeCart}
                          >
                            Checkout with Account
                          </Link>
                        </div>
                        <div className="mt-6 flex justify-center text-center text-sm text-gray-500">
                          <p>
                            or{' '}
                            <button
                              type="button"
                              className="site-link-accent"
                              onClick={closeCart}
                            >
                              Continue Shopping
                              <span aria-hidden="true"> &rarr;</span>
                            </button>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

export default CartSidebar;

