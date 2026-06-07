import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createActionLocker,
  filterAlertsByType,
  filterJobsByEmployeeStatus,
  filterReviewInboxByType,
  fileSectionLabel,
} from "../src/ui-helpers.mjs";

describe("UI helpers", () => {
  it("blocks the same mutating action for two seconds", () => {
    const locker = createActionLocker(2000);

    assert.equal(locker.tryLock("request-docs:client-1", 1000), true);
    assert.equal(locker.tryLock("request-docs:client-1", 2500), false);
    assert.equal(locker.tryLock("request-docs:client-1", 3001), true);
  });

  it("filters review inbox items by review type", () => {
    const items = [
      { clientId: "client-1", reviewType: "client_documents" },
      { clientId: "client-2", reviewType: "completed_work" },
    ];

    assert.deepEqual(filterReviewInboxByType(items, "all").map((item) => item.clientId), ["client-1", "client-2"]);
    assert.deepEqual(filterReviewInboxByType(items, "client_documents").map((item) => item.clientId), ["client-1"]);
    assert.deepEqual(filterReviewInboxByType(items, "completed_work").map((item) => item.clientId), ["client-2"]);
  });

  it("filters manager alerts by alert type", () => {
    const alerts = [
      { id: "alert-1", type: "documents_received" },
      { id: "alert-2", type: "sent_for_review" },
      { id: "alert-3", type: "resubmitted" },
      { id: "alert-4", type: "need_more_info" },
    ];

    assert.deepEqual(filterAlertsByType(alerts, "all").map((alert) => alert.id), ["alert-1", "alert-2", "alert-3", "alert-4"]);
    assert.deepEqual(filterAlertsByType(alerts, "sent_for_review").map((alert) => alert.id), ["alert-2", "alert-3"]);
  });

  it("filters employee jobs by dashboard status", () => {
    const jobs = [
      { id: "job-1", status: "job_assigned" },
      { id: "job-2", status: "job_accepted" },
      { id: "job-3", status: "in_progress" },
      { id: "job-4", status: "revision_required" },
      { id: "job-5", status: "revision_in_progress" },
      { id: "job-6", status: "sent_for_review" },
      { id: "job-7", status: "resubmitted" },
      { id: "job-8", status: "approved" },
      { id: "job-9", status: "reviewed_billed" },
    ];

    assert.deepEqual(filterJobsByEmployeeStatus(jobs, "all").map((job) => job.id), [
      "job-1",
      "job-2",
      "job-3",
      "job-4",
      "job-5",
      "job-6",
      "job-7",
      "job-8",
      "job-9",
    ]);
    assert.deepEqual(filterJobsByEmployeeStatus(jobs, "new_assigned").map((job) => job.id), ["job-1"]);
    assert.deepEqual(filterJobsByEmployeeStatus(jobs, "in_progress").map((job) => job.id), ["job-2", "job-3", "job-5"]);
    assert.deepEqual(filterJobsByEmployeeStatus(jobs, "revision_required").map((job) => job.id), ["job-4"]);
    assert.deepEqual(filterJobsByEmployeeStatus(jobs, "waiting_manager_review").map((job) => job.id), ["job-6", "job-7"]);
    assert.deepEqual(filterJobsByEmployeeStatus(jobs, "closed_or_sent").map((job) => job.id), ["job-8", "job-9"]);
  });

  it("returns human-readable file section labels", () => {
    assert.equal(fileSectionLabel("client_uploaded"), "Client Uploaded");
    assert.equal(fileSectionLabel("employee_work"), "Employee Work Files");
    assert.equal(fileSectionLabel("final_reports"), "Final Reports");
    assert.equal(fileSectionLabel("billing"), "Billing");
    assert.equal(fileSectionLabel("custom_section"), "custom_section");
  });
});
