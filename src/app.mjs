import {
  EVENT_LABELS,
  FILE_SECTIONS,
  STATUS_LABELS,
  acceptJob,
  approveFinalPackage,
  assignJob,
  completeJob,
  createClient,
  createInitialState,
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
  undoAssignment,
  updateClient,
  uploadEmployeeWorkFiles,
} from "./workflow.mjs";
import { WORKSPACE_TABS, getWorkspaceTabForAlert, getWorkspaceTabForEntry, isWorkspaceTab } from "./workspace.mjs";
import {
  createActionLocker,
  fileSectionLabel,
  filterAlertsByType,
  filterJobsByEmployeeStatus,
  filterReviewInboxByType,
} from "./ui-helpers.mjs";

const STORAGE_KEY = "heyday.workflow.state.v1";
const ORGANIZATION_ID = "org-heyday";
const MANAGER_ID = "user-manager";

const app = document.querySelector("#app");
let state = loadState();
let currentUserId = MANAGER_ID;
let currentView = new URLSearchParams(location.search).has("upload") ? "upload" : "manager";
let selectedClientId = "client-1";
let selectedWorkspaceTab = "profile";
let workspaceBackStack = [];
let historyStack = [];
let filters = { query: "", status: "all", employeeId: "all" };
let toastMessage = "";
let showCreateClientForm = false;
let assignDraft = { employeeId: "user-amy", priority: "medium", instructions: "", dueDate: "" };
let createClientDraft = { name: "", contactName: "", email: "", phone: "", notes: "" };
let pendingNeedInfoJobId = null;
let pendingReturnJobId = null;
let selectedEmployeeDashboardId = "user-amy";
let editingClientId = null;
let editClientDraft = emptyEditClientDraft();
let reviewInboxFilter = "all";
let managerAlertFilter = "all";
let pendingFocusRestore = null;
let employeeJobFilter = "all";
let previewFileId = null;
const actionLocker = createActionLocker(2000);
const LOCKED_ACTIONS = new Set([
  "request-docs",
  "upload",
  "assign-job",
  "undo-assignment",
  "reassign-job",
  "send-missing-info",
  "upload-work-files",
  "complete",
  "approve-final-package",
  "send-revision",
  "send-final-package",
  "payment",
  "save-client",
]);

render();

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.closest(".client-table") && target.matches("button")) {
    event.stopPropagation();
  }

  const action = target.dataset.action;
  const id = target.dataset.id;

  try {
    if (LOCKED_ACTIONS.has(action)) {
      const key = actionLockKey(action, target);
      if (!actionLocker.tryLock(key)) {
        showToast("Please wait 2 seconds before pressing this action again.");
        render();
        return;
      }
      window.setTimeout(() => render(), 2050);
    }

    if (action === "view") currentView = id;
    if (action === "role") currentUserId = id;
    if (action === "select-client") handleSelectClient(id);
    if (action === "workspace-tab") handleWorkspaceTab(id);
    if (action === "workspace-back") handleWorkspaceBack();
    if (action === "review-documents") handleReviewDocuments(id);
    if (action === "alert-open") handleAlertOpen(id, target.dataset.type);
    if (action === "alert-dismiss") handleDismissAlert(target.dataset.type, id, target.dataset.jobId);
    if (action === "goto-assign") handleWorkspaceTab("assign");
    if (action === "approve-final-package") handleApproveFinalPackage(id);
    if (action === "request-revision") handleRequestRevision(id);
    if (action === "cancel-revision") pendingReturnJobId = null;
    if (action === "send-revision") handleSendRevision(id);
    if (action === "send-final-package") handleSendFinalPackage(id);
    if (action === "filter-status") filters.status = id;
    if (action === "clear-filters") clearFilters();
    if (action === "toggle-create-client") handleToggleCreateClient();
    if (action === "create-client-from-search") handleOpenCreateClientFromSearch();
    if (action === "cancel-create-client") handleCancelCreateClient();
    if (action === "create-client") handleCreateClient();
    if (action === "edit-client") handleEditClient(id);
    if (action === "cancel-edit-client") handleCancelEditClient();
    if (action === "save-client") handleSaveClient(id);
    if (action === "clear-search") handleClearSearch();
    if (action === "preview-file") handlePreviewFile(id);
    if (action === "close-preview") previewFileId = null;
    if (action === "open-request-email") handleOpenRequestEmail(id);
    if (action === "cancel-need-info") pendingNeedInfoJobId = null;
    if (action === "send-missing-info") handleSendMissingInfo(id);
    if (action === "undo-last") undoLastAction();
    if (action === "reset") resetDemo();
    if (action === "request-docs") handleRequestDocs(id);
    if (action === "assign-job") handleAssignJob(id);
    if (action === "undo-assignment") handleUndoAssignment(id);
    if (action === "reassign-job") handleReassignJob(id);
    if (action === "need-info") handleNeedInfo(id);
    if (action === "review-bill") handleReviewBill(id);
    if (action === "payment") handlePayment(id);
    if (action === "accept") updateState(acceptJob(state, { jobId: id, employeeId: target.dataset.employeeId || activeEmployeeId(), now: now() }));
    if (action === "start") updateState(startJob(state, { jobId: id, employeeId: target.dataset.employeeId || activeEmployeeId(), now: now() }));
    if (action === "start-revision") updateState(startRevision(state, { jobId: id, employeeId: target.dataset.employeeId || activeEmployeeId(), now: now() }));
    if (action === "upload-work-files") handleUploadWorkFiles(id, target.dataset.employeeId || activeEmployeeId());
    if (action === "complete") handleCompleteJob(id);
    if (action === "upload") handleUpload();
  } catch (error) {
    showToast(error.message);
  }

  render();
});

app.addEventListener("input", (event) => {
  const target = event.target;
  let shouldRender = false;
  if (target.id === "client-search") {
    filters.query = target.value;
    pendingFocusRestore = {
      id: "client-search",
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
    };
    shouldRender = true;
  }
  if (target.id === "new-client-name") createClientDraft.name = target.value;
  if (target.id === "new-client-contact") createClientDraft.contactName = target.value;
  if (target.id === "new-client-email") createClientDraft.email = target.value;
  if (target.id === "new-client-phone") createClientDraft.phone = target.value;
  if (target.id === "new-client-notes") createClientDraft.notes = target.value;
  if (target.id === "assign-instructions") assignDraft.instructions = target.value;
  if (target.id === "assign-due") assignDraft.dueDate = target.value;
  if (target.id === "edit-client-name") editClientDraft.name = target.value;
  if (target.id === "edit-client-contact") editClientDraft.contactName = target.value;
  if (target.id === "edit-client-email") editClientDraft.email = target.value;
  if (target.id === "edit-client-phone") editClientDraft.phone = target.value;
  if (target.id === "edit-client-notes") editClientDraft.notes = target.value;
  if (shouldRender) {
    render();
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  let shouldRender = false;
  if (target.id === "status-filter") {
    filters.status = target.value;
    shouldRender = true;
  }
  if (target.id === "employee-filter") {
    filters.employeeId = target.value;
    shouldRender = true;
  }
  if (target.id === "assign-employee") assignDraft.employeeId = target.value;
  if (target.id === "assign-priority") assignDraft.priority = target.value;
  if (target.id === "employee-view-select") {
    selectedEmployeeDashboardId = target.value;
    shouldRender = true;
  }
  if (target.id === "employee-job-filter") {
    employeeJobFilter = target.value;
    shouldRender = true;
  }
  if (target.id === "review-inbox-filter") {
    reviewInboxFilter = target.value;
    shouldRender = true;
  }
  if (target.id === "manager-alert-filter") {
    managerAlertFilter = target.value;
    shouldRender = true;
  }
  if (shouldRender) render();
});

function render() {
  const currentUser = state.users[currentUserId];
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">HD</span>
          <div>
            <div class="brand-title">HEYDAY Workflow</div>
            <div class="brand-subtitle">Client jobs, files, status timeline, billing</div>
          </div>
        </div>
        <nav class="view-tabs" aria-label="Primary views">
          ${tab("manager", "Manager", currentView)}
          ${tab("employee", "Employee", currentView)}
          ${tab("upload", "Upload Portal", currentView)}
        </nav>
        <div class="role-switcher">
          <select id="user-select" aria-label="Current user">
            ${Object.values(state.users)
              .map(
                (user) =>
                  `<option value="${user.id}" ${user.id === currentUserId ? "selected" : ""}>${escapeHtml(user.name)} · ${user.role}</option>`,
              )
              .join("")}
          </select>
          <button class="ghost-button" data-action="undo-last" ${historyStack.length ? "" : "disabled"}>Undo Last Action</button>
          <button class="ghost-button" data-action="reset">Reset Demo</button>
        </div>
      </header>
      <main class="content">
        ${currentView === "manager" ? renderManager() : ""}
        ${currentView === "employee" ? renderEmployee(currentUser) : ""}
        ${currentView === "upload" ? renderUploadPortal() : ""}
      </main>
      ${toastMessage ? `<div class="toast">${escapeHtml(toastMessage)}</div>` : ""}
    </div>
  `;

  const userSelect = document.querySelector("#user-select");
  userSelect?.addEventListener("change", (event) => {
    currentUserId = event.target.value;
    if (state.users[currentUserId].role === "employee" && currentView === "manager") {
      currentView = "employee";
    }
    if (state.users[currentUserId].role === "employee") {
      selectedEmployeeDashboardId = currentUserId;
    }
    render();
  });

  restorePendingFocus();
}

function renderManager() {
  const dashboard = getManagerDashboard(state, ORGANIZATION_ID, now());
  const reviewInbox = getReviewInbox(state, ORGANIZATION_ID);
  const filteredReviewInbox = filterReviewInboxByType(reviewInbox, reviewInboxFilter);
  const managerAlerts = getManagerAlerts(state, ORGANIZATION_ID);
  const filteredManagerAlerts = filterAlertsByType(managerAlerts, managerAlertFilter);
  const clients = searchClients(state, { organizationId: ORGANIZATION_ID, ...filters });
  if (!state.clients[selectedClientId]) {
    selectedClientId = clients[0]?.id ?? selectedClientId;
  }

  return `
    <div class="manager-grid">
      <div class="stack">
        <section class="section">
          <div class="section-header">
            <div>
              <div class="section-title">Manager Dashboard</div>
              <div class="section-subtitle">Live status counts, overdue work, and employee workload</div>
            </div>
            <span class="status-pill">${dashboard.totalClients} clients</span>
          </div>
          <div class="metric-grid">
            ${metric("all", "All Clients", dashboard.totalClients)}
            ${Object.entries(STATUS_LABELS)
              .map(([status, label]) => metric(status, label, dashboard.statusCounts[status] ?? 0))
              .join("")}
          </div>
        </section>

        <div class="manager-review-grid">
          <section class="section">
            <div class="section-header">
              <div>
                <div class="section-title">Documents To Review</div>
                <div class="section-subtitle">Client uploads and completed employee work waiting for manager review</div>
              </div>
              <span class="status-pill documents_received">${filteredReviewInbox.length}/${reviewInbox.length} waiting</span>
            </div>
            <div class="detail-body">
              ${renderReviewInboxControls(reviewInbox)}
              <div class="review-list scroll-list">
                ${renderReviewInbox(filteredReviewInbox)}
              </div>
            </div>
          </section>

          <section class="section">
            <div class="section-header">
              <div>
                <div class="section-title">Manager Alerts</div>
                <div class="section-subtitle">Uploaded documents, completed jobs, and information requests</div>
              </div>
            </div>
            <div class="detail-body">
              ${renderManagerAlertControls(managerAlerts)}
              <div class="notification-list scroll-list">
                ${renderManagerAlerts(filteredManagerAlerts)}
              </div>
            </div>
          </section>
        </div>

        <section class="section">
          <div class="section-header">
            <div>
              <div class="section-title">Client List</div>
              <div class="section-subtitle">Search by client name, phone, email, status, or staff owner</div>
            </div>
            <button class="primary-button" data-action="toggle-create-client">
              ${showCreateClientForm ? "Close Form" : "Create Client"}
            </button>
          </div>
          ${showCreateClientForm ? renderCreateClientForm() : ""}
          <div class="filters">
            <div class="field">
              <label for="client-search">Search</label>
              <div class="search-control">
                <input id="client-search" value="${escapeAttr(filters.query)}" placeholder="Client, contact, phone, email" />
                ${filters.query.trim() ? `<button class="ghost-button compact-button" data-action="clear-search">Clear</button>` : ""}
              </div>
            </div>
            <div class="field">
              <label for="status-filter">Status</label>
              <select id="status-filter">
                <option value="all">All statuses</option>
                ${statusOptions(filters.status)}
              </select>
            </div>
            <div class="field">
              <label for="employee-filter">Employee</label>
              <select id="employee-filter">
                <option value="all">All employees</option>
                ${employees()
                  .map(
                    (user) =>
                      `<option value="${user.id}" ${filters.employeeId === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`,
                  )
                  .join("")}
              </select>
            </div>
          </div>
          <div class="search-result-line">${clients.length} matching client${clients.length === 1 ? "" : "s"}</div>
          ${renderFilterSummary()}
          ${renderClientTable(clients)}
        </section>
      </div>

      <aside class="detail-panel">
        ${renderClientWorkspace(state.clients[selectedClientId])}
      </aside>
    </div>
  `;
}

function renderEmployee(currentUser) {
  const employeeId = activeEmployeeId();
  const employee = state.users[employeeId];
  const jobs = getVisibleJobsForUser(state, employeeId);
  const filteredJobs = filterJobsByEmployeeStatus(jobs, employeeJobFilter);
  const alerts = state.notifications
    .filter((item) => item.recipientId === employeeId)
    .reverse();

  return `
    <div class="employee-grid">
      <section class="section">
        <div class="section-header">
          <div>
            <div class="section-title">${escapeHtml(employee.name)}'s Jobs</div>
            <div class="section-subtitle">New work, progress updates, and completed file handoff</div>
          </div>
          <span class="status-pill">${jobs.length} assigned</span>
        </div>
        <div class="detail-body">
          <label class="field">
            <span>Viewing Employee</span>
            <select id="employee-view-select">
              ${employees()
                .map(
                  (user) =>
                    `<option value="${user.id}" ${employeeId === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="field">
            <span>Job Status</span>
            <select id="employee-job-filter">
              ${employeeJobFilterOptions(jobs)}
            </select>
          </label>
          <div class="job-list scroll-list">
            ${renderEmployeeJobGroups(filteredJobs)}
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <div>
            <div class="section-title">New Work Alerts</div>
            <div class="section-subtitle">Unread assignment and completion notifications</div>
          </div>
        </div>
        <div class="detail-body">
          <div class="notification-list scroll-list">
            ${alerts
              .map(
                (item) => `
                  <div class="notification-item">
                    <div class="job-title">${escapeHtml(item.message)}</div>
                    <div class="muted small">${formatDateTime(item.createdAt)}</div>
                  </div>
                `,
              )
              .join("") || `<div class="empty-state">No new alerts.</div>`}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderUploadPortal() {
  const params = new URLSearchParams(location.search);
  const queryToken = params.get("token") || params.get("upload");
  const activeRequests = state.uploadRequests.filter((request) => !request.usedAt);
  const selectedToken = queryToken || activeRequests[0]?.token || "";
  const selectedRequest = state.uploadRequests.find((request) => request.token === selectedToken);
  const client = selectedRequest ? state.clients[selectedRequest.clientId] : null;

  return `
    <div class="upload-grid">
      <section class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Client Upload Portal</div>
            <div class="section-subtitle">Customer opens a secure one-time link and uploads requested documents</div>
          </div>
          ${client ? `<span class="status-pill">${escapeHtml(client.name)}</span>` : ""}
        </div>
        <div class="detail-body">
          <div class="form-grid">
            <div class="field">
              <label for="upload-token">Upload Token</label>
              <select id="upload-token">
                ${
                  activeRequests.length
                    ? activeRequests
                        .map(
                          (request) =>
                            `<option value="${escapeAttr(request.token)}" ${request.token === selectedToken ? "selected" : ""}>${escapeHtml(state.clients[request.clientId].name)} · expires ${formatDate(request.expiresAt)}</option>`,
                        )
                        .join("")
                    : `<option value="">No active upload links</option>`
                }
              </select>
            </div>
            <div class="field">
              <label for="upload-files">Files</label>
              <input id="upload-files" type="file" multiple />
            </div>
            <button class="primary-button" data-action="upload" data-id="${escapeAttr(selectedToken)}" ${lockedAttr("upload", selectedToken)}>${actionLabel("upload", selectedToken, "Upload Documents", "Uploading...")}</button>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Active Links</div>
            <div class="section-subtitle">Generated when manager sends Request Documents email</div>
          </div>
        </div>
        <div class="detail-body">
          ${
            activeRequests.length
              ? activeRequests
                  .map((request) => {
                    const link = `${location.origin}${location.pathname}?upload=${encodeURIComponent(request.token)}`;
                    return `
                      <div class="upload-card">
                        <div class="job-title">${escapeHtml(state.clients[request.clientId].name)}</div>
                        <div class="muted small">Expires ${formatDateTime(request.expiresAt)}</div>
                        <input readonly value="${escapeAttr(link)}" />
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="empty-state">No active upload requests. Send one from a client detail panel.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function employeeJobFilterOptions(jobs) {
  const options = [
    ["all", "All Jobs"],
    ["new_assigned", "New Assigned"],
    ["in_progress", "In Progress"],
    ["revision_requested", "Revision Requested"],
    ["waiting_manager_review", "Waiting Manager Review"],
    ["closed_or_sent", "Closed or Sent"],
  ];

  return options
    .map(([valueText, label]) => {
      const count = filterJobsByEmployeeStatus(jobs, valueText).length;
      return `<option value="${valueText}" ${employeeJobFilter === valueText ? "selected" : ""}>${escapeHtml(label)} (${count})</option>`;
    })
    .join("");
}

function renderReviewInboxControls(items) {
  return `
    <div class="queue-toolbar">
      <label class="field compact-field">
        <span>Review Type</span>
        <select id="review-inbox-filter">
          <option value="all" ${reviewInboxFilter === "all" ? "selected" : ""}>All Reviews (${items.length})</option>
          <option value="client_documents" ${reviewInboxFilter === "client_documents" ? "selected" : ""}>Client Documents (${items.filter((item) => item.reviewType === "client_documents").length})</option>
          <option value="completed_work" ${reviewInboxFilter === "completed_work" ? "selected" : ""}>Completed Work (${items.filter((item) => item.reviewType === "completed_work").length})</option>
        </select>
      </label>
    </div>
  `;
}

function renderReviewInbox(items) {
  if (!items.length) {
    return `<div class="empty-state">No documents or completed work are waiting for review.</div>`;
  }

  return items
    .map(
      (item) => `
        <article class="review-item">
          <div>
            <div class="job-title">${escapeHtml(item.client.name)}</div>
            <div class="filter-chip">${item.reviewType === "completed_work" ? "Completed Work" : "Client Documents"}</div>
            <div class="muted small">${escapeHtml(item.client.contactName)} · ${item.fileCount} file(s) uploaded</div>
            ${item.reviewType === "completed_work" && item.job?.assignedTo ? `<div class="muted small">Employee: ${escapeHtml(state.users[item.job.assignedTo]?.name ?? "Unassigned")}</div>` : ""}
            <div class="muted small">${item.reviewType === "completed_work" ? "Completed" : "Uploaded"} ${formatDateTime(item.uploadedAt)}</div>
          </div>
          <div class="review-actions">
            ${statusPill(item.status)}
            <button class="primary-button" data-action="review-documents" data-id="${item.clientId}">Review Documents</button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderManagerAlertControls(alerts) {
  return `
    <div class="queue-toolbar">
      <label class="field compact-field">
        <span>Alert Type</span>
        <select id="manager-alert-filter">
          <option value="all" ${managerAlertFilter === "all" ? "selected" : ""}>All Alerts (${alerts.length})</option>
          <option value="documents_received" ${managerAlertFilter === "documents_received" ? "selected" : ""}>Uploaded Documents (${alerts.filter((alert) => alert.type === "documents_received").length})</option>
          <option value="job_completed" ${managerAlertFilter === "job_completed" ? "selected" : ""}>Job Completed (${alerts.filter((alert) => alert.type === "job_completed").length})</option>
          <option value="need_more_info" ${managerAlertFilter === "need_more_info" ? "selected" : ""}>Need More Info (${alerts.filter((alert) => alert.type === "need_more_info").length})</option>
          <option value="data_issue" ${managerAlertFilter === "data_issue" ? "selected" : ""}>Data Issue (${alerts.filter((alert) => alert.type === "data_issue").length})</option>
        </select>
      </label>
    </div>
  `;
}

function renderManagerAlerts(alerts) {
  if (!alerts.length) {
    return `<div class="empty-state">No manager alerts yet.</div>`;
  }

  return alerts
    .map(
      (alert) => `
        <button class="notification-item alert-item" data-action="alert-open" data-id="${escapeAttr(alert.clientId ?? "")}" data-type="${escapeAttr(alert.type)}">
          <div>
            <div class="job-title">
              ${escapeHtml(alertTitle(alert.type))}
              ${alert.repeatCount > 1 ? `<span class="duplicate-badge">Repeated x${alert.repeatCount}</span>` : ""}
            </div>
            <div class="small">${escapeHtml(alert.message)}</div>
            <div class="muted small">${formatDateTime(alert.createdAt)}</div>
          </div>
          <span class="dismiss-link" data-action="alert-dismiss" data-id="${escapeAttr(alert.clientId ?? "")}" data-job-id="${escapeAttr(alert.jobId ?? "")}" data-type="${escapeAttr(alert.type)}">Dismiss</span>
        </button>
      `,
    )
    .join("");
}

function renderFilterSummary() {
  const chips = [];
  if (filters.query.trim()) chips.push(`Search: ${filters.query.trim()}`);
  if (filters.status !== "all") chips.push(`Status: ${STATUS_LABELS[filters.status] ?? filters.status}`);
  if (filters.employeeId !== "all") chips.push(`Employee: ${state.users[filters.employeeId]?.name ?? filters.employeeId}`);

  if (!chips.length) {
    return "";
  }

  return `
    <div class="filter-summary">
      ${chips.map((chip) => `<span class="filter-chip">${escapeHtml(chip)}</span>`).join("")}
      <button class="ghost-button" data-action="clear-filters">Clear Filters</button>
    </div>
  `;
}

function renderCreateClientForm() {
  const suggestedName = filters.query.trim();
  const draftName = createClientDraft.name || suggestedName;
  return `
    <div class="create-client-panel">
      <div class="form-grid">
        <div class="inline-grid">
          <label class="field">
            <span>Client Name</span>
            <input id="new-client-name" value="${escapeAttr(draftName)}" placeholder="Company or client name" />
          </label>
          <label class="field">
            <span>Contact Name</span>
            <input id="new-client-contact" value="${escapeAttr(createClientDraft.contactName)}" placeholder="Main contact" />
          </label>
        </div>
        <div class="inline-grid">
          <label class="field">
            <span>Email</span>
            <input id="new-client-email" type="email" value="${escapeAttr(createClientDraft.email)}" placeholder="client@example.com" />
          </label>
          <label class="field">
            <span>Phone</span>
            <input id="new-client-phone" value="${escapeAttr(createClientDraft.phone)}" placeholder="(604) 555-0100" />
          </label>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea id="new-client-notes" placeholder="Internal notes for this client">${escapeHtml(createClientDraft.notes)}</textarea>
        </label>
        <div class="button-row">
          <button class="primary-button" data-action="create-client">Create Client</button>
          <button class="ghost-button" data-action="cancel-create-client">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderClientTable(clients) {
  if (!clients.length) {
    return `
      <div class="empty-state">
        <div>No clients match the current filters.</div>
        <button class="primary-button" data-action="create-client-from-search">Create New Client</button>
      </div>
    `;
  }

  return `
    <div class="table-wrap client-table-wrap">
      <table class="client-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>Assigned Staff</th>
            <th>Due</th>
            <th>Priority</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${clients
            .map((client) => {
              const job = client.job;
              const employee = job?.assignedTo ? state.users[job.assignedTo] : null;
              return `
                <tr class="clickable" data-action="select-client" data-id="${client.id}">
                  <td>
                    <div class="client-name">${escapeHtml(client.name)}</div>
                    <div class="muted small">${escapeHtml(client.email)} · ${escapeHtml(client.phone)}</div>
                  </td>
                  <td>${statusPill(client.status)}</td>
                  <td>${assignedStaffCell(client, employee)}</td>
                  <td>${job?.dueDate ? formatDate(job.dueDate) : `<span class="muted">No due date</span>`}</td>
                  <td>${job ? priorityPill(job.priority) : ""}</td>
                  <td>${clientRowAction(client, job)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function clientRowAction(client, job) {
  if (client.status === "new_client") {
    return `<button class="primary-button compact-button" data-action="open-request-email" data-id="${client.id}">Send Request Email</button>`;
  }
  if (client.status === "request_sent") {
    return `<button class="ghost-button compact-button" data-action="open-request-email" data-id="${client.id}">Review Email</button>`;
  }
  if (client.status === "documents_received") {
    return `<button class="primary-button compact-button" data-action="review-documents" data-id="${client.id}">Review Documents</button>`;
  }
  if (client.status === "job_completed") {
    return `<button class="primary-button compact-button" data-action="review-documents" data-id="${client.id}">Review Documents</button>`;
  }
  if (client.status === "need_more_info") {
    return `<button class="ghost-button compact-button" data-action="alert-open" data-id="${client.id}" data-type="need_more_info">Review Status</button>`;
  }
  if (job?.assignedTo) {
    return `<button class="ghost-button compact-button" data-action="select-client" data-id="${client.id}">Open Job</button>`;
  }
  return `<button class="ghost-button compact-button" data-action="select-client" data-id="${client.id}">Open</button>`;
}

function assignedStaffCell(client, employee) {
  if (employee) {
    return escapeHtml(employee.name);
  }
  if (client.status === "job_assigned") {
    return `<span class="status-pill need_more_info">Data Issue</span>`;
  }
  return `<span class="muted">Unassigned</span>`;
}

function renderClientWorkspace(client) {
  if (!client) return `<div class="empty-state">Select a client to view details.</div>`;

  const job = Object.values(state.jobs).find((item) => item.clientId === client.id);
  const employee = job?.assignedTo ? state.users[job.assignedTo] : null;
  const events = getTimelineDisplayEvents(state, client.id);
  const files = state.files.filter((file) => file.clientId === client.id);
  const billing = state.billingRecords.find((record) => record.clientId === client.id);
  const uploadedFiles = files.filter((file) => file.section === "client_uploaded");
  const employeeWorkFiles = files.filter((file) => file.section === "employee_work");
  const finalFiles = files.filter((file) => file.section === "final_reports");
  const billingFiles = files.filter((file) => file.section === "billing");
  const latestUpload = uploadedFiles
    .map((file) => file.uploadedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const latestEmployeeWork = employeeWorkFiles
    .map((file) => file.uploadedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  return `
    <div class="workspace-header">
      <div>
        <div class="section-subtitle">Client Workspace</div>
        <div class="section-title">${escapeHtml(client.name)}</div>
        <div class="section-subtitle">${escapeHtml(client.contactName)} · ${escapeHtml(client.phone)} · ${escapeHtml(client.email)}</div>
      </div>
      <div class="workspace-header-actions">
        ${statusPill(client.status)}
        <button class="ghost-button" data-action="workspace-back" ${workspaceBackStack.length ? "" : "disabled"}>Back Section</button>
      </div>
    </div>
    <nav class="workspace-tabs" aria-label="Client workspace sections">
      ${WORKSPACE_TABS.map((tabItem) => workspaceTabButton(tabItem)).join("")}
    </nav>
    <div class="workspace-body">
      ${selectedWorkspaceTab === "profile" ? renderWorkspaceProfile(client, job, employee) : ""}
      ${selectedWorkspaceTab === "request" ? renderWorkspaceRequestEmail(client) : ""}
      ${selectedWorkspaceTab === "files" ? renderWorkspaceFiles(files) : ""}
      ${selectedWorkspaceTab === "review" ? renderWorkspaceReview(client, job, uploadedFiles, latestUpload, employeeWorkFiles, latestEmployeeWork) : ""}
      ${selectedWorkspaceTab === "assign" ? renderWorkspaceAssign(client, job) : ""}
      ${selectedWorkspaceTab === "final" ? renderWorkspaceFinalPackage(client, job, finalFiles, billing, billingFiles) : ""}
      ${selectedWorkspaceTab === "timeline" ? renderWorkspaceTimeline(events) : ""}
      ${selectedWorkspaceTab === "billing" ? renderWorkspaceBilling(job, billing) : ""}
    </div>
  `;
}

function workspaceTabButton(tabItem) {
  return `
    <button class="workspace-tab ${selectedWorkspaceTab === tabItem.id ? "active" : ""}" data-action="workspace-tab" data-id="${tabItem.id}">
      <span aria-hidden="true">${tabItem.icon}</span>
      <span>${escapeHtml(tabItem.label)}</span>
    </button>
  `;
}

function renderWorkspaceProfile(client, job, employee) {
  if (editingClientId === client.id) {
    return renderEditClientForm(client);
  }

  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Profile</div>
      <div class="info-grid">
        ${info("Client Name", client.name)}
        ${info("Contact", client.contactName)}
        ${info("Email", client.email)}
        ${info("Phone", client.phone)}
        ${info("Assigned", employee?.name ?? "Unassigned")}
        ${info("Status Time", formatDateTime(client.statusChangedAt))}
        ${info("Due Date", job?.dueDate ? formatDate(job.dueDate) : "No due date")}
        ${info("Notes", client.notes || "No notes")}
      </div>
      <div class="button-row">
        <button class="primary-button" data-action="edit-client" data-id="${client.id}">Edit Client</button>
        <button class="primary-button" data-action="workspace-tab" data-id="request">Open Request Email</button>
        <button class="ghost-button" data-action="workspace-tab" data-id="files">Open Files</button>
      </div>
    </section>
  `;
}

function renderEditClientForm(client) {
  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Edit Client</div>
      <div class="form-grid">
        <label class="field">
          <span>Client Name</span>
          <input id="edit-client-name" value="${escapeAttr(editClientDraft.name)}" />
        </label>
        <label class="field">
          <span>Contact Name</span>
          <input id="edit-client-contact" value="${escapeAttr(editClientDraft.contactName)}" />
        </label>
        <div class="inline-grid">
          <label class="field">
            <span>Email</span>
            <input id="edit-client-email" type="email" value="${escapeAttr(editClientDraft.email)}" />
          </label>
          <label class="field">
            <span>Phone</span>
            <input id="edit-client-phone" value="${escapeAttr(editClientDraft.phone)}" />
          </label>
        </div>
        <label class="field">
          <span>Notes</span>
          <textarea id="edit-client-notes">${escapeHtml(editClientDraft.notes)}</textarea>
        </label>
        <div class="button-row">
          <button class="primary-button" data-action="save-client" data-id="${client.id}" ${lockedAttr("save-client", client.id)}>${actionLabel("save-client", client.id, "Save Changes", "Saving...")}</button>
          <button class="ghost-button" data-action="cancel-edit-client">Cancel</button>
        </div>
      </div>
    </section>
  `;
}

function renderWorkspaceRequestEmail(client) {
  const latestRequest = state.uploadRequests
    .filter((request) => request.clientId === client.id)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const uploadUrl = latestRequest ? `${location.origin}${location.pathname}?upload=${encodeURIComponent(latestRequest.token)}` : "";
  const requestLabel = latestRequest ? "Resend Request Email" : "Send Request Email";
  const requestStatus = latestRequest?.usedAt
    ? "Uploaded"
    : latestRequest
      ? `Waiting, expires ${formatDate(latestRequest.expiresAt)}`
      : "Not sent yet";

  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Request Email</div>
      <div class="info-grid">
        ${info("Client Email", client.email)}
        ${info("Request Status", requestStatus)}
        ${info("Last Sent", latestRequest ? formatDateTime(latestRequest.createdAt) : "Not sent yet")}
        ${info("Upload Link", uploadUrl || "Generated after sending")}
      </div>
      <div class="email-preview">
        <div class="info-label">Email Message</div>
        <p>Hello ${escapeHtml(client.contactName || client.name)}, please upload your accounting documents using the secure HEYDAY upload link.</p>
      </div>
      <div class="button-row">
        <button class="primary-button" data-action="request-docs" data-id="${client.id}" ${lockedAttr("request-docs", client.id)}>${actionLabel("request-docs", client.id, requestLabel, "Sending...")}</button>
        <button class="ghost-button" data-action="workspace-tab" data-id="timeline">Open Timeline</button>
      </div>
    </section>
  `;
}

function renderWorkspaceFiles(files) {
  const sections = ["client_uploaded", "employee_work", "final_reports", "billing"];
  return `
    <section class="workspace-page">
      <div class="workspace-page-title">File Library</div>
      ${renderFilePreviewPanel()}
      ${sections
        .map((section) => {
          const sectionFiles = files.filter((file) => file.section === section);
          return `
            <div class="file-section">
              <div class="section-subtitle">${escapeHtml(FILE_SECTIONS[section] ?? section)}</div>
              <div class="file-list">
                ${renderFileList(sectionFiles, `No ${FILE_SECTIONS[section] ?? section} files yet.`)}
              </div>
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderWorkspaceReview(client, job, uploadedFiles, latestUpload, employeeWorkFiles, latestEmployeeWork) {
  if (job?.status === "job_completed") {
    const assignedEmployee = job.assignedTo ? state.users[job.assignedTo] : null;
    return `
      <section class="workspace-page">
        <div class="workspace-page-title">Manager Final Review</div>
        <div class="review-summary">
          ${info("Completed Files", `${employeeWorkFiles.length} file(s)`)}
          ${info("Completed Time", latestEmployeeWork ? formatDateTime(latestEmployeeWork) : "No completion recorded")}
          ${info("Employee", assignedEmployee?.name ?? "Unassigned")}
          ${info("Next Step", "Approve final package or return to employee")}
        </div>
        <div class="file-list">
          ${renderFileList(employeeWorkFiles, "No employee completed files found.")}
        </div>
        ${renderFilePreviewPanel()}
        <div class="button-row">
          <button class="primary-button" data-action="approve-final-package" data-id="${job.id}" ${lockedAttr("approve-final-package", job.id)}>${actionLabel("approve-final-package", job.id, "Approve Final Package", "Processing...")}</button>
          <button class="ghost-button" data-action="request-revision" data-id="${job.id}">Return To Employee</button>
          <button class="ghost-button" data-action="workspace-tab" data-id="files">View All Files</button>
        </div>
        ${
          pendingReturnJobId === job.id
            ? `
              <div class="confirm-panel">
                <div class="job-title">Return To Employee For Revision</div>
                <label class="field">
                  <span>Revision Instructions</span>
                  <textarea id="revision-note" placeholder="Tell the employee exactly what to fix.">Please revise the completed package before final delivery.</textarea>
                </label>
                <div class="button-row">
                  <button class="primary-button" data-action="send-revision" data-id="${job.id}" ${lockedAttr("send-revision", job.id)}>${actionLabel("send-revision", job.id, "Send Revision Request", "Sending...")}</button>
                  <button class="ghost-button" data-action="cancel-revision">Cancel</button>
                </div>
              </div>
            `
            : ""
        }
      </section>
    `;
  }

  if (job?.status === "final_package_approved") {
    return `
      <section class="workspace-page">
        <div class="workspace-page-title">Final Review Approved</div>
        <div class="empty-state">Final package is approved. Open Final Package to send the files and invoice to the client.</div>
        <div class="button-row">
          <button class="primary-button" data-action="workspace-tab" data-id="final">Open Final Package</button>
          <button class="ghost-button" data-action="workspace-tab" data-id="timeline">Open Timeline</button>
        </div>
      </section>
    `;
  }

  const activeMissingInfoRequest = getActiveMissingInfoRequest(client.id);
  const missingInfoLink = activeMissingInfoRequest
    ? `${location.origin}${location.pathname}?upload=${encodeURIComponent(activeMissingInfoRequest.token)}`
    : "";
  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Uploaded Documents</div>
      <div class="review-summary">
        ${info("Files Uploaded", `${uploadedFiles.length} file(s)`)}
        ${info("Uploaded Time", latestUpload ? formatDateTime(latestUpload) : "No upload recorded")}
      </div>
      <div class="file-list">
        ${renderFileList(uploadedFiles, "No client-uploaded files found.")}
      </div>
      ${renderFilePreviewPanel()}
      <div class="button-row">
        <button class="primary-button" data-action="goto-assign">Assign Job</button>
        <button class="ghost-button" data-action="need-info" data-id="${job?.id ?? ""}">Need More Info</button>
        <button class="ghost-button" data-action="workspace-tab" data-id="files">View All Files</button>
      </div>
      ${
        pendingNeedInfoJobId === job?.id
          ? `
            <div class="confirm-panel">
              <div class="job-title">Send Missing Info Email</div>
              <label class="field">
                <span>Missing Information Notes</span>
                <textarea id="missing-info-note" placeholder="Example: Missing bank statements and payroll summary.">Need more information before continuing.</textarea>
              </label>
              ${activeMissingInfoRequest ? `<div class="info-item">${info("Existing Active Link", missingInfoLink)}</div>` : ""}
              <div class="button-row">
                <button class="primary-button" data-action="send-missing-info" data-id="${job?.id ?? ""}" ${lockedAttr("send-missing-info", job?.id ?? "")}>${actionLabel("send-missing-info", job?.id ?? "", activeMissingInfoRequest ? "Resend Missing Info Email" : "Send Missing Info Email", "Sending...")}</button>
                <button class="ghost-button" data-action="cancel-need-info">Cancel</button>
              </div>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderWorkspaceAssign(client, job) {
  if (job?.assignedTo) {
    const assignedEmployee = state.users[job.assignedTo];
    return `
      <section class="workspace-page">
        <div class="workspace-page-title">Current Assignment</div>
        <div class="info-grid">
          ${info("Assigned Staff", assignedEmployee?.name ?? "Data Issue")}
          ${info("Assigned Time", job.assignedAt ? formatDateTime(job.assignedAt) : "Not recorded")}
          ${info("Priority", capitalize(job.priority))}
          ${info("Due Date", job.dueDate ? formatDate(job.dueDate) : "No due date")}
        </div>
        <div class="info-item">
          <div class="info-label">Work Instructions</div>
          <div class="info-value">${escapeHtml(job.instructions || "No instructions recorded")}</div>
        </div>
        <div class="button-row">
          <button class="ghost-button" data-action="undo-assignment" data-id="${job.id}" ${lockedAttr("undo-assignment", job.id)}>${actionLabel("undo-assignment", job.id, "Undo Assignment", "Processing...")}</button>
        </div>

        <div class="workspace-page-title">Reassign</div>
        <div class="form-grid">
          <label class="field">
            <span>Work Instructions</span>
            <textarea id="assign-instructions" placeholder="CALL CRA">${escapeHtml(assignDraft.instructions || job.instructions || "")}</textarea>
          </label>
          <div class="inline-grid">
            ${renderEmployeeChoices(job.assignedTo, "New Employee")}
            ${renderPriorityChoices(job.priority)}
          </div>
          <div class="inline-grid">
            <label class="field">
              <span>Due Date</span>
              <input id="assign-due" type="date" value="${escapeAttr(assignDraft.dueDate || job.dueDate || "")}" />
            </label>
            <div class="field action-field">
              <span>Action</span>
              <button class="primary-button" data-action="reassign-job" data-id="${client.id}" ${lockedAttr("reassign-job", client.id)}>${actionLabel("reassign-job", client.id, "Reassign", "Processing...")}</button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Assign Job</div>
      <div class="form-grid">
        <label class="field">
          <span>Work Instructions</span>
          <textarea id="assign-instructions" placeholder="CALL CRA">${escapeHtml(assignDraft.instructions || job?.instructions || "")}</textarea>
        </label>
        <div class="inline-grid">
          ${renderEmployeeChoices(job?.assignedTo ?? "user-amy", "Employee")}
          ${renderPriorityChoices(job?.priority ?? "medium")}
        </div>
        <div class="inline-grid">
          <label class="field">
            <span>Due Date</span>
            <input id="assign-due" type="date" value="${escapeAttr(assignDraft.dueDate || job?.dueDate || "")}" />
          </label>
          <div class="field action-field">
            <span>Action</span>
            <button class="primary-button" data-action="assign-job" data-id="${client.id}" ${lockedAttr("assign-job", client.id)}>${actionLabel("assign-job", client.id, "Assign Job", "Processing...")}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderEmployeeChoices(selectedEmployeeId, label) {
  const activeEmployeeId = assignDraft.employeeId || selectedEmployeeId;
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <select id="assign-employee">
        ${employees()
          .map(
            (user) =>
              `<option value="${user.id}" ${activeEmployeeId === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderPriorityChoices(selectedPriority) {
  const activePriority = assignDraft.priority || selectedPriority;
  return `
    <label class="field">
      <span>Priority</span>
      <select id="assign-priority">
        ${["high", "medium", "low"]
          .map(
            (priority) =>
              `<option value="${priority}" ${activePriority === priority ? "selected" : ""}>${capitalize(priority)}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;
}

function renderWorkspaceTimeline(events) {
  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Status Timeline</div>
      <div class="timeline">
        ${
          events.length
            ? events
                .map(
                  (event) => `
                    <div class="timeline-item">
                      <div class="job-title">${escapeHtml(EVENT_LABELS[event.status] ?? event.status)}${event.duplicateCount > 1 ? ` <span class="duplicate-badge">x${event.duplicateCount}</span>` : ""}</div>
                      <div class="muted small">${formatDateTime(event.at)} · ${event.actorId ? escapeHtml(state.users[event.actorId]?.name ?? "System") : "Client"}</div>
                      <div class="small">${escapeHtml(event.note)}</div>
                    </div>
                  `,
                )
                .join("")
            : `<div class="empty-state">No timeline events yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderWorkspaceFinalPackage(client, job, finalFiles, billing, billingFiles) {
  const canSend = job && job.status === "final_package_approved" && !billing;
  const sent = Boolean(billing);
  const attachmentCount = finalFiles.length + billingFiles.length;

  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Final Package</div>
      <div class="review-summary">
        ${info("Recipient", client.email)}
        ${info("Package Status", sent ? "Sent to client with invoice" : job?.status === "final_package_approved" ? "Approved, ready to send" : "Waiting for final review approval")}
        ${info("Attachments", `${attachmentCount || finalFiles.length} file(s)`)}
        ${info("Invoice", billing ? `${billing.invoiceNumber} - $${billing.amount} CAD` : "Not sent yet")}
      </div>
      <div>
        <div class="section-subtitle">Final Files</div>
        <div class="file-list">
          ${renderFileList(finalFiles, "Approve final review to generate the final package file.")}
        </div>
      </div>
      <div class="email-preview">
        <div class="info-label">Client Email Preview</div>
        <p>To: ${escapeHtml(client.email)}</p>
        <p>Subject: HEYDAY final package and invoice for ${escapeHtml(client.name)}</p>
        <p>Hello ${escapeHtml(client.contactName || client.name)}, please find the completed package and invoice attached. Thank you.</p>
      </div>
      <div class="form-grid">
        <div class="inline-grid">
          <label class="field">
            <span>Invoice Number</span>
            <input id="invoice-number" value="${escapeAttr(billing?.invoiceNumber ?? nextInvoiceNumber())}" ${sent ? "disabled" : ""} />
          </label>
          <label class="field">
            <span>Amount</span>
            <input id="invoice-amount" type="number" min="0" step="25" value="${escapeAttr(billing?.amount ?? 1250)}" ${sent ? "disabled" : ""} />
          </label>
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="send-final-package" data-id="${job?.id ?? ""}" ${canSend && !isActionLocked("send-final-package", job?.id ?? "") ? "" : "disabled"}>${actionLabel("send-final-package", job?.id ?? "", "Send Final Package & Invoice", "Sending...")}</button>
          <button class="ghost-button" data-action="workspace-tab" data-id="billing">Open Billing</button>
        </div>
      </div>
    </section>
  `;
}

function renderWorkspaceBilling(job, billing) {
  const canReceivePayment = job && billing && !billing.paidAt && job.status === "reviewed_billed";
  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Billing</div>
      ${
        billing
          ? `
            <div class="info-grid">
              ${info("Invoice Number", billing.invoiceNumber)}
              ${info("Amount", `$${billing.amount} ${billing.currency}`)}
              ${info("Sent", formatDateTime(billing.sentAt))}
              ${info("Paid", billing.paidAt ? formatDateTime(billing.paidAt) : "Not paid yet")}
            </div>
            <div class="button-row">
              <button class="primary-button" data-action="payment" data-id="${job?.id ?? ""}" ${canReceivePayment && !isActionLocked("payment", job?.id ?? "") ? "" : "disabled"}>${actionLabel("payment", job?.id ?? "", "Payment Received", "Processing...")}</button>
              <button class="ghost-button" data-action="workspace-tab" data-id="timeline">Open Timeline</button>
            </div>
          `
          : `
            <div class="empty-state">Final package and invoice have not been sent yet. Approve the final review, then send from Final Package.</div>
            <div class="button-row">
              <button class="primary-button" data-action="workspace-tab" data-id="final">Open Final Package</button>
            </div>
          `
      }
    </section>
  `;
}

function renderFileList(files, emptyText) {
  if (!files.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return files
    .map(
      (file) => `
        <button class="file-item file-preview-trigger" data-action="preview-file" data-id="${escapeAttr(file.id)}">
          <div>
            <div class="job-title">${escapeHtml(file.name)}</div>
            <div class="muted small">${escapeHtml(fileSectionLabel(file.section))} · ${formatFileSize(file.size)}</div>
          </div>
          <div class="file-item-actions">
            <div class="muted small">${formatDateTime(file.uploadedAt)}</div>
            <span class="ghost-button compact-button">Preview</span>
          </div>
        </button>
      `,
    )
    .join("");
}

function renderFilePreviewPanel(scopeJobId = null) {
  if (!previewFileId) return "";

  const file = state.files.find((item) => item.id === previewFileId);
  if (!file) {
    return `
      <div class="file-preview-panel">
        <div class="job-title">File not found</div>
        <button class="ghost-button compact-button" data-action="close-preview">Close Preview</button>
      </div>
    `;
  }

  if (scopeJobId && file.jobId !== scopeJobId) return "";

  const client = state.clients[file.clientId];
  const job = file.jobId ? state.jobs[file.jobId] : null;
  const uploader =
    state.users[file.uploadedBy]?.name ??
    (file.uploadedBy === "client" ? client?.contactName ?? "Client" : "System");

  return `
    <div class="file-preview-panel">
      <div class="section-subtitle">File Preview</div>
      <div class="info-grid">
        ${info("File Name", file.name)}
        ${info("Section", fileSectionLabel(file.section))}
        ${info("Size", formatFileSize(file.size))}
        ${info("Type", file.type || "Unknown")}
        ${info("Uploaded By", uploader)}
        ${info("Uploaded Time", formatDateTime(file.uploadedAt))}
        ${info("Client", client?.name ?? "Unknown client")}
        ${info("Job", job?.title ?? "No job")}
      </div>
      <div class="email-preview">
        <div class="info-label">Preview</div>
        <p>Demo preview only. Real file storage will open the uploaded file here.</p>
      </div>
      <div class="button-row">
        <button class="ghost-button" data-action="close-preview">Close Preview</button>
        <button class="primary-button" data-action="workspace-tab" data-id="files">Open File Library</button>
      </div>
    </div>
  `;
}

function renderClientDetail(client) {
  if (!client) return `<div class="empty-state">Select a client to view details.</div>`;

  const job = Object.values(state.jobs).find((item) => item.clientId === client.id);
  const employee = job?.assignedTo ? state.users[job.assignedTo] : null;
  const events = state.events.filter((event) => event.clientId === client.id).slice().reverse();
  const files = state.files.filter((file) => file.clientId === client.id);
  const billing = state.billingRecords.find((record) => record.clientId === client.id);

  return `
    <div class="section-header">
      <div>
        <div class="section-title">${escapeHtml(client.name)}</div>
        <div class="section-subtitle">${escapeHtml(client.contactName)} · ${escapeHtml(client.phone)}</div>
      </div>
      ${statusPill(client.status)}
    </div>
    <div class="detail-body">
      <div class="info-grid">
        ${info("Email", client.email)}
        ${info("Assigned", employee?.name ?? "Unassigned")}
        ${info("Status Time", formatDateTime(client.statusChangedAt))}
        ${info("Due Date", job?.dueDate ? formatDate(job.dueDate) : "No due date")}
      </div>

      <div class="action-grid">
        <button class="primary-button" data-action="open-request-email" data-id="${client.id}">Open Request Email</button>
        <button class="ghost-button" data-action="need-info" data-id="${job?.id ?? ""}">Need More Info</button>
      </div>

      <div class="section-subtitle">Assign Job</div>
      <div class="form-grid">
        <textarea id="assign-instructions" placeholder="CALL CRA">${escapeHtml(job?.instructions ?? "")}</textarea>
        <div class="inline-grid">
          <select id="assign-employee">
            ${employees()
              .map(
                (user) =>
                  `<option value="${user.id}" ${job?.assignedTo === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`,
              )
              .join("")}
          </select>
          <select id="assign-priority">
            ${["high", "medium", "low"]
              .map(
                (priority) =>
                  `<option value="${priority}" ${job?.priority === priority ? "selected" : ""}>${capitalize(priority)}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="inline-grid">
          <input id="assign-due" type="date" value="${escapeAttr(job?.dueDate ?? "")}" />
          <button class="primary-button" data-action="assign-job" data-id="${client.id}">Assign Job</button>
        </div>
      </div>

      <div class="section-subtitle">Review, Billing, Payment</div>
      <div class="form-grid">
        <div class="inline-grid">
          <input id="invoice-number" value="${escapeAttr(billing?.invoiceNumber ?? nextInvoiceNumber())}" />
          <input id="invoice-amount" type="number" min="0" step="25" value="${escapeAttr(billing?.amount ?? 1250)}" />
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="review-bill" data-id="${job?.id ?? ""}">Review & Bill</button>
          <button class="ghost-button" data-action="payment" data-id="${job?.id ?? ""}">Payment Received</button>
        </div>
      </div>

      <div>
        <div class="section-subtitle">File Library</div>
        <div class="file-list">
          ${
            files.length
              ? files
                  .map(
                    (file) => `
                      <div class="file-item">
                        <div>
                          <div class="job-title">${escapeHtml(file.name)}</div>
                          <div class="muted small">${escapeHtml(fileSectionLabel(file.section))} · ${formatFileSize(file.size)}</div>
                        </div>
                        <div class="muted small">${formatDateTime(file.uploadedAt)}</div>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="empty-state">No files uploaded yet.</div>`
          }
        </div>
      </div>

      <div>
        <div class="section-subtitle">Status Timeline</div>
        <div class="timeline">
          ${
            events.length
              ? events
                  .map(
                    (event) => `
                      <div class="timeline-item">
                        <div class="job-title">${escapeHtml(STATUS_LABELS[event.status])}</div>
                        <div class="muted small">${formatDateTime(event.at)} · ${event.actorId ? escapeHtml(state.users[event.actorId]?.name ?? "System") : "Client"}</div>
                        <div class="small">${escapeHtml(event.note)}</div>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="empty-state">No timeline events yet.</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function renderEmployeeJobGroups(jobs) {
  if (!jobs.length) {
    return `<div class="empty-state">No jobs assigned to this employee.</div>`;
  }

  const groups = [
    ["New Assigned", jobs.filter((job) => job.status === "job_assigned")],
    ["Revision Requested", jobs.filter((job) => job.status === "revision_requested")],
    ["In Progress", jobs.filter((job) => ["job_accepted", "in_progress"].includes(job.status))],
    ["Completed Waiting Manager Review", jobs.filter((job) => job.status === "job_completed")],
    [
      "Closed or Sent",
      jobs.filter((job) => ["final_package_approved", "reviewed_billed", "payment_received"].includes(job.status)),
    ],
  ].filter(([, groupJobs]) => groupJobs.length);

  return `
    ${groups
      .map(
        ([label, groupJobs]) => `
          <div class="job-group">
            <div class="section-subtitle">${escapeHtml(label)}</div>
            ${groupJobs.map((job) => renderEmployeeJob(job)).join("")}
          </div>
        `,
      )
      .join("")}
  `;
}

function renderEmployeeJob(job) {
  const canAccept = job.status === "job_assigned";
  const canStart = ["job_accepted"].includes(job.status);
  const canStartRevision = job.status === "revision_requested";
  const canUploadWorkFiles = job.status === "in_progress";
  const employeeWorkFiles = state.files.filter((file) => file.jobId === job.id && file.section === "employee_work");
  const hasWorkFiles = employeeWorkFiles.length > 0;
  const canSubmitReview = job.status === "in_progress" && hasWorkFiles;
  const waitingManagerReview = job.status === "job_completed";
  const closed = ["final_package_approved", "reviewed_billed", "payment_received"].includes(job.status);

  return `
    <article class="job-card">
      <div class="job-card-header">
        <div>
          <div class="job-title">${escapeHtml(job.client.name)}</div>
          <div class="muted small">${escapeHtml(job.instructions || job.title)}</div>
        </div>
        ${statusPill(job.status)}
      </div>
      <div class="info-grid">
        ${info("Due", job.dueDate ? formatDate(job.dueDate) : "No due date")}
        ${info("Priority", capitalize(job.priority))}
        ${info("Accepted", job.acceptedAt ? formatDateTime(job.acceptedAt) : "Not accepted")}
        ${info("Started", job.startedAt ? formatDateTime(job.startedAt) : "Not started")}
        ${job.revisionNote ? info("Revision Notes", job.revisionNote) : ""}
        ${info("Work Files", `${employeeWorkFiles.length} uploaded`)}
        ${waitingManagerReview ? info("Status", "Waiting for Manager Final Review") : ""}
        ${closed ? info("Status", "Manager has moved this job to delivery, billing, or closed") : ""}
      </div>
      <div class="employee-work-files">
        <div class="section-subtitle">Work Files For Manager Review</div>
        <div class="file-list compact-file-list">
          ${renderFileList(employeeWorkFiles, "No work files uploaded yet.")}
        </div>
        ${renderFilePreviewPanel(job.id)}
        <div class="inline-grid">
          <label class="field">
            <span>Upload Work Files</span>
            <input id="work-files-${escapeAttr(job.id)}" type="file" multiple ${canUploadWorkFiles ? "" : "disabled"} />
          </label>
          <div class="field action-field">
            <span>Action</span>
            <button class="ghost-button" data-action="upload-work-files" data-id="${job.id}" data-employee-id="${job.assignedTo}" ${canUploadWorkFiles && !isActionLocked("upload-work-files", job.id) ? "" : "disabled"}>${actionLabel("upload-work-files", job.id, "Upload Work Files", "Uploading...")}</button>
          </div>
        </div>
      </div>
      <div class="button-row">
        <button class="ghost-button" data-action="accept" data-id="${job.id}" data-employee-id="${job.assignedTo}" ${canAccept ? "" : "disabled"}>Accept Job</button>
        <button class="primary-button" data-action="start" data-id="${job.id}" data-employee-id="${job.assignedTo}" ${canStart ? "" : "disabled"}>Start Work</button>
        <button class="primary-button" data-action="start-revision" data-id="${job.id}" data-employee-id="${job.assignedTo}" ${canStartRevision ? "" : "disabled"}>Start Revision</button>
        <button class="primary-button" data-action="complete" data-id="${job.id}" data-employee-id="${job.assignedTo}" ${canSubmitReview && !isActionLocked("complete", job.id) ? "" : "disabled"}>${actionLabel("complete", job.id, "Submit To Manager Review", "Submitting...")}</button>
      </div>
    </article>
  `;
}

function metric(status, label, value) {
  return `
    <button class="metric ${filters.status === status ? "active" : ""}" data-action="filter-status" data-id="${status}">
      <div class="metric-value">${value}</div>
      <div class="metric-label">${escapeHtml(label)}</div>
    </button>
  `;
}

function handleRequestDocs(clientId) {
  updateState(requestDocuments(state, { clientId, managerId: MANAGER_ID, now: now() }));
  selectedClientId = clientId;
  resetAssignDraftForClient(clientId);
  selectedWorkspaceTab = getWorkspaceTabForEntry("request_email");
  currentView = "manager";
  showToast("Request email recorded and a secure upload link was generated.");
}

function handleOpenRequestEmail(clientId) {
  if (!clientId || !state.clients[clientId]) {
    return;
  }
  selectedClientId = clientId;
  resetAssignDraftForClient(clientId);
  selectedWorkspaceTab = getWorkspaceTabForEntry("request_email");
  currentView = "manager";
  showToast("Review the request email before sending.");
}

function handleSelectClient(clientId) {
  if (!clientId || !state.clients[clientId]) {
    return;
  }
  selectedClientId = clientId;
  resetAssignDraftForClient(clientId);
  selectedWorkspaceTab = getWorkspaceTabForEntry("client_list");
}

function handleWorkspaceTab(tabId) {
  if (!isWorkspaceTab(tabId)) {
    return;
  }
  if (selectedWorkspaceTab !== tabId) {
    workspaceBackStack = [...workspaceBackStack.slice(-9), selectedWorkspaceTab];
  }
  selectedWorkspaceTab = tabId;
}

function handleWorkspaceBack() {
  const previous = workspaceBackStack.at(-1);
  if (!previous) {
    return;
  }
  workspaceBackStack = workspaceBackStack.slice(0, -1);
  selectedWorkspaceTab = previous;
}

function handleReviewDocuments(clientId) {
  if (!clientId || !state.clients[clientId]) {
    return;
  }
  selectedClientId = clientId;
  resetAssignDraftForClient(clientId);
  selectedWorkspaceTab = getWorkspaceTabForEntry("review_documents");
  filters.status = "all";
  currentView = "manager";
  showToast("Client selected. Review uploaded documents in the workspace.");
}

function handleAlertOpen(clientId, type) {
  if (!clientId || !state.clients[clientId]) {
    return;
  }
  selectedClientId = clientId;
  resetAssignDraftForClient(clientId);
  selectedWorkspaceTab = getWorkspaceTabForAlert(type);
  filters.status = "all";
  currentView = "manager";
}

function handleDismissAlert(type, clientId, jobId) {
  const dismissedAt = now();
  const nextNotifications = state.notifications.map((notification) => {
    const matchesType = notificationAlertType(notification) === type;
    const matchesClient = !clientId || notification.clientId === clientId;
    const matchesJob = !jobId || notification.jobId === jobId;
    if (notification.recipientType === "role" && notification.recipientId === "manager" && matchesType && matchesClient && matchesJob) {
      return { ...notification, readAt: dismissedAt };
    }
    return notification;
  });
  updateState({ ...state, notifications: nextNotifications });
  showToast("Alert dismissed.");
}

function handleCreateClient() {
  const nextState = createClient(state, {
    organizationId: ORGANIZATION_ID,
    managerId: MANAGER_ID,
    name: value("#new-client-name") || createClientDraft.name,
    contactName: value("#new-client-contact") || createClientDraft.contactName,
    email: value("#new-client-email") || createClientDraft.email,
    phone: value("#new-client-phone") || createClientDraft.phone,
    notes: value("#new-client-notes") || createClientDraft.notes,
    now: now(),
  });
  updateState(nextState);
  const createdClient = Object.values(nextState.clients)
    .slice()
    .sort((a, b) => Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt))[0];
  selectedClientId = createdClient.id;
  resetAssignDraftForClient(createdClient.id);
  selectedWorkspaceTab = getWorkspaceTabForEntry("request_email");
  showCreateClientForm = false;
  createClientDraft = emptyCreateClientDraft();
  filters.query = createdClient.name;
  filters.status = "all";
  filters.employeeId = "all";
  showToast("Client created. Send the request email from the workspace or client list.");
}

function handleEditClient(clientId) {
  const client = state.clients[clientId];
  if (!client) {
    return;
  }
  editingClientId = clientId;
  editClientDraft = {
    name: client.name,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone,
    notes: client.notes ?? "",
  };
  selectedWorkspaceTab = "profile";
}

function handleCancelEditClient() {
  editingClientId = null;
  editClientDraft = emptyEditClientDraft();
}

function handleSaveClient(clientId) {
  updateState(
    updateClient(state, {
      clientId,
      managerId: MANAGER_ID,
      name: value("#edit-client-name") || editClientDraft.name,
      contactName: value("#edit-client-contact") || editClientDraft.contactName,
      email: value("#edit-client-email") || editClientDraft.email,
      phone: value("#edit-client-phone") || editClientDraft.phone,
      notes: value("#edit-client-notes") || editClientDraft.notes,
      now: now(),
    }),
  );
  editingClientId = null;
  editClientDraft = emptyEditClientDraft();
  showToast("Client profile updated.");
}

function handleAssignJob(clientId) {
  const job = Object.values(state.jobs).find((item) => item.clientId === clientId);
  const instructions = value("#assign-instructions") || "CALL CRA";
  const employeeId = assignDraft.employeeId || "user-amy";
  const dueDate = value("#assign-due") || todayPlus(7);
  const priority = assignDraft.priority || "medium";

  updateState(
    assignJob(state, {
      clientId,
      jobId: job.id,
      managerId: MANAGER_ID,
      employeeId,
      instructions,
      dueDate,
      priority,
      now: now(),
    }),
  );
  selectedEmployeeDashboardId = employeeId;
  resetAssignDraftForClient(clientId);
  showToast(`Job assigned to ${state.users[employeeId].name}.`);
}

function handleUndoAssignment(jobId) {
  updateState(
    undoAssignment(state, {
      jobId,
      managerId: MANAGER_ID,
      now: now(),
    }),
  );
  selectedWorkspaceTab = "assign";
  showToast("Assignment undone.");
}

function handleReassignJob(clientId) {
  const job = Object.values(state.jobs).find((item) => item.clientId === clientId);
  const instructions = value("#assign-instructions") || job?.instructions || "CALL CRA";
  const employeeId = assignDraft.employeeId || "user-amy";
  const dueDate = value("#assign-due") || job?.dueDate || todayPlus(7);
  const priority = assignDraft.priority || job?.priority || "medium";

  updateState(
    reassignJob(state, {
      jobId: job.id,
      managerId: MANAGER_ID,
      employeeId,
      instructions,
      dueDate,
      priority,
      now: now(),
    }),
  );
  selectedEmployeeDashboardId = employeeId;
  resetAssignDraftForClient(clientId);
  selectedWorkspaceTab = "assign";
  showToast(`Job reassigned to ${state.users[employeeId].name}.`);
}

function handleNeedInfo(jobId) {
  if (!jobId) throw new Error("No job selected");
  pendingNeedInfoJobId = jobId;
  showToast("Confirm the missing information request before sending.");
}

function handleSendMissingInfo(jobId) {
  if (!jobId) throw new Error("No job selected");
  updateState(
    needMoreInfo(state, {
      jobId,
      actorId: currentUserId,
      note: value("#missing-info-note") || "Need more information before continuing.",
      now: now(),
    }),
  );
  pendingNeedInfoJobId = null;
  showToast("Missing information email recorded and a new upload link is ready.");
}

function handleCompleteJob(jobId) {
  const job = state.jobs[jobId];
  const employeeId = job?.assignedTo || activeEmployeeId();
  updateState(
    completeJob(state, {
      jobId,
      employeeId,
      now: now(),
      files: [],
    }),
  );
  showToast("Job completed and sent to manager Documents To Review.");
}

function handleUploadWorkFiles(jobId, employeeId) {
  const fileInput = document.querySelector(`#work-files-${cssEscape(jobId)}`);
  const browserFiles = Array.from(fileInput?.files ?? []);
  const files = browserFiles.length
    ? browserFiles.map((file) => ({ name: file.name, size: file.size, type: file.type || "application/octet-stream" }))
    : [{ name: "employee-work-files.pdf", size: 409600, type: "application/pdf" }];

  updateState(
    uploadEmployeeWorkFiles(state, {
      jobId,
      employeeId,
      files,
      now: now(),
    }),
  );
  showToast("Work files uploaded to this job.");
}

function handleApproveFinalPackage(jobId) {
  if (!jobId) throw new Error("No job selected");
  updateState(
    approveFinalPackage(state, {
      jobId,
      managerId: MANAGER_ID,
      now: now(),
      files: [{ name: "final-report-approved.pdf", size: 512000, type: "application/pdf" }],
    }),
  );
  selectedWorkspaceTab = "final";
  showToast("Final package approved. Review the client email and send invoice from Final Package.");
}

function handleRequestRevision(jobId) {
  if (!jobId) throw new Error("No job selected");
  pendingReturnJobId = jobId;
  showToast("Confirm the revision instructions before returning to employee.");
}

function handleSendRevision(jobId) {
  if (!jobId) throw new Error("No job selected");
  const note = value("#revision-note") || "Please revise the completed package before final delivery.";
  const job = state.jobs[jobId];
  updateState(
    returnToEmployee(state, {
      jobId,
      managerId: MANAGER_ID,
      note,
      now: now(),
    }),
  );
  selectedEmployeeDashboardId = job?.assignedTo || selectedEmployeeDashboardId;
  selectedWorkspaceTab = "timeline";
  pendingReturnJobId = null;
  showToast("Revision request sent to employee.");
}

function handleSendFinalPackage(jobId) {
  if (!jobId) throw new Error("No job selected");
  updateState(
    reviewAndBill(state, {
      jobId,
      managerId: MANAGER_ID,
      invoiceNumber: value("#invoice-number") || nextInvoiceNumber(),
      amount: Number(value("#invoice-amount") || 0),
      now: now(),
    }),
  );
  selectedWorkspaceTab = "billing";
  showToast("Final package and invoice were recorded as sent to the client.");
}

function handleReviewBill(jobId) {
  if (!jobId) throw new Error("No job selected");
  updateState(
    reviewAndBill(state, {
      jobId,
      managerId: MANAGER_ID,
      invoiceNumber: value("#invoice-number") || nextInvoiceNumber(),
      amount: Number(value("#invoice-amount") || 0),
      now: now(),
    }),
  );
  showToast("Final report and bill were recorded as sent.");
}

function handlePayment(jobId) {
  if (!jobId) throw new Error("No job selected");
  updateState(markPaymentReceived(state, { jobId, managerId: MANAGER_ID, now: now() }));
  showToast("Payment received.");
}

function handleUpload() {
  const token = value("#upload-token");
  const fileInput = document.querySelector("#upload-files");
  const browserFiles = Array.from(fileInput?.files ?? []);
  const files = browserFiles.length
    ? browserFiles.map((file) => ({ name: file.name, size: file.size, type: file.type || "application/octet-stream" }))
    : [{ name: "client-uploaded-documents.zip", size: 204800, type: "application/zip" }];

  updateState(receiveUploadedDocuments(state, { token, now: now(), files }));
  currentView = "manager";
  showToast("Documents received. Client status updated automatically.");
}

function updateState(nextState, { trackHistory = true } = {}) {
  if (trackHistory) {
    historyStack = [...historyStack.slice(-24), state];
  }
  state = nextState;
  saveState();
}

function undoLastAction() {
  const previous = historyStack.at(-1);
  if (!previous) {
    return;
  }
  historyStack = historyStack.slice(0, -1);
  state = previous;
  saveState();
  showToast("Last action undone.");
}

function clearFilters() {
  filters = { query: "", status: "all", employeeId: "all" };
}

function emptyCreateClientDraft() {
  return { name: "", contactName: "", email: "", phone: "", notes: "" };
}

function emptyEditClientDraft() {
  return { name: "", contactName: "", email: "", phone: "", notes: "" };
}

function handlePreviewFile(fileId) {
  previewFileId = fileId;
}

function handleClearSearch() {
  filters.query = "";
  pendingFocusRestore = { id: "client-search", start: 0, end: 0 };
}

function handleToggleCreateClient() {
  if (showCreateClientForm) {
    createClientDraft = emptyCreateClientDraft();
    showCreateClientForm = false;
    return;
  }
  createClientDraft = { ...emptyCreateClientDraft(), name: filters.query.trim() };
  showCreateClientForm = true;
}

function handleOpenCreateClientFromSearch() {
  createClientDraft = { ...emptyCreateClientDraft(), name: filters.query.trim() };
  showCreateClientForm = true;
}

function handleCancelCreateClient() {
  createClientDraft = emptyCreateClientDraft();
  showCreateClientForm = false;
}

function resetAssignDraftForClient(clientId) {
  const job = Object.values(state.jobs).find((item) => item.clientId === clientId);
  assignDraft = {
    employeeId: job?.assignedTo ?? "user-amy",
    priority: job?.priority ?? "medium",
    instructions: job?.instructions ?? "",
    dueDate: job?.dueDate ?? "",
  };
}

function captureAssignDraftFields() {
  const instructions = document.querySelector("#assign-instructions")?.value;
  const dueDate = document.querySelector("#assign-due")?.value;
  if (instructions !== undefined) assignDraft.instructions = instructions;
  if (dueDate !== undefined) assignDraft.dueDate = dueDate;
}

function resetDemo() {
  localStorage.removeItem(STORAGE_KEY);
  state = seedState();
  saveState();
  currentView = "manager";
  selectedClientId = "client-1";
  selectedWorkspaceTab = "profile";
  assignDraft = { employeeId: "user-amy", priority: "medium", instructions: "", dueDate: "" };
  createClientDraft = emptyCreateClientDraft();
  editClientDraft = emptyEditClientDraft();
  editingClientId = null;
  pendingNeedInfoJobId = null;
  pendingReturnJobId = null;
  selectedEmployeeDashboardId = "user-amy";
  employeeJobFilter = "all";
  previewFileId = null;
  reviewInboxFilter = "all";
  managerAlertFilter = "all";
  pendingFocusRestore = null;
  filters = { query: "", status: "all", employeeId: "all" };
  showToast("Demo data reset.");
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const seeded = seedState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  return JSON.parse(saved);
}

function seedState() {
  let next = createInitialState();
  next = createClient(next, {
    organizationId: ORGANIZATION_ID,
    managerId: MANAGER_ID,
    name: "Cedar Bookkeeping Co.",
    contactName: "Elena Moss",
    email: "elena@cedarbooks.ca",
    phone: "(604) 555-0166",
    notes: "New client waiting for document request email.",
    now: "2026-06-06T09:00:00.000Z",
  });
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

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function tab(id, label, current) {
  return `<button class="tab ${id === current ? "active" : ""}" data-action="view" data-id="${id}">${label}</button>`;
}

function statusOptions(selected) {
  return Object.entries(STATUS_LABELS)
    .map(
      ([status, label]) =>
        `<option value="${status}" ${selected === status ? "selected" : ""}>${escapeHtml(label)}</option>`,
    )
    .join("");
}

function statusPill(status) {
  return `<span class="status-pill ${status}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>`;
}

function actionLockKey(action, targetOrId) {
  if (typeof targetOrId === "string") {
    return `${action}:${targetOrId}`;
  }
  const id = targetOrId.dataset.id || targetOrId.dataset.employeeId || "global";
  return `${action}:${id}`;
}

function isActionLocked(action, id) {
  return actionLocker.isLocked(actionLockKey(action, id));
}

function lockedAttr(action, id) {
  return isActionLocked(action, id) ? "disabled" : "";
}

function actionLabel(action, id, defaultLabel, lockedLabel) {
  return isActionLocked(action, id) ? lockedLabel : defaultLabel;
}

function restorePendingFocus() {
  if (!pendingFocusRestore) {
    return;
  }
  const restore = pendingFocusRestore;
  pendingFocusRestore = null;
  const field = document.querySelector(`#${restore.id}`);
  if (!field) {
    return;
  }
  field.focus();
  if (typeof field.setSelectionRange === "function") {
    const length = field.value.length;
    field.setSelectionRange(Math.min(restore.start, length), Math.min(restore.end, length));
  }
}

function priorityPill(priority) {
  return `<span class="priority-pill ${priority}">${capitalize(priority)}</span>`;
}

function info(label, valueText) {
  return `
    <div class="info-item">
      <div class="info-label">${escapeHtml(label)}</div>
      <div class="info-value">${escapeHtml(valueText)}</div>
    </div>
  `;
}

function employees() {
  return Object.values(state.users).filter((user) => user.role === "employee");
}

function activeEmployeeId() {
  if (currentView === "employee") {
    return selectedEmployeeDashboardId;
  }
  return selectedEmployeeDashboardId;
}

function getActiveMissingInfoRequest(clientId) {
  const timestamp = Date.parse(now());
  return state.uploadRequests
    .filter((request) => request.clientId === clientId)
    .filter((request) => request.purpose === "missing_info")
    .filter((request) => !request.usedAt)
    .filter((request) => Date.parse(request.expiresAt) >= timestamp)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function now() {
  return new Date().toISOString();
}

function todayPlus(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextInvoiceNumber() {
  return `HD-${String(1001 + state.billingRecords.length).padStart(4, "0")}`;
}

function value(selector) {
  return document.querySelector(selector)?.value.trim() ?? "";
}

function cssEscape(valueText) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(valueText) : String(valueText).replaceAll('"', '\\"');
}

function checkedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? "";
}

function formatDateTime(valueText) {
  if (!valueText) return "Not recorded";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(valueText));
}

function formatDate(valueText) {
  if (!valueText) return "Not recorded";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(valueText));
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function capitalize(valueText) {
  return `${valueText.charAt(0).toUpperCase()}${valueText.slice(1)}`;
}

function alertTitle(type) {
  if (type === "documents_received") return "Documents Uploaded";
  if (type === "job_completed") return "Job Completed";
  if (type === "need_more_info") return "Need More Info";
  if (type === "data_issue") return "Data Issue";
  return "Manager Alert";
}

function notificationAlertType(notification) {
  if (notification.type) return notification.type;
  const message = notification.message.toLowerCase();
  if (message.includes("uploaded")) return "documents_received";
  if (message.includes("completed")) return "job_completed";
  if (message.includes("need") || message.includes("missing")) return "need_more_info";
  return "manager_alert";
}

function showToast(message) {
  toastMessage = message;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toastMessage = "";
    render();
  }, 2600);
}

function escapeHtml(valueText) {
  return String(valueText ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(valueText) {
  return escapeHtml(valueText);
}


