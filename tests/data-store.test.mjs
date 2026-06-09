import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createInitialState } from "../src/workflow.mjs";
import {
  CLIENT_DB_VERSION,
  exportClientData,
  importClientData,
  loadPersistentState,
  resetToSeededState,
} from "../src/data-store.mjs";

function createMockStorage() {
  const store = Object.create(null);

  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      Object.keys(store).forEach((key) => delete store[key]);
    },
    entries() {
      return { ...store };
    },
  };
}

function withStorage(storage, fn) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    return fn();
  } finally {
    globalThis.localStorage = previous;
  }
}

describe("client data store", () => {
  it("imports legacy status names while normalizing clients/jobs/events", () => {
    const legacy = {
      clients: {
        "client-old": {
          ...createInitialState().clients["client-1"],
          id: "client-old",
          status: "job_completed",
        },
      },
      jobs: {
        "job-old": {
          ...createInitialState().jobs["job-1"],
          id: "job-old",
          clientId: "client-old",
          status: "final_package_approved",
        },
      },
      events: [{ id: "event-1", status: "revision_requested", at: "2026-06-01T00:00:00.000Z" }],
    };

    const result = importClientData(legacy);

    assert.equal(result.ok, true);
    assert.equal(result.state.clients["client-old"].status, "sent_for_review");
    assert.equal(result.state.jobs["job-old"].status, "approved");
    assert.equal(result.state.events.at(-1).status, "revision_required");
    assert.equal(result.summary.clients, 1);
    assert.equal(result.summary.jobs, 1);
    assert.equal(result.summary.events, 1);
  });

  it("loads from legacy localStorage keys and writes normalized v2 state", () => {
    const storage = createMockStorage();
    const legacyState = {
      ...createInitialState(),
      metadata: { source: "legacy-app", version: 1 },
      clients: {
        ...createInitialState().clients,
      },
      jobs: {
        ...createInitialState().jobs,
      },
    };
    const legacyKey = "heyday.workflow.state.v1";
    storage.setItem(legacyKey, JSON.stringify(legacyState));

    const loaded = withStorage(storage, () => loadPersistentState());

    const entries = storage.entries();
    assert.equal(loaded.metadata.version, CLIENT_DB_VERSION);
    assert.equal(entries["heyday.workflow.state.v2"], JSON.stringify(loaded));
    assert.equal(loaded.organizations["org-heyday"].name, "HEYDAY Accounting");
  });

  it("falls back to seeded state and persists it when storage is empty", () => {
    const storage = createMockStorage();
    const loaded = withStorage(storage, () => loadPersistentState());

    assert.equal(loaded.metadata.version, CLIENT_DB_VERSION);
    assert.equal(loaded.clients["client-1"].name, "Luna Cafe Ltd.");
    assert.equal(storage.getItem("heyday.workflow.state.v2"), JSON.stringify(loaded));
  });

  it("falls back to seeded state when the latest key is corrupted", () => {
    const storage = createMockStorage();
    storage.setItem("heyday.workflow.state.v2", "{bad-json");
    const loaded = withStorage(storage, () => loadPersistentState());

    assert.equal(loaded.metadata.version, CLIENT_DB_VERSION);
    assert.equal(loaded.clients["client-2"].status, "in_progress");
  });

  it("fills missing collections when importing partial payloads", () => {
    const legacyPartial = {
      clients: {
        "client-1": {
          ...createInitialState().clients["client-1"],
          id: "client-1",
          status: "new_client",
        },
      },
      jobs: {
        "job-1": {
          ...createInitialState().jobs["job-1"],
          id: "job-1",
          clientId: "client-1",
          status: "new_client",
        },
      },
      // intentionally omit organizations, users, events, files, etc.
    };

    const result = importClientData(legacyPartial);

    assert.equal(result.ok, true);
    assert.equal(result.state.organizations["org-heyday"].name, "HEYDAY Accounting");
    assert.equal(result.state.users["user-manager"].role, "manager");
    assert.equal(Array.isArray(result.state.events), true);
    assert.equal(result.state.files.length, 0);
    assert.equal(result.state.uploadRequests.length, 0);
    assert.equal(result.state.notifications.length, 0);
  });

  it("returns explicit error for empty payload or invalid JSON", () => {
    const fromJson = importClientData("{invalid");
    const fromObject = importClientData({});

    assert.equal(fromJson.ok, false);
    assert.match(fromJson.error ?? "", /Import failed/i);
    assert.equal(fromObject.ok, false);
    assert.match(fromObject.error ?? "", /missing client.*job records/i);
  });

  it("imports spreadsheet rows (CSV/XLSX parsed objects) as full client/job data", () => {
    const spreadsheetRows = [
      {
        "client_name": "North Valley Builders",
        "contact_name": "Ella Stone",
        "email": "ella@northvalley.ca",
        "phone": "(604) 555-0109",
        "status": "In Progress",
        "assigned_to": "Amy Wong",
        "due_date": "2026-07-01",
        "job_title": "Year-end tax return",
        "review_round": "2",
      },
      {
        "client_name": "Coastal Studio",
        "contact_name": "Mao Lee",
        "email": "mao@coastalstudio.ca",
        "status": "Need More Info",
      },
    ];

    const result = importClientData(spreadsheetRows);

    assert.equal(result.ok, true);
    assert.equal(result.summary.clients, 2);
    assert.equal(result.summary.jobs, 2);
    const [firstClient, secondClient] = Object.values(result.state.clients);
    const [firstJob, secondJob] = Object.values(result.state.jobs);
    assert.equal(firstClient.status, "in_progress");
    assert.equal(firstClient.status, firstJob.status);
    assert.equal(firstJob.reviewRound, 2);
    assert.equal(secondClient.status, "need_more_info");
  });

  it("imports legacy wrapper payloads with state/data keys", () => {
    const base = createInitialState();
    const payload = {
      state: {
        clients: {
          "client-wrapper": {
            ...base.clients["client-1"],
            id: "client-wrapper",
            name: "Wrapped Customer",
          },
        },
        jobs: {
          "job-wrapper": {
            ...base.jobs["job-1"],
            id: "job-wrapper",
            clientId: "client-wrapper",
          },
        },
      },
    };

    const wrappedStateResult = importClientData(payload);
    assert.equal(wrappedStateResult.ok, true);
    assert.equal(wrappedStateResult.state.clients["client-wrapper"].name, "Wrapped Customer");
    assert.equal(wrappedStateResult.state.jobs["job-wrapper"].clientId, "client-wrapper");

    const dataWrappedResult = importClientData({ data: payload.state });
    assert.equal(dataWrappedResult.ok, true);
    assert.equal(dataWrappedResult.state.clients["client-wrapper"].name, "Wrapped Customer");
    assert.equal(dataWrappedResult.state.jobs["job-wrapper"].clientId, "client-wrapper");
  });

  it("returns explicit error for empty spreadsheet rows", () => {
    const result = importClientData([]);
    assert.equal(result.ok, false);
    assert.equal(result.error, "No valid client rows in spreadsheet");
    assert.equal(result.meta?.totalRows, 0);
    assert.equal(result.meta?.validRows, 0);
  });

  it("returns explicit error for spreadsheet with no client name column values", () => {
    const result = importClientData([
      { foo: "bar", status: "In Progress" },
      { client: "", notes: "missing customer name" },
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.error, "No valid client rows in spreadsheet");
    assert.equal(result.meta?.totalRows, 2);
    assert.equal(result.meta?.validRows, 0);
  });

  it("exports versioned backup JSON that can be imported back", () => {
    const storage = createMockStorage();
    const seeded = withStorage(storage, () => resetToSeededState());
    const payload = exportClientData(seeded);
    const result = importClientData(payload);

    assert.equal(result.ok, true);
    assert.equal(result.state.metadata.version, CLIENT_DB_VERSION);
    assert.equal(result.state.clients["client-1"].status, seeded.clients["client-1"].status);
    const parsed = JSON.parse(payload);
    assert.equal(parsed.metadata.version, CLIENT_DB_VERSION);
    assert.equal(typeof parsed.metadata.exportedAt, "string");
  });
});
