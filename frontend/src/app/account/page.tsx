'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'react-hot-toast';
import { useCustomer } from '@/store/customer.store';
import { CustomerService } from '@/services/customer.service';
import Layout from '@/components/layout/Layout';
import {
  UserIcon,
  ShoppingBagIcon,
  PhoneIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';

export default function AccountPage() {
  const router = useRouter();
  const { customer, isAuthenticated, logout, checkAuth } = useCustomer();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?returnUrl=/account');
      return;
    }

    // Only check auth and load data if authenticated
    const initialize = async () => {
      await checkAuth();
      await loadData();
    };

    initialize();
  }, [isAuthenticated, router]);

  const loadData = async () => {
    try {
      const ordersData = await CustomerService.getMyOrders();
      setOrders(ordersData || []);
    } catch (error) {
      console.error('Failed to load data:', error);
      // Don't show error toast, just log it
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    router.push('/');
  };

  if (!isAuthenticated || !customer) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="bg-white shadow sm:rounded-lg mb-6">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    Welcome back, {customer.full_name}!
                  </h1>
                  <p className="mt-1 text-sm text-gray-500">{customer.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <ArrowRightOnRectangleIcon className="h-5 w-5 mr-2" />
                  Logout
                </button>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <ShoppingBagIcon className="h-6 w-6 text-gray-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Orders</dt>
                      <dd className="text-lg font-medium text-gray-900">{orders.length}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Navigation Menu */}
            <div className="lg:col-span-1">
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">My Account</h3>
                  <nav className="space-y-1">
                    <Link
                      href="/account"
                      className="group flex items-center px-3 py-2 text-sm font-medium rounded-md bg-gray-100 text-gray-900"
                    >
                      <UserIcon className="mr-3 h-5 w-5 text-gray-500" />
                      Dashboard
                    </Link>
                    <Link
                      href="/account/orders"
                      className="group flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
                    >
                      <ShoppingBagIcon className="mr-3 h-5 w-5 text-gray-400" />
                      My Orders
                    </Link>
                    <Link
                      href="/account/tickets"
                      className="group flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
                    >
                      <PhoneIcon className="mr-3 h-5 w-5 text-gray-400" />
                      Contact Us
                    </Link>
                    <Link
                      href="/account/profile"
                      className="group flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-700 hover:bg-gray-50"
                    >
                      <Cog6ToothIcon className="mr-3 h-5 w-5 text-gray-400" />
                      Profile Settings
                    </Link>
                  </nav>
                </div>
              </div>

              {/* Contact Info */}
              <div className="bg-white shadow sm:rounded-lg mt-6">
                <div className="px-4 py-5 sm:p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Need Help?</h3>
                  <div className="text-sm text-gray-600 space-y-2">
                    <p>sales@vibocnc.com</p>
                    <p>Phone: +86 13348028050</p>

                    <p>Hours: 8AM-19PM</p>
                  </div>
                  <Link
                    href="/account/tickets"
                    className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700"
                  >
                    View Contact Info
                  </Link>
                </div>
              </div>
            </div>

            {/* Recent Orders */}
            <div className="lg:col-span-2">
              <div className="bg-white shadow sm:rounded-lg">
                <div className="px-4 py-5 sm:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Recent Orders</h3>
                    <Link href="/account/orders" className="text-sm text-amber-600 hover:text-amber-500">
                      View all
                    </Link>
                  </div>

                  {loading ? (
                    <div className="text-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto"></div>
                    </div>
                  ) : orders.length > 0 ? (
                    <div className="overflow-hidden">
                      <ul className="divide-y divide-gray-200">
                        {orders.slice(0, 5).map((order) => (
                          <li key={order.id} className="py-4">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-sm font-medium text-gray-900">
                                    Order #{order.order_number}
                                  </p>
                                  <div className="flex items-center space-x-2">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                      order.status === 'delivered'
                                        ? 'bg-green-100 text-green-800'
                                        : order.status === 'shipped'
                                        ? 'bg-blue-100 text-blue-800'
                                        : order.status === 'cancelled'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {order.status}
                                    </span>
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                      order.payment_status === 'paid'
                                        ? 'bg-green-100 text-green-800'
                                        : order.payment_status === 'failed'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                      {order.payment_status}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-sm text-gray-500">
                                  ${order.total_amount.toFixed(2)} • {new Date(order.created_at).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </p>
                                {order.tracking_number ? (
                                  <p className="mt-1 text-xs text-gray-500">
                                    Tracking: <span className="font-mono text-gray-700">{order.tracking_number}</span>
                                  </p>
                                ) : null}
                              </div>
                              <Link
                                href={`/account/orders/${order.id}`}
                                className="ml-4 text-sm font-medium text-amber-600 hover:text-amber-700"
                              >
                                View Details
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <ShoppingBagIcon className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No orders yet</h3>
                      <p className="mt-1 text-sm text-gray-500">Start shopping to see your orders here.</p>
                      <div className="mt-6">
                        <Link
                          href="/products"
                          className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-amber-600 hover:bg-amber-700"
                        >
                          Browse Products
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
