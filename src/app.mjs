import {
  EVENT_LABELS,
  FILE_SECTIONS,
  STATUS_LABELS,
  acceptJob,
  approveFinalPackage,
  assignJob,
  completeJob,
  createClient,
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
  startManagerReview,
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
import { exportClientData, importClientData, loadPersistentState, resetToSeededState, savePersistentState } from "./data-store.mjs";

const ORGANIZATION_ID = "org-heyday";
const MANAGER_ID = "user-manager";
const AUTH_STORAGE_KEY = "heyday.auth.session.v1";
const SESSION_DEFAULT_PASSWORD = "111111";
const PASSWORD_MIN_LENGTH = 4;

const app = document.querySelector("#app");
let state = loadPersistentState();
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
let showDataToolsMenu = false;
let settingsMode = null;
let settingsReturnView = "manager";
let pendingImport = null;
let importStatusMessage = "";
let importPhase = "idle";
let importStatusClearTimer = null;
let pendingEmployeeDeletion = null;
let authSession = loadAuthSession();
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

function getSessionScopeLabel(scope) {
  if (scope === "admin") return "Admin";
  if (scope === "manager") return "Manager";
  if (scope === "employee") return "Employee";
  return "Guest";
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function getUserPassword(userId) {
  const user = state.users[userId];
  return String(user?.password || "").trim() || SESSION_DEFAULT_PASSWORD;
}

function isEmployeeUser(user) {
  const role = normalizeRole(user?.role);
  return role === "employee" || role === "staff" || role === "member";
}

function isManagerRole(user) {
  return normalizeRole(user?.role) === "manager";
}

function isAdminRole(user) {
  return normalizeRole(user?.role) === "admin";
}

function isSystemRole(user) {
  return isManagerRole(user) || isAdminRole(user) || String(user?.id || "").trim() === MANAGER_ID;
}

function isStaffUser(user) {
  const role = normalizeRole(user?.role);
  if (role) {
    return isEmployeeUser({ role });
  }
  return Boolean(user?.id && !isSystemRole(user));
}

function nextRecordId(prefix, records) {
  const nextNumber = Object.keys(records).reduce((highest, id) => {
    const match = String(id).match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
  return `${prefix}-${nextNumber}`;
}

function resolveEmployeeIdForLogin() {
  const users = Object.values(state.users);
  const employeeUser = users.find(isStaffUser);
  if (employeeUser?.id) {
    return employeeUser.id;
  }

  const nonSystemUser = users.find((user) => !isSystemRole(user));
  if (nonSystemUser?.id) {
    return nonSystemUser.id;
  }
  return "";
}

function normalizeAuthSession() {
  if (!authSession) {
    return true;
  }

  const scope = authScope();
  if (scope === "employee") {
    const employee = state.users[authSession.userId];
    if (!employee) {
      clearAuthSession();
      authSession = null;
      return false;
    }
    return true;
  }

  if (scope === "manager" || scope === "admin") {
    if (!state.users[authSession.userId]) {
      authSession = { ...authSession, userId: MANAGER_ID };
      saveAuthSession(authSession);
      return true;
    }
    return true;
  }

  clearAuthSession();
  authSession = null;
  return false;
}

function authScope() {
  const scope = String(authSession?.scope || "").trim();
  if (scope === "admin" || scope === "manager" || scope === "employee") {
    return scope;
  }
  return "guest";
}

function resolveSystemAccountId(scope = "manager") {
  if (scope === "admin") {
    const adminUser = Object.values(state.users).find((user) => isAdminRole(user));
    if (adminUser?.id) {
      return adminUser.id;
    }
  }
  const managerUser = state.users[MANAGER_ID];
  if (managerUser?.id) {
    return managerUser.id;
  }
  const legacyManager = Object.values(state.users).find((user) => isManagerRole(user));
  return legacyManager?.id || MANAGER_ID;
}

function authUser() {
  if (!authSession?.userId) {
    return state.users[MANAGER_ID];
  }
  return state.users[authSession.userId] || state.users[MANAGER_ID];
}

function isLoggedIn() {
  const scope = authScope();
  return scope === "manager" || scope === "admin" || scope === "employee";
}

function canViewManagerPlatform() {
  return authScope() === "manager" || authScope() === "admin";
}

function canViewEmployeePlatform() {
  return authScope() === "employee" || authScope() === "admin";
}

function canViewDatabase() {
  return canViewManagerPlatform();
}

function canViewUploadPortal() {
  return true;
}

function canAccessView(viewId) {
  if (authScope() === "admin") return true;
  if (authScope() === "manager") {
    return viewId === "manager" || viewId === "database" || viewId === "upload";
  }
  if (authScope() === "employee") {
    return viewId === "employee";
  }
  return false;
}

function getAccessibleViews() {
  if (authScope() === "admin") {
    return ["manager", "employee", "upload", "database"];
  }
  if (authScope() === "manager") {
    return ["manager", "database", "upload"];
  }
  if (authScope() === "employee") {
    return ["employee"];
  }
  return [];
}

function canOpenSettingsMode(mode) {
  if (mode === "manager-password" || mode === "team-management") {
    return canViewManagerPlatform();
  }
  if (mode === "employee-password") {
    return canViewEmployeePlatform() || canViewManagerPlatform();
  }
  return false;
}

function openSettingsMode(mode) {
  if (!canOpenSettingsMode(mode)) {
    showToast("You do not have permission to open this settings page.");
    return;
  }
  settingsMode = mode;
  settingsReturnView = currentView || (canViewManagerPlatform() ? "manager" : "employee");
  showDataToolsMenu = false;
}

function closeSettingsMode() {
  const accessibleViews = getAccessibleViews();
  if (!accessibleViews.includes(settingsReturnView)) {
    settingsReturnView = accessibleViews[0] || (canViewManagerPlatform() ? "manager" : "employee");
  }
  settingsMode = null;
  currentView = settingsReturnView;
}

function getManagerSession() {
  const scope = authScope();
  const user = authSession?.userId ? state.users[authSession.userId] : null;
  return {
    username: authSession?.username || "",
    displayName: user?.name || (scope === "admin" ? "System Admin" : scope === "employee" ? "Employee" : "Manager"),
    scope: scope,
    userId: authSession?.userId || MANAGER_ID,
  };
}

function loadAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.scope || !parsed.userId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveAuthSession(session) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  pendingEmployeeDeletion = null;
}

function logout() {
  authSession = null;
  clearAuthSession();
  showDataToolsMenu = false;
  settingsMode = null;
  if (new URLSearchParams(location.search).has("upload")) {
    currentView = "upload";
  } else {
    currentView = "manager";
  }
  render();
}

render();

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  const insideDataTools = event.target.closest(".data-tools-menu");
  if (!target) {
    if (showDataToolsMenu && !insideDataTools) {
      showDataToolsMenu = false;
      render();
    }
    return;
  }
  if (!insideDataTools && showDataToolsMenu) {
    showDataToolsMenu = false;
  }
  if (target.closest(".client-table") && target.matches("button")) {
    event.stopPropagation();
  }

  const action = target.dataset.action;
  const id = target.dataset.id;

  try {
    if (action === "login") {
      const scope = target.dataset.scope;
      const username = target.dataset.username || "";
      handleLogin(scope, username);
      return;
    }
    if (action === "logout") {
      logout();
      return;
    }
    if (action === "toggle-data-tools") {
      showDataToolsMenu = !showDataToolsMenu;
      render();
      return;
    }
    if (action === "open-settings") {
      openSettingsMode(id);
      render();
      return;
    }
    if (action === "close-settings") {
      closeSettingsMode();
      render();
      return;
    }
    if (action === "view" && !canAccessView(id)) {
      return;
    }
    if (!isLoggedIn() && !new URLSearchParams(location.search).has("upload")) {
      showToast("Please login before continuing.");
      return;
    }

    if (authScope() === "employee" && action === "employee-view-select" && id) {
      const targetUserId = target.value || id;
      if (targetUserId !== authSession?.userId) {
        return;
      }
    }

    if (LOCKED_ACTIONS.has(action)) {
      const key = actionLockKey(action, target);
      if (!actionLocker.tryLock(key)) {
        showToast("Please wait 2 seconds before pressing this action again.");
        render();
        return;
      }
      window.setTimeout(() => render(), 2050);
    }

    if (action === "view") {
      showDataToolsMenu = false;
      currentView = id;
      settingsMode = null;
    }
    if (action === "role" && canViewManagerPlatform()) {
      currentView = "manager";
      currentUserId = id;
      settingsMode = null;
    }
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
    if (action === "view") {
      currentView = id;
      settingsMode = null;
    }
    if (action === "confirm-import") {
      applyPendingImport();
      return;
    }
    if (action === "confirm-delete-employee") {
      applyPendingEmployeeDelete();
      return;
    }
    if (action === "cancel-delete-employee") {
      cancelPendingEmployeeDelete();
      return;
    }
    if (action === "cancel-import") {
      cancelPendingImport();
      return;
    }
    if (action === "export-data" || action === "import-data" || action === "download-template") {
      showDataToolsMenu = false;
    }
    if (action === "import-data") {
      triggerClientDataImport();
      return;
    }
    if (action === "download-template") downloadImportTemplate();
    if (action === "export-data") exportClientDataToFile();
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
    if (action === "save-password") handleSavePassword(id);
    if (action === "set-employee-password") handleSetEmployeePassword(id);
    if (action === "add-employee") handleAddEmployee();
    if (action === "delete-employee") {
      requestDeleteEmployee(id);
      return;
    }
    if (action === "status-open") {
      handleStatusOpen(id);
      return;
    }
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
    if (authScope() === "employee") {
      const forcedEmployeeId = authSession?.userId;
      if (forcedEmployeeId) {
        target.value = forcedEmployeeId;
      }
      selectedEmployeeDashboardId = forcedEmployeeId || target.value;
      shouldRender = true;
      return;
    }
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
  const hasUploadParam = new URLSearchParams(location.search).has("upload") || new URLSearchParams(location.search).has("token");
  const isUploadPath = currentView === "upload" || hasUploadParam;
  if (!isLoggedIn() && !isUploadPath) {
    app.innerHTML = renderLoginLanding();
    return;
  }
  if (!normalizeAuthSession()) {
    app.innerHTML = renderLoginLanding();
    return;
  }

  if (authScope() === "employee") {
    const employeeId = authSession?.userId;
    if (employeeId && state.users[employeeId]) {
      currentUserId = employeeId;
      selectedEmployeeDashboardId = employeeId;
    }
  }
  const currentUser = state.users[currentUserId];
  const accessibleViews = getAccessibleViews();
  if (!accessibleViews.includes(currentView)) {
    currentView = accessibleViews[0] || "manager";
  }

  const showDataTools = canViewManagerPlatform() || canViewEmployeePlatform();
  const showUndoReset = canViewManagerPlatform();
  app.innerHTML = `
    <div class="app-shell">
      <div class="import-notice-stack">
        ${importStatusMessage ? renderImportStatusBanner() : ""}
        ${pendingImport ? renderPendingImportPanel() : ""}
        ${pendingEmployeeDeletion ? renderPendingEmployeeDeletePanel() : ""}
      </div>
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">HD</span>
          <div>
            <div class="brand-title">HEYDAY Workflow</div>
            <div class="brand-subtitle">Client jobs, files, status timeline, billing</div>
          </div>
        </div>
        <nav class="view-tabs" aria-label="Primary views">
          ${accessibleViews.includes("manager") ? tab("manager", "Manager", currentView) : ""}
          ${accessibleViews.includes("employee") ? tab("employee", "Employee", currentView) : ""}
          ${accessibleViews.includes("upload") ? tab("upload", "Upload Portal", currentView) : ""}
        </nav>
        <div class="role-switcher">
          <div class="session-chip">
            <span>${escapeHtml(getManagerSession().displayName)}</span>
            <span class="session-scope">${escapeHtml(getSessionScopeLabel(authScope()))}</span>
          </div>
          ${showUndoReset ? `<button class="ghost-button" data-action="undo-last" ${historyStack.length ? "" : "disabled"}>Undo Last Action</button>` : ""}
          ${showUndoReset ? `<button class="ghost-button" data-action="reset">Reset Demo</button>` : ""}
          ${showDataTools ? `<div class="data-tools-menu">
            <button class="ghost-button compact-button data-tools-toggle" data-action="toggle-data-tools" title="Tools / Settings" aria-label="Tools / Settings menu">⚙</button>
            ${showDataToolsMenu ? renderDataToolsMenu() : ""}
          </div>` : ""}
          <button class="ghost-button" data-action="logout">Logout</button>
          <input
            id="client-db-import-input"
            type="file"
            accept="application/json,.json,text/csv,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.ms-excel,.xls"
            style="display: none;"
          />
        </div>
      </header>
      <main class="content">
        ${settingsMode ? renderSettingsPage() : ""}
        ${!settingsMode && currentView === "manager" && canViewManagerPlatform() ? renderManager() : ""}
        ${!settingsMode && currentView === "database" && canViewDatabase() ? renderDatabaseView() : ""}
        ${!settingsMode && currentView === "employee" && canViewEmployeePlatform() ? renderEmployee(currentUser) : ""}
        ${!settingsMode && currentView === "upload" && canViewUploadPortal() ? renderUploadPortal() : ""}
      </main>
      ${toastMessage ? `<div class="toast">${escapeHtml(toastMessage)}</div>` : ""}
    </div>
  `;

  const importInput = document.querySelector("#client-db-import-input");
  if (importInput) {
    importInput.onchange = (event) => handleClientDbImportInputChange(event.target);
  }

  restorePendingFocus();
}

function renderLoginLanding() {
  const employeeList = Object.values(state.users).filter((user) => {
    return isEmployeeUser(user) || !isManagerRole(user);
  });
  const fallbackEmployeeId = resolveEmployeeIdForLogin();
  const hasEmployees = employeeList.length > 0;
  const fallbackOnly = !hasEmployees && Boolean(fallbackEmployeeId);
  return `
    <div class="auth-shell">
      <div class="auth-panel">
        <div class="auth-brand">
          <span class="brand-mark">HD</span>
          <div>
            <div class="brand-title">HEYDAY Workflow</div>
            <div class="brand-subtitle">Client jobs & client delivery operations platform</div>
          </div>
        </div>

        <div class="auth-grid">
          <section class="auth-card">
            <div class="auth-card-title">Manager Login</div>
            <div class="auth-card-subtitle">Use this to access manager-level dashboards and operations.</div>
            <label class="field">
              <span>Account</span>
              <input id="manager-username" value="manager" autocomplete="username" placeholder="manager or admin" />
            </label>
            <label class="field">
              <span>Password</span>
              <input id="manager-password" type="password" placeholder="Password" />
            </label>
            <div class="button-row">
              <button class="primary-button" data-action="login" data-scope="manager" data-username="manager">Manager Login</button>
              <button class="primary-button" data-action="login" data-scope="admin" data-username="admin">Admin Login</button>
            </div>
            <div class="auth-note">Default demo credentials are no longer shown. Please set a secure password for manager/admin in Team Management.</div>
          </section>

          <section class="auth-card">
            <div class="auth-card-title">Employee Login</div>
            <div class="auth-card-subtitle">Only employee platform, no manager panel</div>
            <label class="field">
              <span>Employee</span>
              <select id="employee-login-user" ${fallbackEmployeeId ? "" : "disabled"}>
                ${employeeList.length
                ? employeeList
                .map((user) => `<option value="${user.id}">${escapeHtml(user.name)} · ${escapeHtml(user.email || user.id)}</option>`)
                .join("")
                : fallbackEmployeeId
                  ? `<option value="${fallbackEmployeeId}">${escapeHtml(state.users[fallbackEmployeeId]?.name || fallbackEmployeeId)}</option>`
                  : `<option value="">No employee account found</option>`}
              </select>
            </label>
            <label class="field">
              <span>Password</span>
              <input id="employee-password" type="password" placeholder="Password" />
            </label>
            <div class="button-row">
              <button class="primary-button" data-action="login" data-scope="employee" ${fallbackEmployeeId ? "" : "disabled"}>Employee Login</button>
            </div>
            <div class="auth-note">If an account has no saved password, a temporary fallback password is used.</div>
            ${fallbackOnly ? `<div class="auth-note">No user role labeled as employee found in current data. Using ${escapeHtml(state.users[fallbackEmployeeId]?.name || fallbackEmployeeId)} for employee demo login.</div>` : ""}
          </section>
        </div>
      </div>
    </div>
  `;
}

function handleLogin(scope, fallbackUsername = "") {
  const username = authInputValue("manager-username") || String(fallbackUsername || "").trim() || "manager";
  const managerPassword = authInputValue("manager-password");
  const employeePassword = authInputValue("employee-password");
  const managerUser = String(scope || "").toLowerCase();
  const managerScopeId = managerUser === "admin" ? resolveSystemAccountId("admin") : resolveSystemAccountId("manager");
  const managerAuthPassword = getUserPassword(managerScopeId);

  if (managerUser === "manager") {
    if (managerPassword !== managerAuthPassword) {
      showToast("Invalid manager password.");
      return;
    }
    authSession = {
      scope: "manager",
      userId: managerScopeId,
      username,
      displayName: "Manager",
    };
  }

  if (managerUser === "admin") {
    if (managerPassword !== managerAuthPassword) {
      showToast("Invalid admin password.");
      return;
    }
    authSession = {
      scope: "admin",
      userId: managerScopeId,
      username,
      displayName: "System Admin",
    };
  }

  if (managerUser === "employee") {
    const explicitEmployeeId = value("employee-login-user");
    const fallbackEmployeeId = resolveEmployeeIdForLogin();
    const employeeId = explicitEmployeeId || fallbackEmployeeId || "";
    if (!employeeId || !state.users[employeeId]) {
      showToast("No valid employee found in current database. Please import an employee user first.");
      return;
    }
    const expectedEmployeePassword = getUserPassword(employeeId);
    if (employeePassword !== expectedEmployeePassword) {
      showToast("Invalid employee password.");
      return;
    }
    authSession = {
      scope: "employee",
      userId: employeeId,
      username: state.users[employeeId].name,
      displayName: state.users[employeeId].name,
    };
  }

  if (!authSession) {
    showToast("Unknown login path. Please try again.");
    return;
  }

  currentUserId = authSession.userId;
  selectedEmployeeDashboardId = authSession.userId;
  selectedClientId = Object.keys(state.clients)[0] || "client-1";
  settingsMode = null;
  showDataToolsMenu = false;
  if (authSession.scope === "employee") {
    currentView = "employee";
  } else {
    currentView = "manager";
  }
  saveAuthSession(authSession);
  clearImportState();
  render();
}

function clearImportState() {
  pendingImport = null;
  importStatusMessage = "";
  importPhase = "idle";
  clearImportStatusClearTimer();
  pendingEmployeeDeletion = null;
}

function requestDeleteEmployee(targetUserId) {
  if (!targetUserId || !state.users[targetUserId]) {
    showToast("Employee not found.");
    return;
  }

  const user = state.users[targetUserId];
  if (isSystemRole(user)) {
    showToast("Manager account cannot be deleted.");
    return;
  }

  pendingEmployeeDeletion = {
    targetUserId,
    name: user.name || targetUserId,
    displayEmail: user.email || "",
    canSelfDelete: authSession?.userId === targetUserId,
  };
  render();
}

function applyPendingEmployeeDelete() {
  const targetUserId = pendingEmployeeDeletion?.targetUserId;
  if (!targetUserId || !state.users[targetUserId]) {
    pendingEmployeeDeletion = null;
    render();
    return;
  }

  const user = state.users[targetUserId];
  if (isSystemRole(user)) {
    pendingEmployeeDeletion = null;
    showToast("Manager account cannot be deleted.");
    render();
    return;
  }

  const nextUsers = { ...state.users };
  delete nextUsers[targetUserId];

  const nextJobs = Object.fromEntries(
    Object.entries(state.jobs).map(([jobId, job]) => [jobId, job.assignedTo === targetUserId ? { ...job, assignedTo: null } : job]),
  );

  const nextNotifications = state.notifications.filter(
    (notification) => !(notification.recipientType === "user" && notification.recipientId === targetUserId),
  );

  const nextState = {
    ...state,
    users: nextUsers,
    jobs: nextJobs,
    notifications: nextNotifications,
  };

  if (authSession?.userId === targetUserId) {
    clearAuthSession();
    authSession = null;
    if (new URLSearchParams(location.search).has("upload")) {
      currentView = "upload";
    } else {
      currentView = "manager";
    }
  }
  if (selectedEmployeeDashboardId === targetUserId) {
    selectedEmployeeDashboardId = Object.values(nextUsers).find((item) => isStaffUser(item))?.id || "user-amy";
  }
  if (currentUserId === targetUserId) {
    currentUserId = MANAGER_ID;
  }

  saveState(nextState);
  historyStack = [];
  pendingEmployeeDeletion = null;
  showToast(`Employee ${user.name} has been removed.`);

  if (!isLoggedIn()) {
    render();
    return;
  }
  render();
}

function cancelPendingEmployeeDelete() {
  pendingEmployeeDeletion = null;
  showToast("Employee deletion cancelled.");
  render();
}

function authInputValue(id) {
  return String(document.querySelector(`#${id}`)?.value || "").trim();
}

function handleClientDbImportInputChange(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) {
    updateImportStatus("No file selected.", "error");
    return;
  }

  pendingImport = null;
  updateImportStatus(`Import file selected: ${file.name} (${file.size} bytes).`, "selected");
  const fileType = detectFileExtension(file);
  const fileSource = fileType === "json" ? "JSON" : fileType === "csv" ? "CSV" : fileType === "xlsx" || fileType === "xls" ? "Excel" : "Unknown";

  const onHandled = () => {
    if (!pendingImport && importPhase !== "success") {
      importPhase = "idle";
    }
    render();
  };
  const showParsedSummary = (counts, sourceHint = fileSource) => {
    if (!counts || typeof counts.totalRows !== "number" || typeof counts.validRows !== "number") {
      return;
    }
    const summaryMessage = `Detected ${counts.totalRows} lines (${counts.validRows} valid records) from ${sourceHint}`;
    updateImportStatus(summaryMessage, "parsed");
  };

  (async () => {
    try {
      updateImportStatus(`Parsing file (${fileSource})...`, "parsing");

      if (fileType === "json") {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            handleImportClientDatabase(String(reader.result || ""), { source: "json" });
          } catch (error) {
            updateImportStatus(error?.message || "Failed to parse JSON file.", "error");
            onHandled();
            return;
          }
          onHandled();
        };
        reader.onerror = () => {
          updateImportStatus("Failed to read the selected import file.", "error");
          onHandled();
        };
        reader.readAsText(file);
        return;
      }

      if (fileType === "csv") {
        const reader = new FileReader();
        reader.onload = () => {
          const parsed = parseCsvRows(reader.result || "");
          showParsedSummary({ totalRows: parsed.totalRows, validRows: parsed.validRows }, "CSV");
          if (parsed.validRows === 0) {
            updateImportStatus("No valid client rows in spreadsheet", "error");
            onHandled();
            return;
          }
          handleImportClientDatabase(parsed.rows, { source: "csv", ...parsed });
          onHandled();
        };
        reader.onerror = () => {
          updateImportStatus("Failed to read the selected import file.", "error");
          onHandled();
        };
        reader.readAsText(file);
        return;
      }

      if (fileType === "xlsx" || fileType === "xls") {
        const buffer = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("Failed to read the selected import file."));
          reader.readAsArrayBuffer(file);
        });
        const parsed = await parseXlsxRows(buffer);
        showParsedSummary({ totalRows: parsed.totalRows, validRows: parsed.validRows }, "Excel");
        if (parsed.validRows === 0) {
          updateImportStatus("No valid client rows in spreadsheet", "error");
          onHandled();
          return;
        }
        handleImportClientDatabase(parsed.rows, { source: "xlsx", ...parsed });
        onHandled();
        return;
      }

      updateImportStatus("Unsupported file format. Please upload JSON, CSV, XLSX, or XLS.", "error");
      onHandled();
    } catch (error) {
      updateImportStatus(error?.message || "Failed to import file.", "error");
      onHandled();
    }
  })();
}

function updateImportStatus(message, phase = "idle", autoClearMs = 0) {
  clearImportStatusClearTimer();
  importStatusMessage = message;
  importPhase = phase;
  showToast(message);
  render();
  scheduleImportStatusClear(phase, autoClearMs);
}

function clearImportStatusClearTimer() {
  if (importStatusClearTimer) {
    window.clearTimeout(importStatusClearTimer);
    importStatusClearTimer = null;
  }
}

function scheduleImportStatusClear(messagePhase, delayMs = 0) {
  clearImportStatusClearTimer();
  if (!delayMs || messagePhase !== "success") {
    return;
  }
  importStatusClearTimer = window.setTimeout(() => {
    if (importPhase !== "success") {
      return;
    }
    importStatusMessage = "";
    importPhase = "idle";
    importStatusClearTimer = null;
    render();
  }, delayMs);
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
                <div class="section-subtitle">Client uploads and submitted employee work waiting for manager review</div>
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
                <div class="section-subtitle">Uploaded documents, work sent for review, and information requests</div>
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

function renderPasswordPanel(userId, includeCurrentScopeHint = false) {
  const user = state.users[userId];
  if (!user) {
    return '<div class="empty-state">Account unavailable.</div>';
  }
  const accountLabel = includeCurrentScopeHint ? `${user.name} (Current login)` : user.name;
  return `
    <div class="detail-body">
      <div class="field">
        <span>Account</span>
        <div class="locked-name">${escapeHtml(accountLabel)} · ${escapeHtml(user.id)}</div>
      </div>
      <label class="field">
        <span>Current Password</span>
        <input id="user-password-current-${user.id}" type="password" placeholder="Current password" />
      </label>
      <label class="field">
        <span>New Password</span>
        <input id="user-password-new-${user.id}" type="password" placeholder="New password" />
      </label>
      <label class="field">
        <span>Confirm New Password</span>
        <input id="user-password-confirm-${user.id}" type="password" placeholder="Confirm new password" />
      </label>
      <div class="action-grid">
        <button class="primary-button" data-action="save-password" data-id="${user.id}">
          Save Password
        </button>
      </div>
      <div class="auth-note">Default password for new records is <strong>${SESSION_DEFAULT_PASSWORD}</strong>.</div>
    </div>
  `;
}

function renderTeamManagement() {
  const activeEmployees = employees();
  const sortedEmployees = activeEmployees.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return `
    <div class="detail-body">
      <div class="section">
        <div class="section-header">
          <div class="section-title">Add Employee</div>
        </div>
        <div class="detail-body">
          <label class="field">
            <span>Employee Name</span>
            <input id="new-employee-name" placeholder="Employee full name" />
          </label>
          <label class="field">
            <span>Email</span>
            <input id="new-employee-email" placeholder="name@company.com" />
          </label>
          <label class="field">
            <span>Employee ID (optional)</span>
            <input id="new-employee-id" placeholder="Auto-generated if empty" />
          </label>
          <label class="field">
            <span>Initial Password</span>
            <input id="new-employee-password" type="password" placeholder="Set login password" value="${SESSION_DEFAULT_PASSWORD}" />
          </label>
          <div class="action-grid">
            <button class="primary-button" data-action="add-employee">Add Employee</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div class="section-title">Current Employees</div>
        </div>
        <div class="table-wrap database-table-wrap">
          <table class="database-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Email</th>
                <th>Password</th>
                <th>Action</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${sortedEmployees
                .map((user) => {
                  const safeId = escapeAttr(user.id);
                  return `
                    <tr>
                      <td>${escapeHtml(user.name)} · ${escapeHtml(user.id)}</td>
                      <td>${escapeHtml(user.email || "—")}</td>
                      <td>
                        <div class="field">
                          <input id="employee-password-new-${safeId}" type="password" placeholder="New password" />
                        </div>
                        <div class="field">
                          <input id="employee-password-confirm-${safeId}" type="password" placeholder="Confirm password" />
                        </div>
                      </td>
                      <td><button class="ghost-button compact-button" data-action="set-employee-password" data-id="${safeId}">Set Password</button></td>
                      <td><button class="danger-button compact-button" data-action="delete-employee" data-id="${safeId}">Delete</button></td>
                    </tr>
                  `;
                })
                .join("") || `<tr><td colspan="5" class="muted">No employee found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderDatabaseView() {
  const organizationClients = Object.values(state.clients)
    .filter(
    (client) => client.organizationId === ORGANIZATION_ID || !client.organizationId,
    )
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const organizationJobs = Object.values(state.jobs)
    .filter((job) => job.organizationId === ORGANIZATION_ID || !job.organizationId)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  const organizationUsers = Object.values(state.users).filter(
    (user) => !user.organizationId || user.organizationId === ORGANIZATION_ID || user.id === MANAGER_ID,
  );
  const events = state.events || [];
  const files = state.files || [];
  const uploadRequests = state.uploadRequests || [];

  const clientsById = Object.fromEntries(organizationClients.map((client) => [client.id, client]));
  const clientJobs = {};
  organizationJobs.forEach((job) => {
    const list = clientJobs[job.clientId] || [];
    list.push(job);
    clientJobs[job.clientId] = list;
  });
  return `
    <div class="database-grid">
      <section class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Client Database</div>
            <div class="section-subtitle">Read-only view of current stored clients, jobs, and related records.</div>
          </div>
        </div>
        <div class="metric-grid">
          ${dbMetric("Total Clients", String(organizationClients.length))}
          ${dbMetric("Total Jobs", String(organizationJobs.length))}
          ${dbMetric("Events", String(events.length))}
          ${dbMetric("Files", String(files.length))}
          ${dbMetric("Upload Requests", String(uploadRequests.length))}
          ${dbMetric("Staff", String(organizationUsers.length))}
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Client Records</div>
            <div class="section-subtitle">All client entities in this workspace.</div>
          </div>
        </div>
        <div class="table-wrap database-table-wrap">
          <table class="database-table">
            <thead>
              <tr>
                <th>Client ID</th>
                <th>Client Name</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Jobs</th>
              </tr>
            </thead>
            <tbody>
              ${organizationClients
                .map((client) => {
                  const jobs = clientJobs[client.id] || [];
                  const linkedJobIds = jobs.map((job) => job.id).join(", ") || "No job";
                  return `
                    <tr>
                      <td>${escapeHtml(client.id)}</td>
                      <td>${escapeHtml(client.name)}</td>
                      <td>${escapeHtml(client.contactName || "—")}</td>
                      <td>${escapeHtml(client.email || "—")}</td>
                      <td>${escapeHtml(client.phone || "—")}</td>
                      <td>${statusPill(client.status)}</td>
                      <td>${escapeHtml(linkedJobIds)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
          ${organizationClients.length ? "" : '<div class="empty-state">No client records in database yet.</div>'}
        </div>
      </section>

      <section class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Job Records</div>
            <div class="section-subtitle">All jobs connected to clients.</div>
          </div>
        </div>
        <div class="table-wrap database-table-wrap">
          <table class="database-table">
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Client</th>
                <th>Title</th>
                <th>Assigned To</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>Review Round</th>
              </tr>
            </thead>
            <tbody>
              ${organizationJobs
                .map((job) => {
                  const clientName = clientsById[job.clientId]?.name || "(Unknown client)";
                  const employee = job.assignedTo ? state.users[job.assignedTo] : null;
                  return `
                    <tr>
                      <td>${escapeHtml(job.id)}</td>
                      <td>${escapeHtml(clientName)}</td>
                      <td>${escapeHtml(job.title || "—")}</td>
                      <td>${escapeHtml(employee?.name || "Unassigned")}</td>
                      <td>${statusPill(job.status)}</td>
                      <td>${job.dueDate ? formatDate(job.dueDate) : "—"}</td>
                      <td>${escapeHtml(String(job.reviewRound || 1))}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
          ${organizationJobs.length ? "" : '<div class="empty-state">No job records in database yet.</div>'}
        </div>
      </section>
    </div>
  `;
}

function renderEmployee(currentUser) {
  const employeeId = activeEmployeeId();
  const employee = state.users[employeeId] || state.users[MANAGER_ID];
  const jobs = getVisibleJobsForUser(state, employeeId);
  const filteredJobs = filterJobsByEmployeeStatus(jobs, employeeJobFilter);
  const alerts = state.notifications
    .filter((item) => item.recipientId === employeeId)
    .reverse();
  const canSwitchEmployeeView = canViewManagerPlatform();

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
          ${canSwitchEmployeeView
            ? `<label class="field">
                <span>Viewing Employee</span>
                <select id="employee-view-select">
                  ${employees()
                    .map(
                      (user) =>
                        `<option value="${user.id}" ${employeeId === user.id ? "selected" : ""}>${escapeHtml(user.name)}</option>`,
                    )
                    .join("")}
                </select>
              </label>`
            : `<div class="field compact-field">
                <span>Viewing Employee</span>
                <div class="locked-name">${escapeHtml(employee.name)} (${escapeHtml(employeeId)})</div>
              </div>`}
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
    ["revision_required", "Revision Required"],
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
          <option value="completed_work" ${reviewInboxFilter === "completed_work" ? "selected" : ""}>Work Review (${items.filter((item) => item.reviewType === "completed_work").length})</option>
        </select>
      </label>
    </div>
  `;
}

function renderReviewInbox(items) {
  if (!items.length) {
    return `<div class="empty-state">No documents or submitted work are waiting for review.</div>`;
  }

  return items
    .map(
      (item) => `
        <article class="review-item">
          <div>
            <div class="job-title">${escapeHtml(item.client.name)}</div>
            <div class="filter-chip">${item.reviewType === "completed_work" ? `${formatReviewRound(item.reviewRound)} Review` : "Client Documents"}</div>
            <div class="muted small">${escapeHtml(item.client.contactName)} · ${item.fileCount} file(s) uploaded</div>
            ${item.reviewType === "completed_work" && item.job?.assignedTo ? `<div class="muted small">Employee: ${escapeHtml(state.users[item.job.assignedTo]?.name ?? "Unassigned")}</div>` : ""}
            <div class="muted small">${item.reviewType === "completed_work" ? "Sent" : "Uploaded"} ${formatDateTime(item.uploadedAt)}</div>
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
          <option value="sent_for_review" ${managerAlertFilter === "sent_for_review" ? "selected" : ""}>Sent for Review (${alerts.filter((alert) => ["sent_for_review", "resubmitted"].includes(alert.type)).length})</option>
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
                  <td>${statusPillWithAction(client.status, client.id)}</td>
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
  if (["sent_for_review", "resubmitted"].includes(client.status)) {
    return `<button class="primary-button compact-button" data-action="review-documents" data-id="${client.id}">Start Review</button>`;
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
        ${statusPillWithAction(client.status, client.id)}
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
  if (job?.status === "under_review") {
    const assignedEmployee = job.assignedTo ? state.users[job.assignedTo] : null;
    return `
      <section class="workspace-page">
        <div class="workspace-page-title">Under Review</div>
        <div class="review-summary">
          ${info("Review Round", `${formatReviewRound(job.reviewRound)} Review`)}
          ${info("Work Files", `${employeeWorkFiles.length} file(s)`)}
          ${info("Submitted Time", latestEmployeeWork ? formatDateTime(latestEmployeeWork) : "No submission recorded")}
          ${info("Employee", assignedEmployee?.name ?? "Unassigned")}
          ${info("Next Step", "Approve or return to employee")}
        </div>
        <div class="file-list">
          ${renderFileList(employeeWorkFiles, "No employee work files found.")}
        </div>
        ${renderFilePreviewPanel()}
        <div class="button-row">
          <button class="primary-button" data-action="approve-final-package" data-id="${job.id}" ${lockedAttr("approve-final-package", job.id)}>${actionLabel("approve-final-package", job.id, "Approve", "Processing...")}</button>
          <button class="ghost-button" data-action="request-revision" data-id="${job.id}">Require Revision</button>
          <button class="ghost-button" data-action="workspace-tab" data-id="files">View All Files</button>
        </div>
        ${
          pendingReturnJobId === job.id
            ? `
              <div class="confirm-panel">
                <div class="job-title">Revision Required</div>
                <label class="field">
                  <span>Revision Instructions</span>
                  <textarea id="revision-note" placeholder="Tell the employee exactly what to fix.">Please revise the package before final delivery.</textarea>
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

  if (job?.status === "approved") {
    return `
      <section class="workspace-page">
        <div class="workspace-page-title">Approved</div>
        <div class="empty-state">The work is approved. Open Final Package to send the files and invoice to the client.</div>
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
  const canSend = job && job.status === "approved" && !billing;
  const sent = Boolean(billing);
  const attachmentCount = finalFiles.length + billingFiles.length;

  return `
    <section class="workspace-page">
      <div class="workspace-page-title">Final Package</div>
      <div class="review-summary">
        ${info("Recipient", client.email)}
        ${info("Package Status", sent ? "Sent to client with invoice" : job?.status === "approved" ? "Approved, ready to send" : "Waiting for approval")}
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
    ["Revision Required", jobs.filter((job) => job.status === "revision_required")],
    ["In Progress", jobs.filter((job) => ["job_accepted", "in_progress", "revision_in_progress"].includes(job.status))],
    ["Sent for Review", jobs.filter((job) => ["sent_for_review", "resubmitted", "under_review"].includes(job.status))],
    [
      "Closed or Sent",
      jobs.filter((job) => ["approved", "reviewed_billed", "payment_received"].includes(job.status)),
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
  const canStartRevision = job.status === "revision_required";
  const canUploadWorkFiles = ["in_progress", "revision_in_progress"].includes(job.status);
  const employeeWorkFiles = state.files.filter((file) => file.jobId === job.id && file.section === "employee_work");
  const hasWorkFiles = employeeWorkFiles.length > 0;
  const canSubmitReview = ["in_progress", "revision_in_progress"].includes(job.status) && hasWorkFiles;
  const waitingManagerReview = ["sent_for_review", "resubmitted", "under_review"].includes(job.status);
  const closed = ["approved", "reviewed_billed", "payment_received"].includes(job.status);
  const submitLabel = job.status === "revision_in_progress" ? "Resubmit" : "Send for Review";

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
        ${job.reviewRound ? info("Review Round", `${formatReviewRound(job.reviewRound)} Review`) : ""}
        ${waitingManagerReview ? info("Status", job.status === "under_review" ? "Manager is reviewing" : "Waiting for manager review") : ""}
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
        <button class="primary-button" data-action="complete" data-id="${job.id}" data-employee-id="${job.assignedTo}" ${canSubmitReview && !isActionLocked("complete", job.id) ? "" : "disabled"}>${actionLabel("complete", job.id, submitLabel, "Submitting...")}</button>
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

function dbMetric(label, value) {
  return `
    <div class="metric">
      <div class="metric-value">${escapeHtml(String(value))}</div>
      <div class="metric-label">${escapeHtml(label)}</div>
    </div>
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
  const job = Object.values(state.jobs).find((item) => item.clientId === clientId);
  if (job && ["sent_for_review", "resubmitted"].includes(job.status)) {
    updateState(startManagerReview(state, { jobId: job.id, managerId: MANAGER_ID, now: now() }));
  }
  selectedClientId = clientId;
  resetAssignDraftForClient(clientId);
  selectedWorkspaceTab = getWorkspaceTabForEntry("review_documents");
  filters.status = "all";
  currentView = "manager";
  showToast("Client selected. Review documents in the workspace.");
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
  const isRevision = job?.status === "revision_in_progress";
  updateState(
    completeJob(state, {
      jobId,
      employeeId,
      now: now(),
      files: [],
    }),
  );
  showToast(isRevision ? "Revision resubmitted for manager review." : "Work sent for manager review.");
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
  showToast("Work approved. Review the client email and send invoice from Final Package.");
}

function handleRequestRevision(jobId) {
  if (!jobId) throw new Error("No job selected");
  pendingReturnJobId = jobId;
  showToast("Confirm the revision instructions before returning to employee.");
}

function handleSendRevision(jobId) {
  if (!jobId) throw new Error("No job selected");
  const note = value("#revision-note") || "Please revise the package before final delivery.";
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
  showToast("Revision required and sent to employee.");
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

function handleSavePassword(targetUserId) {
  if (!targetUserId) {
    showToast("Invalid account.");
    return;
  }
  const user = state.users[targetUserId];
  if (!user) {
    showToast("Account not found.");
    return;
  }

  const currentPassword = authInputValue(`user-password-current-${targetUserId}`);
  const nextPassword = authInputValue(`user-password-new-${targetUserId}`);
  const confirmPassword = authInputValue(`user-password-confirm-${targetUserId}`);
  const expectedCurrentPassword = getUserPassword(targetUserId);

  if (currentPassword !== expectedCurrentPassword) {
    showToast("Current password is incorrect.");
    return;
  }
  if (nextPassword.length < PASSWORD_MIN_LENGTH) {
    showToast(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    return;
  }
  if (nextPassword !== confirmPassword) {
    showToast("The new passwords do not match.");
    return;
  }

  state.users[targetUserId] = { ...user, password: nextPassword };
  saveState();
  const currentPasswordInput = document.querySelector(`#${cssEscape(`user-password-current-${targetUserId}`)}`);
  const nextPasswordInput = document.querySelector(`#${cssEscape(`user-password-new-${targetUserId}`)}`);
  const confirmPasswordInput = document.querySelector(`#${cssEscape(`user-password-confirm-${targetUserId}`)}`);
  if (currentPasswordInput) {
    currentPasswordInput.value = "";
  }
  if (nextPasswordInput) {
    nextPasswordInput.value = "";
  }
  if (confirmPasswordInput) {
    confirmPasswordInput.value = "";
  }
  showToast(`Password updated for ${user.name}.`);
  render();
}

function handleSetEmployeePassword(targetUserId) {
  if (!targetUserId || !state.users[targetUserId]) {
    showToast("Employee account not found.");
    return;
  }
  const nextPassword = authInputValue(`employee-password-new-${targetUserId}`);
  const confirmPassword = authInputValue(`employee-password-confirm-${targetUserId}`);
  if (nextPassword.length < PASSWORD_MIN_LENGTH) {
    showToast(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    return;
  }
  if (nextPassword !== confirmPassword) {
    showToast("The new passwords do not match.");
    return;
  }

  state.users[targetUserId] = {
    ...state.users[targetUserId],
    password: nextPassword,
  };
  saveState();
  const inputNewId = `employee-password-new-${targetUserId}`;
  const inputConfirmId = `employee-password-confirm-${targetUserId}`;
  const newPasswordInput = document.querySelector(`#${cssEscape(inputNewId)}`);
  const confirmInput = document.querySelector(`#${cssEscape(inputConfirmId)}`);
  if (newPasswordInput) {
    newPasswordInput.value = "";
  }
  if (confirmInput) {
    confirmInput.value = "";
  }
  showToast(`Password updated for ${state.users[targetUserId].name}.`);
  if (authSession?.userId === targetUserId && authSession?.scope === "employee") {
    showToast(`${state.users[targetUserId].name} should log in again using new password.`);
  }
  render();
}

function sanitizeEmployeeId(rawId) {
  const normalized = String(rawId || "").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  const trimmed = normalized.replace(/-+/g, "-").replace(/(^-|-$)/g, "");
  if (trimmed) {
    return trimmed;
  }
  return "";
}

function handleAddEmployee() {
  const name = authInputValue("new-employee-name").trim();
  const email = authInputValue("new-employee-email").trim();
  const preferredId = sanitizeEmployeeId(authInputValue("new-employee-id"));
  const password = authInputValue("new-employee-password");

  if (!name) {
    showToast("Employee name is required.");
    return;
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    showToast(`Initial password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    return;
  }

  const generatedId = preferredId || nextRecordId("user", state.users);
  if (state.users[generatedId]) {
    showToast(`Employee ID already exists: ${generatedId}`);
    return;
  }

  const nextUsers = {
    ...state.users,
    [generatedId]: {
      id: generatedId,
      organizationId: ORGANIZATION_ID,
      name,
      email,
      role: "employee",
      password,
    },
  };
  updateState({
    ...state,
    users: nextUsers,
  });

  showToast(`Employee "${name}" added as ${generatedId}.`);
  const nameInput = document.querySelector("#new-employee-name");
  const emailInput = document.querySelector("#new-employee-email");
  const employeeIdInput = document.querySelector("#new-employee-id");
  const passwordInput = document.querySelector("#new-employee-password");
  if (nameInput) {
    nameInput.value = "";
  }
  if (emailInput) {
    emailInput.value = "";
  }
  if (employeeIdInput) {
    employeeIdInput.value = "";
  }
  if (passwordInput) {
    passwordInput.value = SESSION_DEFAULT_PASSWORD;
  }
  render();
}

function renderPendingEmployeeDeletePanel() {
  if (!pendingEmployeeDeletion?.targetUserId) {
    return "";
  }

  const emailText = pendingEmployeeDeletion.displayEmail
    ? ` <span class="muted">${escapeHtml(pendingEmployeeDeletion.displayEmail)}</span>`
    : "";
  return `
    <section class="import-confirm-banner danger-action-banner">
      <div class="import-confirm-main">
        <div class="import-confirm-title">Delete Employee</div>
        <div class="import-confirm-summary">
          Remove <strong>${escapeHtml(pendingEmployeeDeletion.name)}</strong>${emailText ? `${emailText}` : ""} ?
          ${pendingEmployeeDeletion.canSelfDelete ? "<br/>You are currently logged in as this employee and will be signed out." : ""}
        </div>
      </div>
      <div class="import-confirm-actions">
        <button class="danger-button compact-button" data-action="confirm-delete-employee">Delete</button>
        <button class="ghost-button compact-button" data-action="cancel-delete-employee">Cancel</button>
      </div>
    </section>
  `;
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

function saveState(nextState = state) {
  const normalized = savePersistentState(nextState);
  state = normalized;
}

function renderDataToolsMenu() {
  const showManagerTools = canViewManagerPlatform();
  const showEmployeeTools = canViewEmployeePlatform();
  return `
    <div class="data-tools-dropdown" aria-label="Quick actions">
      <div class="data-tools-group-title">Database</div>
      ${showManagerTools ? `<button class="ghost-button compact-button" data-action="view" data-id="database">Open Database</button>` : ""}

      ${showManagerTools ? `<div class="data-tools-group-title">Data Tools</div>` : ""}
      ${showManagerTools ? `<button class="ghost-button compact-button" data-action="export-data">Export Client Database</button>` : ""}
      ${showManagerTools ? `<button class="ghost-button compact-button" data-action="import-data">Import Client Database</button>` : ""}
      ${showManagerTools ? `<button class="ghost-button compact-button" data-action="download-template">Download Import Template</button>` : ""}

      ${showManagerTools ? `<div class="data-tools-group-title">Manager Settings</div>` : ""}
      ${showManagerTools ? `<button class="ghost-button compact-button" data-action="open-settings" data-id="manager-password">Manager Password</button>` : ""}
      ${showManagerTools ? `<button class="ghost-button compact-button" data-action="open-settings" data-id="team-management">Team Management</button>` : ""}

      ${showEmployeeTools && !showManagerTools ? `<div class="data-tools-group-title">Employee Settings</div>` : ""}
      ${showEmployeeTools && !showManagerTools ? `<button class="ghost-button compact-button" data-action="open-settings" data-id="employee-password">Password</button>` : ""}
    </div>
  `;
}

function renderSettingsPage() {
  if (!settingsMode) {
    return "";
  }
  if (settingsMode === "manager-password") {
    return `
      <section class="section">
        <div class="section-header">
          <button class="ghost-button compact-button" data-action="close-settings">← Back</button>
          <div>
            <div class="section-title">Manager Password</div>
            <div class="section-subtitle">Update password for the current Manager/Admin account.</div>
          </div>
          <span class="status-pill">Settings</span>
        </div>
        ${renderPasswordPanel(authSession?.userId || MANAGER_ID, false)}
      </section>
    `;
  }
  if (settingsMode === "team-management") {
    return `
      <section class="section">
        <div class="section-header">
          <button class="ghost-button compact-button" data-action="close-settings">← Back</button>
          <div>
            <div class="section-title">Team Management</div>
            <div class="section-subtitle">Add employees, update passwords, or remove staff.</div>
          </div>
        </div>
        ${renderTeamManagement()}
      </section>
    `;
  }
  if (settingsMode === "employee-password") {
    const employee = currentUserForContext();
    if (!employee) {
      closeSettingsMode();
      return "";
    }
    return `
      <section class="section">
        <div class="section-header">
          <button class="ghost-button compact-button" data-action="close-settings">← Back</button>
          <div>
            <div class="section-title">Password</div>
            <div class="section-subtitle">Update your employee password.</div>
          </div>
        </div>
        ${renderPasswordPanel(employee.id, true)}
      </section>
    `;
  }
  return "";
}

function currentUserForContext() {
  return state.users[currentUserId] || state.users[MANAGER_ID];
}

function renderPendingImportPanel() {
  if (!pendingImport) {
    return "";
  }
  const sourceLabel = pendingImport.source === "json" ? "JSON" : pendingImport.source === "xlsx" || pendingImport.source === "xls" ? "Excel" : pendingImport.source === "csv" ? "CSV" : pendingImport.source === "spreadsheet" ? "Spreadsheet" : "Unknown";
  const linesSummary = pendingImport.parseMeta && Number.isFinite(pendingImport.parseMeta.totalRows) ? `Lines: ${pendingImport.parseMeta.totalRows} (${pendingImport.parseMeta.validRows} valid)` : "";
  return `
    <section class="import-confirm-banner">
      <div class="import-confirm-main">
        <div class="import-confirm-title">Replace current database with this file?</div>
        <div class="import-confirm-summary">
          Imported: ${pendingImport.summary.clients} clients, ${pendingImport.summary.jobs} jobs
          ${linesSummary ? `<br/>${linesSummary}` : ""}
          ${sourceLabel ? `<br/>Source: ${sourceLabel}` : ""}
        </div>
      </div>
      <div class="import-confirm-actions">
        <button class="ghost-button compact-button" data-action="confirm-import">Confirm Import</button>
        <button class="ghost-button compact-button" data-action="cancel-import">Cancel</button>
      </div>
    </section>
  `;
}

function triggerClientDataImport() {
  const input = document.querySelector("#client-db-import-input");
  if (input) {
    pendingImport = null;
    importPhase = "idle";
    importStatusMessage = "Import file dialog opened. Pick a JSON/CSV/XLSX/XLS file.";
    showToast(importStatusMessage);
    input.value = "";
    input.click();
    return;
  }
  showToast("Import input is not available.");
}

function exportClientDataToFile() {
  try {
    const payload = exportClientData(state);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const fileName = `heyday-client-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
    showToast("Client database export completed.");
  } catch (error) {
    showToast(`Export failed: ${error.message}`);
  }
}

function handleImportClientDatabase(raw, importMeta = null) {
  const result = importClientData(raw);
  if (!result.ok) {
    const errorMessage = result.error || "Import failed. Please check the source file.";
    updateImportStatus(errorMessage, "error");
    pendingImport = null;
    return;
  }
  if (!result.summary || (result.summary.clients === 0 && result.summary.jobs === 0)) {
    updateImportStatus("No valid client rows in spreadsheet", "error");
    return;
  }
  const source = importMeta || result.meta || {};
  pendingImport = {
    raw,
    summary: result.summary,
    parseMeta: {
      totalRows: source.totalRows,
      validRows: source.validRows,
    },
    source: source.source || "unknown",
    nextState: result.state,
  };
  importPhase = "ready";
  importStatusMessage = `Parsed import ready. Imported: ${result.summary.clients} clients, ${result.summary.jobs} jobs.`;
  showToast(importStatusMessage);
  render();
}

function applyPendingImport() {
  if (!pendingImport?.nextState) {
    return;
  }
  const toImport = pendingImport;
  pendingImport = null;
  state = resetImportState(toImport.nextState);
  const currentViewClientCount = searchClients(state, { organizationId: ORGANIZATION_ID, ...filters }).length;
  const successMessage = `Imported and loaded: ${toImport.summary.clients} clients, ${toImport.summary.jobs} jobs. Current view: ${currentViewClientCount} clients.`;
  updateImportStatus(successMessage, "success", 2600);
}

function cancelPendingImport() {
  if (!pendingImport) {
    return;
  }
  pendingImport = null;
  importPhase = "idle";
  importStatusMessage = "Import cancelled.";
  showToast("Import cancelled.");
  render();
}

function renderImportStatusBanner() {
  if (!importStatusMessage) {
    return "";
  }
  const phaseClass = importPhase ? ` import-status-${importPhase}` : "";
  return `
    <section class="import-status-banner${phaseClass}">
      <div class="import-status-label">${escapeHtml(importPhase?.toUpperCase() || "INFO")}</div>
      ${escapeHtml(importStatusMessage)}
    </section>
  `;
}

function downloadImportTemplate() {
  const header = ["client_name", "contact_name", "email", "phone", "status", "assigned_to", "due_date", "job_title", "notes", "review_round"];
  const rows = [
    ["North Valley", "Ella Stone", "ella@northtable.com", "+1 604-555-1001", "In Progress", "user-amy", "2026-07-15", "Tax filing support", "VIP client", "1"],
    ["Coastal Studio", "Mao Li", "mao@coastal.com", "+1 604-555-1002", "Need More Info", "user-ryan", "2026-07-20", "Payroll processing", "Waiting for bank docs", "1"],
    ["Oakridge Holdings", "Sophie Chen", "sophie@oakridge.com", "+1 604-555-1003", "Reviewed & Billed", "user-amy", "2026-07-22", "Year-end close", "Paid package sent", "1"],
  ];
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (text.includes('"') || text.includes(",") || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  const lines = [header, ...rows].map((row) => row.map((value) => escapeCsv(value)).join(","));
  const payload = `${lines.join("\n")}\n`;
  const blob = new Blob([payload], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  const fileName = `heyday-import-template-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  anchor.remove();
  showToast("Import template downloaded.");
}

function resetImportState(importedState) {
  pendingImport = null;
  state = importedState;
  historyStack = [];
  settingsMode = null;
  currentUserId = MANAGER_ID;
  showCreateClientForm = false;
  createClientDraft = emptyCreateClientDraft();
  editClientDraft = emptyEditClientDraft();
  editingClientId = null;
  pendingNeedInfoJobId = null;
  pendingReturnJobId = null;
  selectedClientId = Object.keys(state.clients).includes("client-1")
    ? "client-1"
    : Object.values(state.clients)[0]?.id || "";
  selectedWorkspaceTab = "profile";
  currentView = "manager";
  selectedEmployeeDashboardId = employees()[0]?.id || MANAGER_ID;
  filters = { query: "", status: "all", employeeId: "all" };
  employeeJobFilter = "all";
  reviewInboxFilter = "all";
  managerAlertFilter = "all";
  previewFileId = null;
  pendingFocusRestore = null;
  saveState();
  return state;
}

function resetDemo() {
  settingsMode = null;
  state = resetToSeededState();
  historyStack = [];
  currentUserId = MANAGER_ID;
  showCreateClientForm = false;
  selectedClientId = Object.keys(state.clients).includes("client-1") ? "client-1" : Object.values(state.clients)[0]?.id || "";
  selectedWorkspaceTab = "profile";
  currentView = "manager";
  assignDraft = { employeeId: "user-amy", priority: "medium", instructions: "", dueDate: "" };
  createClientDraft = emptyCreateClientDraft();
  editClientDraft = emptyEditClientDraft();
  editingClientId = null;
  pendingNeedInfoJobId = null;
  pendingReturnJobId = null;
  selectedEmployeeDashboardId = employees()[0]?.id || "user-amy";
  employeeJobFilter = "all";
  previewFileId = null;
  reviewInboxFilter = "all";
  managerAlertFilter = "all";
  pendingFocusRestore = null;
  filters = { query: "", status: "all", employeeId: "all" };
  showToast("Demo data reset.");
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

function getWorkspaceTabForStatus(status) {
  if (status === "new_client" || status === "request_sent") return "request";
  if (status === "documents_received") return "review";
  if (status === "job_assigned" || status === "job_accepted" || status === "in_progress" || status === "revision_required" || status === "revision_in_progress") {
    return "assign";
  }
  if (status === "sent_for_review" || status === "resubmitted" || status === "under_review") return "review";
  if (status === "approved") return "final";
  if (status === "reviewed_billed" || status === "payment_received") return "billing";
  if (status === "need_more_info") return "timeline";
  return "profile";
}

function statusPillWithAction(status, clientId) {
  if (!clientId) {
    return statusPill(status);
  }
  return `<button class="status-pill ${status} status-pill-button" data-action="status-open" data-id="${escapeAttr(clientId)}" title="Open in workspace">${escapeHtml(STATUS_LABELS[status] ?? status)}</button>`;
}

function handleStatusOpen(clientId) {
  const client = state.clients[clientId];
  if (!client) {
    showToast("Client not found.");
    return;
  }
  selectedClientId = clientId;
  selectedWorkspaceTab = getWorkspaceTabForStatus(client.status);
  currentView = "manager";
  showDataToolsMenu = false;
  settingsMode = null;
  render();
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
  return Object.values(state.users).filter(isStaffUser);
}

function activeEmployeeId() {
  if (currentView === "employee") {
    return selectedEmployeeDashboardId;
  }
  return selectedEmployeeDashboardId;
}

function detectFileExtension(file) {
  const fromName = String(file?.name || "").toLowerCase();
  const fromType = String(file?.type || "").toLowerCase();

  if (fromName.endsWith(".xlsx")) return "xlsx";
  if (fromName.endsWith(".xls")) return "xls";
  if (fromName.endsWith(".csv")) return "csv";
  if (fromName.endsWith(".json")) return "json";
  const lowerType = fromType.toLowerCase();
  if (lowerType === "text/csv" || lowerType === "application/vnd.ms-excel") return "csv";
  if (lowerType === "application/json") return "json";
  if (lowerType.includes("spreadsheetml") || lowerType.includes("sheet") || lowerType.includes("excel")) return "xlsx";
  return "unknown";
}

function normalizeFieldAlias(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\uFEFF]/g, "")
    .replace(/[\s_-]+/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHasClientName(row) {
  if (!row || typeof row !== "object") {
    return false;
  }
  const aliases = new Set([
    "client_name",
    "client name",
    "client",
    "customer",
    "customer name",
    "customer_name",
    "company",
    "name",
    "客户",
    "客户名称",
    "客户名",
  ]);
  return Object.keys(row).some((key) => {
    const normalized = normalizeFieldAlias(key);
    if (!aliases.has(normalized)) {
      if (/\b(client|customer|客户|公司|名字|名称)\b/.test(normalized) && String(row[key] ?? "").trim()) {
        return true;
      }
      return false;
    }
    return String(row[key] ?? "").trim() !== "";
  });
}

function parseCsvRows(raw) {
  const text = String(raw ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }

  function pushRow() {
    rows.push(row);
    row = [];
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      pushField();
      continue;
    }

    if (char === "\n") {
      pushField();
      pushRow();
      continue;
    }

    if (char === "\r") {
      continue;
    }

    field += char;
  }

  pushField();
  if (row.length !== 1 || row[0] !== "") {
    pushRow();
  }

  if (!rows.length) {
    return { rows: [], totalRows: 0, validRows: 0 };
  }

  const header = rows[0].map((column) => String(column).trim());
  const hasBOM = header[0]?.charCodeAt(0) === 0xfeff ? header[0].replace(/^\uFEFF/, "") : header[0];
  if (hasBOM) {
    header[0] = hasBOM;
  }

  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    const rowValues = rows[i];
    if (!rowValues || !rowValues.length) {
      continue;
    }
    const entry = {};
    let hasValue = false;
    for (let j = 0; j < header.length; j += 1) {
      const key = header[j];
      const value = rowValues[j] ?? "";
      entry[key] = value;
      if (!hasValue && String(value).trim()) {
        hasValue = true;
      }
    }
    if (!hasValue) {
      continue;
    }
    records.push(entry);
  }
  const totalRows = Math.max(0, rows.length - 1);
  const validRows = records.filter(parseHasClientName).length;
  return { rows: records, totalRows, validRows };
}

async function loadSheetJsParser() {
  if (window.XLSX && typeof window.XLSX.read === "function" && window.XLSX.utils?.sheet_to_json) {
    return window.XLSX;
  }

  if (!document) {
    throw new Error("SheetJS parser is unavailable in this environment.");
  }

  if (!loadSheetJsParser.promise) {
    loadSheetJsParser.promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "sheetjs-cdn";
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.async = true;
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => reject(new Error("Unable to load Excel parser library. Please check your network connection."));
      document.body.appendChild(script);
    });
  }

  const lib = await loadSheetJsParser.promise;
  if (!lib?.read) {
    throw new Error("Loaded SheetJS library is not available.");
  }
  return lib;
}

function parseXlsxRows(buffer) {
  return loadSheetJsParser()
    .then((XLSX) => {
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook?.SheetNames?.[0];
      if (!firstSheetName) {
        throw new Error("No worksheet found in the Excel file.");
      }
      const sheet = workbook.Sheets[firstSheetName];
      if (!sheet || !sheet["!ref"]) {
        throw new Error("The first worksheet is empty.");
      }
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error("The first worksheet is empty.");
      }
      const validRows = rows.filter(parseHasClientName).length;
      return { rows, totalRows: rows.length, validRows };
    });
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

function formatReviewRound(round) {
  const value = Number(round) || 1;
  const suffix = value % 10 === 1 && value % 100 !== 11 ? "st" : value % 10 === 2 && value % 100 !== 12 ? "nd" : value % 10 === 3 && value % 100 !== 13 ? "rd" : "th";
  return `${value}${suffix}`;
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
  if (type === "sent_for_review") return "Sent for Review";
  if (type === "resubmitted") return "Resubmitted";
  if (type === "need_more_info") return "Need More Info";
  if (type === "data_issue") return "Data Issue";
  return "Manager Alert";
}

function notificationAlertType(notification) {
  if (notification.type) return notification.type;
  const message = notification.message.toLowerCase();
  if (message.includes("uploaded")) return "documents_received";
  if (message.includes("review") || message.includes("resubmitted")) return "sent_for_review";
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
