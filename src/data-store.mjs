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

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
    users: safeEntries(input.users ?? base.users),
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
    if (!isRecord(candidate)) {
      return { ok: false, error: "Import failed: data must be an object." };
    }
    if (!candidate.clients && !candidate.jobs) {
      return { ok: false, error: "Import failed: missing client or job records." };
    }

    const normalized = normalizeStateValue(candidate);
    const summary = {
      clients: Object.keys(normalized.clients).length,
      jobs: Object.keys(normalized.jobs).length,
      events: normalized.events.length,
    };
    return { ok: true, state: normalized, summary };
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
