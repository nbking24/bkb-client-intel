// @ts-nocheck
import { AgentModule, AgentContext } from './types';
import {
  getJob,
  getActiveJobs,
  getCostItemsLightForJob,
  getDocumentStatusesForJob,
  getFilesForJob,
  JTCostItem,
} from '../../../lib/jobtread';

// ============================================================
// PROJECT DETAILS AGENT
// Answers questions about project specifications, scope of work,
// materials, documents, and project details by fetching cost items
// from the PAVE API with full hierarchy (parentCostGroup = area).
//
// HIERARCHY:
//   Area/Location (parentCostGroup, e.g. "🏠 Exterior / General")
//     └─ Cost Group (e.g. "07 Siding & Exterior Trim")
//         └─ Line Items (e.g. "James Hardie Lap Siding 7 1/4")
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
 * Build a structured text representation from cost items using parentCostGroup hierarchy.
 * Groups items by Area (parentCostGroup) → Cost Group → Line Items with file attachments.
 */
function formatCostItemsWithHierarchy(
  items: JTCostItem[],
  searchTerm?: string
): { content: string; attachments: Array<{ fileName: string; downloadUrl: string; context: string }> } {
  // Optionally filter items by search term
  let filtered = items;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = items.filter((item) => {
      const searchable = [
        item.name,
        item.description,
        item.costGroup?.name,
        item.costGroup?.description,
        item.costGroup?.parentCostGroup?.name,
        item.costGroup?.parentCostGroup?.description,
        item.costCode?.name,
        item.costCode?.number,
        item.status,
        item.internalNotes,
        item.vendor,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(term);
    });

    // If no direct match, try broader matching on area names
    if (filtered.length === 0) {
      filtered = items.filter((item) => {
        const areaName = (item.costGroup?.parentCostGroup?.name || '').toLowerCase();
        return areaName.includes(term);
      });
    }
  }

  // Collect all file attachments (from cost items, cost groups, and parent cost groups)
  const allAttachments: Array<{ fileName: string; downloadUrl: string; context: string }> = [];
  const seenFileIds = new Set<string>(); // Deduplicate files by ID

  // Helper to collect files without duplicates
  function collectFile(file: any, context: string) {
    if (!file?.url) return;
    const fileKey = file.id || file.url;
    if (seenFileIds.has(fileKey)) return;
    seenFileIds.add(fileKey);
    allAttachments.push({
      fileName: file.name || 'attachment',
      downloadUrl: file.url,
      context,
    });
  }

  // Build hierarchy: Area → Cost Group → Items
  const areaMap = new Map<string, Map<string, JTCostItem[]>>();
  // Track cost group files separately (keyed by group name to deduplicate)
  const groupFiles = new Map<string, Array<{ name: string; url: string }>>();
  // Track parent cost group (area) files
  const areaFiles = new Map<string, Array<{ name: string; url: string }>>();

  for (const item of filtered) {
    const areaName = item.costGroup?.parentCostGroup?.name || 'General';
    const groupName = item.costGroup?.name || 'Ungrouped';

    if (!areaMap.has(areaName)) areaMap.set(areaName, new Map());
    const groupMap = areaMap.get(areaName)!;
    if (!groupMap.has(groupName)) groupMap.set(groupName, []);
    groupMap.get(groupName)!.push(item);

    // Collect cost item files
    if (item.files && item.files.length > 0) {
      for (const file of item.files) {
        collectFile(file, groupName + ' > ' + item.name);
      }
    }

    // Collect cost GROUP files (attached to the trade/category level)
    if (item.costGroup?.files && item.costGroup.files.length > 0) {
      if (!groupFiles.has(groupName)) groupFiles.set(groupName, []);
      for (const file of item.costGroup.files) {
        if (file.url) {
          const existing = groupFiles.get(groupName)!;
          if (!existing.some(f => f.url === file.url)) {
            existing.push(file);
            collectFile(file, groupName);
          }
        }
      }
    }

    // Collect parent cost group (AREA) files
    if (item.costGroup?.parentCostGroup?.files && item.costGroup.parentCostGroup.files.length > 0) {
      if (!areaFiles.has(areaName)) areaFiles.set(areaName, []);
      for (const file of item.costGroup.parentCostGroup.files) {
        if (file.url) {
          const existing = areaFiles.get(areaName)!;
          if (!existing.some(f => f.url === file.url)) {
            existing.push(file);
            collectFile(file, areaName);
          }
        }
      }
    }
  }

  // Format output
  const lines: string[] = [];
  lines.push('APPROVED SPECIFICATIONS (' + filtered.length + ' items from signed contracts/COs' + (searchTerm ? ', matching "' + searchTerm + '"' : '') + ')');
  lines.push('');

  for (const [areaName, groupMap] of areaMap) {
    lines.push('');
    lines.push('═══════════════════════════════════════════');
    lines.push('📍 AREA: ' + areaName);
    lines.push('═══════════════════════════════════════════');

    // Area-level description (from parent cost group)
    const firstGroupInArea = Array.from(groupMap.values())[0];
    const areaDesc = firstGroupInArea?.[0]?.costGroup?.parentCostGroup?.description;
    if (areaDesc) {
      const desc = areaDesc.length > 400 ? areaDesc.slice(0, 400) + '...' : areaDesc;
      lines.push('  [Area Note: ' + desc + ']');
    }

    // Area-level files (from parent cost group)
    const areaFileList = areaFiles.get(areaName);
    if (areaFileList && areaFileList.length > 0) {
      for (const file of areaFileList) {
        lines.push('  [📎 ' + file.name + '](' + file.url + ')');
      }
    }
    lines.push('');

    for (const [groupName, groupItems] of groupMap) {
      lines.push('--- ' + groupName + ' (' + groupItems.length + ' items) ---');

      // Cost group description (critical spec notes like "Existing door planned to remain")
      const groupDesc = groupItems[0]?.costGroup?.description;
      if (groupDesc) {
        const desc = groupDesc.length > 400 ? groupDesc.slice(0, 400) + '...' : groupDesc;
        lines.push('  [Group Specification: ' + desc + ']');
      }

      // Cost group-level files
      const gFiles = groupFiles.get(groupName);
      if (gFiles && gFiles.length > 0) {
        for (const file of gFiles) {
          lines.push('  [📎 ' + file.name + '](' + file.url + ')');
        }
      }

      for (const item of groupItems) {
        const code = item.costCode ? ' (' + item.costCode.number + ')' : '';
        lines.push('  • ' + item.name + code);
        if (item.description) {
          const desc = item.description.length > 300
            ? item.description.slice(0, 300) + '...'
            : item.description;
          lines.push('    ' + desc);
        }
        // Document source (contract or change order)
        if ((item as any).documentName) {
          lines.push('    [Doc: ' + (item as any).documentName + ']');
        }
        // Custom fields: Status, Vendor, Internal Notes
        const customParts: string[] = [];
        if (item.status) customParts.push('Status: ' + item.status);
        if (item.vendor) customParts.push('Vendor: ' + item.vendor);
        if (customParts.length > 0) {
          lines.push('    [' + customParts.join(' | ') + ']');
        }
        if (item.internalNotes) {
          lines.push('    Internal Notes: ' + item.internalNotes);
        }
        // Inline cost item file links
        if (item.files && item.files.length > 0) {
          for (const file of item.files) {
            if (file.url) {
              lines.push('    [📎 ' + file.name + '](' + file.url + ')');
            }
          }
        }
      }
      lines.push('');
    }
  }

  if (filtered.length === 0) {
    lines.push(searchTerm
      ? 'No specifications found matching "' + searchTerm + '". Try a broader term.'
      : 'No specification items found for this job.');
  }

  // Add a dedicated RELATED FILES section at the end for high visibility
  if (allAttachments.length > 0) {
    lines.push('');
    lines.push('═══════════════════════════════════════════');
    lines.push('📄 RELATED FILES & DOCUMENTS (' + allAttachments.length + ' files)');
    lines.push('═══════════════════════════════════════════');
    lines.push('IMPORTANT: You MUST include these file links in your response so the user can click to view them.');
    lines.push('');
    for (const att of allAttachments) {
      lines.push('  • [📎 ' + att.fileName + '](' + att.downloadUrl + ')');
      lines.push('    Context: ' + att.context);
    }
  }

  return {
    content: lines.join('\n'),
    attachments: allAttachments,
  };
}

const projectDetails: AgentModule = {
  name: 'project-details',
  description:
    'Answers questions about approved contract specs, scope of work, change orders, materials, and project details. Only uses data from approved documents.',
  icon: '📋',

  systemPrompt: (ctx: AgentContext, _userMessage?: string) => {
    return (
      'You are the Specs agent for Brett King Builder (BKB). Your purpose is to answer the BKB team\'s questions ' +
      'about what is in the CONTRACT and CHANGE ORDERS — what was planned, approved, and agreed upon with the client.\n\n' +

      'DATA SOURCE — APPROVED DOCUMENTS ONLY:\n' +
      'You ONLY have access to items from APPROVED contracts and change orders. This is intentional.\n' +
      '- Items come from signed/approved customer orders (estimates) and change orders.\n' +
      '- Unapproved budget items, drafts, and pending estimates are EXCLUDED.\n' +
      '- Each item shows which document it belongs to (e.g. "[Doc: Wooley Estimate]" or "[Doc: CO #2 - Kitchen Add]").\n' +
      '- When answering, you can reference which document (contract or change order) an item came from.\n\n' +

      'CRITICAL HIERARCHY RULES:\n' +
      'Items are organized in a hierarchy that you MUST respect:\n' +
      '  1. AREA / LOCATION (e.g. "Exterior / General", "Kitchen", "Master Bath")\n' +
      '     Defines WHERE the work is being done. May include [Area Note: ...] with area-level details.\n' +
      '  2. COST GROUP (e.g. "07 Siding & Exterior Trim", "10 Plumbing")\n' +
      '     Defines the TRADE CATEGORY. May include [Group Specification: ...] with critical scope notes.\n' +
      '  3. LINE ITEMS (e.g. "James Hardie Lap Siding 7 1/4 Exposure")\n' +
      '     The specific materials and work items with descriptions.\n\n' +
      'IMPORTANT: [Group Specification: ...] notes contain CRITICAL scope details from the project manager.\n' +
      'They may override or clarify what line items suggest. ALWAYS read and respect them.\n\n' +

      'RESPONSE RULES:\n' +
      '- ALWAYS organize by AREA/LOCATION first, then items within each area.\n' +
      '- If items appear in multiple areas, list them SEPARATELY for each area.\n' +
      '- Start with a brief SUMMARY answer (2-3 sentences) for quick reference.\n' +
      '- Then provide DETAILED specification data organized by area.\n' +
      '- Include specific details: measurements, quantities, materials, brands, models.\n' +
      '- Reference which document (contract or CO) the item came from when relevant.\n' +
      '- NEVER make up information. Only answer based on what is in the approved data.\n' +
      '- If the data does not contain the answer, say so clearly.\n\n' +

      'FILE LINKS (MANDATORY):\n' +
      '- You MUST include ALL file links from the tool response in your answer.\n' +
      '- File links appear as [📎 FileName](url) and in the RELATED FILES section.\n' +
      '- Place relevant file links near the specification items they relate to.\n' +
      '- After your answer, include a "Related Documents" section listing ALL file links.\n' +
      '- The user needs to click these to view PDFs, images, fixture sheets, and drawings.\n' +
      '- NEVER omit file links. They are critical.\n\n' +

      'CUSTOM FIELDS (Status, Vendor, Internal Notes):\n' +
      '- Status = ordering/procurement status (e.g. "4. Ordered/Finalized").\n' +
      '- Vendor = who is supplying or installing the item.\n' +
      '- Internal Notes = additional BKB team notes.\n' +
      '- ALWAYS include these when present.\n\n' +

      'TOOLS:\n' +
      '- Use get_project_details to fetch approved specifications for a job.\n' +
      '- If you have the JobTread Job ID from context, use it directly. Otherwise use search_jobs.\n' +
      '- Use get_job_files for job-level file attachments.\n' +
      '- If a tool returns an error, include the error message in your response so the team can report it.\n\n' +

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
        'Get approved project specifications for a job. ONLY returns items from approved contracts ' +
        'and change orders — not unapproved budget items. Items are organized by ' +
        'AREA/LOCATION and COST GROUP with file attachments. ' +
        'Use the search parameter to filter by keyword (e.g. "siding", "door", "plumbing").',
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
    if (/(give me.*detail|all.*detail|detail.*of)/i.test(lower)) return 0.92;
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
        const searchTerm = (input.search || '').trim();

        // Step 1: Get job info and Specifications URL
        const job = await getJob(jobId);
        const specUrl = job ? getSpecificationsUrl(job) : null;

        // Step 2: Get document statuses (lightweight query — just IDs and statuses)
        // and cost items in parallel for speed
        const [docStatuses, allCostItems] = await Promise.all([
          getDocumentStatusesForJob(jobId),
          getCostItemsLightForJob(jobId, 200),
        ]);

        // Build a set of approved document IDs and a map for name lookup
        const approvedDocIds = new Set<string>();
        const docNameMap = new Map<string, string>();
        for (const doc of docStatuses) {
          // Build a clear document label including number (e.g. "Change Order #6", "Construction Contract #1")
          const docNum = (doc as any).number;
          const baseName = doc.name || doc.type || 'Document';
          const docLabel = docNum ? `${baseName} #${docNum}` : baseName;
          docNameMap.set(doc.id, docLabel);
          if (doc.status === 'approved') {
            approvedDocIds.add(doc.id);
          }
        }

        // DEBUG: Log approved documents and cost item document references
        console.log('[project-details] Approved doc IDs:', Array.from(approvedDocIds));
        console.log('[project-details] Doc name map:', Array.from(docNameMap.entries()));
        console.log('[project-details] Total cost items from PAVE:', allCostItems.length);
        const docIdDistribution = new Map<string, number>();
        for (const item of allCostItems) {
          const did = item.document?.id || 'NO_DOC';
          docIdDistribution.set(did, (docIdDistribution.get(did) || 0) + 1);
        }
        console.log('[project-details] Cost items by document ID:', Array.from(docIdDistribution.entries()).map(([id, count]) => `${docNameMap.get(id) || id}: ${count}`));

        // CRITICAL FILTER: Item must be on an APPROVED document (signed contract or approved CO).
        // Note: We do NOT filter by isSpecification because that flag is rarely set in JobTread.
        // Approved customer orders already represent what was agreed upon with the client.
        const costItems = allCostItems.filter((item: any) => {
          const docId = item.document?.id;
          if (!docId) return false;
          return approvedDocIds.has(docId);
        });
        console.log('[project-details] After filtering to approved docs:', costItems.length, 'items');

        if (!costItems || costItems.length === 0) {
          return JSON.stringify({
            success: false,
            specificationsUrl: specUrl,
            message:
              'No approved specification items found for this job.' +
              (approvedDocIds.size === 0
                ? ' No approved documents exist yet — the contract may not be signed.'
                : ' Approved documents exist (' + approvedDocIds.size + ') but no spec line items were found on them.') +
              (specUrl ? ' Specifications page: ' + specUrl : ''),
          });
        }

        // Inject document name (with number) into each item for context
        for (const item of costItems) {
          const docId = item.document?.id;
          if (docId) {
            (item as any).documentName = docNameMap.get(docId) || item.document?.name || 'Approved Document';
            (item as any).documentNumber = item.document?.number || '';
            (item as any).documentType = item.document?.type || '';
          }
        }

        // Step 4: Build formatted hierarchy with area grouping and file links
        const { content, attachments } = formatCostItemsWithHierarchy(costItems, searchTerm || undefined);

        // Truncate if too long (keep tight to avoid exceeding Claude token limits)
        let finalContent = content;
        if (finalContent.length > 8000) {
          finalContent =
            finalContent.slice(0, 8000) +
            '\n\n... [Truncated. Use a search term to narrow results.]';
        }

        return JSON.stringify({
          success: true,
          source: 'approved_documents_only',
          specificationsUrl: specUrl,
          totalApprovedItems: costItems.length,
          note: 'ONLY items from APPROVED contracts/COs.',
          content: finalContent,
          fileCount: attachments.length,
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
      const errMsg = err?.message || 'Unknown error';
      console.error('[project-details] Tool error (' + name + '):', errMsg);
      return JSON.stringify({
        error: 'Error executing ' + name + ': ' + errMsg,
      });
    }
  },
};

export default projectDetails;
