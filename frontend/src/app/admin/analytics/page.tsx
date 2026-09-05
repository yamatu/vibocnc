'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, useIsFetching } from '@tanstack/react-query';
import { queryKeys } from '@/lib/react-query';
import { AnalyticsService } from '@/services/analytics.service';
import type {
  AnalyticsSettings,
  AnalyticsFilters,
} from '@/services/analytics.service';
import AdminLayout from '@/components/admin/AdminLayout';
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import toast from 'react-hot-toast';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const numericToAlpha2: Record<string, string> = {
  '004':'AF','008':'AL','012':'DZ','020':'AD','024':'AO','028':'AG','032':'AR','051':'AM',
  '036':'AU','040':'AT','031':'AZ','044':'BS','048':'BH','050':'BD','052':'BB','112':'BY',
  '056':'BE','084':'BZ','204':'BJ','064':'BT','068':'BO','070':'BA','072':'BW','076':'BR',
  '096':'BN','100':'BG','854':'BF','108':'BI','116':'KH','120':'CM','124':'CA','132':'CV',
  '140':'CF','148':'TD','152':'CL','156':'CN','170':'CO','174':'KM','178':'CG','180':'CD',
  '188':'CR','384':'CI','191':'HR','192':'CU','196':'CY','203':'CZ','208':'DK','262':'DJ',
  '212':'DM','214':'DO','218':'EC','818':'EG','222':'SV','226':'GQ','232':'ER','233':'EE',
  '231':'ET','242':'FJ','246':'FI','250':'FR','266':'GA','270':'GM','268':'GE','276':'DE',
  '288':'GH','300':'GR','308':'GD','320':'GT','324':'GN','624':'GW','328':'GY','332':'HT',
  '340':'HN','348':'HU','352':'IS','356':'IN','360':'ID','364':'IR','368':'IQ','372':'IE',
  '376':'IL','380':'IT','388':'JM','392':'JP','400':'JO','398':'KZ','404':'KE','296':'KI',
  '408':'KP','410':'KR','414':'KW','417':'KG','418':'LA','428':'LV','422':'LB','426':'LS',
  '430':'LR','434':'LY','438':'LI','440':'LT','442':'LU','807':'MK','450':'MG','454':'MW',
  '458':'MY','462':'MV','466':'ML','470':'MT','584':'MH','478':'MR','480':'MU','484':'MX',
  '583':'FM','498':'MD','492':'MC','496':'MN','499':'ME','504':'MA','508':'MZ','104':'MM',
  '516':'NA','520':'NR','524':'NP','528':'NL','554':'NZ','558':'NI','562':'NE','566':'NG',
  '578':'NO','512':'OM','586':'PK','585':'PW','591':'PA','598':'PG','600':'PY','604':'PE',
  '608':'PH','616':'PL','620':'PT','634':'QA','642':'RO','643':'RU','646':'RW','659':'KN',
  '662':'LC','670':'VC','882':'WS','674':'SM','678':'ST','682':'SA','686':'SN','688':'RS',
  '690':'SC','694':'SL','702':'SG','703':'SK','705':'SI','090':'SB','706':'SO','710':'ZA',
  '728':'SS','724':'ES','144':'LK','729':'SD','740':'SR','748':'SZ','752':'SE','756':'CH',
  '760':'SY','158':'TW','762':'TJ','834':'TZ','764':'TH','626':'TL','768':'TG','776':'TO',
  '780':'TT','788':'TN','792':'TR','795':'TM','798':'TV','800':'UG','804':'UA','784':'AE',
  '826':'GB','840':'US','858':'UY','860':'UZ','548':'VU','862':'VE','704':'VN','887':'YE',
  '894':'ZM','716':'ZW','275':'PS','-99':'XK',
};

interface GeoFeature {
  type: string;
  id: string;
  properties: { name: string };
  geometry: GeoPermissibleObjects;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// (no in-page sidebar – the admin layout sidebar handles navigation)

// ---------------------------------------------------------------------------
// World Map
// ---------------------------------------------------------------------------
function WorldMap({
  countryData,
  onCountryClick,
  selectedCountry,
}: {
  countryData: Record<string, { count: number; name: string }>;
  onCountryClick: (code: string, name: string) => void;
  selectedCountry: string | null;
}) {
  const [features, setFeatures] = useState<GeoFeature[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipContent, setTooltipContent] = useState('');
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(GEO_URL)
      .then((r) => r.json())
      .then((topo: Topology) => {
        if (cancelled) return;
        const geojson = feature(topo, topo.objects.countries as GeometryCollection);
        setFeatures(geojson.features as unknown as GeoFeature[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const maxCount = useMemo(() => {
    const vals = Object.values(countryData).map((v) => v.count);
    return vals.length > 0 ? Math.max(...vals, 1) : 1;
  }, [countryData]);

  const projection = useMemo(
    () => geoNaturalEarth1().scale(147).translate([480, 250]).rotate([-10, 0, 0]),
    []
  );
  const pathGen = useMemo(() => geoPath().projection(projection), [projection]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 20 });
  }, []);

  if (features.length === 0) {
    return <div className="h-64 flex items-center justify-center text-gray-400">Loading map...</div>;
  }

  return (
    <div ref={containerRef} className="relative" onMouseMove={handleMouseMove}>
      {tooltipContent && tooltipPos && (
        <div
          className="absolute z-50 bg-gray-900 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          {tooltipContent}
        </div>
      )}
      <svg viewBox="0 0 960 500" className="w-full h-auto">
        {features.map((f) => {
          const id = f.id;
          const alpha2 = numericToAlpha2[id];
          const entry = alpha2 ? countryData[alpha2] : undefined;
          const intensity = entry ? Math.min(entry.count / maxCount, 1) : 0;
          const isHovered = hoveredId === id;
          const isSelected = alpha2 === selectedCountry;
          let fill: string;
          if (isSelected) fill = '#1D4ED8';
          else if (isHovered) fill = '#2563EB';
          else if (intensity > 0) fill = `rgba(59, 130, 246, ${0.15 + intensity * 0.85})`;
          else fill = '#E5E7EB';
          const d = pathGen(f.geometry as GeoPermissibleObjects);
          if (!d) return null;
          return (
            <path
              key={id}
              d={d}
              fill={fill}
              stroke={isSelected ? '#1E3A8A' : isHovered ? '#1D4ED8' : '#D1D5DB'}
              strokeWidth={isSelected ? 1.5 : isHovered ? 1 : 0.5}
              onMouseEnter={() => {
                setHoveredId(id);
                if (entry) setTooltipContent(`${entry.name}: ${entry.count.toLocaleString()} visitors (click for details)`);
                else setTooltipContent(f.properties?.name || '');
              }}
              onMouseLeave={() => { setHoveredId(null); setTooltipContent(''); setTooltipPos(null); }}
              onClick={() => { if (alpha2 && entry) onCountryClick(alpha2, entry.name); }}
              style={{ cursor: entry ? 'pointer' : 'default' }}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Analytics Page
// ---------------------------------------------------------------------------
export default function AnalyticsPage() {
  const queryClient = useQueryClient();

  // Date filters
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return formatDate(d); });
  const [endDate, setEndDate] = useState(() => formatDate(new Date()));
  const [includeBots, setIncludeBots] = useState(false);

  // Country drill-down
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCountryName, setSelectedCountryName] = useState('');
  const [countryVisitorPage, setCountryVisitorPage] = useState(1);

  // SKU country filter
  const [skuCountryFilter, setSkuCountryFilter] = useState('');

  // Visitor table
  const [visitorPage, setVisitorPage] = useState(1);
  const [visitorIP, setVisitorIP] = useState('');
  const [visitorCountry, setVisitorCountry] = useState('');
  const [visitorBotFilter, setVisitorBotFilter] = useState('');

  // Settings
  const [cleanupDate, setCleanupDate] = useState('');
  const [trackingCodeDraft, setTrackingCodeDraft] = useState('');

  const baseFilters: AnalyticsFilters = useMemo(() => ({ start: startDate, end: endDate }), [startDate, endDate]);

  // Queries
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: queryKeys.analytics.overview(baseFilters),
    queryFn: () => AnalyticsService.getOverview(baseFilters),
  });
  const { data: trends } = useQuery({
    queryKey: queryKeys.analytics.trends(baseFilters),
    queryFn: () => AnalyticsService.getTrends(baseFilters),
  });
  const { data: countries } = useQuery({
    queryKey: queryKeys.analytics.countries({ ...baseFilters, is_bot: includeBots ? undefined : 'false' }),
    queryFn: () => AnalyticsService.getCountries({ ...baseFilters, is_bot: includeBots ? undefined : 'false' }),
  });
  const { data: pages } = useQuery({
    queryKey: queryKeys.analytics.pages({ ...baseFilters, limit: 10 }),
    queryFn: () => AnalyticsService.getPages({ ...baseFilters, limit: 10 }),
  });
  const { data: productSKUs } = useQuery({
    queryKey: queryKeys.analytics.productSKUs({ ...baseFilters, country: skuCountryFilter || undefined, limit: 20 }),
    queryFn: () => AnalyticsService.getProductSKUs({ ...baseFilters, country: skuCountryFilter || undefined, limit: 20 }),
  });
  const { data: countrySKUs } = useQuery({
    queryKey: queryKeys.analytics.countrySKUs({ ...baseFilters, limit: 10 }),
    queryFn: () => AnalyticsService.getCountrySKUs({ ...baseFilters, limit: 10 }),
  });

  // Country drill-down query
  const countryVisitorFilters = useMemo(() => ({
    ...baseFilters, country: selectedCountry || undefined, page: countryVisitorPage, page_size: 15,
  }), [baseFilters, selectedCountry, countryVisitorPage]);

  const { data: countryVisitors } = useQuery({
    queryKey: queryKeys.analytics.countryVisitors(countryVisitorFilters),
    queryFn: () => AnalyticsService.getCountryVisitors(countryVisitorFilters),
    enabled: !!selectedCountry,
  });

  const visitorFilters: AnalyticsFilters = useMemo(() => ({
    ...baseFilters, page: visitorPage, page_size: 15,
    country: visitorCountry || undefined, is_bot: visitorBotFilter || undefined, ip: visitorIP || undefined,
  }), [baseFilters, visitorPage, visitorCountry, visitorBotFilter, visitorIP]);

  const { data: visitors } = useQuery({
    queryKey: queryKeys.analytics.visitors(visitorFilters),
    queryFn: () => AnalyticsService.getVisitors(visitorFilters),
  });
  const isAnalyticsRefreshing = useIsFetching({ queryKey: queryKeys.analytics.all() }) > 0;
  const { data: settings } = useQuery({
    queryKey: queryKeys.analytics.settings(),
    queryFn: () => AnalyticsService.getSettings(),
  });
  useEffect(() => {
    if (settings) setTrackingCodeDraft(settings.tracking_code || '');
  }, [settings]);

  const handleRefreshAnalytics = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all() });
  }, [queryClient]);

  // Mutations
  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<Pick<AnalyticsSettings, 'retention_days' | 'auto_cleanup_enabled' | 'tracking_enabled' | 'tracking_code_enabled' | 'tracking_code'>>) =>
      AnalyticsService.updateSettings(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.analytics.settings() }); toast.success('Settings updated'); },
    onError: (err: Error) => toast.error(err.message),
  });
  const cleanupMutation = useMutation({
    mutationFn: (before: string) => AnalyticsService.manualCleanup(before),
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all() }); toast.success(`Deleted ${data.deleted_count} records before ${data.before}`); },
    onError: (err: Error) => toast.error(err.message),
  });

  // Country map data
  const countryMapData = useMemo(() => {
    if (!countries) return {};
    const m: Record<string, { count: number; name: string }> = {};
    for (const c of countries) { if (c.country_code) m[c.country_code] = { count: c.count, name: c.country }; }
    return m;
  }, [countries]);

  const botPieData = useMemo(() => {
    if (!overview) return [];
    const humans = overview.total_visitors - overview.total_bots;
    return [{ name: 'Human', value: humans > 0 ? humans : 0 }, { name: 'Bot', value: overview.total_bots }];
  }, [overview]);

  const handleCountryClick = useCallback((code: string, name: string) => {
    setSelectedCountry(code);
    setSelectedCountryName(name);
    setCountryVisitorPage(1);
  }, []);

  return (
    <AdminLayout>
    <div className="space-y-6">
        {/* Header + Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-2xl font-bold text-gray-900">Visitor Analytics</h2>
          <div className="flex flex-wrap items-center gap-3">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm" />
            <span className="text-gray-500">to</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm" />
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={includeBots} onChange={(e) => setIncludeBots(e.target.checked)} className="rounded border-gray-300" />
              Include bots
            </label>
          </div>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Visitors" value={overview?.total_visitors ?? '-'} loading={overviewLoading} color="blue" />
          <StatCard label="Unique IPs" value={overview?.unique_ips ?? '-'} loading={overviewLoading} color="green" />
          <StatCard label="Bot %" value={overview ? `${overview.bot_percentage.toFixed(1)}%` : '-'} loading={overviewLoading} color="yellow" />
          <StatCard label="Top Country" value={overview?.top_country ? `${overview.top_country} (${overview.top_country_count})` : '-'} loading={overviewLoading} color="purple" />
        </div>

        {/* World Map */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-1">Visitor Geography</h3>
          <p className="text-xs text-gray-400 mb-3">Click a country on the map to see visitor IPs below</p>
          <WorldMap countryData={countryMapData} onCountryClick={handleCountryClick} selectedCountry={selectedCountry} />
          {countries && countries.length > 0 && (
            <div className="mt-4 max-h-48 overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left text-gray-500"><th className="pb-1 font-medium">Country</th><th className="pb-1 font-medium text-right">Visitors</th></tr></thead>
                <tbody>
                  {countries.slice(0, 20).map((c) => (
                    <tr
                      key={c.country_code}
                      className={`border-t border-gray-100 cursor-pointer hover:bg-blue-50 ${selectedCountry === c.country_code ? 'bg-blue-50' : ''}`}
                      onClick={() => handleCountryClick(c.country_code, c.country)}
                    >
                      <td className="py-1">{c.country} ({c.country_code})</td>
                      <td className="py-1 text-right font-medium">{c.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Country Visitors Detail (drill-down) */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">
              {selectedCountry ? `${selectedCountryName} (${selectedCountry}) - Visitor IPs` : 'Country Visitors'}
            </h3>
            {selectedCountry && (
              <button onClick={() => { setSelectedCountry(null); setSelectedCountryName(''); }} className="text-xs text-gray-500 hover:text-gray-700 underline">
                Clear selection
              </button>
            )}
          </div>
          {!selectedCountry ? (
            <p className="text-sm text-gray-400 py-8 text-center">Click a country on the map above to see visitor IPs</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 font-medium">IP Address</th>
                      <th className="pb-2 font-medium">City</th>
                      <th className="pb-2 font-medium">Region</th>
                      <th className="pb-2 font-medium text-right">Visits</th>
                      <th className="pb-2 font-medium">Last Visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countryVisitors?.data?.map((v, i) => (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="py-2 font-mono text-xs">{v.ip_address}</td>
                        <td className="py-2">{v.city || '-'}</td>
                        <td className="py-2">{v.region || '-'}</td>
                        <td className="py-2 text-right font-medium">{v.visit_count}</td>
                        <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(v.last_visit).toLocaleString()}</td>
                      </tr>
                    ))}
                    {(!countryVisitors?.data || countryVisitors.data.length === 0) && (
                      <tr><td colSpan={5} className="py-8 text-center text-gray-400">No visitor records</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {countryVisitors && countryVisitors.total_pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-gray-500">Page {countryVisitors.page} of {countryVisitors.total_pages} ({countryVisitors.total} IPs)</span>
                  <div className="flex gap-2">
                    <button onClick={() => setCountryVisitorPage((p) => Math.max(1, p - 1))} disabled={countryVisitors.page <= 1} className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50">Prev</button>
                    <button onClick={() => setCountryVisitorPage((p) => Math.min(countryVisitors.total_pages, p + 1))} disabled={countryVisitors.page >= countryVisitors.total_pages} className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-lg font-semibold mb-3">Daily Traffic Trends</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip /><Legend />
                <Line type="monotone" dataKey="total" stroke="#3B82F6" name="Total" dot={false} />
                <Line type="monotone" dataKey="unique_ips" stroke="#10B981" name="Unique IPs" dot={false} />
                <Line type="monotone" dataKey="bots" stroke="#F59E0B" name="Bots" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-lg font-semibold mb-3">Bot vs Human Traffic</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={botPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {botPieData.map((_, index) => (<Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Hot Products (SKU) */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="text-lg font-semibold">Hot Products (SKU)</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Filter by country:</span>
              <input
                type="text" placeholder="e.g. US" value={skuCountryFilter}
                onChange={(e) => setSkuCountryFilter(e.target.value.toUpperCase())}
                className="px-2 py-1 border border-gray-300 rounded-md text-sm w-20"
              />
              {skuCountryFilter && (
                <button onClick={() => setSkuCountryFilter('')} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">SKU</th>
                  <th className="pb-2 font-medium text-right">Views</th>
                  <th className="pb-2 font-medium text-right">Unique IPs</th>
                  <th className="pb-2 font-medium">Top Country</th>
                </tr>
              </thead>
              <tbody>
                {productSKUs?.map((p, i) => (
                  <tr key={p.sku} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 font-mono text-xs font-medium text-blue-600">{p.sku}</td>
                    <td className="py-2 text-right font-medium">{p.count.toLocaleString()}</td>
                    <td className="py-2 text-right">{p.unique_ips.toLocaleString()}</td>
                    <td className="py-2">{p.top_country || '-'}</td>
                  </tr>
                ))}
                {(!productSKUs || productSKUs.length === 0) && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-400">No product visit data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Country SKU Preferences */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-3">Country SKU Preferences</h3>
          <p className="text-xs text-gray-400 mb-4">Which SKUs each country is most interested in</p>
          {countrySKUs && countrySKUs.length > 0 ? (
            <div className="space-y-4">
              {countrySKUs.map((cs) => (
                <div key={cs.country_code} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">
                      {cs.country} ({cs.country_code})
                    </span>
                    <span className="text-xs text-gray-500">{cs.total_views.toLocaleString()} product views</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {cs.top_skus.map((s) => (
                      <span key={s.sku} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-mono">
                        {s.sku}
                        <span className="text-blue-400">({s.count})</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-gray-400 text-sm">No country SKU data</p>
          )}
        </div>

        {/* Top Pages */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-3">Top 10 Visited Pages</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pages ?? []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="path" width={200} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#3B82F6" name="Views" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Visitor Logs Table */}
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-3 gap-3">
            <h3 className="text-lg font-semibold">Visitor Log</h3>
            <button
              onClick={handleRefreshAnalytics}
              disabled={isAnalyticsRefreshing}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyticsRefreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
          <div className="flex flex-wrap gap-3 mb-4">
            <input type="text" placeholder="Filter by IP..." value={visitorIP} onChange={(e) => { setVisitorIP(e.target.value); setVisitorPage(1); }} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-40" />
            <input type="text" placeholder="Country code..." value={visitorCountry} onChange={(e) => { setVisitorCountry(e.target.value.toUpperCase()); setVisitorPage(1); }} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm w-32" />
            <select value={visitorBotFilter} onChange={(e) => { setVisitorBotFilter(e.target.value); setVisitorPage(1); }} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm">
              <option value="">All traffic</option>
              <option value="false">Humans only</option>
              <option value="true">Bots only</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">IP</th><th className="pb-2 font-medium">Country</th><th className="pb-2 font-medium">City</th>
                  <th className="pb-2 font-medium">Path</th><th className="pb-2 font-medium">Bot</th><th className="pb-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {visitors?.data?.map((v) => (
                  <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-2 font-mono text-xs">{v.ip_address}</td>
                    <td className="py-2">{v.country_code || '-'}</td>
                    <td className="py-2">{v.city || '-'}</td>
                    <td className="py-2 max-w-[200px] truncate" title={v.path}>
                      {v.path.startsWith('/products/') ? (
                        <span className="text-blue-600 font-medium">{v.path}</span>
                      ) : v.path}
                    </td>
                    <td className="py-2">
                      {v.is_bot
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">{v.bot_name || 'Bot'}</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Human</span>}
                    </td>
                    <td className="py-2 text-xs text-gray-500 whitespace-nowrap">{new Date(v.created_at).toLocaleString()}</td>
                  </tr>
                ))}
                {(!visitors?.data || visitors.data.length === 0) && (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">No visitor records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {visitors && visitors.total_pages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-500">Page {visitors.page} of {visitors.total_pages} ({visitors.total} total)</span>
              <div className="flex gap-2">
                <button onClick={() => setVisitorPage((p) => Math.max(1, p - 1))} disabled={visitors.page <= 1} className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50">Prev</button>
                <button onClick={() => setVisitorPage((p) => Math.min(visitors.total_pages, p + 1))} disabled={visitors.page >= visitors.total_pages} className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50">Next</button>
              </div>
            </div>
          )}
        </div>

        {/* Settings Panel */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-4">Analytics Settings</h3>
          {settings && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.tracking_enabled} onChange={(e) => updateSettingsMutation.mutate({ tracking_enabled: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm">Tracking Enabled</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.auto_cleanup_enabled} onChange={(e) => updateSettingsMutation.mutate({ auto_cleanup_enabled: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm">Auto Cleanup</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  Retention:
                  <input type="number" min={1} max={3650} value={settings.retention_days}
                    onChange={(e) => { const v = parseInt(e.target.value, 10); if (v > 0) updateSettingsMutation.mutate({ retention_days: v }); }}
                    className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm" />
                  days
                </label>
              </div>
              {settings.last_cleanup_at && (
                <p className="text-xs text-gray-500">Last auto-cleanup: {new Date(settings.last_cleanup_at).toLocaleString()}</p>
              )}
              <div className="flex items-end gap-3 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Manual Cleanup: delete records before</label>
                  <input type="date" value={cleanupDate} onChange={(e) => setCleanupDate(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm" />
                </div>
                <button
                  onClick={() => { if (!cleanupDate) { toast.error('Select a date first'); return; } if (confirm(`Delete all visitor records before ${cleanupDate}?`)) cleanupMutation.mutate(cleanupDate); }}
                  disabled={!cleanupDate || cleanupMutation.isPending}
                  className="px-4 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {cleanupMutation.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={settings.tracking_code_enabled}
                    onChange={(e) => updateSettingsMutation.mutate({ tracking_code_enabled: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  Enable website tracking code
                </label>
                <p className="mt-1 text-xs text-gray-500">Paste the complete Google tag snippet. It will be loaded in the public site head when enabled.</p>
                <textarea
                  value={trackingCodeDraft}
                  onChange={(e) => setTrackingCodeDraft(e.target.value)}
                  placeholder={'<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>'}
                  rows={7}
                  spellCheck={false}
                  className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => updateSettingsMutation.mutate({ tracking_code: trackingCodeDraft })}
                  disabled={updateSettingsMutation.isPending}
                  className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateSettingsMutation.isPending ? 'Saving...' : 'Save tracking code'}
                </button>
              </div>
            </div>
          )}
        </div>

    </div>
    </AdminLayout>
  );
}

function StatCard({ label, value, loading, color }: { label: string; value: string | number; loading: boolean; color: 'blue' | 'green' | 'yellow' | 'purple' }) {
  const colorMap = { blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700', yellow: 'bg-yellow-50 text-yellow-700', purple: 'bg-purple-50 text-purple-700' };
  return (
    <div className={`rounded-lg p-4 ${colorMap[color]}`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="mt-1 text-2xl font-bold">
        {loading ? <span className="inline-block w-16 h-7 bg-current opacity-10 rounded animate-pulse" /> : typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
