/**
 * CodeAlpha - Project Management Tool (Trello/Asana-style)
 * Backend: Express.js
 * Storage: In-memory (swap with MongoDB/Postgres for production)
 *
 * Features:
 *  - Auth system
 *  - Create group projects
 *  - Project boards + task cards
 *  - Assign tasks to users
 *  - Comment / communicate within tasks
 */

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.static(__dirname));
app.use(
  session({
    secret: "codealpha-pm-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 2 }
  })
);

// ---------- In-memory "database" ----------
const db = {
  users: [], // { id, name, email, passwordHash }
  projects: [], // { id, name, description, ownerId, memberIds: [], createdAt }
  tasks: [] // { id, projectId, title, description, status, assigneeId, comments: [{id, userId, text, createdAt}], createdAt }
};

let nextUserId = 1;
let nextProjectId = 1;
let nextTaskId = 1;
let nextCommentId = 1;

const TASK_STATUSES = ["To Do", "In Progress", "Done"];

// ---------- Middleware ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please login first." });
  next();
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email };
}

function requireProjectMember(req, res, next) {
  const project = db.projects.find((p) => p.id === parseInt(req.params.projectId || req.body.projectId));
  if (!project) return res.status(404).json({ error: "Project not found." });
  if (!project.memberIds.includes(req.session.userId)) {
    return res.status(403).json({ error: "You are not a member of this project." });
  }
  req.project = project;
  next();
}

// ---------- Auth ----------
app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "All fields required." });
  if (db.users.find((u) => u.email === email)) return res.status(400).json({ error: "Email already registered." });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: nextUserId++, name, email, passwordHash };
  db.users.push(user);
  req.session.userId = user.id;
  res.json({ message: "Registered.", user: publicUser(user) });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(400).json({ error: "Invalid credentials." });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: "Invalid credentials." });
  req.session.userId = user.id;
  res.json({ message: "Logged in.", user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out." }));
});

app.get("/api/me", (req, res) => {
  const user = db.users.find((u) => u.id === req.session.userId);
  res.json({ user: publicUser(user) });
});

// list all users (for adding as members / assigning tasks)
app.get("/api/users", requireAuth, (req, res) => {
  res.json(db.users.map(publicUser));
});

// ---------- Projects ----------
app.get("/api/projects", requireAuth, (req, res) => {
  const myProjects = db.projects.filter((p) => p.memberIds.includes(req.session.userId));
  res.json(
    myProjects.map((p) => ({
      ...p,
      taskCount: db.tasks.filter((t) => t.projectId === p.id).length
    }))
  );
});

app.post("/api/projects", requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Project name required." });
  const project = {
    id: nextProjectId++,
    name,
    description: description || "",
    ownerId: req.session.userId,
    memberIds: [req.session.userId],
    createdAt: new Date().toISOString()
  };
  db.projects.push(project);
  res.json({ message: "Project created.", project });
});

app.get("/api/projects/:projectId", requireAuth, requireProjectMember, (req, res) => {
  const members = req.project.memberIds.map((id) => publicUser(db.users.find((u) => u.id === id)));
  res.json({ ...req.project, members });
});

app.post("/api/projects/:projectId/members", requireAuth, requireProjectMember, (req, res) => {
  const { userId } = req.body;
  const targetId = parseInt(userId);
  if (!db.users.find((u) => u.id === targetId)) return res.status(404).json({ error: "User not found." });
  if (!req.project.memberIds.includes(targetId)) req.project.memberIds.push(targetId);
  res.json({ message: "Member added.", memberIds: req.project.memberIds });
});

// ---------- Tasks (task cards on boards) ----------
app.get("/api/projects/:projectId/tasks", requireAuth, requireProjectMember, (req, res) => {
  const tasks = db.tasks.filter((t) => t.projectId === req.project.id);
  const enriched = tasks.map((t) => ({
    ...t,
    assigneeName: t.assigneeId ? (db.users.find((u) => u.id === t.assigneeId) || {}).name : null,
    commentCount: t.comments.length
  }));
  res.json(enriched);
});

app.post("/api/projects/:projectId/tasks", requireAuth, requireProjectMember, (req, res) => {
  const { title, description, assigneeId } = req.body;
  if (!title) return res.status(400).json({ error: "Task title required." });
  const task = {
    id: nextTaskId++,
    projectId: req.project.id,
    title,
    description: description || "",
    status: "To Do",
    assigneeId: assigneeId ? parseInt(assigneeId) : null,
    comments: [],
    createdAt: new Date().toISOString()
  };
  db.tasks.push(task);
  res.json({ message: "Task created.", task });
});

app.put("/api/tasks/:taskId", requireAuth, (req, res) => {
  const task = db.tasks.find((t) => t.id === parseInt(req.params.taskId));
  if (!task) return res.status(404).json({ error: "Task not found." });
  const project = db.projects.find((p) => p.id === task.projectId);
  if (!project.memberIds.includes(req.session.userId)) return res.status(403).json({ error: "Not a project member." });

  const { title, description, status, assigneeId } = req.body;
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (status !== undefined && TASK_STATUSES.includes(status)) task.status = status;
  if (assigneeId !== undefined) task.assigneeId = assigneeId ? parseInt(assigneeId) : null;
  res.json({ message: "Task updated.", task });
});

app.delete("/api/tasks/:taskId", requireAuth, (req, res) => {
  const task = db.tasks.find((t) => t.id === parseInt(req.params.taskId));
  if (!task) return res.status(404).json({ error: "Task not found." });
  const project = db.projects.find((p) => p.id === task.projectId);
  if (!project.memberIds.includes(req.session.userId)) return res.status(403).json({ error: "Not a project member." });
  db.tasks = db.tasks.filter((t) => t.id !== task.id);
  res.json({ message: "Task deleted." });
});

// ---------- Task comments (communication within tasks) ----------
app.post("/api/tasks/:taskId/comments", requireAuth, (req, res) => {
  const task = db.tasks.find((t) => t.id === parseInt(req.params.taskId));
  if (!task) return res.status(404).json({ error: "Task not found." });
  const project = db.projects.find((p) => p.id === task.projectId);
  if (!project.memberIds.includes(req.session.userId)) return res.status(403).json({ error: "Not a project member." });

  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Comment text required." });
  const author = db.users.find((u) => u.id === req.session.userId);
  const comment = {
    id: nextCommentId++,
    userId: req.session.userId,
    authorName: author.name,
    text,
    createdAt: new Date().toISOString()
  };
  task.comments.push(comment);
  res.json({ message: "Comment added.", comment });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`CodeAlpha Project Management Tool running at http://localhost:${PORT}`);
});
