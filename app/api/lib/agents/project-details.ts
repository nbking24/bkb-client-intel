// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import {
  getJob,
  getActiveJobs,
  getSpecificationsForJob,
  getDocumentsForJob,
  getFilesForJob,
} from '../../../lib/jobtread';

// ============================================================
// PROJECT DETAILS AGENT
// Answers questions about project specifications, scope of work,
// materials, documents, and project details by fetching the
// Specifications URL from the job's custom fields.
//
// HIERARCHY AWARENESS:
// The JobTread Specifications page organizes items in a hierarchy:
//   Area/Location (e.g. "Exterior / General", "Covered Barn Roof")
//     └─ Cost Group (e.g. "07 Siding & Exterior Trim")
//         └─ Line Items (e.g. "James Hardie Lap Siding 7 1/4")
//
// This agent preserves that hierarchy when extracting and
// presenting specification data to the user.
// ============================================================

/**
 * Extract the "Specifications - URL" from a job's custom field values.
 */
function getSpecificationsUrl(job: any): string | null {
  const cfvNodes = job?.customFieldValues?.nodes || [];
  const specField = cfvNodes.find(
    (cfv: any) =>
      cfv.customField?.name?.toLowerCase().includes('specifications') &&
      cfv.customField?.name?.toLowerCase().includes('url')
  );
  return specField?.value || null;
}

/**
 * Try to fetch and render the specifications page content.
 * The JobTread Specifications URL is a React SPA, so we attempt
 * server-side rendering with Puppeteer.
 *
 * IMPORTANT: This extracts STRUCTURED content that preserves the
 * area/location hierarchy visible on the page. The page has:
 *  - Area tags (yellow badges like "Exterior / General")
 *  - Cost group sections (like "07 Siding & Exterior Trim")
 *  - Individual line items with descriptions
 */
async function fetchSpecificationsPageContent(url: string): Promise<string | null> {
  try {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for SPA to render
    await new Promise(r => setTimeout(r, 3000));

    // Extract structured content preserving hierarchy
    const content = await page.evaluate(() => {
      const lines: string[] = [];
      let currentArea = 'General';
      let currentCostGroup = '';

      // The specifications page renders content in a scrollable container.
      // We traverse all elements looking for:
      // 1. Area/location tags (colored badges/chips)
      // 2. Cost group headers (section headings with numbers like "07 Siding")
      // 3. Item names and descriptions (nested under groups)

      const main = document.querySelector('main') || document.body;
      const allElements = main.querySelectorAll('*');

      for (const el of allElements) {
        const tag = el.tagName.toLowerCase();
        const text = el.textContent?.trim() || '';
        if (!text) continue;

        // Detect area/location tags — these are typically styled badges/chips
        // They contain text like "Exterior / General", "Covered Barn Roof", etc.
        // They often have a colored background and appear as inline elements
        const style = window.getComputedStyle(el);
        const bgColor = style.backgroundColor;
        const isChip = (
          el.classList.contains('chip') ||
          el.classList.contains('badge') ||
          el.classList.contains('tag') ||
          el.getAttribute('data-tag') !== null ||
          // Yellow/colored background badges (not white/transparent)
          (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent' &&
           bgColor !== 'rgb(255, 255, 255)' &&
           el.children.length === 0 &&
           text.length < 60 &&
           !text.match(/^\d/) &&
           (text.includes('/') || text.includes('Room') || text.includes('Floor') ||
            text.includes('Exterior') || text.includes('Interior') ||
            text.includes('Kitchen') || text.includes('Bath') ||
            text.includes('Garage') || text.includes('Barn') ||
            text.includes('Pool') || text.includes('Porch') ||
            text.includes('Deck') || text.includes('Patio') ||
            text.includes('Basement') || text.includes('Attic') ||
            text.includes('Master') || text.includes('Covered') ||
            text.includes('General')))
        );

        if (isChip && text.length > 2 && text.length < 60) {
          currentArea = text;
          lines.push('');
          lines.push('═══════════════════════════════════════════');
          lines.push('📍 AREA: ' + currentArea);
          lines.push('═══════════════════════════════════════════');
          continue;
        }

        // Detect cost group headers (like "02 Sitework & Demolition")
        // These are typically h2/h3/h4 or bold text starting with a number
        const isCostGroupHeader = (
          (tag === 'h2' || tag === 'h3' || tag === 'h4') &&
          /^\d{2}\s/.test(text)
        ) || (
          style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 600
        ) && /^\d{2}\s/.test(text) && text.length < 80 && el.children.length <= 1;

        if (isCostGroupHeader && text.length > 3 && text.length < 80) {
          currentCostGroup = text;
          lines.push('');
          lines.push('--- ' + currentCostGroup + ' [Area: ' + currentArea + '] ---');
          continue;
        }
      }

      // If structured extraction didn't capture much, fall back to innerText
      // but add area markers where we can detect them
      if (lines.filter(l => l.trim()).length < 10) {
        const rawText = main.innerText || '';
        return rawText;
      }

      return lines.join('\n');
    });

    // If structured extraction was sparse, fall back to enhanced innerText
    let finalContent = content || '';

    if (!finalContent.includes('AREA:') && !finalContent.includes('═══')) {
      // Structured extraction didn't work well, use enhanced innerText
      const rawContent = await page.evaluate(() => {
        const main = document.querySelector('main') || document.body;
        return main.innerText || '';
      });
      finalContent = rawContent;
    }

    await browser.close();
    return finalContent || null;
  } catch (err: any) {
    console.warn('[project-details] Puppeteer fetch failed:', err?.message);
    return null;
  }
}

/**
 * Build a text representation of specifications from PAVE API data.
 * This is the fallback when Puppeteer is not available.
 * Preserves hierarchy: Area/Location → Cost Group → Items
 */
function formatPaveSpecifications(specs: any): string {
  const lines: string[] = [];

  if (specs.description) {
    lines.push('SPECIFICATIONS DESCRIPTION:');
    lines.push(specs.description.slice(0, 3000));
    lines.push('');
  }

  // Documents section
  if (specs.documents && specs.documents.length > 0) {
    lines.push('PROJECT DOCUMENTS (' + specs.documents.length + '):');
    for (const doc of specs.documents) {
      lines.push('  • ' + doc.name + ' [' + doc.type + '] — ' + doc.status);
    }
    lines.push('');
  }

  // Cost items grouped by cost group
  // NOTE: The PAVE API doesn't directly expose the "area/location" tags
  // that appear on the Specifications page. The area tags come from
  // a different data structure in the SPA. So in PAVE fallback mode,
  // we group by cost group only.
  const grouped = specs.groupedItems || {};
  const groupNames = Object.keys(grouped);

  if (groupNames.length > 0) {
    lines.push('SCOPE OF WORK / SPECIFICATIONS (' + specs.items.length + ' total items):');
    lines.push('');

    for (const groupName of groupNames) {
      const items = grouped[groupName];
      lines.push('--- ' + groupName + ' (' + items.length + ' items) ---');

      for (const item of items) {
        const code = item.costCode ? ' (' + item.costCode.number + ')' : '';
        lines.push('  • ' + item.name + code);
        if (item.description) {
          // Preserve description structure - it may contain area/location info
          lines.push('    ' + item.description.slice(0, 800));
        }
      }
      lines.push('');
    }
  }

  if (specs.footer) {
    lines.push('SPECIFICATIONS FOOTER:');
    lines.push(specs.footer.slice(0, 2000));
  }

  return lines.join('\n');
}

const projectDetails: AgentModule = {
  name: 'project-details',
  description:
    'Answers questions about project specifications, scope of work, materials, documents, and project details.',
  icon: '📋',

  systemPrompt: (ctx: AgentContext) => {
    return (
      'You are the Project Details agent for Brett King Builder (BKB). You answer questions about ' +
      'project specifications, scope of work, materials, documents, change orders, and project details.\n\n' +
      'You have access to the full specifications data for each job, which includes:\n' +
      '- Project documents (contracts, change orders, permits, plan sets)\n' +
      '- Scope of work items grouped by AREA/LOCATION and then by COST GROUP (trade category)\n' +
      '- Material specifications and descriptions\n' +
      '- Cost codes and cost groups\n\n' +

      'CRITICAL HIERARCHY RULES:\n' +
      'The specifications are organized in a hierarchy that you MUST respect in your answers:\n' +
      '  1. AREA / LOCATION (e.g. "Exterior / General", "Covered Barn Roof", "Kitchen", "Master Bath")\n' +
      '     These define WHERE the work is being done.\n' +
      '  2. COST GROUP (e.g. "07 Siding & Exterior Trim", "09 Drywall & Painting")\n' +
      '     These define the TRADE CATEGORY.\n' +
      '  3. LINE ITEMS (e.g. "James Hardie Lap Siding 7 1/4 Exposure")\n' +
      '     These are the specific materials and work items.\n\n' +

      'When answering questions:\n' +
      '- ALWAYS organize your response by AREA/LOCATION first, then by items within each area.\n' +
      '- If items appear in multiple areas, list them SEPARATELY for each area.\n' +
      '- For example, if asked "what siding is being used?" and there are two areas:\n' +
      '  * "Exterior / General" has James Hardie Lap Siding\n' +
      '  * "Covered Barn Roof" has Board & Batten Siding\n' +
      '  Then your answer should clearly state which siding goes in which area.\n' +
      '- NEVER lump items from different areas together without identifying the area.\n' +
      '- If the data includes area markers (like "📍 AREA:" or "[Area: ...]"), use those.\n' +
      '- If the data does NOT have clear area markers, organize by cost group instead.\n\n' +

      'FORMATTING RULES:\n' +
      '- Use clear section headers for each area/location.\n' +
      '- Include specific details: measurements, quantities, materials, brands, models.\n' +
      '- Quote directly from the specifications when possible.\n' +
      '- If multiple options exist (like Option 1, Option 2), list each option with its details.\n' +
      '- Keep responses well-organized but thorough.\n\n' +

      'OTHER INSTRUCTIONS:\n' +
      '- Use the get_project_details tool to fetch specifications for a job.\n' +
      '- If you have the JobTread Job ID from context, use it directly. Otherwise, use search_jobs to find it.\n' +
      '- NEVER make up information. Only answer based on what is in the specifications data.\n' +
      '- If the specifications data does not contain the answer, say so clearly.\n' +
      '- When referencing specific items, include their cost group, cost code, and description.\n' +
      '- For file/document questions, list the documents found and their status.\n\n' +

      (ctx.jtJobId ? 'JobTread Job ID: ' + ctx.jtJobId + '\n' : '') +
      (ctx.contactName ? 'Client: ' + ctx.contactName + '\n' : '') +
      (ctx.opportunityName ? 'Project: ' + ctx.opportunityName + '\n' : '')
    );
  },

  tools: [
    {
      name: 'search_jobs',
      description:
        'Search for a job by name, number, or client name. Use this when you need to find a job ID.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term (job name, number, or client)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_project_details',
      description:
        'Get the full project specifications for a job. Returns all specification items organized by ' +
        'AREA/LOCATION and COST GROUP, preserving the hierarchy from the Specifications page. ' +
        'Areas define WHERE work is done (e.g. "Exterior / General", "Covered Barn Roof"). ' +
        'Cost groups define the TRADE (e.g. "07 Siding"). Line items are the specific specs. ' +
        'Use the search parameter to filter by keyword (e.g. "siding", "door", "window").',
      input_schema: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'The JobTread Job ID',
          },
          search: {
            type: 'string',
            description:
              'Optional keyword to filter specifications (e.g. "siding", "door", "window", "kitchen"). ' +
              'Recommended for specific questions to get focused results.',
          },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_files',
      description:
        'Get files/attachments uploaded to a job. Returns file names, URLs, and types.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            description: 'The JobTread Job ID',
          },
        },
        required: ['jobId'],
      },
    },
  ],

  canHandle: (message: string): number => {
    const lower = message.toLowerCase();

    // High confidence: specification/scope/material questions
    if (
      /(specification|spec\b|scope of work|scope|material|what.*included|what.*excluded)/i.test(
        lower
      )
    )
      return 0.95;
    if (
      /(what.*door|what.*window|what.*floor|what.*cabinet|what.*counter|what.*tile|what.*roof|what.*siding)/i.test(
        lower
      )
    )
      return 0.92;
    if (
      /(what.*planned|what.*budgeted|what.*approved|what.*specified)/i.test(lower)
    )
      return 0.90;
    if (/(project details|project info|project overview)/i.test(lower))
      return 0.90;
    // "give me all the details" / "details of the siding" etc.
    if (/(give me.*detail|all.*detail|detail.*of)/i.test(lower)) return 0.92;
    // "where is it getting installed" / "where does it go"
    if (/(where.*install|where.*go|where.*being|where.*getting)/i.test(lower))
      return 0.93;

    // Medium-high: document/contract/change order questions
    if (
      /(change order|CO\b|contract|proposal|permit|plan.?set)/i.test(lower)
    )
      return 0.85;
    if (
      /(what.*in the|what.*on the).*(project|job|house|pool|build)/i.test(
        lower
      )
    )
      return 0.80;

    // Medium: general project questions
    if (
      /(tell me about|details|breakdown|describe|list.*items|what.*include)/i.test(
        lower
      )
    )
      return 0.70;
    if (
      /(file|attachment|document|drawing|plan|elevation)/i.test(lower)
    )
      return 0.70;

    // Low: could be about a project but not clearly specs
    if (
      /(kitchen|bathroom|bedroom|living|garage|pool|deck|patio|basement)/i.test(
        lower
      ) &&
      /(what|tell|describe|show|list)/i.test(lower)
    )
      return 0.65;

    return 0;
  },

  fetchContext: async (ctx: AgentContext): Promise<string> => {
    if (!ctx.jtJobId) return '';
    try {
      const job = await getJob(ctx.jtJobId);
      if (!job) return '';

      const specUrl = getSpecificationsUrl(job);
      const lines: string[] = [];
      lines.push('Job: ' + job.name + ' (#' + job.number + ')');
      lines.push('Client: ' + job.clientName);
      if (specUrl) {
        lines.push('Specifications URL: ' + specUrl);
      }
      return lines.join('\n');
    } catch {
      return '';
    }
  },

  executeTool: async (
    name: string,
    input: any,
    ctx: AgentContext
  ): Promise<string> => {
    try {
      if (name === 'search_jobs') {
        const allJobs = await getActiveJobs(50);
        const query = (input.query || '').toLowerCase().trim();
        let filtered = allJobs;
        if (query) {
          filtered = allJobs.filter((j: any) => {
            const searchable = [
              j.name,
              j.number,
              j.clientName,
              j.locationName,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return searchable.includes(query);
          });
        }
        if (!filtered || filtered.length === 0)
          return JSON.stringify({
            success: true,
            message: 'No jobs found matching "' + input.query + '".',
          });
        return JSON.stringify({
          success: true,
          count: filtered.length,
          jobs: filtered.slice(0, 10).map((j: any) => ({
            id: j.id,
            name: j.name,
            number: j.number,
            client: j.clientName || j.location?.account?.name || '',
            status: j.customStatus || j.status,
          })),
        });
      }

      if (name === 'get_project_details') {
        const jobId = input.jobId;
        const searchTerm = (input.search || '').toLowerCase().trim();

        // Step 1: Get job info and Specifications URL
        const job = await getJob(jobId);
        const specUrl = job ? getSpecificationsUrl(job) : null;

        // Step 2: Try to fetch the actual Specifications page content
        let pageContent: string | null = null;
        if (specUrl) {
          pageContent = await fetchSpecificationsPageContent(specUrl);
        }

        if (pageContent) {
          let content = pageContent;

          // Filter by search term if provided
          if (searchTerm) {
            const lines = content.split('\n');
            const matchingLines: string[] = [];
            let lastAreaHeader = '';
            let lastGroupHeader = '';

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];

              // Track current area and group headers
              if (line.includes('AREA:') || line.includes('═══')) {
                lastAreaHeader = line;
                continue;
              }
              if (line.startsWith('--- ') && line.includes('[Area:')) {
                lastGroupHeader = line;
                continue;
              }

              // Check if this line matches the search term
              if (line.toLowerCase().includes(searchTerm)) {
                // Include the area header if we haven't already
                if (
                  lastAreaHeader &&
                  !matchingLines.includes(lastAreaHeader)
                ) {
                  matchingLines.push('');
                  matchingLines.push(lastAreaHeader);
                }
                // Include the group header if we haven't already
                if (
                  lastGroupHeader &&
                  !matchingLines.includes(lastGroupHeader)
                ) {
                  matchingLines.push(lastGroupHeader);
                }

                // Include context lines (2 before, 5 after for description)
                const start = Math.max(0, i - 2);
                const end = Math.min(lines.length, i + 6);
                for (let j = start; j < end; j++) {
                  if (!matchingLines.includes(lines[j])) {
                    matchingLines.push(lines[j]);
                  }
                }
              }
            }

            if (matchingLines.length > 0) {
              content = matchingLines.join('\n');
            } else {
              // Broader search - check if ANY line matches
              const broadMatch = lines.filter(l =>
                l.toLowerCase().includes(searchTerm)
              );
              if (broadMatch.length > 0) {
                content = broadMatch.join('\n');
              } else {
                content =
                  'No content found matching "' +
                  input.search +
                  '" in the specifications.\n' +
                  'Try a broader search term or check the Specifications URL directly.';
              }
            }
          }

          // Truncate to fit in context
          if (content.length > 15000) {
            content =
              content.slice(0, 15000) +
              '\n\n... [Content truncated. ' +
              (pageContent.length - 15000) +
              ' more characters available. Use a search term to narrow results.]';
          }

          return JSON.stringify({
            success: true,
            source: 'specifications_page',
            specificationsUrl: specUrl,
            hierarchyNote:
              'Content is organized by AREA/LOCATION → COST GROUP → LINE ITEMS. ' +
              'Look for "📍 AREA:" markers or "[Area: ...]" tags to identify which area each item belongs to.',
            content: content,
          });
        }

        // Step 3: Fallback to PAVE API data
        const specs = await getSpecificationsForJob(jobId);
        const paveContent = formatPaveSpecifications(specs);

        if (searchTerm) {
          const lines = paveContent.split('\n');
          const matchingLines: string[] = [];
          let lastGroupHeader = '';

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('--- ')) {
              lastGroupHeader = line;
              continue;
            }
            if (line.toLowerCase().includes(searchTerm)) {
              if (
                lastGroupHeader &&
                !matchingLines.includes(lastGroupHeader)
              ) {
                matchingLines.push('');
                matchingLines.push(lastGroupHeader);
              }
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 3);
              for (let j = start; j < end; j++) {
                if (!matchingLines.includes(lines[j])) {
                  matchingLines.push(lines[j]);
                }
              }
            }
          }

          if (matchingLines.length === 0) {
            return JSON.stringify({
              success: true,
              source: 'pave_api',
              specificationsUrl: specUrl,
              message:
                'No specifications found matching "' +
                input.search +
                '".' +
                (specUrl
                  ? ' You can check the full specifications at: ' + specUrl
                  : ''),
            });
          }

          return JSON.stringify({
            success: true,
            source: 'pave_api',
            specificationsUrl: specUrl,
            totalItems: specs.items.length,
            hierarchyNote:
              'PAVE API data is organized by COST GROUP. Area/location data may not be fully available in this view. ' +
              'Check the Specifications URL for complete area assignments.',
            content: matchingLines.join('\n'),
          });
        }

        let content = paveContent;
        if (content.length > 15000) {
          content =
            content.slice(0, 15000) +
            '\n\n... [Content truncated. Use a search term to narrow results.]';
        }

        return JSON.stringify({
          success: true,
          source: 'pave_api',
          specificationsUrl: specUrl,
          totalItems: specs.items.length,
          totalGroups: Object.keys(specs.groupedItems || {}).length,
          hierarchyNote:
            'PAVE API data is organized by COST GROUP. Area/location tags may not be fully available. ' +
            'Check the Specifications URL for complete area assignments.',
          content: content,
        });
      }

      if (name === 'get_job_files') {
        const files = await getFilesForJob(input.jobId);
        if (!files || files.length === 0) {
          return JSON.stringify({
            success: true,
            message: 'No files found for this job.',
          });
        }
        return JSON.stringify({
          success: true,
          count: files.length,
          files: files.slice(0, 30).map((f: any) => ({
            id: f.id,
            name: f.name,
            url: f.url || f.downloadUrl || null,
            type: f.contentType || f.type || 'unknown',
            createdAt: f.createdAt,
          })),
        });
      }

      return JSON.stringify({ error: 'Unknown tool: ' + name });
    } catch (err: any) {
      console.error(
        '[project-details] Tool error (' + name + '):',
        err?.message
      );
      return JSON.stringify({
        error: 'Error: ' + (err?.message || 'Unknown error'),
      });
    }
  },
};

export default projectDetails;
