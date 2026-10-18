import Link from 'next/link';
import PublicLayout from '@/components/layout/PublicLayout';

export default function NotFound() {
  return (
    <PublicLayout>
      <section className="mx-auto flex min-h-[50vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
        <p className="text-sm font-semibold text-[#0b3e75]">404</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Page not found</h1>
        <p className="mt-4 text-slate-600">The page you are looking for does not exist or has been moved.</p>
        <div className="mt-8 flex gap-3">
          <Link href="/" className="rounded-md bg-[#0b3e75] px-5 py-2.5 font-semibold text-white hover:bg-[#082f5a]">Home</Link>
          <Link href="/products" className="rounded-md border border-slate-300 px-5 py-2.5 font-semibold text-slate-800 hover:bg-slate-100">Browse products</Link>
        </div>
      </section>
    </PublicLayout>
  );
}
