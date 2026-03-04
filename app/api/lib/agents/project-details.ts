// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import {
  getJob, getActiveJobs, getSpecificationsForJob, getDocumentsForJob, getFilesForJob,
} from '../../../lib/jobtread';

// ============================================================
// PROJECT DETAILS AGENT
// Answers questions about project specifications, scope of work,
// materials, documents, and project details by fetching the
// Specifications URL from the job's custom fields.
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
 * server-side rendering with Puppeteer. Falls back to PAVE API data.
 */
async function fetchSpecificationsPageContent(url: string): Promise<string | null> {
  try {
    // Try Puppeteer with @sparticuz/chromium for Vercel serverless
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

    // Wait a bit more for SPA to render
    await new Promise(r => setTimeout(r, 2000));

    // Extract the main content text
    const content = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      return main.innerText;
    });

    await browser.close();
    return content || null;
  } catch (err: any) {
    console.warn('[project-details] Puppeteer fetch failed:', err?.message);
    return null;
  }
}

/**
 * Build a text representation of specifications from PAVE API data.
 * This is the fallback when Puppeteer is not available.
 */
function formatPaveSpecifications(specs: any): string {
  const lines: string[] = [];

  if (specs.description) {
    lines.push('SPECIFICATIONS DESCRIPTION:');
    lines.push(specs.description.slice(0, 3000));
    lines.push('');
  }

  // Documents section (Project Details)
  if (specs.documents && specs.documents.length > 0) {
    lines.push('📋 PROJECT DOCUMENTS (' + specs.documents.length + '):');
    for (const doc of specs.documents) {
      lines.push('  • ' + doc.name + ' [' + doc.type + '] — ' + doc.status);
    }
    lines.push('');
  }

  // Cost items grouped by cost group (Scope of Work sections)
  const grouped = specs.groupedItems || {};
  const groupNames = Object.keys(grouped);

  if (groupNames.length > 0) {
    lines.push('🔨 SCOPE OF WORK / SPECIFICATIONS (' + specs.items.length + ' total items):');
    lines.push('');

    for (const groupName of groupNames) {
      const items = grouped[groupName];
      lines.push('--- ' + groupName + ' (' + items.length + ' items) ---');
      for (const item of items) {
        const code = item.costCode ? ' (' + item.costCode.number + ')' : '';
        lines.push('  • ' + item.name + code);
        if (item.description) {
          lines.push('    ' + item.description.slice(0, 500));
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
  description: 'Answers questions about project specifications, scope of work, materials, documents, and project details.',
  icon: '📋',

  systemPrompt: (ctx: AgentContext) => {
    return (
      'You are the Project Details agent for Brett King Builder (BKB). You answer questions about ' +
      'project specifications, scope of work, materials, documents, change orders, and project details.\n\n' +
      'You have access to the full specifications data for each job, which includes:\n' +
      '- Project documents (contracts, change orders, permits, plan sets)\n' +
      '- Scope of work items grouped by category (rooms, trades, phases)\n' +
      '- Material specifications and descriptions\n' +
      '- Cost codes and cost groups\n\n' +
      'INSTRUCTIONS:\n' +
      '- Use the get_project_details tool to fetch specifications for a job.\n' +
      '- If you have the JobTread Job ID from context, use it directly. Otherwise, use search_jobs to find it.\n' +
      '- Answer questions thoroughly based on the specification data. Quote specific items, descriptions, and details.\n' +
      '- If a search term is provided, use it to filter results.\n' +
      '- NEVER make up information. Only answer based on what is in the specifications data.\n' +
      '- If the specifications data does not contain the answer, say so clearly and provide the Specifications URL if available so the user can check directly.\n' +
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
      description: 'Search for a job by name, number, or client name. Use this when you need to find a job ID.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term (job name, number, or client)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_project_details',
      description: 'Get the full project specifications for a job. Returns all cost items grouped by cost group (scope of work), project documents, and specifications description/footer. This is the same data shown on the JobTread Specifications page. Use the search parameter to filter by keyword (e.g. "door", "window", "kitchen", "plumbing").',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
          search: { type: 'string', description: 'Optional keyword to filter specifications (e.g. "door", "soffit", "window", "kitchen"). Recommended for specific questions.' },
        },
        required: ['jobId'],
      },
    },
    {
      name: 'get_job_files',
      description: 'Get files/attachments uploaded to a job. Returns file names, URLs, and types.',
      input_schema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'The JobTread Job ID' },
        },
        required: ['jobId'],
      },
    },
  ],

  canHandle: (message: string): number => {
    const lower = message.toLowerCase();

    // High confidence: specification/scope/material questions
    if (/(specification|spec\b|scope of work|scope|material|what.*included|what.*excluded)/i.test(lower)) return 0.95;
    if (/(what.*door|what.*window|what.*floor|what.*cabinet|what.*counter|what.*tile|what.*roof|what.*siding)/i.test(lower)) return 0.92;
    if (/(what.*planned|what.*budgeted|what.*approved|what.*specified)/i.test(lower)) return 0.90;
    if (/(project details|project info|project overview)/i.test(lower)) return 0.90;

    // Medium-high: document/contract/change order questions
    if (/(change order|CO\b|contract|proposal|permit|plan.?set)/i.test(lower)) return 0.85;
    if (/(what.*in the|what.*on the).*(project|job|house|pool|build)/i.test(lower)) return 0.80;

    // Medium: general project questions that might be about details
    if (/(tell me about|details|breakdown|describe|list.*items|what.*include)/i.test(lower)) return 0.70;
    if (/(file|attachment|document|drawing|plan|elevation)/i.test(lower)) return 0.70;

    // Low: could be about a project but not clearly specs
    if (/(kitchen|bathroom|bedroom|living|garage|pool|deck|patio|basement)/i.test(lower) &&
        /(what|tell|describe|show|list)/i.test(lower)) return 0.65;

    return 0;
  },

  fetchContext: async (ctx: AgentContext): Promise<string> => {
    // Pre-fetch job details if we have a job ID to get the Specifications URL
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

  executeTool: async (name: string, input: any, ctx: AgentContext): Promise<string> => {
    try {
      if (name === 'search_jobs') {
        const allJobs = await getActiveJobs(50);
        const query = (input.query || '').toLowerCase().trim();
        let filtered = allJobs;
        if (query) {
          filtered = allJobs.filter((j: any) => {
            const searchable = [j.name, j.number, j.clientName, j.locationName]
              .filter(Boolean).join(' ').toLowerCase();
            return searchable.includes(query);
          });
        }
        if (!filtered || filtered.length === 0) return JSON.stringify({ success: true, message: 'No jobs found matching "' + input.query + '".' });
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
          // We got the full rendered page content
          let content = pageContent;

          // Filter by search term if provided
          if (searchTerm) {
            const sections = content.split(/\n(?=[🔨⚙️🎨🏠📋📝])/);
            const matchingSections = sections.filter(s =>
              s.toLowerCase().includes(searchTerm)
            );
            if (matchingSections.length > 0) {
              content = matchingSections.join('\n\n');
            } else {
              // Search line by line
              const lines = content.split('\n');
              const matchingLines: string[] = [];
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(searchTerm)) {
                  // Include context (2 lines before and after)
                  const start = Math.max(0, i - 2);
                  const end = Math.min(lines.length, i + 3);
                  matchingLines.push('...');
                  matchingLines.push(...lines.slice(start, end));
                }
              }
              content = matchingLines.length > 0
                ? matchingLines.join('\n')
                : 'No content found matching "' + input.search + '" in the specifications page.';
            }
          }

          // Truncate to fit in context
          if (content.length > 15000) {
            content = content.slice(0, 15000) + '\n\n... [Content truncated. ' + (pageContent.length - 15000) + ' more characters available. Use a search term to narrow results.]';
          }

          return JSON.stringify({
            success: true,
            source: 'specifications_page',
            specificationsUrl: specUrl,
            content: content,
          });
        }

        // Step 3: Fallback to PAVE API data
        const specs = await getSpecificationsForJob(jobId);
        const paveContent = formatPaveSpecifications(specs);

        if (searchTerm) {
          // Filter the PAVE content by search term
          const lines = paveContent.split('\n');
          const matchingLines: string[] = [];
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(searchTerm)) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 2);
              matchingLines.push(...lines.slice(start, end));
              matchingLines.push('');
            }
          }
          if (matchingLines.length === 0) {
            return JSON.stringify({
              success: true,
              source: 'pave_api',
              specificationsUrl: specUrl,
              message: 'No specifications found matching "' + input.search + '".' + (specUrl ? ' You can check the full specifications at: ' + specUrl : ''),
            });
          }
          return JSON.stringify({
            success: true,
            source: 'pave_api',
            specificationsUrl: specUrl,
            totalItems: specs.items.length,
            content: matchingLines.join('\n'),
          });
        }

        // Truncate to fit in context
        let content = paveContent;
        if (content.length > 15000) {
          content = content.slice(0, 15000) + '\n\n... [Content truncated. Use a search term to narrow results.]';
        }

        return JSON.stringify({
          success: true,
          source: 'pave_api',
          specificationsUrl: specUrl,
          totalItems: specs.items.length,
          totalGroups: Object.keys(specs.groupedItems || {}).length,
          content: content,
        });
      }

      if (name === 'get_job_files') {
        const files = await getFilesForJob(input.jobId);
        if (!files || files.length === 0) {
          return JSON.stringify({ success: true, message: 'No files found for this job.' });
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
      console.error('[project-details] Tool error (' + name + '):', err?.message);
      return JSON.stringify({ error: 'Error: ' + (err?.message || 'Unknown error') });
    }
  },
};

export default projectDetails;
