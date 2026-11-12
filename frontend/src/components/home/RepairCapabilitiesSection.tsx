'use client';

import Link from 'next/link';
import {
  BoltIcon,
  CircleStackIcon,
  ComputerDesktopIcon,
  CpuChipIcon,
  PowerIcon,
  RectangleGroupIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import type { HomepageContent } from '@/types';
import { usePublicI18n } from '@/lib/i18n/PublicI18nProvider';

const ICONS = [ComputerDesktopIcon, BoltIcon, CpuChipIcon, PowerIcon, CircleStackIcon, RectangleGroupIcon, WrenchScrewdriverIcon, CpuChipIcon];

const DEFAULT_CAPABILITIES = [
  { title: 'HMI Panel Repair', description: 'Evaluation for failed displays, touch response problems, communication faults and operator panel power issues.', faults: ['Cracked or dim screens', 'Touch issues', 'Communication faults'], brands: 'Allen-Bradley, Siemens, Omron, Schneider and more' },
  { title: 'Servo Drive Repair', description: 'Fault analysis and repair support for servo amplifiers and motion drives with unstable output or alarm conditions.', faults: ['Power faults', 'Feedback problems', 'Communication errors'], brands: 'FANUC, Siemens, Mitsubishi, Yaskawa and more' },
  { title: 'PLC Module Repair', description: 'Assessment of CPU, I/O and communication modules that no longer operate reliably in an automation system.', faults: ['CPU faults', 'I/O channel issues', 'Network problems'], brands: 'Allen-Bradley, Siemens, Schneider, Omron and more' },
  { title: 'Power Supply Repair', description: 'Diagnosis of industrial power supplies with no output, low voltage, intermittent startup or internal component failure.', faults: ['No output', 'Low voltage', 'Intermittent power'], brands: 'Major industrial power supply manufacturers' },
  { title: 'Servo Motor Repair', description: 'Support for servo motors affected by feedback errors, overheating, unstable motion or mechanical wear.', faults: ['Encoder faults', 'Overheating', 'Bearing or feedback issues'], brands: 'FANUC, Mitsubishi, Yaskawa, Bosch Rexroth and more' },
  { title: 'CNC Control Board Repair', description: 'Board-level evaluation for controller cards with boot, power, interface or communication circuit faults.', faults: ['Board faults', 'Power issues', 'Communication failures'], brands: 'FANUC, Siemens, Mitsubishi, ABB and more' },
  { title: 'Inverter Repair', description: 'Repair evaluation for industrial variable-frequency drives with power-stage, speed-control and trip faults.', faults: ['Drive trips', 'Power-stage failure', 'Speed-control issues'], brands: 'Danfoss, ABB, Schneider, Siemens and more' },
  { title: 'Industrial Electronic Repair', description: 'Component-level assessment for legacy control boards, specialty modules and industrial electronic assemblies.', faults: ['Board repair', 'Component-level work', 'Legacy electronics'], brands: 'Industrial controls, circuit boards and specialty hardware' },
];

type RepairCapability = (typeof DEFAULT_CAPABILITIES)[number];

function parseCapabilities(content?: HomepageContent | null): RepairCapability[] {
  const raw = content?.data;
  if (!raw) return DEFAULT_CAPABILITIES;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed?.capabilities) && parsed.capabilities.length > 0
      ? parsed.capabilities as RepairCapability[]
      : DEFAULT_CAPABILITIES;
  } catch { return DEFAULT_CAPABILITIES; }
}

export default function RepairCapabilitiesSection({ content }: { content?: HomepageContent | null }) {
  const { href } = usePublicI18n();
  const capabilities = parseCapabilities(content);
  return (
    <section id="repair-capabilities" className="home-deferred-section bg-white py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--site-primary)]">Our repair capabilities</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{content?.title || 'What We Repair'}</h2>
          <p className="mt-5 text-lg leading-8 text-slate-600">
            {content?.description || 'We evaluate automation parts for repair and replacement, including HMI panels, servo drives, motors, CNC boards, power supplies, PLC modules, inverters and other industrial electronics. If a unit is not listed, send the model and fault details for review.'}
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {capabilities.slice(0, 12).map((item, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <article key={item.title} className="rounded-lg border border-slate-200 bg-slate-50 p-6 shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-blue-50 text-[var(--site-primary)]"><Icon className="h-6 w-6" /></div>
                <h3 className="mt-5 text-xl font-bold text-slate-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.description}</p>
                <ul className="mt-5 space-y-2 border-t border-slate-200 pt-4">
                  {(item.faults || []).slice(0, 4).map((fault: string) => <li key={fault} className="flex gap-2 text-sm font-medium text-slate-700"><span className="text-orange-600">•</span>{fault}</li>)}
                </ul>
                <p className="mt-5 text-xs leading-5 text-slate-500"><strong className="text-slate-700">Typical coverage:</strong> {item.brands}</p>
              </article>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-5 rounded-lg bg-slate-950 p-7 text-white sm:flex-row sm:items-center">
          <div><h3 className="text-xl font-bold">Not sure whether your unit can be repaired?</h3><p className="mt-2 text-sm leading-6 text-slate-300">Request an initial evaluation and ask about available replacement stock before committing.</p></div>
          <Link href={href(content?.button_url || '/repair-request')} className="shrink-0 rounded-md bg-orange-700 px-6 py-3 font-bold text-white hover:bg-[var(--site-primary)]">{content?.button_text || 'Request Repair Evaluation'}</Link>
        </div>
      </div>
    </section>
  );
}
