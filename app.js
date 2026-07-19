let currentUser = null;
let currentProjectId = null;
let allUsers = [];
let currentTasks = [];

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  document.getElementById(pageId).classList.remove("hidden");
  if (pageId === "projects") loadProjects();
}

function switchAuthTab(tab) {
  document.getElementById("tabLogin").classList.toggle("active", tab === "login");
  document.getElementById("tabRegister").classList.toggle("active", tab === "register");
  document.getElementById("loginForm").classList.toggle("hidden", tab !== "login");
  document.getElementById("registerForm").classList.toggle("hidden", tab !== "register");
}

// ---------- Auth ----------
async function checkAuth() {
  const res = await fetch("/api/me");
  const data = await res.json();
  currentUser = data.user;
  renderAuthArea();
}

function renderAuthArea() {
  const area = document.getElementById("authArea");
  const newProjectBox = document.getElementById("newProjectBox");
  if (currentUser) {
    area.innerHTML = `<span>Hi, ${currentUser.name}</span> <button onclick="handleLogout()">Logout</button>`;
    newProjectBox.classList.remove("hidden");
  } else {
    area.innerHTML = `<button onclick="showPage('auth')">Login / Register</button>`;
    newProjectBox.classList.add("hidden");
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const res = await fetch("/api/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) { document.getElementById("loginError").textContent = data.error; return false; }
  currentUser = data.user;
  renderAuthArea();
  showPage("projects");
  return false;
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById("regName").value;
  const email = document.getElementById("regEmail").value;
  const password = document.getElementById("regPassword").value;
  const res = await fetch("/api/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password })
  });
  const data = await res.json();
  if (!res.ok) { document.getElementById("registerError").textContent = data.error; return false; }
  currentUser = data.user;
  renderAuthArea();
  showPage("projects");
  return false;
}

async function handleLogout() {
  await fetch("/api/logout", { method: "POST" });
  currentUser = null;
  renderAuthArea();
  showPage("projects");
}

// ---------- Projects ----------
async function loadProjects() {
  if (!currentUser) {
    document.getElementById("projectsList").innerHTML = "<p>Please login to view your projects.</p>";
    return;
  }
  const res = await fetch("/api/projects");
  const projects = await res.json();
  document.getElementById("projectsList").innerHTML =
    projects
      .map(
        (p) => `
      <div class="project-card" onclick="openProject(${p.id})">
        <h3>${p.name}</h3>
        <p>${p.description || ""}</p>
        <p class="meta">${p.taskCount} tasks &middot; ${p.memberIds.length} members</p>
      </div>`
      )
      .join("") || "<p>No projects yet. Create one above!</p>";
}

async function createProject() {
  const name = document.getElementById("newProjectName").value.trim();
  const description = document.getElementById("newProjectDesc").value.trim();
  if (!name) return;
  await fetch("/api/projects", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description })
  });
  document.getElementById("newProjectName").value = "";
  document.getElementById("newProjectDesc").value = "";
  loadProjects();
}

// ---------- Project board ----------
async function openProject(projectId) {
  currentProjectId = projectId;
  const res = await fetch(`/api/projects/${projectId}`);
  const project = await res.json();

  const usersRes = await fetch("/api/users");
  allUsers = await usersRes.json();

  document.getElementById("boardHeader").innerHTML = `
    <h2>${project.name}</h2>
    <p>${project.description || ""}</p>
    <p><strong>Members:</strong> ${project.members.map((m) => m.name).join(", ")}</p>
    <div>
      <select id="newMemberSelect">
        ${allUsers.map((u) => `<option value="${u.id}">${u.name}</option>`).join("")}
      </select>
      <button onclick="addMember()">Add Member</button>
    </div>
  `;

  const assigneeSelect = document.getElementById("newTaskAssignee");
  assigneeSelect.innerHTML =
    `<option value="">Unassigned</option>` +
    project.members.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");

  showPage("board");
  loadTasks();
}

async function addMember() {
  const userId = document.getElementById("newMemberSelect").value;
  await fetch(`/api/projects/${currentProjectId}/members`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId })
  });
  openProject(currentProjectId);
}

async function loadTasks() {
  const res = await fetch(`/api/projects/${currentProjectId}/tasks`);
  currentTasks = await res.json();
  renderColumns();
}

function renderColumns() {
  const cols = { "To Do": "col-todo", "In Progress": "col-inprogress", "Done": "col-done" };
  Object.values(cols).forEach((id) => (document.getElementById(id).innerHTML = ""));

  currentTasks.forEach((t) => {
    const colId = cols[t.status] || cols["To Do"];
    const el = document.createElement("div");
    el.className = "task-card";
    el.onclick = () => openTaskModal(t.id);
    el.innerHTML = `
      <h4>${t.title}</h4>
      <div class="assignee">${t.assigneeName ? "👤 " + t.assigneeName : "Unassigned"}</div>
      <div class="comment-count">💬 ${t.commentCount}</div>
    `;
    document.getElementById(colId).appendChild(el);
  });
}

async function createTask() {
  const title = document.getElementById("newTaskTitle").value.trim();
  const description = document.getElementById("newTaskDesc").value.trim();
  const assigneeId = document.getElementById("newTaskAssignee").value;
  if (!title) return;
  await fetch(`/api/projects/${currentProjectId}/tasks`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, assigneeId: assigneeId || null })
  });
  document.getElementById("newTaskTitle").value = "";
  document.getElementById("newTaskDesc").value = "";
  loadTasks();
}

// ---------- Task modal ----------
function openTaskModal(taskId) {
  const task = currentTasks.find((t) => t.id === taskId);
  const modal = document.getElementById("taskModal");
  const commentsHtml = task.comments
    ? task.comments.map((c) => `<div class="task-comment"><strong>${c.authorName}:</strong> ${c.text}</div>`).join("")
    : "";

  document.getElementById("taskModalContent").innerHTML = `
    <h2>${task.title}</h2>
    <p>${task.description || "No description."}</p>
    <p><strong>Assignee:</strong> ${task.assigneeName || "Unassigned"}</p>
    <label>Status:</label>
    <select class="status-select" id="statusSelect" onchange="updateTaskStatus(${task.id})">
      <option value="To Do" ${task.status === "To Do" ? "selected" : ""}>To Do</option>
      <option value="In Progress" ${task.status === "In Progress" ? "selected" : ""}>In Progress</option>
      <option value="Done" ${task.status === "Done" ? "selected" : ""}>Done</option>
    </select>
    <button onclick="deleteTask(${task.id})">Delete Task</button>

    <div class="task-comments">
      <h4>Comments</h4>
      ${commentsHtml || "<p>No comments yet.</p>"}
      <div class="comment-input-row">
        <input type="text" id="taskCommentInput" placeholder="Write a comment..." />
        <button onclick="addTaskComment(${task.id})">Send</button>
      </div>
    </div>
  `;
  modal.classList.remove("hidden");
}

function closeTaskModal() {
  document.getElementById("taskModal").classList.add("hidden");
  loadTasks();
}

async function updateTaskStatus(taskId) {
  const status = document.getElementById("statusSelect").value;
  await fetch(`/api/tasks/${taskId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  const res = await fetch(`/api/projects/${currentProjectId}/tasks`);
  currentTasks = await res.json();
  renderColumns();
}

async function deleteTask(taskId) {
  await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
  closeTaskModal();
}

async function addTaskComment(taskId) {
  const input = document.getElementById("taskCommentInput");
  const text = input.value.trim();
  if (!text) return;
  await fetch(`/api/tasks/${taskId}/comments`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const res = await fetch(`/api/projects/${currentProjectId}/tasks`);
  currentTasks = await res.json();
  openTaskModal(taskId);
}

// ---------- Init ----------
window.addEventListener("DOMContentLoaded", async () => {
  await checkAuth();
  showPage("projects");
});
