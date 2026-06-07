export const STATUS_LABELS = {
  new_client: "New Client",
  request_sent: "Request Sent",
  documents_received: "Documents Received",
  job_assigned: "Job Assigned",
  job_accepted: "Job Accepted",
  in_progress: "In Progress",
  sent_for_review: "Sent for Review",
  under_review: "Under Review",
  revision_required: "Revision Required",
  revision_in_progress: "Revision In Progress",
  resubmitted: "Resubmitted",
  approved: "Approved",
  reviewed_billed: "Reviewed & Billed",
  payment_received: "Payment Received / Job Closed",
  need_more_info: "Need More Info",
};

export const EVENT_LABELS = {
  ...STATUS_LABELS,
  client_updated: "Client Profile Updated",
  employee_files_uploaded: "Employee Files Uploaded",
  assignment_changed: "Assignment Changed",
  assignment_undone: "Assignment Undone",
};

export const FILE_SECTIONS = {
  client_uploaded: "Client Uploaded",
  employee_work: "Employee Work Files",
  final_reports: "Final Reports",
  billing: "Billing",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_WAITING_STATUSES = ["sent_for_review", "resubmitted"];
const REVIEW_ACTIVE_STATUSES = ["under_review"];
const FINALIZED_STATUSES = ["approved", "reviewed_billed", "payment_received"];
const EMPLOYEE_FILE_LOCKED_STATUSES = [...REVIEW_WAITING_STATUSES, ...REVIEW_ACTIVE_STATUSES, ...FINALIZED_STATUSES];
const LEGACY_STATUS_MAP = {
  job_completed: "sent_for_review",
  revision_requested: "revision_required",
  final_package_approved: "approved",
};

export function createInitialState() {
  return {
    organizations: {
      "org-heyday": {
        id: "org-heyday",
        name: "HEYDAY Accounting",
      },
    },
    users: {
      "user-manager": {
        id: "user-manager",
        organizationId: "org-heyday",
        name: "Mia Chen",
        email: "manager@heydayaccounting.com",
        role: "manager",
      },
      "user-amy": {
        id: "user-amy",
        organizationId: "org-heyday",
        name: "Amy Wong",
        email: "amy@heydayaccounting.com",
        role: "employee",
      },
      "user-ryan": {
        id: "user-ryan",
        organizationId: "org-heyday",
        name: "Ryan Lee",
        email: "ryan@heydayaccounting.com",
        role: "employee",
      },
    },
    clients: {
      "client-1": {
        id: "client-1",
        organizationId: "org-heyday",
        name: "Luna Cafe Ltd.",
        contactName: "Grace Lin",
        email: "grace@lunacafe.ca",
        phone: "(604) 555-0138",
        status: "documents_received",
        statusChangedAt: "2026-06-05T15:10:00.000Z",
        notes: "Corporate year-end file. Confirm GST filing before final package.",
      },
      "client-2": {
        id: "client-2",
        organizationId: "org-heyday",
        name: "Harbour Dental Inc.",
        contactName: "Dr. Nolan Hart",
        email: "office@harbourdental.ca",
        phone: "(778) 555-0184",
        status: "in_progress",
        statusChangedAt: "2026-06-03T09:20:00.000Z",
        notes: "Manager requested CRA follow-up.",
      },
      "client-3": {
        id: "client-3",
        organizationId: "org-heyday",
        name: "Maple Ridge Design",
        contactName: "Sofia Patel",
        email: "sofia@mapleridgedesign.ca",
        phone: "(236) 555-0111",
        status: "request_sent",
        statusChangedAt: "2026-06-01T10:30:00.000Z",
        notes: "Waiting for payroll summary and bank statements.",
      },
    },
    jobs: {
      "job-1": {
        id: "job-1",
        organizationId: "org-heyday",
        clientId: "client-1",
        title: "Year-end package",
        instructions: "",
        status: "documents_received",
        priority: "medium",
        dueDate: "2026-06-18",
        assignedTo: null,
        assignedBy: null,
        assignedAt: null,
        acceptedAt: null,
        startedAt: null,
        completedAt: null,
        reviewRound: 1,
      },
      "job-2": {
        id: "job-2",
        organizationId: "org-heyday",
        clientId: "client-2",
        title: "CRA follow-up",
        instructions: "CALL CRA and confirm payroll remittance balance.",
        status: "in_progress",
        priority: "high",
        dueDate: "2026-06-04",
        assignedTo: "user-amy",
        assignedBy: "user-manager",
        assignedAt: "2026-06-02T14:00:00.000Z",
        acceptedAt: "2026-06-02T14:20:00.000Z",
        startedAt: "2026-06-03T09:20:00.000Z",
        completedAt: null,
        reviewRound: 1,
      },
      "job-3": {
        id: "job-3",
        organizationId: "org-heyday",
        clientId: "client-3",
        title: "Document collection",
        instructions: "Collect missing source documents.",
        status: "request_sent",
        priority: "low",
        dueDate: "2026-06-20",
        assignedTo: null,
        assignedBy: null,
        assignedAt: null,
        acceptedAt: null,
        startedAt: null,
        completedAt: null,
        reviewRound: 1,
      },
    },
    events: [],
    files: [],
    uploadRequests: [],
    notifications: [],
    billingRecords: [],
  };
}

export function normalizeWorkflowState(state) {
  return {
    ...state,
    clients: mapRecords(state.clients ?? {}, (client) => ({
      ...client,
      status: normalizeStatus(client.status),
    })),
    jobs: mapRecords(state.jobs ?? {}, (job) => ({
      ...job,
      status: normalizeStatus(job.status),
      reviewRound: job.reviewRound ?? 1,
    })),
    events: (state.events ?? []).map((event) => ({
      ...event,
      status: normalizeStatus(event.status),
    })),
    notifications: (state.notifications ?? []).map((notification) => ({
      ...notification,
      type: notification.type ? normalizeStatus(notification.type) : notification.type,
    })),
  };
}

export function createClient(
  state,
  { organizationId, managerId, name, contactName, email, phone, notes = "", now },
) {
  requireManager(state, managerId);
  if (!state.organizations[organizationId]) {
    throw new Error("Organization not found");
  }
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  if (!trimmedName) {
    throw new Error("Client name is required");
  }
  if (!trimmedEmail) {
    throw new Error("Client email is required");
  }

  const clientId = nextRecordId("client", state.clients);
  const jobId = nextRecordId("job", state.jobs);
  const client = {
    id: clientId,
    organizationId,
    name: trimmedName,
    contactName: contactName.trim(),
    email: trimmedEmail,
    phone: phone.trim(),
    status: "new_client",
    statusChangedAt: now,
    notes: notes.trim(),
  };

  return appendEvent(
    {
      ...state,
      clients: {
        ...state.clients,
        [clientId]: client,
      },
      jobs: {
        ...state.jobs,
        [jobId]: {
          id: jobId,
          organizationId,
          clientId,
          title: "Document collection",
          instructions: "",
          status: "new_client",
          priority: "medium",
          dueDate: "",
          assignedTo: null,
          assignedBy: null,
          assignedAt: null,
          acceptedAt: null,
          startedAt: null,
          completedAt: null,
          reviewRound: 1,
        },
      },
    },
    {
      organizationId,
      clientId,
      jobId,
      status: "new_client",
      actorId: managerId,
      note: "Client profile created.",
      at: now,
    },
  );
}

export function updateClient(
  state,
  { clientId, managerId, name, contactName, email, phone, notes = "", now },
) {
  requireManager(state, managerId);
  const client = requireClient(state, clientId);
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  if (!trimmedName) {
    throw new Error("Client name is required");
  }
  if (!trimmedEmail) {
    throw new Error("Client email is required");
  }

  return appendEvent(
    {
      ...state,
      clients: updateRecord(state.clients, clientId, {
        name: trimmedName,
        contactName: contactName.trim(),
        email: trimmedEmail,
        phone: phone.trim(),
        notes: notes.trim(),
      }),
    },
    {
      organizationId: client.organizationId,
      clientId,
      jobId: getJobByClientId(state, clientId)?.id ?? null,
      status: "client_updated",
      actorId: managerId,
      note: "Client profile updated.",
      at: now,
    },
  );
}

export function requestDocuments(state, { clientId, managerId, now }) {
  requireManager(state, managerId);
  const client = requireClient(state, clientId);
  const job = getJobByClientId(state, clientId);
  const token = makeToken(clientId, now, state.uploadRequests.length + 1);
  const expiresAt = new Date(Date.parse(now) + 14 * DAY_MS).toISOString();

  return appendEvent(
    {
      ...state,
      clients: updateRecord(state.clients, clientId, {
        status: "request_sent",
        statusChangedAt: now,
      }),
      jobs: job
        ? updateRecord(state.jobs, job.id, {
            status: "request_sent",
          })
        : state.jobs,
      uploadRequests: [
        ...state.uploadRequests,
        {
          id: `upload-${state.uploadRequests.length + 1}`,
          organizationId: client.organizationId,
          clientId,
          token,
          purpose: "document_request",
          requestedBy: managerId,
          createdAt: now,
          expiresAt,
          usedAt: null,
        },
      ],
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "client",
          recipientId: clientId,
          message: `Document request email sent to ${client.email}`,
          createdAt: now,
          readAt: null,
        },
      ],
    },
    {
      organizationId: client.organizationId,
      clientId,
      jobId: job?.id ?? null,
      status: "request_sent",
      actorId: managerId,
      note: "Document request email sent.",
      at: now,
    },
  );
}

export function receiveUploadedDocuments(state, { token, now, files }) {
  const requestIndex = state.uploadRequests.findIndex((request) => request.token === token);
  if (requestIndex === -1) {
    throw new Error("Upload link not found");
  }

  const uploadRequest = state.uploadRequests[requestIndex];
  if (uploadRequest.usedAt) {
    throw new Error("Upload link already used");
  }

  if (Date.parse(now) > Date.parse(uploadRequest.expiresAt)) {
    throw new Error("Upload link expired");
  }

  const client = requireClient(state, uploadRequest.clientId);
  const job = getJobByClientId(state, client.id);
  const nextFiles = files.map((file, index) => ({
    id: `file-${state.files.length + index + 1}`,
    organizationId: client.organizationId,
    clientId: client.id,
    jobId: job?.id ?? null,
    section: "client_uploaded",
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedBy: "client",
    uploadedAt: now,
  }));
  const nextRequests = state.uploadRequests.map((request, index) =>
    index === requestIndex ? { ...request, usedAt: now } : request,
  );

  return appendEvent(
    {
      ...state,
      clients: updateRecord(state.clients, client.id, {
        status: "documents_received",
        statusChangedAt: now,
      }),
      jobs: job
        ? updateRecord(state.jobs, job.id, {
            status: "documents_received",
          })
        : state.jobs,
      uploadRequests: nextRequests,
      files: [...state.files, ...nextFiles],
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "role",
          recipientId: "manager",
          type: "documents_received",
          clientId: client.id,
          jobId: job?.id ?? null,
          message: `${client.name} uploaded ${files.length} file(s).`,
          createdAt: now,
          readAt: null,
        },
      ],
    },
    {
      organizationId: client.organizationId,
      clientId: client.id,
      jobId: job?.id ?? null,
      status: "documents_received",
      actorId: null,
      note: "Client uploaded requested documents.",
      at: now,
    },
  );
}

export function assignJob(
  state,
  { clientId, jobId, managerId, employeeId, instructions, dueDate, priority, now },
) {
  requireManager(state, managerId);
  requireEmployee(state, employeeId);
  const client = requireClient(state, clientId);
  const job = requireJob(state, jobId);
  if (job.clientId !== clientId) {
    throw new Error("Job does not belong to client");
  }
  if (job.assignedTo) {
    throw new Error("Job already assigned. Use Reassign or Undo Assignment.");
  }

  return appendEvent(
    {
      ...state,
      clients: updateRecord(state.clients, clientId, {
        status: "job_assigned",
        statusChangedAt: now,
      }),
      jobs: updateRecord(state.jobs, jobId, {
        instructions,
        status: "job_assigned",
        priority,
        dueDate,
        assignedTo: employeeId,
        assignedBy: managerId,
        assignedAt: now,
      }),
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "user",
          recipientId: employeeId,
          message: `New job assigned: ${client.name} - ${instructions}`,
          createdAt: now,
          readAt: null,
        },
      ],
    },
    {
      organizationId: client.organizationId,
      clientId,
      jobId,
      status: "job_assigned",
      actorId: managerId,
      note: `Assigned to ${state.users[employeeId].name}: ${instructions}`,
      at: now,
      previousStatus: client.status,
    },
  );
}

export function undoAssignment(state, { jobId, managerId, now }) {
  requireManager(state, managerId);
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  if (!job.assignedTo) {
    throw new Error("Job is not assigned");
  }
  const previousStatus = getPreviousAssignmentStatus(state, job, client);

  return appendEvent(
    {
      ...state,
      clients: updateRecord(state.clients, client.id, {
        status: previousStatus,
        statusChangedAt: now,
      }),
      jobs: updateRecord(state.jobs, jobId, {
        status: previousStatus,
        assignedTo: null,
        assignedBy: null,
        assignedAt: null,
        acceptedAt: null,
        startedAt: null,
      }),
    },
    {
      organizationId: client.organizationId,
      clientId: client.id,
      jobId,
      status: "assignment_undone",
      actorId: managerId,
      note: `Assignment undone. Job returned to ${STATUS_LABELS[previousStatus] ?? previousStatus}.`,
      at: now,
    },
  );
}

export function reassignJob(
  state,
  { jobId, managerId, employeeId, instructions, dueDate, priority, now },
) {
  requireManager(state, managerId);
  requireEmployee(state, employeeId);
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  if (!job.assignedTo) {
    throw new Error("Job is not assigned. Use Assign Job first.");
  }
  if (EMPLOYEE_FILE_LOCKED_STATUSES.includes(job.status)) {
    throw new Error("Submitted or closed jobs cannot be reassigned");
  }

  const previousEmployee = state.users[job.assignedTo]?.name ?? "Unassigned";
  const nextEmployee = state.users[employeeId].name;

  return appendEvent(
    {
      ...state,
      clients: updateRecord(state.clients, client.id, {
        status: "job_assigned",
        statusChangedAt: now,
      }),
      jobs: updateRecord(state.jobs, jobId, {
        instructions,
        status: "job_assigned",
        priority,
        dueDate,
        assignedTo: employeeId,
        assignedBy: managerId,
        assignedAt: now,
        acceptedAt: null,
        startedAt: null,
      }),
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "user",
          recipientId: employeeId,
          message: `Job reassigned: ${client.name} - ${instructions}`,
          createdAt: now,
          readAt: null,
        },
      ],
    },
    {
      organizationId: client.organizationId,
      clientId: client.id,
      jobId,
      status: "assignment_changed",
      actorId: managerId,
      note: `Assignment changed from ${previousEmployee} to ${nextEmployee}: ${instructions}`,
      at: now,
      previousStatus: job.status,
    },
  );
}

export function acceptJob(state, { jobId, employeeId, now }) {
  const job = requireAssignedJob(state, jobId, employeeId);
  const client = requireClient(state, job.clientId);

  return updateJobAndClient(state, {
    client,
    jobId,
    status: "job_accepted",
    actorId: employeeId,
    now,
    note: `${state.users[employeeId].name} accepted the job.`,
    jobPatch: { acceptedAt: now },
  });
}

export function startJob(state, { jobId, employeeId, now }) {
  const job = requireAssignedJob(state, jobId, employeeId);
  const client = requireClient(state, job.clientId);

  return updateJobAndClient(state, {
    client,
    jobId,
    status: "in_progress",
    actorId: employeeId,
    now,
    note: `${state.users[employeeId].name} started work.`,
    jobPatch: { startedAt: now },
  });
}

export function startRevision(state, { jobId, employeeId, now }) {
  const job = requireAssignedJob(state, jobId, employeeId);
  const client = requireClient(state, job.clientId);
  if (job.status !== "revision_required") {
    throw new Error("Job is not waiting for revision");
  }

  return updateJobAndClient(state, {
    client,
    jobId,
    status: "revision_in_progress",
    actorId: employeeId,
    now,
    note: `${state.users[employeeId].name} started the requested revision.`,
    jobPatch: { startedAt: now, revisionStartedAt: now },
  });
}

export function uploadEmployeeWorkFiles(state, { jobId, employeeId, now, files }) {
  const job = requireAssignedJob(state, jobId, employeeId);
  const client = requireClient(state, job.clientId);
  if (!files.length) {
    throw new Error("Upload at least one work file");
  }
  if (EMPLOYEE_FILE_LOCKED_STATUSES.includes(job.status)) {
    throw new Error("Submitted or closed jobs cannot accept new employee files");
  }

  const uploadedFiles = createEmployeeWorkFiles(state, {
    client,
    jobId,
    employeeId,
    files,
    now,
  });

  return appendEvent(
    {
      ...state,
      files: [...state.files, ...uploadedFiles],
    },
    {
      organizationId: client.organizationId,
      clientId: client.id,
      jobId,
      status: "employee_files_uploaded",
      actorId: employeeId,
      note: `${state.users[employeeId].name} uploaded ${files.length} work file(s).`,
      at: now,
    },
  );
}

export function completeJob(state, { jobId, employeeId, now, files }) {
  const job = requireAssignedJob(state, jobId, employeeId);
  const client = requireClient(state, job.clientId);
  const submittedFiles = files ?? [];
  const hasExistingEmployeeFiles = state.files.some((file) => file.jobId === jobId && file.section === "employee_work");
  if (!submittedFiles.length && !hasExistingEmployeeFiles) {
    throw new Error("Upload work files before submitting to manager review");
  }
  const completedFiles = createEmployeeWorkFiles(state, {
    client,
    jobId,
    employeeId,
    files: submittedFiles,
    now,
  });
  const isResubmission = job.status === "revision_in_progress";
  const nextReviewRound = isResubmission ? (job.reviewRound ?? 1) + 1 : (job.reviewRound ?? 1);
  const nextStatus = isResubmission ? "resubmitted" : "sent_for_review";
  const notificationType = isResubmission ? "resubmitted" : "sent_for_review";

  return updateJobAndClient(
    {
      ...state,
      files: [...state.files, ...completedFiles],
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "role",
          recipientId: "manager",
          type: notificationType,
          clientId: client.id,
          jobId,
          message: `${state.users[employeeId].name} ${isResubmission ? "resubmitted" : "sent"} ${client.name} for review.`,
          createdAt: now,
          readAt: null,
        },
      ],
    },
    {
      client,
      jobId,
      status: nextStatus,
      actorId: employeeId,
      now,
      note: `${state.users[employeeId].name} ${isResubmission ? "resubmitted the revision" : "sent the job"} for manager review.`,
      jobPatch: {
        completedAt: now,
        reviewRound: nextReviewRound,
        revisionCompletedAt: isResubmission ? now : job.revisionCompletedAt,
      },
    },
  );
}

export function startManagerReview(state, { jobId, managerId, now }) {
  requireManager(state, managerId);
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  if (!REVIEW_WAITING_STATUSES.includes(job.status)) {
    throw new Error("Job is not waiting for manager review");
  }

  const reviewRound = job.reviewRound ?? 1;
  return updateJobAndClient(state, {
    client,
    jobId,
    status: "under_review",
    actorId: managerId,
    now,
    note: `Manager started ${formatReviewRound(reviewRound)} review.`,
    jobPatch: { reviewRound, reviewStartedAt: now },
  });
}

export function returnToEmployee(state, { jobId, managerId, note, now }) {
  requireManager(state, managerId);
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  if (job.status !== "under_review") {
    throw new Error("Only work under review can be returned to an employee");
  }
  if (!job.assignedTo) {
    throw new Error("Job has no assigned employee to return to");
  }
  const revisionNote = note.trim() || "Revision requested by manager.";

  return updateJobAndClient(
    {
      ...state,
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "user",
          recipientId: job.assignedTo,
          type: "revision_required",
          clientId: client.id,
          jobId,
          message: `Revision requested: ${client.name} - ${revisionNote}`,
          createdAt: now,
          readAt: null,
        },
      ],
    },
    {
      client,
      jobId,
      status: "revision_required",
      actorId: managerId,
      now,
      note: `Returned to ${state.users[job.assignedTo].name}: ${revisionNote}`,
      jobPatch: { revisionNote, revisionRequestedAt: now },
    },
  );
}

export function approveFinalPackage(state, { jobId, managerId, now, files = [] }) {
  requireManager(state, managerId);
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  if (job.status !== "under_review") {
    throw new Error("Only work under review can be approved");
  }

  const existingFinalFiles = state.files.filter((file) => file.jobId === jobId && file.section === "final_reports");
  const defaultFiles = existingFinalFiles.length
    ? []
    : [
        {
          name: `${client.name} final package.pdf`,
          size: 512000,
          type: "application/pdf",
        },
      ];
  const finalFiles = [...defaultFiles, ...files].map((file, index) => ({
    id: `file-${state.files.length + index + 1}`,
    organizationId: client.organizationId,
    clientId: client.id,
    jobId,
    section: "final_reports",
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedBy: managerId,
    uploadedAt: now,
  }));

  return updateJobAndClient(
    {
      ...state,
      files: [...state.files, ...finalFiles],
    },
    {
      client,
      jobId,
      status: "approved",
      actorId: managerId,
      now,
      note: "Manager approved the reviewed work for final client delivery.",
      jobPatch: { finalPackageApprovedAt: now },
    },
  );
}

export function reviewAndBill(state, { jobId, managerId, invoiceNumber, amount, now }) {
  requireManager(state, managerId);
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  if (["reviewed_billed", "payment_received"].includes(job.status)) {
    throw new Error("Job already reviewed and billed");
  }
  if (job.status !== "approved") {
    throw new Error("Work must be approved before sending invoice");
  }
  if (state.billingRecords.some((record) => record.jobId === jobId)) {
    throw new Error("Job already reviewed and billed");
  }
  const invoiceFile = {
    id: `file-${state.files.length + 1}`,
    organizationId: client.organizationId,
    clientId: client.id,
    jobId,
    section: "billing",
    name: `${invoiceNumber}.pdf`,
    size: 128000,
    type: "application/pdf",
    uploadedBy: managerId,
    uploadedAt: now,
  };

  return updateJobAndClient(
    {
      ...state,
      files: [...state.files, invoiceFile],
      billingRecords: [
        ...state.billingRecords,
        {
          id: `billing-${state.billingRecords.length + 1}`,
          organizationId: client.organizationId,
          clientId: client.id,
          jobId,
          invoiceNumber,
          amount,
          currency: "CAD",
          sentAt: now,
          paidAt: null,
        },
      ],
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "client",
          recipientId: client.id,
          message: `Final report and invoice ${invoiceNumber} sent to ${client.email}.`,
          createdAt: now,
          readAt: null,
        },
      ],
    },
    {
      client,
      jobId,
      status: "reviewed_billed",
      actorId: managerId,
      now,
      note: `Reviewed and billed with invoice ${invoiceNumber}.`,
      jobPatch: {},
    },
  );
}

export function markPaymentReceived(state, { jobId, managerId, now }) {
  requireManager(state, managerId);
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  const billing = state.billingRecords.find((record) => record.jobId === jobId);
  if (!billing) {
    throw new Error("Job must be reviewed and billed before payment can be received");
  }
  if (job.status === "payment_received" || billing.paidAt) {
    throw new Error("Payment already received");
  }

  return updateJobAndClient(
    {
      ...state,
      billingRecords: state.billingRecords.map((record) =>
        record.jobId === jobId && !record.paidAt ? { ...record, paidAt: now } : record,
      ),
    },
    {
      client,
      jobId,
      status: "payment_received",
      actorId: managerId,
      now,
      note: "Payment received and recorded.",
      jobPatch: {},
    },
  );
}

export function needMoreInfo(state, { jobId, actorId, note, now }) {
  const job = requireJob(state, jobId);
  const client = requireClient(state, job.clientId);
  const alreadyNeedsInfo = job.status === "need_more_info" && client.status === "need_more_info";
  const activeMissingInfoRequest = state.uploadRequests.find(
    (request) =>
      request.clientId === client.id &&
      request.purpose === "missing_info" &&
      !request.usedAt &&
      Date.parse(now) <= Date.parse(request.expiresAt),
  );

  if (alreadyNeedsInfo && activeMissingInfoRequest) {
    return state;
  }

  const token = makeToken(client.id, now, state.uploadRequests.length + 1);
  const expiresAt = new Date(Date.parse(now) + 14 * DAY_MS).toISOString();

  return updateJobAndClient(
    {
      ...state,
      uploadRequests: [
        ...state.uploadRequests,
        {
          id: `upload-${state.uploadRequests.length + 1}`,
          organizationId: client.organizationId,
          clientId: client.id,
          token,
          purpose: "missing_info",
          requestedBy: actorId,
          createdAt: now,
          expiresAt,
          usedAt: null,
        },
      ],
      notifications: [
        ...state.notifications,
        {
          id: `notification-${state.notifications.length + 1}`,
          organizationId: client.organizationId,
          recipientType: "client",
          recipientId: client.id,
          message: `Missing information request email sent to ${client.email}`,
          createdAt: now,
          readAt: null,
        },
        {
          id: `notification-${state.notifications.length + 2}`,
          organizationId: client.organizationId,
          recipientType: "role",
          recipientId: "manager",
          type: "need_more_info",
          clientId: client.id,
          jobId,
          message: `${client.name}: ${note}`,
          createdAt: now,
          readAt: null,
          duplicateOf: alreadyNeedsInfo ? latestAlertKey(state, "need_more_info", client.id, jobId) : null,
        },
      ],
    },
    {
      client,
      jobId,
      status: "need_more_info",
      actorId,
      now,
      note,
      jobPatch: {},
    },
  );
}

export function getVisibleJobsForUser(state, userId) {
  const user = requireUser(state, userId);
  const jobs = Object.values(state.jobs).filter((job) => job.organizationId === user.organizationId);
  const visibleJobs = user.role === "manager" ? jobs : jobs.filter((job) => job.assignedTo === userId);
  return visibleJobs.map((job) => hydrateJob(state, job));
}

export function getManagerDashboard(state, organizationId, now) {
  const clients = Object.values(state.clients).filter((client) => client.organizationId === organizationId);
  const jobs = Object.values(state.jobs).filter((job) => job.organizationId === organizationId);
  const employees = Object.values(state.users).filter(
    (user) => user.organizationId === organizationId && user.role === "employee",
  );

  const statusCounts = clients.reduce((counts, client) => {
    counts[client.status] = (counts[client.status] ?? 0) + 1;
    return counts;
  }, {});

  const today = new Date(now);
  const overdueJobs = jobs
    .filter((job) => job.dueDate && !FINALIZED_STATUSES.includes(job.status))
    .filter((job) => new Date(`${job.dueDate}T23:59:59.999Z`) < today)
    .map((job) => hydrateJob(state, job));

  const workload = employees.map((employee) => ({
    userId: employee.id,
    name: employee.name,
    activeJobs: jobs.filter(
      (job) =>
        job.assignedTo === employee.id &&
        !FINALIZED_STATUSES.includes(job.status),
    ).length,
    completedJobs: jobs.filter((job) => job.assignedTo === employee.id && FINALIZED_STATUSES.includes(job.status)).length,
  }));

  return {
    totalClients: clients.length,
    statusCounts,
    overdueJobs,
    workload,
    recentEvents: state.events.slice(-8).reverse(),
  };
}

export function getReviewInbox(state, organizationId) {
  return Object.values(state.clients)
    .filter((client) => client.organizationId === organizationId)
    .filter((client) => ["documents_received", ...REVIEW_WAITING_STATUSES].includes(client.status))
    .map((client) => {
      const job = getJobByClientId(state, client.id);
      const reviewType = REVIEW_WAITING_STATUSES.includes(client.status) ? "completed_work" : "client_documents";
      const reviewSection = reviewType === "completed_work" ? "employee_work" : "client_uploaded";
      const reviewFiles = state.files.filter((file) => file.clientId === client.id && file.section === reviewSection);
      const latestUpload = reviewFiles
        .map((file) => file.uploadedAt)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

      return {
        clientId: client.id,
        jobId: job?.id ?? null,
        client,
        job,
        status: client.status,
        reviewType,
        reviewRound: job?.reviewRound ?? 1,
        fileCount: reviewFiles.length,
        uploadedAt: latestUpload ?? client.statusChangedAt,
      };
    })
    .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
}

export function getManagerAlerts(state, organizationId) {
  const roleNotifications = state.notifications
    .filter((notification) => notification.organizationId === organizationId)
    .filter((notification) => !notification.readAt)
    .filter((notification) => notification.recipientType === "role" && notification.recipientId === "manager")
    .map((notification) => ({
      id: notification.id,
      type: notification.type ?? inferAlertType(notification.message),
      clientId: notification.clientId ?? null,
      jobId: notification.jobId ?? null,
      message: notification.message,
      createdAt: notification.createdAt,
      repeatCount: 1,
    }));

  const dataIssues = Object.values(state.clients)
    .filter((client) => client.organizationId === organizationId)
    .filter((client) => client.status === "job_assigned")
    .map((client) => {
      const job = getJobByClientId(state, client.id);
      return { client, job };
    })
    .filter(({ job }) => job && !job.assignedTo)
    .map(({ client, job }) => ({
      id: `data-issue-${client.id}`,
      type: "data_issue",
      clientId: client.id,
      jobId: job.id,
      message: `${client.name} has assigned status without assigned staff.`,
      createdAt: client.statusChangedAt,
      repeatCount: 1,
    }));

  return dedupeAlerts([...roleNotifications, ...dataIssues]).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function searchClients(state, { organizationId, query = "", status = "all", employeeId = "all" }) {
  const normalized = query.trim().toLowerCase();
  return Object.values(state.clients)
    .filter((client) => client.organizationId === organizationId)
    .filter((client) => status === "all" || client.status === status)
    .filter((client) => {
      if (employeeId === "all") return true;
      const job = getJobByClientId(state, client.id);
      return job?.assignedTo === employeeId;
    })
    .filter((client) => {
      if (!normalized) return true;
      return [client.name, client.contactName, client.email, client.phone].some((value) =>
        value.toLowerCase().includes(normalized),
      );
    })
    .map((client) => ({
      ...client,
      job: getJobByClientId(state, client.id),
      searchScore: normalized ? clientSearchScore(client, normalized) : 0,
    }))
    .sort((a, b) => {
      if (!normalized) return Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt);
      if (a.searchScore !== b.searchScore) return a.searchScore - b.searchScore;
      return a.name.localeCompare(b.name);
    });
}

export function getTimelineDisplayEvents(state, clientId) {
  const events = state.events.filter((event) => event.clientId === clientId).slice().reverse();
  const collapsed = [];

  for (const event of events) {
    const previous = collapsed.at(-1);
    if (
      previous &&
      previous.status === event.status &&
      previous.jobId === event.jobId &&
      previous.note === event.note
    ) {
      previous.duplicateCount += 1;
      if (Date.parse(event.at) < Date.parse(previous.firstAt)) {
        previous.firstAt = event.at;
      }
    } else {
      collapsed.push({
        ...event,
        duplicateCount: 1,
        firstAt: event.at,
      });
    }
  }

  return collapsed;
}

export function hydrateJob(state, job) {
  return {
    ...job,
    client: state.clients[job.clientId],
    assignedEmployee: job.assignedTo ? state.users[job.assignedTo] : null,
    manager: job.assignedBy ? state.users[job.assignedBy] : null,
  };
}

function createEmployeeWorkFiles(state, { client, jobId, employeeId, files, now }) {
  return files.map((file, index) => ({
    id: `file-${state.files.length + index + 1}`,
    organizationId: client.organizationId,
    clientId: client.id,
    jobId,
    section: "employee_work",
    name: file.name,
    size: file.size,
    type: file.type,
    uploadedBy: employeeId,
    uploadedAt: now,
  }));
}

function updateJobAndClient(state, { client, jobId, status, actorId, now, note, jobPatch }) {
  return appendEvent(
    {
      ...state,
      clients: updateRecord(state.clients, client.id, {
        status,
        statusChangedAt: now,
      }),
      jobs: updateRecord(state.jobs, jobId, {
        status,
        ...jobPatch,
      }),
    },
    {
      organizationId: client.organizationId,
      clientId: client.id,
      jobId,
      status,
      actorId,
      note,
      at: now,
    },
  );
}

function appendEvent(state, event) {
  return {
    ...state,
    events: [
      ...state.events,
      {
        id: `event-${state.events.length + 1}`,
        ...event,
      },
    ],
  };
}

function updateRecord(records, id, patch) {
  return {
    ...records,
    [id]: {
      ...records[id],
      ...patch,
    },
  };
}

function mapRecords(records, mapper) {
  return Object.fromEntries(Object.entries(records).map(([id, record]) => [id, mapper(record)]));
}

function normalizeStatus(status) {
  return LEGACY_STATUS_MAP[status] ?? status;
}

function requireManager(state, userId) {
  const user = requireUser(state, userId);
  if (user.role !== "manager") {
    throw new Error("Manager access required");
  }
  return user;
}

function requireEmployee(state, userId) {
  const user = requireUser(state, userId);
  if (user.role !== "employee") {
    throw new Error("Employee access required");
  }
  return user;
}

function requireAssignedJob(state, jobId, employeeId) {
  requireEmployee(state, employeeId);
  const job = requireJob(state, jobId);
  if (job.assignedTo !== employeeId) {
    throw new Error("Job is not assigned to this employee");
  }
  return job;
}

function requireUser(state, userId) {
  const user = state.users[userId];
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

function requireClient(state, clientId) {
  const client = state.clients[clientId];
  if (!client) {
    throw new Error("Client not found");
  }
  return client;
}

function requireJob(state, jobId) {
  const job = state.jobs[jobId];
  if (!job) {
    throw new Error("Job not found");
  }
  return job;
}

function getPreviousAssignmentStatus(state, job, client) {
  const assignmentEvent = state.events
    .filter((event) => event.jobId === job.id)
    .filter((event) => ["job_assigned", "assignment_changed"].includes(event.status))
    .slice()
    .reverse()
    .find((event) => event.previousStatus);

  if (assignmentEvent?.previousStatus) {
    return assignmentEvent.previousStatus;
  }
  if (state.files.some((file) => file.clientId === client.id && file.section === "client_uploaded")) {
    return "documents_received";
  }
  if (state.uploadRequests.some((request) => request.clientId === client.id)) {
    return "request_sent";
  }
  return client.status === "documents_received" ? "documents_received" : "new_client";
}

function getJobByClientId(state, clientId) {
  return Object.values(state.jobs).find((job) => job.clientId === clientId) ?? null;
}

function dedupeAlerts(alerts) {
  const grouped = new Map();
  for (const alert of alerts) {
    const key = [alert.type, alert.clientId ?? "none", alert.jobId ?? "none"].join(":");
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, { ...alert, repeatCount: alert.repeatCount ?? 1 });
      continue;
    }

    const latest = Date.parse(alert.createdAt) >= Date.parse(previous.createdAt) ? alert : previous;
    grouped.set(key, {
      ...latest,
      repeatCount: (previous.repeatCount ?? 1) + (alert.repeatCount ?? 1),
    });
  }
  return Array.from(grouped.values());
}

function clientSearchScore(client, query) {
  const fields = [
    { value: client.name, weight: 0 },
    { value: client.contactName, weight: 1 },
    { value: client.email, weight: 2 },
    { value: client.phone, weight: 3 },
  ];

  return fields.reduce((best, field) => {
    const value = field.value.toLowerCase();
    const index = value.indexOf(query);
    if (index === -1) return best;
    const prefixPenalty = index === 0 ? 0 : 10 + index;
    return Math.min(best, field.weight * 20 + prefixPenalty);
  }, Number.MAX_SAFE_INTEGER);
}

function latestAlertKey(state, type, clientId, jobId) {
  const notification = state.notifications
    .filter((item) => item.type === type && item.clientId === clientId && item.jobId === jobId)
    .slice()
    .reverse()[0];
  return notification?.id ?? null;
}

function inferAlertType(message) {
  const normalized = message.toLowerCase();
  if (normalized.includes("uploaded")) return "documents_received";
  if (normalized.includes("review") || normalized.includes("resubmitted")) return "sent_for_review";
  if (normalized.includes("need") || normalized.includes("missing")) return "need_more_info";
  return "manager_alert";
}

function formatReviewRound(round) {
  const value = Number(round) || 1;
  const suffix = value % 10 === 1 && value % 100 !== 11 ? "st" : value % 10 === 2 && value % 100 !== 12 ? "nd" : value % 10 === 3 && value % 100 !== 13 ? "rd" : "th";
  return `${value}${suffix}`;
}

function nextRecordId(prefix, records) {
  const nextNumber =
    Object.keys(records).reduce((highest, id) => {
      const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1;
  return `${prefix}-${nextNumber}`;
}

function makeToken(clientId, now, sequence) {
  return Array.from(`${clientId}:${now}:${sequence}`)
    .map((char) => char.codePointAt(0).toString(36).padStart(2, "0"))
    .join("");
}
