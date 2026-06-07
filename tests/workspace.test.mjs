import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WORKSPACE_TABS, getWorkspaceTabForAlert, getWorkspaceTabForEntry, isWorkspaceTab } from "../src/workspace.mjs";

describe("client workspace navigation", () => {
  it("opens profile when selecting a client from the client list", () => {
    assert.equal(getWorkspaceTabForEntry("client_list"), "profile");
  });

  it("opens review when manager clicks Review Documents", () => {
    assert.equal(getWorkspaceTabForEntry("review_documents"), "review");
  });

  it("opens request email when manager sends a request from the client list", () => {
    assert.equal(getWorkspaceTabForEntry("request_email"), "request");
  });

  it("routes manager alerts to the matching workspace page", () => {
    assert.equal(getWorkspaceTabForAlert("documents_received"), "review");
    assert.equal(getWorkspaceTabForAlert("sent_for_review"), "review");
    assert.equal(getWorkspaceTabForAlert("need_more_info"), "timeline");
    assert.equal(getWorkspaceTabForAlert("data_issue"), "timeline");
    assert.equal(getWorkspaceTabForAlert("manager_alert"), "profile");
  });

  it("keeps final package before billing in the workspace flow", () => {
    assert.equal(isWorkspaceTab("final"), true);
    assert.deepEqual(
      WORKSPACE_TABS.map((tab) => tab.id).slice(-3),
      ["final", "timeline", "billing"],
    );
  });
});
