import { createInitialState, normalizeWorkflowState, requestDocuments } from "./workflow.mjs";

export const CLIENT_DB_VERSION = 2;
const CLIENT_DB_STORAGE_KEY = "heyday.workflow.state.v2";
const STORAGE_FALLBACK_KEYS = ["heyday.workflow.state.v1", "heyday.workflow.state"];
const ORGANIZATION_ID = "org-heyday";
const MANAGER_ID = "user-manager";

export const CLIENT_DB_METADATA_SOURCE = "heyday-client-database";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeEntries(value) {
  if (!isRecord(value)) {
    return {};
  }
  return value;
}

function normalizeUsersValue(rawUsers, fallbackUsers) {
  const fallback = safeEntries(fallbackUsers);
  if (Array.isArray(rawUsers)) {
    const normalized = {};
    for (let i = 0; i < rawUsers.length; i += 1) {
      const rawUser = rawUsers[i];
      if (!isRecord(rawUser)) {
        continue;
      }
      const fallbackId = String(rawUser.id || rawUser.userId || rawUser.employeeId || `user-${i + 1}`).trim();
      const normalizedId = fallbackId || `user-${i + 1}`;
      normalized[normalizedId] = {
        ...rawUser,
        id: normalizedId,
        organizationId: rawUser.organizationId || ORGANIZATION_ID,
      };
    }
    if (Object.keys(normalized).length > 0) {
      return { ...fallback, ...normalized };
    }
    return fallback;
  }

  if (!isRecord(rawUsers) || Object.keys(rawUsers).length === 0) {
    return fallback;
  }

  const normalized = {};
  Object.entries(rawUsers).forEach(([id, rawUser]) => {
    if (!isRecord(rawUser)) {
      return;
    }
    const resolvedId = String(rawUser.id || id).trim();
    if (!resolvedId) {
      return;
    }
    normalized[resolvedId] = {
      ...rawUser,
      id: resolvedId,
      organizationId: rawUser.organizationId || ORGANIZATION_ID,
    };
  });

  if (Object.keys(normalized).length > 0) {
    return { ...fallback, ...normalized };
  }
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toLowerTrim(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

function asString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function nextRecordId(prefix, records) {
  const nextNumber = Object.keys(records).reduce((highest, id) => {
    const match = String(id).match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
  return `${prefix}-${nextNumber}`;
}

function pickByAlias(record, aliases) {
  const keySet = new Set(Object.keys(record).map((key) => toLowerTrim(key)));
  const normalizedAliases = aliases.map(toLowerTrim);
  for (const alias of normalizedAliases) {
    if (keySet.has(alias)) {
      const key = Object.keys(record).find((item) => toLowerTrim(item) === alias);
      if (key !== undefined) {
        return record[key];
      }
    }
  }
  return "";
}

function normalizeStatusFromSheet(value) {
  const normalized = toLowerTrim(value).replace(/[\s_-]+/g, " ").replace(/&/g, " and ").replace(/\/+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "new_client";
  }
  const statusMap = {
    "new client": "new_client",
    "newclient": "new_client",
    "request sent": "request_sent",
    "documents received": "documents_received",
    "job assigned": "job_assigned",
    "job accepted": "job_accepted",
    "in progress": "in_progress",
    "sent for review": "sent_for_review",
    "under review": "under_review",
    "revision required": "revision_required",
    "revision in progress": "revision_in_progress",
    "resubmitted": "resubmitted",
    "approved": "approved",
    "reviewed and billed": "reviewed_billed",
    "reviewed_billed": "reviewed_billed",
    "reviewed billed": "reviewed_billed",
    "payment received": "payment_received",
    "payment received or job closed": "payment_received",
    "payment received job closed": "payment_received",
    "need more info": "need_more_info",
    "need_more_info": "need_more_info",
    "job completed": "sent_for_review",
    "revision requested": "revision_required",
    "final package approved": "approved",
  };

  return statusMap[normalized] || statusMap[normalized.replace(/ /g, "_")] || "new_client";
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + Math.round((value - 1) * 24 * 60 * 60 * 1000));
    return date.toISOString().slice(0, 10);
  }
  const text = asString(value);
  if (!text) {
    return "";
  }
  const parsed = new Date(text);
  return Number.isNaN(Date.parse(parsed)) ? text : parsed.toISOString().slice(0, 10);
}

function resolveAssignedEmployee(state, record) {
  const raw = pickByAlias(record, [
    "assigned_to",
    "assignedto",
    "employee",
    "owner",
    "owner_id",
    "employee_id",
    "employee email",
  ]);
  const rawText = toLowerTrim(raw);
  if (!rawText) {
    return null;
  }
  const employee = Object.values(state.users).find((user) => {
    const matchesId = toLowerTrim(user.id) === rawText;
    const matchesName = toLowerTrim(user.name) === rawText;
    const matchesEmail = toLowerTrim(user.email) === rawText;
    return matchesId || matchesName || matchesEmail;
  });
  return employee?.id ?? null;
}

function parseClientSpreadsheetRows(rows) {
  const base = createInitialState();
  const now = new Date().toISOString();
  const clients = {};
  const jobs = {};
  const totalRows = Array.isArray(rows) ? rows.length : 0;
  let validRows = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const name = asString(
      pickByAlias(row, ["client", "client_name", "client name", "company", "name", "公司", "客户", "客户名称"]),
    );
    if (!name) {
      continue;
    }
    validRows += 1;

    const suggestedClientId = asString(pickByAlias(row, ["id", "client_id", "client id"]));
    let clientId = suggestedClientId;
    if (!/^client-\d+$/.test(clientId) || clients[clientId]) {
      clientId = nextRecordId("client", clients);
    }
    const status = normalizeStatusFromSheet(pickByAlias(row, ["status", "state", "stage", "阶段", "客户状态"]));
    const rawAssignedTo = pickByAlias(row, ["assigned_to", "assignedto", "employee", "owner", "owner_id", "employee_id", "employee email"]);
    const reviewRoundValue = Number(asString(pickByAlias(row, ["review_round", "review round"])));
    const statusChangedAt = asString(
      pickByAlias(row, ["status_changed_at", "status changed at", "updated_at", "updated at"]) || now,
    );

    clients[clientId] = {
      id: clientId,
      organizationId: ORGANIZATION_ID,
      name,
      contactName: asString(pickByAlias(row, ["contact_name", "contact name", "联系人", "contact"])),
      email: asString(pickByAlias(row, ["email", "email_address", "邮箱"])),
      phone: asString(pickByAlias(row, ["phone", "phone_number", "电话号码", "mobile"])),
      status,
      statusChangedAt: statusChangedAt || now,
      notes: asString(pickByAlias(row, ["notes", "备注", "说明", "remark"])),
    };

    const suggestedJobId = asString(pickByAlias(row, ["job_id", "job id", "jobid"]));
    const jobId = /^job-\d+$/.test(suggestedJobId) && !jobs[suggestedJobId] ? suggestedJobId : nextRecordId("job", jobs);

    jobs[jobId] = {
      id: jobId,
      organizationId: ORGANIZATION_ID,
      clientId,
      title: asString(
        pickByAlias(row, ["job_title", "title", "service", "job title", "标题", "项目"]) || "Document collection",
      ),
      instructions: asString(pickByAlias(row, ["instructions", "instructions_note", "notes", "instruction"])),
      status,
      priority: asString(pickByAlias(row, ["priority", "urgency", "优先级"])) || "medium",
      dueDate: parseDateValue(pickByAlias(row, ["due_date", "due date", "dueDate", "截止日期", "截止日期(yyyy-mm-dd)"])),
      assignedTo: resolveAssignedEmployee(base, { ...row, assignedTo: rawAssignedTo }),
      assignedBy: null,
      assignedAt: asString(pickByAlias(row, ["assigned_at", "assigned at", "assignment_at"])) || null,
      acceptedAt: asString(pickByAlias(row, ["accepted_at", "accepted at"])) || null,
      startedAt: asString(pickByAlias(row, ["started_at", "started at"])) || null,
      completedAt: asString(pickByAlias(row, ["completed_at", "completed at"])) || null,
      reviewRound: Number.isFinite(reviewRoundValue) && reviewRoundValue > 0 ? reviewRoundValue : 1,
    };
  }

  return {
    state: {
      clients,
      jobs,
      events: [],
      files: [],
      uploadRequests: [],
      notifications: [],
      billingRecords: [],
      organizations: base.organizations,
      users: base.users,
    },
    parseMeta: {
      totalRows,
      validRows,
    },
  };
}

function seedState() {
  let next = createInitialState();
  next = requestDocuments(next, {
    clientId: "client-3",
    managerId: MANAGER_ID,
    now: "2026-06-01T10:30:00.000Z",
  });
  next.files = [
    {
      id: "file-seed-1",
      organizationId: ORGANIZATION_ID,
      clientId: "client-1",
      jobId: "job-1",
      section: "client_uploaded",
      name: "bank-statements.pdf",
      size: 1245000,
      type: "application/pdf",
      uploadedBy: "client",
      uploadedAt: "2026-06-05T15:10:00.000Z",
    },
  ];
  return next;
}

function normalizeStateValue(raw) {
  const base = seedState();
  const input = isRecord(raw) ? raw : {};
  const merged = {
    ...base,
    ...input,
    metadata: isRecord(input.metadata) ? input.metadata : {},
    organizations: safeEntries(input.organizations ?? base.organizations),
    users: normalizeUsersValue(input.users, base.users),
    clients: safeEntries(input.clients),
    jobs: safeEntries(input.jobs),
    events: asArray(input.events),
    files: asArray(input.files),
    uploadRequests: asArray(input.uploadRequests),
    notifications: asArray(input.notifications),
    billingRecords: asArray(input.billingRecords),
  };
  return normalizeWorkflowState(merged);
}

function buildPersistenceState(state, metadataPatch = {}) {
  return {
    ...state,
    metadata: {
      ...state?.metadata,
      version: CLIENT_DB_VERSION,
      source: CLIENT_DB_METADATA_SOURCE,
      ...metadataPatch,
    },
  };
}

function safeParseJson(text) {
  return JSON.parse(text);
}

export function exportClientData(state) {
  const current = state ?? {};
  return JSON.stringify(buildPersistenceState(normalizeWorkflowState(current), { exportedAt: new Date().toISOString() }), null, 2);
}

export function importClientData(rawState) {
  try {
    const candidate = typeof rawState === "string" ? safeParseJson(rawState) : rawState;
    if (candidate === null || candidate === undefined) {
      return { ok: false, error: "Import failed: data must be an object, array, or JSON text." };
    }
    let normalizedCandidate = candidate;
    if (isRecord(candidate.state) && (candidate.state.clients || candidate.state.jobs)) {
      normalizedCandidate = candidate.state;
    } else if (isRecord(candidate.data) && (candidate.data.clients || candidate.data.jobs)) {
      normalizedCandidate = candidate.data;
    }

    if (Array.isArray(normalizedCandidate)) {
      const parsed = parseClientSpreadsheetRows(normalizedCandidate);
      const normalizedRows = normalizeStateValue(parsed.state);
      const summary = {
        clients: Object.keys(normalizedRows.clients).length,
        jobs: Object.keys(normalizedRows.jobs).length,
        events: normalizedRows.events.length,
      };
      if (summary.clients === 0 && summary.jobs === 0) {
        return { ok: false, error: "No valid client rows in spreadsheet", meta: parsed.parseMeta };
      }
      return {
        ok: true,
        state: normalizedRows,
        summary,
        meta: {
          ...parsed.parseMeta,
          source: "spreadsheet",
        },
      };
    }

    if (!isRecord(normalizedCandidate)) {
      return { ok: false, error: "Import failed: data must be an object, array, or JSON text." };
    }
    if (!normalizedCandidate.clients && !normalizedCandidate.jobs) {
      return { ok: false, error: "Import failed: missing client or job records." };
    }

    const normalized = normalizeStateValue(normalizedCandidate);
    const summary = {
      clients: Object.keys(normalized.clients).length,
      jobs: Object.keys(normalized.jobs).length,
      events: normalized.events.length,
    };
    return {
      ok: true,
      state: normalized,
      summary,
      meta: { source: "json" },
    };
  } catch (error) {
    return { ok: false, error: `Import failed: ${error.message}` };
  }
}

export function loadPersistentState() {
  const keys = [CLIENT_DB_STORAGE_KEY, ...STORAGE_FALLBACK_KEYS];
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) {
      continue;
    }

    const imported = importClientData(raw);
    if (imported.ok) {
      const merged = buildPersistenceState(imported.state, { lastLoadedFrom: key, loadedAt: new Date().toISOString() });
      localStorage.setItem(CLIENT_DB_STORAGE_KEY, JSON.stringify(merged));
      return merged;
    }
  }
  return resetToSeededState();
}

export function savePersistentState(state) {
  const normalized = normalizeWorkflowState(state);
  const persisted = buildPersistenceState(normalized, { savedAt: new Date().toISOString() });
  localStorage.setItem(CLIENT_DB_STORAGE_KEY, JSON.stringify(persisted));
  return persisted;
}

export function resetToSeededState() {
  const seeded = normalizeWorkflowState(seedState());
  const persisted = buildPersistenceState(seeded, { resetAt: new Date().toISOString() });
  localStorage.setItem(CLIENT_DB_STORAGE_KEY, JSON.stringify(persisted));
  return persisted;
}
