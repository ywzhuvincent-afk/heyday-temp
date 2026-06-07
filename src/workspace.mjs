export const WORKSPACE_TABS = [
  { id: "profile", icon: "ID", label: "Profile" },
  { id: "request", icon: "@", label: "Request Email" },
  { id: "files", icon: "F", label: "Files" },
  { id: "review", icon: "OK", label: "Review" },
  { id: "assign", icon: "Team", label: "Assign" },
  { id: "final", icon: "Pack", label: "Final Package" },
  { id: "timeline", icon: "Time", label: "Timeline" },
  { id: "billing", icon: "$", label: "Billing" },
];

export function getWorkspaceTabForEntry(entry) {
  if (entry === "request_email") return "request";
  if (entry === "review_documents") return "review";
  return "profile";
}

export function getWorkspaceTabForAlert(type) {
  if (type === "documents_received") return "review";
  if (type === "job_completed") return "review";
  if (type === "need_more_info") return "timeline";
  if (type === "data_issue") return "timeline";
  return "profile";
}

export function isWorkspaceTab(tabId) {
  return WORKSPACE_TABS.some((tab) => tab.id === tabId);
}
