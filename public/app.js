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
  `
};

const state = {
  token: localStorage.getItem("codex-web-token") || "dev-token",
  selectedProjectCwd: "",
  selectedProjectName: "",
  selectedSessionId: "",
  expandedProjects: new Set(),
  sidebar: { projects: [], totalSessionCount: 0 },
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

els.refreshSidebar.innerHTML = ICONS.refresh;
els.terminalLink.innerHTML = `${ICONS.terminal}<span>SSH</span>`;
els.token.value = state.token;

void loadConfig();
void loadSidebar();
renderEmptyChat("Select a project or session to start.");

els.authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  state.token = els.token.value.trim();
  localStorage.setItem("codex-web-token", state.token);
  void loadSidebar();
});

els.refreshSidebar.addEventListener("click", () => {
  void loadSidebar();
});

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
  renderSidebar(data);
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
  els.send.textContent = "Sending...";
  const assistant = addMessage("assistant", "");
  const assistantBody = assistant.querySelector(".messageBody");
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
      for (const event of events) handleSse(event, assistantBody);
    }
  } catch (error) {
    assistant.classList.add("error");
    assistantBody.textContent += `\n${error.message}`;
  } finally {
    state.busy = false;
    els.send.disabled = false;
    els.send.textContent = "Send";
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

function handleSse(raw, assistantBody) {
  const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) return;
  const data = JSON.parse(dataLine.slice(6));
  if (data.stream === "stderr" || data.stream === "error") {
    addMessage(data.stream, data.line);
    return;
  }
  const nextText = (assistantBody.dataset.raw || "") + formatCodexLine(data.line);
  renderMessageContent(assistantBody, nextText);
  assistantBody.parentElement.scrollIntoView({ block: "end" });
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
