// @ts-nocheck
// JobTread API - uses Pave query language (not GraphQL)
// Docs: https://app.jobtread.com/docs
//
// PAVE API patterns:
// - Org-level collections (jobs, tasks, memberships) must be queried
//   under organization: { $: { id: orgId }, collection: {...} }
// - Single entity by ID uses SINGULAR at root: job, task, document
// - Mutations (createTask, etc.) go at the root level

const JT_URL = 'https://api.jobtread.com/pave';
const JT_KEY = () => process.env.JOBTREAD_API_KEY || '';
const JT_ORG = '22P5SRwhLaYe';

async function jtQuery(query: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Pave HTTP API requires body wrapped in { query: ... }
  const paveQuery = {
    $: { grantKey: JT_KEY() },
    ...query,
  };

  const res = await fetch(JT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: paveQuery }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('JobTread API error ' + res.status + ': ' + text.slice(0, 200));
  }
  return res.json();
}

// Org-scoped query helper — wraps collection under organization
async function orgQuery(collection: string, params: Record<string, unknown>) {
  const data = await jtQuery({
    organization: {
      $: { id: JT_ORG },
      [collection]: params,
    },
  });
  return (data as any)?.organization?.[collection] || {};
}

// Fetch all org members (membership ID + user name)
export async function getMembers(): Promise<{ id: string; name: string }[]> {
  const result = await orgQuery('memberships', {
    nodes: {
      id: {},
      user: { id: {}, name: {} },
    },
  });
  const nodes = result.nodes || [];
  return nodes.map((n: any) => ({ id: n.id, name: n.user?.name || '' }));
}

export async function getActiveJobs(limit = 30) {
  const result = await orgQuery('jobs', {
    $: {
      size: Math.min(limit, 100),
      where: ['closedOn', '=', null],
    },
    nodes: {
      id: {},
      name: {},
      number: {},
      status: {},
      createdAt: {},
    },
  });
  const jobs = result.nodes || [];
  return jobs;
}

// ---------------------------------------------------------------------------
// Marketing Photo Engine helpers
//
// The Cowork/Claude task does the heavy media work. These helpers just let the
// Hub list which jobs are opted in for marketing and compute the folder name
// used on the designer's FTP server. Keep them defensive: JobTread custom-field
// graphs can be missing or shaped oddly, so tolerate that and return [] rather
// than throwing.
// ---------------------------------------------------------------------------

/**
 * Folder name rule: replace the FIRST space in the job name with a hyphen.
 *   "Edwards Pool House" -> "Edwards-Pool House"
 *   "Leonard Kitchen"    -> "Leonard-Kitchen"
 * A name with no space is returned unchanged.
 */
export function folderNameForJob(name: string): string {
  // Produce a clean, filesystem-safe per-job folder name.
  //   "Edwards Pool House"     -> "Edwards-Pool House"
  //   "Puglia - Sunroom"       -> "Puglia-Sunroom"
  //   "Halvorsen Roof/Exterior" -> "Halvorsen-Roof-Exterior"
  let s = (name || '').trim();
  s = s.replace(/[\/\\]+/g, '-');    // slashes are path separators, not allowed in a folder name
  s = s.replace(/\s*[-\u2013]\s*/g, '-'); // collapse " - " style separators to a single hyphen
  s = s.replace(' ', '-');            // first remaining space becomes a hyphen
  s = s.replace(/-{2,}/g, '-');       // collapse repeated hyphens
  s = s.replace(/^-+|-+$/g, '');      // trim stray hyphens
  return s;
}

function isTruthyMarketingValue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === 'yes' || v === '1';
  }
  return false;
}

/**
 * Eligible marketing jobs = active jobs (closedOn = null) whose custom field
 * named "Marketing" (case-insensitive) is set truthy ("true"/"yes"/"1"/true).
 *
 * Returns [] on any error rather than throwing, so callers/UI degrade cleanly.
 */
export async function getMarketingJobs(limit = 200): Promise<
  { id: string; name: string; number: string; folderName: string }[]
> {
  try {
    const result = await orgQuery('jobs', {
      $: {
        size: Math.min(limit, 100),
        where: ['closedOn', '=', null],
      },
      nodes: {
        id: {},
        name: {},
        number: {},
        customFieldValues: {
          nodes: { value: {}, customField: { name: {} } },
        },
      },
    });

    const nodes = result.nodes || [];
    const out: { id: string; name: string; number: string; folderName: string }[] = [];

    for (const job of nodes) {
      try {
        const cfvs = job?.customFieldValues?.nodes || [];
        const marketingField = cfvs.find(
          (cfv: any) => (cfv?.customField?.name || '').trim().toLowerCase() === 'marketing'
        );
        if (!marketingField || !isTruthyMarketingValue(marketingField.value)) continue;

        const name = job?.name || '';
        out.push({
          id: job?.id || '',
          name,
          number: job?.number || '',
          folderName: folderNameForJob(name),
        });
      } catch {
        // Skip a single malformed job node rather than failing the whole list.
        continue;
      }
    }

    return out;
  } catch (err: any) {
    console.error('[jobtread] getMarketingJobs failed:', err?.message || err);
    return [];
  }
}

/**
 * Cheap change-detection probe for the nightly marketing detector.
 *
 * Returns whether a job has picked up new marketing-worthy items since a given
 * timestamp, WITHOUT pulling any nodes. We only ask JobTread for counts, so this
 * stays fast and inexpensive even across many jobs.
 *   - newMediaCount: files (images/videos and anything else) created after sinceISO.
 *   - newApprovedOrder: an approved customerOrder document created after sinceISO.
 *
 * If sinceISO is null we treat the job as everything-new (first look), returning
 * hasNew = true so the caller schedules a full scan. On any error we degrade to
 * "nothing new" so one bad job never breaks the detector run.
 *
 * Query shapes (confirmed against the live Pave schema):
 *   files:     where ["createdAt", ">", sinceISO]  (single infix condition)
 *   documents: where { and: [ ["type","=","customerOrder"],
 *                             ["status","=","approved"],
 *                             ["createdAt",">",sinceISO] ] }
 * Note: Pave compound filters use the object form { and: [...] }, not a nested
 * array. size:1 keeps the page tiny; count is computed server side.
 */
export async function jobHasNewMarketingItemsSince(
  jobId: string,
  sinceISO: string | null
): Promise<{ hasNew: boolean; newMediaCount: number; newApprovedOrder: boolean }> {
  // No baseline yet: treat the whole job as new so it gets a full scan.
  if (!sinceISO) {
    return { hasNew: true, newMediaCount: 0, newApprovedOrder: false };
  }

  try {
    let newMediaCount = 0;
    let newApprovedOrder = false;

    // New files (photos/videos and any other uploads) since the baseline.
    try {
      const filesData: any = await jtQuery({
        job: {
          $: { id: jobId },
          files: {
            $: { size: 1, where: ['createdAt', '>', sinceISO] },
            count: {},
          },
        },
      });
      const c = filesData?.job?.files?.count;
      newMediaCount = typeof c === 'number' ? c : 0;
    } catch (err: any) {
      console.error('[jobtread] jobHasNewMarketingItemsSince files count failed:', err?.message || err);
    }

    // A newly approved customer order is a strong "this job progressed" signal.
    try {
      const docsData: any = await jtQuery({
        job: {
          $: { id: jobId },
          documents: {
            $: {
              size: 1,
              where: {
                and: [
                  ['type', '=', 'customerOrder'],
                  ['status', '=', 'approved'],
                  ['createdAt', '>', sinceISO],
                ],
              },
            },
            count: {},
          },
        },
      });
      const c = docsData?.job?.documents?.count;
      newApprovedOrder = typeof c === 'number' && c > 0;
    } catch (err: any) {
      console.error('[jobtread] jobHasNewMarketingItemsSince documents count failed:', err?.message || err);
    }

    return {
      hasNew: newMediaCount > 0 || newApprovedOrder,
      newMediaCount,
      newApprovedOrder,
    };
  } catch (err: any) {
    console.error('[jobtread] jobHasNewMarketingItemsSince failed:', err?.message || err);
    return { hasNew: false, newMediaCount: 0, newApprovedOrder: false };
  }
}

/**
 * List the JobTread file ids for a job that are videos (mime type video/*, or a
 * common video file extension). Used by the detector to catch videos that exist
 * on a job but were never recorded/processed — the old detector only looked for
 * items NEWER than the last build, so a video skipped during the first build
 * (e.g. because it was large) got stranded and never revisited. Comparing the
 * job's current video ids against what we have recorded closes that blind spot.
 *
 * Metadata only (id + type + name), small page — no downloads.
 */
export async function getJobVideoFileIds(jobId: string): Promise<string[]> {
  const ids: string[] = [];
  const videoExt = /\.(mov|mp4|m4v|avi|mkv|webm|hevc|3gp)$/i;
  try {
    let page: string | undefined = undefined;
    for (let i = 0; i < 20; i++) {
      const data: any = await jtQuery({
        job: {
          $: { id: jobId },
          files: {
            $: { size: 100, ...(page ? { page } : {}) },
            nextPage: {},
            nodes: { id: {}, name: {}, type: {} },
          },
        },
      });
      const files = data?.job?.files?.nodes || [];
      for (const f of files) {
        const type = (f?.type || '').toLowerCase();
        const name = f?.name || '';
        if (type.startsWith('video/') || videoExt.test(name)) {
          if (f?.id) ids.push(f.id);
        }
      }
      page = data?.job?.files?.nextPage || undefined;
      if (!page) break;
    }
  } catch (err: any) {
    console.error('[jobtread] getJobVideoFileIds failed:', err?.message || err);
  }
  return ids;
}

export async function getAllJobs(max = 2000): Promise<
  { id: string; name: string; number: string; closedOn: string | null }[]
> {
  const out: { id: string; name: string; number: string; closedOn: string | null }[] = [];
  let page: string | undefined = undefined;
  // JobTread caps page size at 100, so paginate via nextPage tokens.
  for (let i = 0; i < 40; i++) {
    const result: any = await orgQuery('jobs', {
      $: { size: 100, ...(page ? { page } : {}) },
      nextPage: {},
      nodes: { id: {}, name: {}, number: {}, closedOn: {} },
    });
    const nodes = result.nodes || [];
    for (const j of nodes) {
      out.push({ id: j.id, name: j.name, number: j.number, closedOn: j.closedOn ?? null });
    }
    page = result.nextPage || undefined;
    if (!page || out.length >= max) break;
  }
  return out;
}

export async function createTask(params: {
        jobId: string;
        name: string;
        description?: string;
        startDate?: string;
        endDate?: string;
        assignedMembershipIds?: string[];
}) {
          const { jobId, name, description, startDate, endDate, assignedMembershipIds } = params;

  const data = await jtQuery({
            createTask: {
                        $: {
                                      targetId: jobId,
                                      targetType: 'job',
                                      name,
                                      ...(description ? { description } : {}),
                                      ...(startDate ? { startDate } : {}),
                                      ...(endDate ? { endDate } : {}),
                                      ...(assignedMembershipIds?.length ? { assignedMembershipIds } : {}),
                        },
                        createdTask: {
                                      id: {},
                                      name: {},
                        },
            },
  });

  const created = (data as any)?.createTask?.createdTask;
        if (!created?.id) {
                  throw new Error('Task creation failed: ' + JSON.stringify(data));
        }
        return { id: created.id, name: created.name };
}
