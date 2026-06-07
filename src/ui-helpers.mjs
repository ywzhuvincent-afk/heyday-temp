export function createActionLocker(cooldownMs = 2000) {
  const locks = new Map();

  return {
    tryLock(key, timestamp = Date.now()) {
      const previous = locks.get(key);
      if (previous !== undefined && timestamp - previous < cooldownMs) {
        return false;
      }
      locks.set(key, timestamp);
      return true;
    },
    isLocked(key, timestamp = Date.now()) {
      const previous = locks.get(key);
      return previous !== undefined && timestamp - previous < cooldownMs;
    },
  };
}

export function filterReviewInboxByType(items, filter) {
  if (!filter || filter === "all") {
    return items;
  }
  return items.filter((item) => item.reviewType === filter);
}

export function filterAlertsByType(alerts, filter) {
  if (!filter || filter === "all") {
    return alerts;
  }
  return alerts.filter((alert) => alert.type === filter);
}

export function filterJobsByEmployeeStatus(jobs, filter) {
  if (!filter || filter === "all") {
    return jobs;
  }
  const statusGroups = {
    new_assigned: ["job_assigned"],
    in_progress: ["job_accepted", "in_progress"],
    revision_requested: ["revision_requested"],
    waiting_manager_review: ["job_completed"],
    closed_or_sent: ["final_package_approved", "reviewed_billed", "payment_received"],
  };
  const statuses = statusGroups[filter] ?? [];
  return jobs.filter((job) => statuses.includes(job.status));
}

export function fileSectionLabel(section) {
  const labels = {
    client_uploaded: "Client Uploaded",
    employee_work: "Employee Work Files",
    final_reports: "Final Reports",
    billing: "Billing",
  };
  return labels[section] ?? section;
}
