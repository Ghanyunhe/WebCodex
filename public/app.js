const COLLAPSED_SESSION_COUNT = 2;

const state = {
  token: localStorage.getItem("codex-web-token") || "dev-token",
  selectedProjectCwd: "",
  selectedProjectName: "",
  selectedSessionId: "",
  expandedProjects: new Set(),
  sidebar: { projects: [] },
  busy: false
};

const els = {
  authForm: document.querySelector("#authForm"),
  token: document.querySelector("#token"),
  sidebarTree: document.querySelector("#sidebarTree"),
  refreshSidebar: document.querySelector("#refreshSidebar"),
  terminalLink: document.querySelector("#terminalLink"),
  sessionKicker: document.querySelector("#sessionKicker"),
  sessionTitle: document.querySelector("#sessionTitle"),
  cwd: document.querySelector("#cwd"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send")
};

els.token.value = state.token;
void loadConfig();
void loadSidebar();

els.authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.token = els.token.value.trim();
  localStorage.setItem("codex-web-token", state.token);
  void loadSidebar();
});

els.refreshSidebar.addEventListener("click", () => loadSidebar());

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;

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
  if (config.terminalUrl) {
    els.terminalLink.href = config.terminalUrl;
    els.terminalLink.hidden = false;
  }
}

async function loadSidebar() {
  const data = await api("/api/sidebar").catch((error) => {
    renderSidebarError(error.message);
    return null;
  });
  if (!data) return;

  state.sidebar = data;
  els.sidebarTree.replaceChildren(...data.projects.map(renderProjectGroup));
  markActiveSession();
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

  const header = document.createElement("div");
  header.className = "projectHeader";
  header.innerHTML = `
    <button class="projectSelect" type="button">
      <span class="folderIcon" aria-hidden="true"></span>
      <span class="projectName"></span>
    </button>
    <div class="projectActions">
      <button class="iconButton moreButton" type="button" title="More project actions" aria-label="More project actions">...</button>
      <button class="iconButton newSessionButton" type="button" aria-label=""></button>
    </div>
  `;

  header.querySelector(".projectName").textContent = project.name;
  header.querySelector(".newSessionButton").title = `Start a new chat in ${project.name}`;
  header.querySelector(".newSessionButton").setAttribute("aria-label", `Start a new session in ${project.name}`);
  header.querySelector(".projectSelect").addEventListener("click", () => selectProject(project));
  header.querySelector(".newSessionButton").addEventListener("click", (event) => {
    event.stopPropagation();
    startNewSession(project);
  });

  const list = document.createElement("ol");
  list.className = "projectSessions";
  const expanded = state.expandedProjects.has(project.cwd);
  const visibleSessions = expanded ? project.sessions : project.sessions.slice(0, COLLAPSED_SESSION_COUNT);
  list.replaceChildren(...visibleSessions.map((session) => renderSessionRow(session, project)));

  section.append(header, list);

  if (project.sessions.length > COLLAPSED_SESSION_COUNT) {
    const toggle = document.createElement("button");
  toggle.className = "expandButton";
  toggle.type = "button";
  toggle.textContent = expanded ? "Collapse" : "Show more";
    toggle.addEventListener("click", () => {
      if (expanded) {
        state.expandedProjects.delete(project.cwd);
      } else {
        state.expandedProjects.add(project.cwd);
      }
      els.sidebarTree.replaceChildren(...state.sidebar.projects.map(renderProjectGroup));
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
  els.sessionTitle.textContent = "选择一个 session";
  els.messages.replaceChildren();
  markActiveSession();
}

function startNewSession(project) {
  state.selectedProjectCwd = project.cwd;
  state.selectedProjectName = project.name;
  state.selectedSessionId = "";
  els.cwd.value = project.cwd;
  els.sessionKicker.textContent = project.cwd;
  els.sessionTitle.textContent = `New chat in ${project.name}`;
  els.messages.replaceChildren();
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
  for (const message of messages) addMessage(message.role, message.text);
  markActiveSession();
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
  els.send.disabled = true;
  const assistant = addMessage("assistant", "");
  const wasDraftSession = !state.selectedSessionId;
  const draftProjectCwd = state.selectedProjectCwd || els.cwd.value.trim();

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
        cwd: els.cwd.value.trim()
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
      for (const event of events) handleSse(event, assistant);
    }
  } catch (error) {
    assistant.classList.add("error");
    assistant.textContent += `\n${error.message}`;
  } finally {
    state.busy = false;
    els.send.disabled = false;
    await loadSidebar();
    if (wasDraftSession && draftProjectCwd) {
      selectNewestSessionForProject(draftProjectCwd);
    }
  }
}

function selectNewestSessionForProject(cwd) {
  const project = state.sidebar.projects.find((item) => item.cwd === cwd);
  const newest = project?.sessions?.[0];
  if (!project || !newest) return;
  state.selectedProjectCwd = project.cwd;
  state.selectedProjectName = project.name;
  state.selectedSessionId = newest.id;
  els.sessionKicker.textContent = project.name;
  els.sessionTitle.textContent = newest.title;
  markActiveSession();
}

function handleSse(raw, assistant) {
  const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return;
  const data = JSON.parse(dataLine.slice(6));
  if (data.stream === "stderr" || data.stream === "error") {
    addMessage(data.stream, data.line);
    return;
  }
  assistant.textContent += formatCodexLine(data.line);
  assistant.scrollIntoView({ block: "end" });
}

function formatCodexLine(line) {
  try {
    const event = JSON.parse(line);
    const text = event?.payload?.content?.[0]?.text
      || event?.payload?.message
      || event?.payload?.text
      || "";
    return text ? `${text}\n` : `${line}\n`;
  } catch {
    return `${line}\n`;
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

function addMessage(role, text) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.textContent = text;
  els.messages.append(message);
  message.scrollIntoView({ block: "end" });
  return message;
}

function showSystem(text) {
  addMessage("error", text);
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
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分`;
  if (diff < day) return `${Math.floor(diff / hour)} 时`;
  if (diff < week) return `${Math.floor(diff / day)} 天`;
  if (diff < month) return `${Math.floor(diff / week)} 周`;
  return `${Math.floor(diff / month)} 个月`;
}
