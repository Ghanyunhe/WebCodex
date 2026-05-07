const COLLAPSED_SESSION_COUNT = 2;

const ICONS = {
  refresh: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0 2 5.5" />
      <path d="M20 4v7h-7" />
    </svg>
  `,
  folder: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </svg>
  `,
  more: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  `,
  compose: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h8" />
      <path d="M16.5 4.5a2.1 2.1 0 1 1 3 3L8 19l-4 1 1-4z" />
    </svg>
  `,
  terminal: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 7 5 5-5 5" />
      <path d="M13 17h6" />
    </svg>
  `,
  chevronDown: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  `
};

const state = {
  token: localStorage.getItem("codex-web-token") || "dev-token",
  model: localStorage.getItem("codex-web-model") || "",
  reasoningEffort: localStorage.getItem("codex-web-reasoning-effort") || "",
  executionMode: localStorage.getItem("codex-web-execution-mode") || "",
  connected: false,
  connectionStatus: "disconnected",
  diagnostics: null,
  logsExpanded: false,
  diagnosticsTimer: 0,
  selectedProjectCwd: "",
  selectedProjectName: "",
  selectedSessionId: "",
  expandedProjects: new Set(),
  sidebar: { projects: [], totalSessionCount: 0 },
  modelOptions: [],
  reasoningEffortOptions: [],
  executionModeOptions: [],
  openPicker: "",
  busy: false
};

const els = {
  authForm: document.querySelector("#authForm"),
  token: document.querySelector("#token"),
  connectionStatus: document.querySelector("#connectionStatus"),
  connectionButton: document.querySelector("#connectionButton"),
  healthSummary: document.querySelector("#healthSummary"),
  healthMeta: document.querySelector("#healthMeta"),
  processMeta: document.querySelector("#processMeta"),
  activityMeta: document.querySelector("#activityMeta"),
  toggleLogs: document.querySelector("#toggleLogs"),
  logBody: document.querySelector("#logBody"),
  logEntries: document.querySelector("#logEntries"),
  sidebarTree: document.querySelector("#sidebarTree"),
  refreshSidebar: document.querySelector("#refreshSidebar"),
  terminalLink: document.querySelector("#terminalLink"),
  sessionKicker: document.querySelector("#sessionKicker"),
  sessionTitle: document.querySelector("#sessionTitle"),
  modelButton: document.querySelector("#modelButton"),
  modelMenu: document.querySelector("#modelMenu"),
  reasoningButton: document.querySelector("#reasoningButton"),
  reasoningMenu: document.querySelector("#reasoningMenu"),
  executionButton: document.querySelector("#executionButton"),
  executionMenu: document.querySelector("#executionMenu"),
  cwd: document.querySelector("#cwd"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send")
};

els.refreshSidebar.innerHTML = ICONS.refresh;
els.terminalLink.innerHTML = `${ICONS.terminal}<span>SSH</span>`;
els.token.value = state.token;
renderPickerButtons();
renderConnectionState();
renderDiagnostics();

void loadConfig();
void loadConnectionStatus();
renderEmptyChat("Connect to app-server to load projects and chat.");

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.token = els.token.value.trim();
  localStorage.setItem("codex-web-token", state.token);
  await loadConnectionStatus();
});

els.refreshSidebar.addEventListener("click", () => {
  if (state.connected) void loadSidebar();
});

els.connectionButton.addEventListener("click", async () => {
  if (state.connectionStatus === "connecting") return;
  if (state.connected) {
    await disconnectAppServer();
  } else {
    await connectAppServer();
  }
});

els.toggleLogs.addEventListener("click", () => {
  state.logsExpanded = !state.logsExpanded;
  renderDiagnostics();
});

els.modelButton.addEventListener("click", () => togglePicker("model"));
els.reasoningButton.addEventListener("click", () => togglePicker("reasoning"));
els.executionButton.addEventListener("click", () => togglePicker("execution"));

document.addEventListener("click", (event) => {
  if (!event.target.closest(".picker")) {
    closePicker();
  }
});

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  if (!state.connected) {
    showSystem("Connect to app-server before sending a message.");
    return;
  }

  const prompt = els.prompt.value.trim();
  if (!prompt) return;

  if (!state.selectedSessionId && !state.selectedProjectCwd && !els.cwd.value.trim()) {
    showSystem("Select a project before starting a new session.");
    return;
  }

  els.prompt.value = "";
  addMessage("user", prompt);
  await sendPrompt(prompt);
});

async function loadConfig() {
  const config = await api("/api/config").catch(() => ({}));
  if (config.defaultCwd) els.cwd.value = config.defaultCwd;
  state.modelOptions = config.modelOptions || [];
  state.reasoningEffortOptions = config.reasoningEffortOptions || [];
  state.executionModeOptions = config.executionModeOptions || [];
  if (!state.model && config.defaultModel) {
    state.model = String(config.defaultModel);
    localStorage.setItem("codex-web-model", state.model);
  }
  if (!state.reasoningEffort && config.defaultReasoningEffort) {
    state.reasoningEffort = String(config.defaultReasoningEffort);
    localStorage.setItem("codex-web-reasoning-effort", state.reasoningEffort);
  }
  if (!state.executionMode && config.defaultExecutionMode) {
    state.executionMode = String(config.defaultExecutionMode);
    localStorage.setItem("codex-web-execution-mode", state.executionMode);
  }
  renderPickerButtons();
  renderPickerMenus();
  updateComposerState();
  if (config.terminalUrl) {
    els.terminalLink.href = config.terminalUrl;
    els.terminalLink.hidden = false;
  }
}

async function loadConnectionStatus() {
  const status = await api("/api/connection/status").catch(() => null);
  if (!status) return;
  applyConnectionStatus(status);
  await loadDiagnostics();
  if (state.connected) {
    await loadSidebar();
  } else {
    renderSidebarDisconnected();
  }
}

async function connectAppServer() {
  state.connectionStatus = "connecting";
  renderConnectionState();
  try {
    const status = await post("/api/connection/connect");
    applyConnectionStatus(status);
    await loadDiagnostics();
    await loadSidebar();
  } catch (error) {
    state.connected = false;
    state.connectionStatus = "errored";
    renderConnectionState();
    renderSidebarError(error.message);
    renderEmptyChat("App-server failed to connect.");
  }
}

async function disconnectAppServer() {
  try {
    await post("/api/connection/disconnect");
  } finally {
    applyConnectionStatus({ status: "disconnected", connected: false });
    state.diagnostics = null;
    state.sidebar = { projects: [], totalSessionCount: 0 };
    state.selectedProjectCwd = "";
    state.selectedProjectName = "";
    state.selectedSessionId = "";
    els.sessionKicker.textContent = "Offline";
    els.sessionTitle.textContent = "Connect app-server";
    renderSidebarDisconnected();
    renderEmptyChat("Connect to app-server to load projects and chat.");
    renderDiagnostics();
  }
}

function applyConnectionStatus(status) {
  state.connected = Boolean(status.connected);
  state.connectionStatus = status.status || (state.connected ? "connected" : "disconnected");
  if (status.health) {
    state.diagnostics = {
      ...(state.diagnostics || {}),
      health: status.health,
      status: status.status
    };
  }
  if (status.defaultCwd && !state.selectedProjectCwd) {
    els.cwd.value = status.defaultCwd;
  }
  renderConnectionState();
  syncDiagnosticsPolling();
}

function renderConnectionState() {
  els.connectionStatus.textContent = connectionLabel(state.connectionStatus);
  els.connectionStatus.className = `connectionStatus ${state.connectionStatus}`;
  els.connectionButton.textContent = state.connected
    ? "Disconnect"
    : state.connectionStatus === "connecting"
      ? "Connecting..."
      : "Connect";
  els.connectionButton.disabled = state.connectionStatus === "connecting" || state.busy;
  updateComposerState();
}

async function loadDiagnostics() {
  const diagnostics = await api("/api/connection/diagnostics").catch(() => null);
  if (!diagnostics) return;
  state.diagnostics = diagnostics;
  renderDiagnostics();
}

function syncDiagnosticsPolling() {
  if (state.diagnosticsTimer) {
    window.clearInterval(state.diagnosticsTimer);
    state.diagnosticsTimer = 0;
  }
  if (!state.connected) return;
  state.diagnosticsTimer = window.setInterval(() => {
    void loadDiagnostics();
  }, 5000);
}

function renderDiagnostics() {
  const diagnostics = state.diagnostics;
  const healthLevel = diagnostics?.health?.level || (state.connected ? "healthy" : "offline");
  const healthSummary = diagnostics?.health?.summary || (state.connected ? "Connected" : "App-server is offline");
  const processText = diagnostics?.processId ? `PID ${diagnostics.processId}` : "Not running";
  const activityText = diagnostics?.lastActivityAt ? `Last activity ${formatTimestamp(diagnostics.lastActivityAt)}` : "No recent activity";

  els.healthSummary.textContent = titleCase(healthLevel);
  els.healthMeta.textContent = healthSummary;
  els.processMeta.textContent = processText;
  els.activityMeta.textContent = activityText;
  els.healthSummary.closest(".healthCard").dataset.health = healthLevel;
  els.processMeta.closest(".healthCard").dataset.health = healthLevel;

  els.toggleLogs.textContent = state.logsExpanded ? "Hide logs" : "Show logs";
  els.toggleLogs.setAttribute("aria-expanded", String(state.logsExpanded));
  els.logBody.hidden = !state.logsExpanded;

  const logs = diagnostics?.logs || [];
  if (!logs.length) {
    const empty = document.createElement("div");
    empty.className = "logEmpty";
    empty.textContent = "No app-server logs yet.";
    els.logEntries.replaceChildren(empty);
    return;
  }

  const entries = logs.slice().reverse().map((entry) => {
    const row = document.createElement("article");
    row.className = "logEntry";
    row.dataset.level = entry.level || "info";
    row.innerHTML = `
      <span class="logLevel"></span>
      <time class="logTime"></time>
      <div class="logMessage"></div>
    `;
    row.querySelector(".logLevel").textContent = entry.level || "info";
    row.querySelector(".logTime").textContent = formatTimestamp(entry.at);
    row.querySelector(".logMessage").textContent = entry.message || "";
    return row;
  });
  els.logEntries.replaceChildren(...entries);
}

function updateComposerState() {
  const disabled = !state.connected || state.busy;
  els.prompt.disabled = !state.connected;
  els.cwd.disabled = !state.connected;
  els.send.disabled = disabled;
  els.modelButton.disabled = disabled;
  els.reasoningButton.disabled = disabled;
  els.executionButton.disabled = disabled;
}

function renderPickerButtons() {
  els.reasoningButton.innerHTML = `${reasoningLabel(state.reasoningEffort || "medium")}${ICONS.chevronDown}`;
  els.modelButton.innerHTML = `${state.model || "gpt-5.4"}${ICONS.chevronDown}`;
  els.executionButton.innerHTML = `${executionModeLabel(state.executionMode || "workspace-write")}${ICONS.chevronDown}`;
}

function renderPickerMenus() {
  const reasoningItems = state.reasoningEffortOptions.map((value) =>
    buildMenuItem({
      text: reasoningLabel(value),
      selected: value === state.reasoningEffort,
      onSelect: () => {
        state.reasoningEffort = value;
        localStorage.setItem("codex-web-reasoning-effort", state.reasoningEffort);
        renderPickerButtons();
        renderPickerMenus();
        closePicker();
      }
    })
  );
  els.reasoningMenu.replaceChildren(...reasoningItems);

  const modelItems = state.modelOptions.map((value) =>
    buildMenuItem({
      text: value,
      selected: value === state.model,
      onSelect: () => {
        state.model = value;
        localStorage.setItem("codex-web-model", state.model);
        renderPickerButtons();
        renderPickerMenus();
        closePicker();
      }
    })
  );
  els.modelMenu.replaceChildren(...modelItems);

  const executionItems = state.executionModeOptions.map((value) =>
    buildMenuItem({
      text: executionModeLabel(value),
      selected: value === state.executionMode,
      onSelect: () => {
        state.executionMode = value;
        localStorage.setItem("codex-web-execution-mode", state.executionMode);
        renderPickerButtons();
        renderPickerMenus();
        closePicker();
      }
    })
  );
  els.executionMenu.replaceChildren(...executionItems);
}

function buildMenuItem({ text, selected, onSelect }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pickerOption${selected ? " selected" : ""}`;
  button.textContent = text;
  button.addEventListener("click", onSelect);
  return button;
}

function togglePicker(name) {
  if (!state.connected || state.busy) return;
  state.openPicker = state.openPicker === name ? "" : name;
  syncPickerVisibility();
}

function closePicker() {
  if (!state.openPicker) return;
  state.openPicker = "";
  syncPickerVisibility();
}

function syncPickerVisibility() {
  const reasoningOpen = state.openPicker === "reasoning";
  const modelOpen = state.openPicker === "model";
  const executionOpen = state.openPicker === "execution";
  els.reasoningMenu.hidden = !reasoningOpen;
  els.modelMenu.hidden = !modelOpen;
  els.executionMenu.hidden = !executionOpen;
  els.reasoningButton.setAttribute("aria-expanded", String(reasoningOpen));
  els.modelButton.setAttribute("aria-expanded", String(modelOpen));
  els.executionButton.setAttribute("aria-expanded", String(executionOpen));
}

function reasoningLabel(value) {
  const labels = {
    low: "低",
    medium: "中",
    high: "高",
    xhigh: "超高"
  };
  return labels[value] || value;
}

function executionModeLabel(value) {
  const labels = {
    "read-only": "只读",
    "workspace-write": "工作区写入",
    "danger-full-access": "完全访问"
  };
  return labels[value] || value;
}

async function loadSidebar() {
  if (!state.connected) {
    renderSidebarDisconnected();
    return;
  }

  const data = await api("/api/sidebar").catch((error) => {
    renderSidebarError(error.message);
    return null;
  });
  if (!data) return;

  state.sidebar = data;
  renderSidebar(data);
  syncSelectionFromSidebar();
  markActiveSession();
}

function renderSidebar(data) {
  const header = document.createElement("div");
  header.className = "sidebarSectionHeader";
  header.innerHTML = `
    <span>Projects</span>
    <span class="sidebarMeta">${data.projects.length} / ${data.totalSessionCount} sessions</span>
  `;

  const groups = data.projects.map(renderProjectGroup);
  els.sidebarTree.replaceChildren(header, ...groups);
}

function renderSidebarDisconnected() {
  const item = document.createElement("div");
  item.className = "sidebarError";
  item.textContent = "Connect to app-server to load projects.";
  els.sidebarTree.replaceChildren(item);
}

function renderSidebarError(message) {
  const item = document.createElement("div");
  item.className = "sidebarError";
  item.textContent = `Projects unavailable: ${message}`;
  els.sidebarTree.replaceChildren(item);
}

function renderProjectGroup(project) {
  const section = document.createElement("section");
  section.className = "projectGroup";
  section.dataset.cwd = project.cwd;

  const expanded = state.expandedProjects.has(project.cwd);
  const visibleSessions = expanded
    ? project.sessions
    : project.sessions.slice(0, COLLAPSED_SESSION_COUNT);

  const header = document.createElement("div");
  header.className = "projectHeader";
  header.innerHTML = `
    <button class="projectSelect" type="button">
      <span class="projectIcon">${ICONS.folder}</span>
      <span class="projectText">
        <span class="projectName"></span>
        <span class="projectSummary"></span>
      </span>
    </button>
    <div class="projectActions">
      <button class="iconButton moreButton" type="button" title="More project actions" aria-label="More project actions">${ICONS.more}</button>
      <button class="iconButton newSessionButton" type="button" aria-label="">${ICONS.compose}</button>
    </div>
  `;

  header.querySelector(".projectName").textContent = project.name;
  header.querySelector(".projectSummary").textContent = `${project.sessionCount} session${project.sessionCount === 1 ? "" : "s"}`;
  header.querySelector(".newSessionButton").title = `Start a new chat in ${project.name}`;
  header.querySelector(".newSessionButton").setAttribute("aria-label", `Start a new session in ${project.name}`);
  header.querySelector(".projectSelect").addEventListener("click", () => selectProject(project));
  header.querySelector(".newSessionButton").addEventListener("click", (event) => {
    event.stopPropagation();
    startNewSession(project);
  });

  const list = document.createElement("ol");
  list.className = "projectSessions";
  list.replaceChildren(...visibleSessions.map((session) => renderSessionRow(session, project)));

  section.append(header, list);

  if (project.sessions.length > COLLAPSED_SESSION_COUNT) {
    const toggle = document.createElement("button");
    toggle.className = "expandButton";
    toggle.type = "button";
    toggle.textContent = expanded
      ? `Collapse ${project.sessions.length - COLLAPSED_SESSION_COUNT} older sessions`
      : `Show ${project.sessions.length - COLLAPSED_SESSION_COUNT} more`;
    toggle.addEventListener("click", () => {
      if (expanded) {
        state.expandedProjects.delete(project.cwd);
      } else {
        state.expandedProjects.add(project.cwd);
      }
      renderSidebar(state.sidebar);
      markActiveSession();
    });
    section.append(toggle);
  }

  return section;
}

function renderSessionRow(session, project) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.className = "sessionRow";
  button.dataset.sessionId = session.id;
  button.type = "button";
  button.innerHTML = `
    <span class="sessionRowTitle"></span>
    <span class="sessionRowTime"></span>
  `;
  button.querySelector(".sessionRowTitle").textContent = session.title;
  button.querySelector(".sessionRowTime").textContent = relativeTime(session.updatedAt);
  button.addEventListener("click", async () => {
    const data = await api(`/api/sessions/${encodeURIComponent(session.id)}`);
    selectSession(project, session, data.messages);
  });
  item.append(button);
  return item;
}

function selectProject(project) {
  state.selectedProjectCwd = project.cwd;
  state.selectedProjectName = project.name;
  state.selectedSessionId = "";
  els.cwd.value = project.cwd;
  els.sessionKicker.textContent = project.name;
  els.sessionTitle.textContent = "Choose a session";
  renderEmptyChat("Select a session from the sidebar, or start a new chat for this project.");
  markActiveSession();
}

function startNewSession(project) {
  state.selectedProjectCwd = project.cwd;
  state.selectedProjectName = project.name;
  state.selectedSessionId = "";
  els.cwd.value = project.cwd;
  els.sessionKicker.textContent = project.name;
  els.sessionTitle.textContent = `New chat in ${project.name}`;
  renderEmptyChat("Your first message will create a new session in this project.");
  markActiveSession();
  els.prompt.focus();
}

function selectSession(project, session, messages) {
  state.selectedProjectCwd = project.cwd;
  state.selectedProjectName = project.name;
  state.selectedSessionId = session.id;
  els.cwd.value = project.cwd;
  els.sessionKicker.textContent = project.name;
  els.sessionTitle.textContent = session.title;
  els.messages.replaceChildren();

  if (!messages.length) {
    renderEmptyChat("This session has no visible user or assistant messages yet.");
  } else {
    for (const message of messages) addMessage(message.role, message.text);
  }

  markActiveSession();
}

function syncSelectionFromSidebar() {
  if (!state.selectedSessionId) return;

  for (const project of state.sidebar.projects) {
    const match = project.sessions.find((session) => session.id === state.selectedSessionId);
    if (!match) continue;
    state.selectedProjectCwd = project.cwd;
    state.selectedProjectName = project.name;
    els.cwd.value = project.cwd;
    els.sessionKicker.textContent = project.name;
    els.sessionTitle.textContent = match.title;
    return;
  }
}

function markActiveSession() {
  for (const group of els.sidebarTree.querySelectorAll(".projectGroup")) {
    group.classList.toggle("activeProject", group.dataset.cwd === state.selectedProjectCwd);
  }
  for (const button of els.sidebarTree.querySelectorAll(".sessionRow")) {
    button.classList.toggle("active", button.dataset.sessionId === state.selectedSessionId);
  }
}

async function sendPrompt(prompt) {
  state.busy = true;
  updateComposerState();
  els.connectionButton.disabled = true;
  els.send.textContent = "Sending...";
  const assistant = addMessage("assistant", "");
  const assistantBody = assistant.querySelector(".messageBody");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({
        prompt,
        sessionId: state.selectedSessionId,
        cwd: els.cwd.value.trim(),
        model: state.model.trim(),
        reasoningEffort: state.reasoningEffort.trim(),
        executionMode: state.executionMode.trim()
      })
    });

    if (!response.ok || !response.body) {
      throw new Error(await response.text());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const event of events) handleSse(event, assistantBody, assistant);
    }
  } catch (error) {
    assistant.classList.add("error");
    renderMessageContent(assistantBody, `${assistantBody.dataset.raw || ""}\n${error.message}`.trim());
  } finally {
    state.busy = false;
    els.connectionButton.disabled = false;
    els.send.textContent = "Send";
    renderConnectionState();
    if (state.connected) await loadSidebar();
    await loadDiagnostics();
  }
}

function handleSse(raw, assistantBody, assistant) {
  const eventLine = raw.split("\n").find((line) => line.startsWith("event: "));
  const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return;

  const eventName = eventLine ? eventLine.slice(7).trim() : "";
  const data = JSON.parse(dataLine.slice(6));

  if (eventName === "thread") {
    state.selectedSessionId = data.id || state.selectedSessionId;
    state.selectedProjectCwd = data.cwd || state.selectedProjectCwd;
    state.selectedProjectName = projectNameFromPath(state.selectedProjectCwd) || state.selectedProjectName;
    els.sessionKicker.textContent = state.selectedProjectName || "Thread";
    els.sessionTitle.textContent = data.title || "New chat";
    markActiveSession();
    return;
  }

  if (eventName === "warning") {
    addMessage("error", data.message || "");
    return;
  }

  if (eventName === "stderr") {
    addMessage("stderr", data.line || "");
    return;
  }

  if (eventName === "error") {
    assistant.classList.add("error");
    renderMessageContent(assistantBody, `${assistantBody.dataset.raw || ""}\n${data.message || ""}`.trim());
    return;
  }

  if (eventName === "delta") {
    const nextText = (assistantBody.dataset.raw || "") + (data.delta || "");
    renderMessageContent(assistantBody, nextText);
    assistantBody.parentElement.scrollIntoView({ block: "end" });
    return;
  }

  if (eventName === "message" && !assistantBody.dataset.raw) {
    renderMessageContent(assistantBody, data.text || "");
  }
}

async function api(path) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function post(path) {
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function addMessage(role, text) {
  if (els.messages.querySelector(".emptyState")) {
    els.messages.replaceChildren();
  }

  const message = document.createElement("article");
  message.className = `message ${role}`;

  const meta = document.createElement("div");
  meta.className = "messageMeta";
  meta.textContent = roleLabel(role);

  const body = document.createElement("div");
  body.className = "messageBody";
  renderMessageContent(body, text);

  message.append(meta, body);
  els.messages.append(message);
  message.scrollIntoView({ block: "end" });
  return message;
}

function renderEmptyChat(text) {
  els.messages.replaceChildren();
  const empty = document.createElement("section");
  empty.className = "emptyState";
  empty.innerHTML = `
    <div class="emptyStateBadge">Codex Remote</div>
    <h3>Ready when you are</h3>
    <p></p>
  `;
  empty.querySelector("p").textContent = text;
  els.messages.append(empty);
}

function showSystem(text) {
  addMessage("error", text);
}

function roleLabel(role) {
  if (role === "user") return "You";
  if (role === "assistant") return "Codex";
  if (role === "stderr") return "stderr";
  return "System";
}

function connectionLabel(status) {
  if (status === "connected") return "Connected";
  if (status === "connecting") return "Connecting";
  if (status === "errored") return "Error";
  return "Disconnected";
}

function relativeTime(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  const diff = Math.max(0, Date.now() - then);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < week) return `${Math.floor(diff / day)}d`;
  if (diff < month) return `${Math.floor(diff / week)}w`;
  return `${Math.floor(diff / month)}mo`;
}

function renderMessageContent(container, text) {
  container.dataset.raw = text;
  container.replaceChildren(...buildRichNodes(text));
}

function buildRichNodes(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const nodes = [];
  const lines = normalized.split("\n");
  let paragraphLines = [];
  let list = null;
  let codeBlock = null;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    nodes.push(renderParagraph(paragraphLines.join("\n")));
    paragraphLines = [];
  };

  const flushList = () => {
    if (!list) return;
    nodes.push(renderList(list.type, list.items));
    list = null;
  };

  const flushCodeBlock = () => {
    if (!codeBlock) return;
    nodes.push(renderCodeBlock(codeBlock.lines.join("\n"), codeBlock.language));
    codeBlock = null;
  };

  for (const line of lines) {
    if (codeBlock) {
      if (line.trimStart().startsWith("```")) {
        flushCodeBlock();
      } else {
        codeBlock.lines.push(line);
      }
      continue;
    }

    const fenceMatch = line.trimStart().match(/^```([A-Za-z0-9_+-]+)?\s*$/);
    if (fenceMatch) {
      flushParagraph();
      flushList();
      codeBlock = {
        language: fenceMatch[1] || "",
        lines: []
      };
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const type = unordered ? "ul" : "ol";
      const content = (unordered || ordered)[1];
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(content);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  flushCodeBlock();

  if (!nodes.length) {
    const empty = document.createElement("p");
    empty.append(document.createTextNode(""));
    nodes.push(empty);
  }

  return nodes;
}

function renderCodeBlock(source, language = "") {
  const wrapper = document.createElement("pre");
  wrapper.className = "codeBlock";
  if (language) wrapper.dataset.language = language;

  const code = document.createElement("code");
  code.textContent = source;
  wrapper.append(code);
  return wrapper;
}

function renderList(type, items) {
  const list = document.createElement(type);
  list.className = "messageList";
  for (const entry of items) {
    const item = document.createElement("li");
    item.append(...renderInlineTokens(entry));
    list.append(item);
  }
  return list;
}

function renderParagraph(source) {
  const paragraph = document.createElement("p");
  const lines = source.split("\n");

  lines.forEach((line, index) => {
    paragraph.append(...renderInlineTokens(line));
    if (index < lines.length - 1) paragraph.append(document.createElement("br"));
  });

  return paragraph;
}

function renderInlineTokens(text) {
  const nodes = [];
  const tokenPattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (match[1]) {
      const code = document.createElement("code");
      code.className = "inlineCode";
      code.textContent = normalizeInlineCode(match[1]);
      nodes.push(code);
    } else {
      const link = document.createElement("a");
      link.className = "messageLink";
      link.textContent = match[2];
      link.href = match[3];
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      nodes.push(link);
    }

    cursor = tokenPattern.lastIndex;
  }

  if (cursor < text.length) {
    nodes.push(document.createTextNode(text.slice(cursor)));
  }

  return nodes;
}

function normalizeInlineCode(text) {
  return text.replace(/^\s+/, "").replace(/\s+$/, "");
}

function projectNameFromPath(cwd) {
  return String(cwd || "").split(/[\\/]/).filter(Boolean).at(-1) || "";
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function titleCase(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
