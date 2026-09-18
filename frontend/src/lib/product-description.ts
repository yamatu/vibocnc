// Legacy AI-generated product descriptions embedded the same facts that the
// storefront already renders in dedicated sections (the "Part Details" panel,
// the specification table and the compatibility block). Newly generated copy no
// longer does that, but already-published products keep their stored text.
//
// This helper removes those duplicated blocks at render time, so an old product
// stops showing the same data twice without rewriting or losing the stored
// description. It only touches copy that is clearly machine generated (it must
// contain a generated marker) and only removes blocks whose heading matches a
// dedicated section that is actually being rendered.
const GENERATED_COPY_MARKERS = ['Why buy from Vibocnc', 'Typical applications'];

const SPEC_TABLE_FOOTNOTE_PREFIX = 'Values above are taken from the catalogue record';

export interface DuplicateDescriptionOptions {
  hasSpecifications?: boolean;
  hasCompatibility?: boolean;
}

export function stripDuplicateGeneratedSections(
  description: string,
  options: DuplicateDescriptionOptions = {},
): string {
  const text = String(description ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return description;
  if (!GENERATED_COPY_MARKERS.some(marker => text.includes(marker))) return description;

  const removableHeadings = new Set(['key details']);
  if (options.hasSpecifications) removableHeadings.add('technical specifications');
  if (options.hasCompatibility) removableHeadings.add('compatibility and ordering guidance');

  const blocks = text.split(/\n{2,}/);
  const kept = blocks.filter(block => {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) return false;
    if (options.hasSpecifications && trimmedBlock.startsWith(SPEC_TABLE_FOOTNOTE_PREFIX)) return false;
    const heading = trimmedBlock.split('\n')[0].trim().replace(/[:：]\s*$/, '').toLowerCase();
    return !removableHeadings.has(heading);
  });

  const cleaned = kept.join('\n\n').trim();
  return cleaned.length > 0 ? cleaned : description;
}
