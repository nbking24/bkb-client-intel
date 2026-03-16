// ============================================================
// Cost Catalog Helpers
// Fetches and caches the BKB org cost catalog from JobTread
// for use by the Estimating Agent
// ============================================================

import { createServerClient } from './supabase';

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = () => process.env.JOBTREAD_ORG_ID || '22P5SRwhLaYe';

// -- Types --

export interface CatalogCostItem {
  id: string;
  name: string;
  description: string | null;
  costCode: { id: string; name: string; number: string } | null;
  costType: { id: string; name: string } | null;
  unit: { id: string; name: string; abbreviation: string } | null;
  unitCost: number;
  unitPrice: number;
  quantity: number;
  isTaxable: boolean;
}

export interface CostCodeRef {
  id: string;
  name: string;
  number: string;
}

export interface CostTypeRef {
  id: string;
  name: string;
}

export interface UnitRef {
  id: string;
  name: string;
  abbreviation: string;
}

export interface CostCatalog {
  items: CatalogCostItem[];
  costCodes: CostCodeRef[];
  costTypes: CostTypeRef[];
  units: UnitRef[];
  fetchedAt: string;
}

// -- PAVE helpers (lightweight, just for catalog) --

async function pave(query: Record<string, unknown>) {
  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey: JT_KEY() }, ...query } }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PAVE error ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0]?.message || 'PAVE error');
  return json;
}

async function orgQuery(collection: string, params: Record<string, unknown>) {
  const data = await pave({
    organization: { $: { id: JT_ORG() }, [collection]: params },
  });
  return (data as any)?.organization?.[collection] || {};
}

// -- Fetch functions --

export async function fetchCostCodes(): Promise<CostCodeRef[]> {
  const result = await orgQuery('costCodes', {
    $: { size: 50 },
    nodes: { id: {}, name: {}, number: {} },
  });
  return (result.nodes || []).map((n: any) => ({
    id: n.id,
    name: n.name,
    number: n.number || '',
  }));
}

export async function fetchCostTypes(): Promise<CostTypeRef[]> {
  const result = await orgQuery('costTypes', {
    $: { size: 20 },
    nodes: { id: {}, name: {} },
  });
  return (result.nodes || []).map((n: any) => ({
    id: n.id,
    name: n.name,
  }));
}

export async function fetchUnits(): Promise<UnitRef[]> {
  const result = await orgQuery('units', {
    $: { size: 20 },
    nodes: { id: {}, name: {}, abbreviation: {} },
  });
  return (result.nodes || []).map((n: any) => ({
    id: n.id,
    name: n.name,
    abbreviation: n.abbreviation || '',
  }));
}

export async function fetchCatalogItems(): Promise<CatalogCostItem[]> {
  const allItems: CatalogCostItem[] = [];
  let cursor: string | null = null;
  const PAGE_SIZE = 200;

  // Paginate through all org cost items
  while (true) {
    const params: Record<string, unknown> = {
      $: { size: PAGE_SIZE, ...(cursor ? { after: cursor } : {}) },
      nodes: {
        id: {},
        name: {},
        description: {},
        quantity: {},
        unitCost: {},
        unitPrice: {},
        isTaxable: {},
        costCode: { id: {}, name: {}, number: {} },
        costType: { id: {}, name: {} },
        unit: { id: {}, name: {}, abbreviation: {} },
      },
    };

    const result = await orgQuery('costItems', params);
    const nodes = result.nodes || [];

    for (const n of nodes) {
      allItems.push({
        id: n.id,
        name: n.name || '',
        description: n.description || null,
        costCode: n.costCode ? { id: n.costCode.id, name: n.costCode.name, number: n.costCode.number || '' } : null,
        costType: n.costType ? { id: n.costType.id, name: n.costType.name } : null,
        unit: n.unit ? { id: n.unit.id, name: n.unit.name, abbreviation: n.unit.abbreviation || '' } : null,
        unitCost: n.unitCost || 0,
        unitPrice: n.unitPrice || 0,
        quantity: n.quantity || 1,
        isTaxable: n.isTaxable || false,
      });
    }

    if (nodes.length < PAGE_SIZE) break;
    cursor = nodes[nodes.length - 1]?.id;
    if (!cursor) break;
  }

  return allItems;
}

// -- Full catalog fetch --

export async function fetchFullCatalog(): Promise<CostCatalog> {
  const [items, costCodes, costTypes, units] = await Promise.all([
    fetchCatalogItems(),
    fetchCostCodes(),
    fetchCostTypes(),
    fetchUnits(),
  ]);

  return {
    items,
    costCodes,
    costTypes,
    units,
    fetchedAt: new Date().toISOString(),
  };
}

// -- Caching via Supabase --

const CACHE_KEY = 'cost-catalog';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedCatalog(): Promise<CostCatalog> {
  try {
    const sb = createServerClient();
    const { data } = await sb
      .from('agent_cache')
      .select('data, updated_at')
      .eq('key', CACHE_KEY)
      .single();

    if (data?.data && data.updated_at) {
      const age = Date.now() - new Date(data.updated_at).getTime();
      if (age < CACHE_TTL_MS) {
        return data.data as CostCatalog;
      }
    }
  } catch {
    // Cache miss or error — fetch fresh
  }

  // Fetch fresh and cache
  const catalog = await fetchFullCatalog();

  try {
    const sb = createServerClient();
    await sb.from('agent_cache').upsert({
      key: CACHE_KEY,
      data: catalog,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Cache write failure is non-fatal
  }

  return catalog;
}

// -- Lookup helpers --

export function findCostCodeId(catalog: CostCatalog, codeNumber: string): string | null {
  const code = catalog.costCodes.find(
    (c) => c.number === codeNumber || c.name.startsWith(codeNumber)
  );
  return code?.id || null;
}

export function findCostTypeId(catalog: CostCatalog, typeName: string): string | null {
  const ct = catalog.costTypes.find(
    (t) => t.name.toLowerCase() === typeName.toLowerCase()
  );
  return ct?.id || null;
}

export function findUnitId(catalog: CostCatalog, unitName: string): string | null {
  const u = catalog.units.find(
    (u) => u.name.toLowerCase() === unitName.toLowerCase() ||
           u.abbreviation.toLowerCase() === unitName.toLowerCase()
  );
  return u?.id || null;
}

export function findCatalogItemsByCode(catalog: CostCatalog, codeNumber: string): CatalogCostItem[] {
  return catalog.items.filter(
    (item) => item.costCode?.number === codeNumber
  );
}

// -- Format catalog for AI context --

export function formatCatalogForAgent(catalog: CostCatalog): string {
  const lines: string[] = [];

  lines.push('## BKB Cost Catalog Reference\n');

  // Cost codes
  lines.push('### Cost Codes');
  for (const cc of catalog.costCodes.sort((a, b) => a.number.localeCompare(b.number))) {
    lines.push(`- ${cc.number} ${cc.name} (ID: ${cc.id})`);
  }

  // Cost types
  lines.push('\n### Cost Types');
  for (const ct of catalog.costTypes) {
    lines.push(`- ${ct.name} (ID: ${ct.id})`);
  }

  // Units
  lines.push('\n### Units');
  for (const u of catalog.units) {
    lines.push(`- ${u.name} [${u.abbreviation}] (ID: ${u.id})`);
  }

  // Catalog items grouped by cost code
  lines.push('\n### Catalog Items by Cost Code\n');
  const byCode = new Map<string, CatalogCostItem[]>();
  for (const item of catalog.items) {
    const key = item.costCode?.number || '??';
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key)!.push(item);
  }

  const sortedEntries = Array.from(byCode.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [code, items] of sortedEntries) {
    const codeName = catalog.costCodes.find((c) => c.number === code)?.name || '';
    lines.push(`#### ${code} ${codeName}`);
    for (const item of items.slice(0, 30)) { // Limit per code to manage context size
      const parts = [item.name];
      if (item.costType) parts.push(item.costType.name);
      if (item.unit) parts.push(item.unit.abbreviation);
      if (item.unitCost > 0) parts.push(`$${item.unitCost}/${item.unitPrice}`);
      if (item.description) parts.push(`"${item.description.slice(0, 60)}"`);
      lines.push(`  - ${parts.join(' | ')} (ID: ${item.id})`);
    }
    if (items.length > 30) {
      lines.push(`  ... and ${items.length - 30} more items`);
    }
  }

  return lines.join('\n');
}
