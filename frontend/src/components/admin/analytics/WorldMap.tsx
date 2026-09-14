'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

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

export default function WorldMap({
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
