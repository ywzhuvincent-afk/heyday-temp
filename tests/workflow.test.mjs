import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assignJob,
  completeJob,
  createClient,
  createInitialState,
  approveFinalPackage,
  getManagerDashboard,
  getManagerAlerts,
  getReviewInbox,
  getTimelineDisplayEvents,
  getVisibleJobsForUser,
  markPaymentReceived,
  needMoreInfo,
  receiveUploadedDocuments,
  requestDocuments,
  reassignJob,
  reviewAndBill,
  returnToEmployee,
  searchClients,
  startRevision,
  startJob,
  acceptJob,
  undoAssignment,
  updateClient,
  uploadEmployeeWorkFiles,
} from "../src/workflow.mjs";

describe("HEYDAY workflow", () => {
  it("creates a new client with a draft active job before sending a request email", () => {
    const state = createInitialState();

    const result = createClient(state, {
      organizationId: "org-heyday",
      managerId: "user-manager",
      name: "North Shore Books",
      contactName: "Ivy Park",
      email: "ivy@northshorebooks.ca",
      phone: "(604) 555-0199",
      notes: "New year-end client.",
      now: "2026-06-07T09:00:00.000Z",
    });

    const client = Object.values(result.clients).find((item) => item.name === "North Shore Books");
    assert.ok(client);
    assert.equal(client.status, "new_client");
    assert.equal(client.statusChangedAt, "2026-06-07T09:00:00.000Z");

    const job = Object.values(result.jobs).find((item) => item.clientId === client.id);
    assert.ok(job);
    assert.equal(job.status, "new_client");
    assert.equal(job.assignedTo, null);
    assert.equal(result.events.at(-1).status, "new_client");
  });

  it("sends a request email for a newly created client and keeps the client searchable", () => {
    let state = createClient(createInitialState(), {
      organizationId: "org-heyday",
      managerId: "user-manager",
      name: "North Shore Books",
      contactName: "Ivy Park",
      email: "ivy@northshorebooks.ca",
      phone: "(604) 555-0199",
      notes: "",
      now: "2026-06-07T09:00:00.000Z",
    });
    const clientId = Object.values(state.clients).find((client) => client.name === "North Shore Books").id;

    state = requestDocuments(state, {
      clientId,
      managerId: "user-manager",
      now: "2026-06-07T10:00:00.000Z",
    });

    assert.equal(state.clients[clientId].status, "request_sent");
    assert.equal(state.uploadRequests.at(-1).clientId, clientId);
    assert.deepEqual(
      searchClients(state, { organizationId: "org-heyday", query: "shore" }).map((client) => client.id),
      [clientId],
    );
  });

  it("updates client profile fields and records a timeline event", () => {
    const result = updateClient(createInitialState(), {
      clientId: "client-1",
      managerId: "user-manager",
      name: "Luna Cafe Group Ltd.",
      contactName: "Grace Lin",
      email: "grace.updated@lunacafe.ca",
      phone: "(604) 555-0999",
      notes: "Updated contact details.",
      now: "2026-06-07T12:00:00.000Z",
    });

    assert.equal(result.clients["client-1"].name, "Luna Cafe Group Ltd.");
    assert.equal(result.clients["client-1"].email, "grace.updated@lunacafe.ca");
    assert.equal(result.clients["client-1"].phone, "(604) 555-0999");
    assert.equal(result.clients["client-1"].notes, "Updated contact details.");
    assert.equal(result.clients["client-1"].status, "documents_received");
    assert.equal(result.events.at(-1).status, "client_updated");
    assert.equal(result.events.at(-1).note, "Client profile updated.");
  });

  it("records a request email and creates an expiring upload link", () => {
    const state = createInitialState();
    const now = "2026-06-07T10:00:00.000Z";

    const result = requestDocuments(state, {
      clientId: "client-1",
      managerId: "user-manager",
      now,
    });

    assert.equal(result.clients["client-1"].status, "request_sent");
    assert.equal(result.clients["client-1"].statusChangedAt, now);
    assert.equal(result.uploadRequests.length, 1);
    assert.equal(result.uploadRequests[0].clientId, "client-1");
    assert.equal(result.uploadRequests[0].expiresAt, "2026-06-21T10:00:00.000Z");
    assert.equal(result.events.at(-1).status, "request_sent");
  });

  it("creates upload links in browser-like environments without Buffer", () => {
    const originalBuffer = globalThis.Buffer;
    globalThis.Buffer = undefined;

    try {
      const result = requestDocuments(createInitialState(), {
        clientId: "client-1",
        managerId: "user-manager",
        now: "2026-06-07T10:00:00.000Z",
      });

      assert.match(result.uploadRequests[0].token, /^[a-zA-Z0-9_-]+$/);
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });

  it("accepts customer uploads through a valid token and updates the client timeline", () => {
    const requested = requestDocuments(createInitialState(), {
      clientId: "client-1",
      managerId: "user-manager",
      now: "2026-06-07T10:00:00.000Z",
    });
    const token = requested.uploadRequests[0].token;

    const result = receiveUploadedDocuments(requested, {
      token,
      now: "2026-06-08T12:30:00.000Z",
      files: [{ name: "T4.pdf", size: 1042, type: "application/pdf" }],
    });

    assert.equal(result.clients["client-1"].status, "documents_received");
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].section, "client_uploaded");
    assert.equal(result.uploadRequests[0].usedAt, "2026-06-08T12:30:00.000Z");
    assert.equal(result.events.at(-1).status, "documents_received");
  });

  it("places uploaded client documents into the manager review inbox", () => {
    const requested = requestDocuments(createInitialState(), {
      clientId: "client-1",
      managerId: "user-manager",
      now: "2026-06-07T10:00:00.000Z",
    });

    const uploaded = receiveUploadedDocuments(requested, {
      token: requested.uploadRequests[0].token,
      now: "2026-06-08T12:30:00.000Z",
      files: [
        { name: "T4.pdf", size: 1042, type: "application/pdf" },
        { name: "bank.pdf", size: 2048, type: "application/pdf" },
      ],
    });

    const inbox = getReviewInbox(uploaded, "org-heyday");

    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].client.name, "Luna Cafe Ltd.");
    assert.equal(inbox[0].fileCount, 2);
    assert.equal(inbox[0].uploadedAt, "2026-06-08T12:30:00.000Z");
    assert.equal(inbox[0].status, "documents_received");
    assert.equal(inbox[0].reviewType, "client_documents");
  });

  it("places completed employee work into the manager review inbox", () => {
    const completed = completeJob(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [{ name: "completed-package.pdf", size: 4096, type: "application/pdf" }],
    });

    const inbox = getReviewInbox(completed, "org-heyday");

    assert.equal(inbox[0].client.name, "Harbour Dental Inc.");
    assert.equal(inbox[0].status, "job_completed");
    assert.equal(inbox[0].reviewType, "completed_work");
    assert.equal(inbox[0].fileCount, 1);
    assert.equal(inbox[0].uploadedAt, "2026-06-10T16:45:00.000Z");
  });

  it("uploads employee work files without submitting the job", () => {
    const result = uploadEmployeeWorkFiles(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T15:00:00.000Z",
      files: [{ name: "draft-working-paper.pdf", size: 4096, type: "application/pdf" }],
    });

    assert.equal(result.clients["client-2"].status, "in_progress");
    assert.equal(result.jobs["job-2"].status, "in_progress");
    assert.equal(result.files.at(-1).section, "employee_work");
    assert.equal(result.files.at(-1).uploadedBy, "user-amy");
    assert.equal(result.events.at(-1).status, "employee_files_uploaded");
  });

  it("requires employee work files before submitting to manager review", () => {
    assert.throws(
      () =>
        completeJob(createInitialState(), {
          jobId: "job-2",
          employeeId: "user-amy",
          now: "2026-06-10T16:45:00.000Z",
          files: [],
        }),
      /upload work files/i,
    );
  });

  it("submits existing uploaded employee work files to manager review", () => {
    let state = uploadEmployeeWorkFiles(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T15:00:00.000Z",
      files: [{ name: "completed-package.pdf", size: 4096, type: "application/pdf" }],
    });

    state = completeJob(state, {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [],
    });

    const inboxItem = getReviewInbox(state, "org-heyday").find((item) => item.clientId === "client-2");

    assert.equal(state.clients["client-2"].status, "job_completed");
    assert.equal(inboxItem.reviewType, "completed_work");
    assert.equal(inboxItem.fileCount, 1);
  });

  it("removes completed work from the review inbox after final package approval", () => {
    let state = completeJob(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [{ name: "completed-package.pdf", size: 4096, type: "application/pdf" }],
    });

    assert.ok(getReviewInbox(state, "org-heyday").some((item) => item.clientId === "client-2"));

    state = approveFinalPackage(state, {
      jobId: "job-2",
      managerId: "user-manager",
      now: "2026-06-11T11:00:00.000Z",
    });

    assert.equal(state.clients["client-2"].status, "final_package_approved");
    assert.equal(getReviewInbox(state, "org-heyday").some((item) => item.clientId === "client-2"), false);
  });

  it("rejects expired upload links", () => {
    const requested = requestDocuments(createInitialState(), {
      clientId: "client-1",
      managerId: "user-manager",
      now: "2026-06-07T10:00:00.000Z",
    });

    assert.throws(
      () =>
        receiveUploadedDocuments(requested, {
          token: requested.uploadRequests[0].token,
          now: "2026-06-22T10:00:00.000Z",
          files: [{ name: "late.pdf", size: 5, type: "application/pdf" }],
        }),
      /Upload link expired/,
    );
  });

  it("tracks assignment, employee progress, manager billing, and payment timestamps", () => {
    let state = createInitialState();
    state = assignJob(state, {
      clientId: "client-1",
      jobId: "job-1",
      managerId: "user-manager",
      employeeId: "user-amy",
      instructions: "CALL CRA",
      dueDate: "2026-06-14",
      priority: "high",
      now: "2026-06-09T09:00:00.000Z",
    });
    state = acceptJob(state, {
      jobId: "job-1",
      employeeId: "user-amy",
      now: "2026-06-09T09:15:00.000Z",
    });
    state = startJob(state, {
      jobId: "job-1",
      employeeId: "user-amy",
      now: "2026-06-09T10:00:00.000Z",
    });
    state = completeJob(state, {
      jobId: "job-1",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [{ name: "final-report.pdf", size: 4096, type: "application/pdf" }],
    });
    state = approveFinalPackage(state, {
      jobId: "job-1",
      managerId: "user-manager",
      now: "2026-06-11T10:30:00.000Z",
    });
    state = reviewAndBill(state, {
      jobId: "job-1",
      managerId: "user-manager",
      invoiceNumber: "HD-1001",
      amount: 1250,
      now: "2026-06-11T11:00:00.000Z",
    });
    state = markPaymentReceived(state, {
      jobId: "job-1",
      managerId: "user-manager",
      now: "2026-06-12T13:00:00.000Z",
    });

    assert.equal(state.clients["client-1"].status, "payment_received");
    assert.equal(state.jobs["job-1"].assignedTo, "user-amy");
    assert.equal(state.jobs["job-1"].acceptedAt, "2026-06-09T09:15:00.000Z");
    assert.equal(state.jobs["job-1"].startedAt, "2026-06-09T10:00:00.000Z");
    assert.equal(state.jobs["job-1"].completedAt, "2026-06-10T16:45:00.000Z");
    assert.equal(state.billingRecords[0].paidAt, "2026-06-12T13:00:00.000Z");
    assert.deepEqual(
      state.events.map((event) => event.status),
      [
        "job_assigned",
        "job_accepted",
        "in_progress",
        "job_completed",
        "final_package_approved",
        "reviewed_billed",
        "payment_received",
      ],
    );
  });

  it("prevents duplicate billing and duplicate payment records", () => {
    let state = completeJob(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [{ name: "completed-package.pdf", size: 4096, type: "application/pdf" }],
    });
    state = approveFinalPackage(state, {
      jobId: "job-2",
      managerId: "user-manager",
      now: "2026-06-11T10:30:00.000Z",
    });
    state = reviewAndBill(state, {
      jobId: "job-2",
      managerId: "user-manager",
      invoiceNumber: "HD-1001",
      amount: 1250,
      now: "2026-06-11T11:00:00.000Z",
    });

    assert.throws(
      () =>
        reviewAndBill(state, {
          jobId: "job-2",
          managerId: "user-manager",
          invoiceNumber: "HD-1002",
          amount: 1400,
          now: "2026-06-11T11:05:00.000Z",
        }),
      /already reviewed and billed/i,
    );

    state = markPaymentReceived(state, {
      jobId: "job-2",
      managerId: "user-manager",
      now: "2026-06-12T13:00:00.000Z",
    });

    assert.throws(
      () =>
        markPaymentReceived(state, {
          jobId: "job-2",
          managerId: "user-manager",
          now: "2026-06-12T13:05:00.000Z",
        }),
      /already received/i,
    );
    assert.equal(state.billingRecords.length, 1);
  });

  it("requires final package approval before sending invoice and receiving payment", () => {
    let state = completeJob(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [{ name: "completed-package.pdf", size: 4096, type: "application/pdf" }],
    });

    assert.throws(
      () =>
        reviewAndBill(state, {
          jobId: "job-2",
          managerId: "user-manager",
          invoiceNumber: "HD-1001",
          amount: 1250,
          now: "2026-06-11T11:00:00.000Z",
        }),
      /final package/i,
    );

    state = approveFinalPackage(state, {
      jobId: "job-2",
      managerId: "user-manager",
      now: "2026-06-11T10:30:00.000Z",
    });
    state = reviewAndBill(state, {
      jobId: "job-2",
      managerId: "user-manager",
      invoiceNumber: "HD-1001",
      amount: 1250,
      now: "2026-06-11T11:00:00.000Z",
    });
    state = markPaymentReceived(state, {
      jobId: "job-2",
      managerId: "user-manager",
      now: "2026-06-12T13:00:00.000Z",
    });

    assert.equal(state.clients["client-2"].status, "payment_received");
    assert.equal(state.jobs["job-2"].status, "payment_received");
  });

  it("lets a manager return completed work to the assigned employee for revision", () => {
    let state = completeJob(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [{ name: "completed-package.pdf", size: 4096, type: "application/pdf" }],
    });

    state = returnToEmployee(state, {
      jobId: "job-2",
      managerId: "user-manager",
      note: "Please update the CRA confirmation section.",
      now: "2026-06-11T09:00:00.000Z",
    });

    assert.equal(state.clients["client-2"].status, "revision_requested");
    assert.equal(state.jobs["job-2"].status, "revision_requested");
    assert.equal(state.jobs["job-2"].revisionNote, "Please update the CRA confirmation section.");
    assert.equal(state.events.at(-1).status, "revision_requested");
    assert.equal(state.notifications.at(-1).recipientId, "user-amy");
    assert.equal(state.notifications.at(-1).type, "revision_requested");
    assert.deepEqual(
      getVisibleJobsForUser(state, "user-amy").map((job) => job.status),
      ["revision_requested"],
    );
  });

  it("lets an employee start and complete a requested revision back to manager review", () => {
    let state = completeJob(createInitialState(), {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-10T16:45:00.000Z",
      files: [{ name: "completed-package.pdf", size: 4096, type: "application/pdf" }],
    });
    state = returnToEmployee(state, {
      jobId: "job-2",
      managerId: "user-manager",
      note: "Please update the CRA confirmation section.",
      now: "2026-06-11T09:00:00.000Z",
    });
    state = startRevision(state, {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-11T10:00:00.000Z",
    });
    state = completeJob(state, {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-11T15:30:00.000Z",
      files: [{ name: "revised-completed-package.pdf", size: 5096, type: "application/pdf" }],
    });

    const inboxItem = getReviewInbox(state, "org-heyday").find((item) => item.clientId === "client-2");

    assert.equal(state.clients["client-2"].status, "job_completed");
    assert.equal(inboxItem.reviewType, "completed_work");
    assert.equal(inboxItem.fileCount, 2);
    assert.deepEqual(
      state.events.map((event) => event.status).slice(-3),
      ["revision_requested", "in_progress", "job_completed"],
    );
  });

  it("prevents duplicate assignment on an already assigned job", () => {
    const assigned = assignJob(createInitialState(), {
      clientId: "client-1",
      jobId: "job-1",
      managerId: "user-manager",
      employeeId: "user-amy",
      instructions: "CALL CRA",
      dueDate: "2026-06-14",
      priority: "high",
      now: "2026-06-09T09:00:00.000Z",
    });

    assert.throws(
      () =>
        assignJob(assigned, {
          clientId: "client-1",
          jobId: "job-1",
          managerId: "user-manager",
          employeeId: "user-amy",
          instructions: "CALL CRA",
          dueDate: "2026-06-14",
          priority: "high",
          now: "2026-06-09T09:01:00.000Z",
        }),
      /already assigned/i,
    );

    assert.equal(assigned.events.filter((event) => event.status === "job_assigned").length, 1);
  });

  it("undoes assignment and returns the job to documents received", () => {
    const assigned = assignJob(createInitialState(), {
      clientId: "client-1",
      jobId: "job-1",
      managerId: "user-manager",
      employeeId: "user-amy",
      instructions: "CALL CRA",
      dueDate: "2026-06-14",
      priority: "high",
      now: "2026-06-09T09:00:00.000Z",
    });

    const undone = undoAssignment(assigned, {
      jobId: "job-1",
      managerId: "user-manager",
      now: "2026-06-09T09:05:00.000Z",
    });

    assert.equal(undone.clients["client-1"].status, "documents_received");
    assert.equal(undone.jobs["job-1"].status, "documents_received");
    assert.equal(undone.jobs["job-1"].assignedTo, null);
    assert.equal(undone.jobs["job-1"].assignedAt, null);
    assert.equal(undone.events.at(-1).status, "assignment_undone");
  });

  it("undoes assignment back to request sent when no client documents were uploaded yet", () => {
    let state = createClient(createInitialState(), {
      organizationId: "org-heyday",
      managerId: "user-manager",
      name: "Pacific Studio",
      contactName: "Noah Gray",
      email: "noah@pacificstudio.ca",
      phone: "(604) 555-0144",
      notes: "",
      now: "2026-06-07T09:00:00.000Z",
    });
    const clientId = Object.values(state.clients).find((client) => client.name === "Pacific Studio").id;
    const jobId = Object.values(state.jobs).find((job) => job.clientId === clientId).id;
    state = requestDocuments(state, { clientId, managerId: "user-manager", now: "2026-06-07T10:00:00.000Z" });
    state = assignJob(state, {
      clientId,
      jobId,
      managerId: "user-manager",
      employeeId: "user-amy",
      instructions: "Prepare onboarding list",
      dueDate: "2026-06-14",
      priority: "medium",
      now: "2026-06-07T11:00:00.000Z",
    });

    const undone = undoAssignment(state, {
      jobId,
      managerId: "user-manager",
      now: "2026-06-07T11:05:00.000Z",
    });

    assert.equal(undone.clients[clientId].status, "request_sent");
    assert.equal(undone.jobs[jobId].status, "request_sent");
    assert.equal(undone.jobs[jobId].assignedTo, null);
  });

  it("reassigns by recording one assignment change and keeping only the current employee", () => {
    const assigned = assignJob(createInitialState(), {
      clientId: "client-1",
      jobId: "job-1",
      managerId: "user-manager",
      employeeId: "user-amy",
      instructions: "CALL CRA",
      dueDate: "2026-06-14",
      priority: "high",
      now: "2026-06-09T09:00:00.000Z",
    });

    const reassigned = reassignJob(assigned, {
      jobId: "job-1",
      managerId: "user-manager",
      employeeId: "user-ryan",
      instructions: "CALL CRA and update notes",
      dueDate: "2026-06-15",
      priority: "medium",
      now: "2026-06-09T10:00:00.000Z",
    });

    assert.equal(reassigned.clients["client-1"].status, "job_assigned");
    assert.equal(reassigned.jobs["job-1"].assignedTo, "user-ryan");
    assert.equal(reassigned.jobs["job-1"].assignedAt, "2026-06-09T10:00:00.000Z");
    assert.equal(reassigned.events.filter((event) => event.status === "job_assigned").length, 1);
    assert.equal(reassigned.events.filter((event) => event.status === "assignment_changed").length, 1);
  });

  it("collapses consecutive duplicate assignment events for timeline display", () => {
    const state = createInitialState();
    const timeline = getTimelineDisplayEvents({
      ...state,
      events: [
        {
          id: "event-1",
          organizationId: "org-heyday",
          clientId: "client-1",
          jobId: "job-1",
          status: "job_assigned",
          actorId: "user-manager",
          note: "Assigned to Amy Wong: CALL CRA",
          at: "2026-06-09T09:00:00.000Z",
        },
        {
          id: "event-2",
          organizationId: "org-heyday",
          clientId: "client-1",
          jobId: "job-1",
          status: "job_assigned",
          actorId: "user-manager",
          note: "Assigned to Amy Wong: CALL CRA",
          at: "2026-06-09T09:01:00.000Z",
        },
      ],
    }, "client-1");

    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].duplicateCount, 2);
  });

  it("lets managers see all jobs while employees only see their assignments", () => {
    const state = createInitialState();

    assert.equal(getVisibleJobsForUser(state, "user-manager").length, 3);
    assert.deepEqual(
      getVisibleJobsForUser(state, "user-amy").map((job) => job.id),
      ["job-2"],
    );
  });

  it("summarizes manager dashboard status and workload counts", () => {
    const state = createInitialState();
    const dashboard = getManagerDashboard(state, "org-heyday", "2026-06-07T00:00:00.000Z");

    assert.equal(dashboard.totalClients, 3);
    assert.equal(dashboard.statusCounts.documents_received, 1);
    assert.equal(dashboard.statusCounts.in_progress, 1);
    assert.equal(dashboard.workload.find((item) => item.userId === "user-amy").activeJobs, 1);
    assert.equal(dashboard.overdueJobs.length, 1);
  });

  it("filters clients by status and employee and returns all clients when filters reset", () => {
    const state = createInitialState();

    const assignedOnly = state.clients["client-2"];
    assert.equal(assignedOnly.status, "in_progress");

    assert.deepEqual(
      searchClients(state, { organizationId: "org-heyday", status: "in_progress" }).map((client) => client.id),
      ["client-2"],
    );
    assert.deepEqual(
      searchClients(state, { organizationId: "org-heyday", employeeId: "user-amy" }).map((client) => client.id),
      ["client-2"],
    );
    assert.equal(searchClients(state, { organizationId: "org-heyday", status: "all", employeeId: "all" }).length, 3);
  });

  it("sorts client search results by closest text match", () => {
    let state = createClient(createInitialState(), {
      organizationId: "org-heyday",
      managerId: "user-manager",
      name: "Cafe Payroll Services",
      contactName: "Alex Cafe",
      email: "alex@payroll.example",
      phone: "(604) 555-0101",
      notes: "",
      now: "2026-06-07T09:00:00.000Z",
    });
    state = createClient(state, {
      organizationId: "org-heyday",
      managerId: "user-manager",
      name: "Westside Studio",
      contactName: "Cathy Lane",
      email: "cafe@westside.example",
      phone: "(604) 555-0102",
      notes: "",
      now: "2026-06-07T09:05:00.000Z",
    });

    assert.deepEqual(
      searchClients(state, { organizationId: "org-heyday", query: "caf" })
        .slice(0, 2)
        .map((client) => client.name),
      ["Cafe Payroll Services", "Luna Cafe Ltd."],
    );
  });

  it("surfaces manager alerts for uploads, completed jobs, and need more info", () => {
    let state = requestDocuments(createInitialState(), {
      clientId: "client-1",
      managerId: "user-manager",
      now: "2026-06-07T10:00:00.000Z",
    });
    state = receiveUploadedDocuments(state, {
      token: state.uploadRequests[0].token,
      now: "2026-06-08T12:30:00.000Z",
      files: [{ name: "T4.pdf", size: 1042, type: "application/pdf" }],
    });
    state = completeJob(state, {
      jobId: "job-2",
      employeeId: "user-amy",
      now: "2026-06-09T17:00:00.000Z",
      files: [{ name: "completed.pdf", size: 4096, type: "application/pdf" }],
    });
    state = needMoreInfo(state, {
      jobId: "job-1",
      actorId: "user-manager",
      note: "Missing bank statements.",
      now: "2026-06-10T09:00:00.000Z",
    });

    const alerts = getManagerAlerts(state, "org-heyday");

    assert.deepEqual(
      alerts.map((alert) => alert.type),
      ["need_more_info", "job_completed", "documents_received"],
    );
    assert.match(alerts[0].message, /Missing bank statements/);
    assert.match(alerts[1].message, /completed/);
    assert.match(alerts[2].message, /uploaded 1 file/);
  });

  it("creates one reusable missing info upload link and returns to documents received after upload", () => {
    let state = needMoreInfo(createInitialState(), {
      jobId: "job-1",
      actorId: "user-manager",
      note: "Missing bank statements.",
      now: "2026-06-10T09:00:00.000Z",
    });
    state = needMoreInfo(state, {
      jobId: "job-1",
      actorId: "user-manager",
      note: "Missing bank statements.",
      now: "2026-06-10T09:01:00.000Z",
    });

    const missingInfoRequests = state.uploadRequests.filter(
      (request) => request.clientId === "client-1" && request.purpose === "missing_info",
    );

    assert.equal(missingInfoRequests.length, 1);
    assert.equal(state.clients["client-1"].status, "need_more_info");
    assert.equal(getManagerAlerts(state, "org-heyday").filter((alert) => alert.type === "need_more_info").length, 1);

    const uploaded = receiveUploadedDocuments(state, {
      token: missingInfoRequests[0].token,
      now: "2026-06-10T10:00:00.000Z",
      files: [{ name: "missing-bank.pdf", size: 2048, type: "application/pdf" }],
    });

    assert.equal(uploaded.clients["client-1"].status, "documents_received");
    assert.equal(getReviewInbox(uploaded, "org-heyday")[0].reviewType, "client_documents");
  });

  it("does not create repeated manager alerts for the same active missing info request", () => {
    let state = createInitialState();
    state = needMoreInfo(state, {
      jobId: "job-1",
      actorId: "user-manager",
      note: "Need more information before continuing.",
      now: "2026-06-10T09:00:00.000Z",
    });
    state = needMoreInfo(state, {
      jobId: "job-1",
      actorId: "user-manager",
      note: "Need more information before continuing.",
      now: "2026-06-10T09:01:00.000Z",
    });

    const alerts = getManagerAlerts(state, "org-heyday").filter((alert) => alert.type === "need_more_info");

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].repeatCount, 1);
    assert.equal(alerts[0].createdAt, "2026-06-10T09:00:00.000Z");
  });

  it("surfaces manager alerts for assigned jobs without assigned staff", () => {
    const state = createInitialState();
    const brokenState = {
      ...state,
      clients: {
        ...state.clients,
        "client-3": {
          ...state.clients["client-3"],
          status: "job_assigned",
        },
      },
      jobs: {
        ...state.jobs,
        "job-3": {
          ...state.jobs["job-3"],
          status: "job_assigned",
          assignedTo: null,
        },
      },
    };

    const alerts = getManagerAlerts(brokenState, "org-heyday");

    assert.equal(alerts[0].type, "data_issue");
    assert.equal(alerts[0].clientId, "client-3");
    assert.match(alerts[0].message, /assigned status without assigned staff/i);
  });
});
