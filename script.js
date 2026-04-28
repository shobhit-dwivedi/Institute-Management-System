/* ============================================================
   Tuition Manager — Vanilla JS SaaS app
   Talks to Google Apps Script Web App via fetch
   ============================================================ */

const API_URL =
  "https://script.google.com/macros/s/AKfycbyVVfmyBFqf2_VrJVwTV_mkjL-pVXLtN1x78uzW-pdkY2Bb4TOk7omVdtHL3nAZKtOH/exec";

const STORAGE_KEY = "tm_session_v1";

/* ============================================================
   APP STATE
   ============================================================ */
const state = {
  user: null,             // { username, name, role, institute }
  page: "dashboard",
  sidebarOpen: false,

  // Cached lists (per institute, per session)
  students: [],
  teachers: [],
  attendance: [],
  marks: [],
  fees: [],
  homework: [],
  notes: [],

  // Loading flags
  loading: false,
};

/* ============================================================
   API HELPERS
   ============================================================ */

/**
 * Generic POST to Apps Script.
 * Apps Script web apps don't accept custom headers from browsers without
 * triggering CORS preflight, so we send body as text/plain.
 */
async function apiCall(action, payload = {}) {
  const body = JSON.stringify({
    action,
    institute: state.user?.institute || payload.institute || "",
    ...payload,
  });

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow",
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Server did not return JSON");
    }

    if (data && data.success === false) {
      throw new Error(data.error || data.message || "Request failed");
    }
    return data;
  } catch (err) {
    console.error(`[API ${action}]`, err);
    throw err;
  }
}

/* ============================================================
   SESSION
   ============================================================ */
function saveSession(user) {
  state.user = user;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSession() {
  state.user = null;
  localStorage.removeItem(STORAGE_KEY);
}

/* ============================================================
   UI HELPERS
   ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function showLoader(show = true) {
  $("#loader-root").classList.toggle("hidden", !show);
}

function toast(message, type = "info", duration = 3000) {
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add("fade-out");
    setTimeout(() => el.remove(), 250);
  }, duration);
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  btn.classList.toggle("is-loading", loading);
  btn.disabled = loading;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function formatDate(d) {
  if (!d) return "";
  try {
    let date;
    const s = String(d);
    // Parse "YYYY-MM-DD" as a LOCAL date (not UTC). new Date("2026-04-28")
    // is parsed as UTC midnight, which renders as the previous day in any
    // timezone west of UTC. Constructing it from parts keeps the calendar
    // day stable everywhere.
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      date = new Date(s);
    }
    if (isNaN(date.getTime())) return s;
    return date.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return d;
  }
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal({ title, body, onMount }) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal-root").classList.remove("hidden");
  if (typeof onMount === "function") onMount($("#modal-body"));
}
function closeModal() {
  $("#modal-root").classList.add("hidden");
  $("#modal-body").innerHTML = "";
}
$("#modal-root").addEventListener("click", (e) => {
  if (e.target.matches("[data-close]")) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* ============================================================
   AUTH UI
   ============================================================ */
function bindAuth() {
  // Tab switching
  $$(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const isLogin = tab.dataset.tab === "login";
      $("#login-form").classList.toggle("hidden", !isLogin);
      $("#register-form").classList.toggle("hidden", isLogin);
      $("#login-msg").textContent = "";
      $("#register-msg").textContent = "";
    });
  });

  // Login submit (role is determined by the server)
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#login-username").value.trim();
    const password = $("#login-password").value;
    const btn = e.target.querySelector("button[type=submit]");
    const msg = $("#login-msg");
    msg.textContent = ""; msg.className = "auth-foot-msg";

    if (!username || !password) {
      msg.textContent = "Please fill in username and password.";
      msg.classList.add("is-error");
      return;
    }

    setBtnLoading(btn, true);
    try {
      const res = await apiCall("login", { username, password });
      const user = res.user || res.data || res;
      if (!user || !user.username) throw new Error("Invalid response from server");
      saveSession({
        username: user.username,
        name: user.name || user.username,
        role: String(user.role || "teacher").toLowerCase(),
        institute: user.institute,
        email: user.email || "",
      });
      msg.textContent = "Welcome back!";
      msg.classList.add("is-ok");
      setTimeout(() => mountApp(), 300);
    } catch (err) {
      msg.textContent = err.message || "Sign in failed.";
      msg.classList.add("is-error");
    } finally {
      setBtnLoading(btn, false);
    }
  });

  // Register submit (institute owner only)
  $("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#reg-name").value.trim();
    const email = $("#reg-email").value.trim();
    const username = $("#reg-username").value.trim();
    const password = $("#reg-password").value;
    const institute = $("#reg-institute").value.trim();
    const btn = e.target.querySelector("button[type=submit]");
    const msg = $("#register-msg");
    msg.textContent = ""; msg.className = "auth-foot-msg";

    if (!name || !email || !username || !password || !institute) {
      msg.textContent = "Please fill in every field.";
      msg.classList.add("is-error");
      return;
    }

    setBtnLoading(btn, true);
    try {
      const res = await apiCall("register", {
        name, email, username, password, institute, role: "owner",
      });
      const user = res.user || res.data || res;
      saveSession({
        username: user.username || username,
        name: user.name || name,
        role: String(user.role || "owner").toLowerCase(),
        institute: user.institute || institute,
        email: user.email || email,
      });
      msg.textContent = "Institute created!";
      msg.classList.add("is-ok");
      setTimeout(() => mountApp(), 300);
    } catch (err) {
      msg.textContent = err.message || "Could not create account.";
      msg.classList.add("is-error");
    } finally {
      setBtnLoading(btn, false);
    }
  });
}

/* ============================================================
   ROLE HELPERS
   ============================================================ */
function isStaff() {
  const r = String(state.user?.role || "").toLowerCase();
  return r === "owner" || r === "coowner" || r === "teacher";
}
function isOwnerLike() {
  const r = String(state.user?.role || "").toLowerCase();
  return r === "owner" || r === "coowner";
}
function isStudent() {
  return String(state.user?.role || "").toLowerCase() === "student";
}
function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "owner")    return "Owner";
  if (r === "coowner")  return "Co-owner";
  if (r === "teacher")  return "Teacher";
  if (r === "student")  return "Student";
  return r || "—";
}

/* ============================================================
   PREWRITTEN REMARKS (positive + negative)
   Used by the Notes modal.
   ============================================================ */
const POSITIVE_REMARKS = [
  "Excellent performance",
  "Very good writing",
  "Great improvement shown",
  "Active participation in class",
  "Top of the class today",
  "Helpful to classmates",
  "Asks insightful questions",
  "Excellent presentation skills",
  "Consistent hard work",
  "Showed great creativity",
  "Punctual and well-prepared",
  "Demonstrates curiosity to learn",
  "Polite and well-mannered",
  "Excellent problem-solving",
  "Confident speaker",
  "Beautiful handwriting",
  "Pays attention to details",
  "Quick learner",
  "Works well in groups",
  "Volunteers eagerly",
  "Sets a positive example",
  "Great team player",
  "Listens attentively",
  "Shows perseverance",
  "Strong analytical thinking",
  "Maintains a positive attitude",
  "Thoughtful and considerate",
  "Outstanding effort today",
];

const NEGATIVE_REMARKS = [
  "Late arrival",
  "Homework not completed",
  "Needs to focus more in class",
  "Disturbed others during the lesson",
  "Did not participate",
  "Forgot required materials",
  "Frequent absences",
  "Needs help with revision",
  "Incomplete classwork",
  "Talks excessively in class",
  "Untidy work submitted",
  "Avoids participation",
  "Distracted during the lesson",
  "Did not follow instructions",
  "Needs to improve punctuality",
  "Lacks attention to detail",
  "Struggling with the topic",
  "Needs more practice",
  "Did not bring notebook",
  "Reluctant to ask for help",
  "Needs to be more organised",
  "Submitted assignment late",
  "Slow with assignments",
  "Inconsistent effort",
  "Poor test preparation",
  "Needs improvement in spelling",
  "Hesitant to speak up",
  "Needs encouragement to try harder",
];

/* ============================================================
   APP NAVIGATION
   ============================================================ */
const TEACHER_NAV = [
  { id: "dashboard",  label: "Dashboard",  title: "Dashboard",   sub: "Overview of what's happening in your institute.", icon: "grid" },
  { id: "students",   label: "Students",   title: "Students",    sub: "Add, view and manage every student in your institute.", icon: "users" },
  { id: "attendance", label: "Attendance", title: "Attendance",  sub: "Mark daily attendance in seconds.", icon: "calendar-check" },
  { id: "marks",      label: "Marks",      title: "Marks",       sub: "Record and review test scores.", icon: "award" },
  { id: "fees",       label: "Fees",       title: "Fees & Reminders", sub: "Track payments and send reminders.", icon: "wallet" },
  { id: "homework",   label: "Homework",   title: "Homework",    sub: "Assign and review homework.", icon: "book" },
  { id: "notes",      label: "Notes",      title: "Anecdotal Notes", sub: "Capture observations about students.", icon: "edit" },
  { id: "teachers",   label: "Teachers",   title: "Team",        sub: "Manage other teachers in your institute.", icon: "user-plus" },
];

const STUDENT_NAV = [
  { id: "dashboard",   label: "Dashboard",  title: "Dashboard",       sub: "Your learning at a glance.", icon: "grid" },
  { id: "profile",     label: "My Profile", title: "My Profile",      sub: "Your account information.", icon: "user" },
  { id: "attendance",  label: "Attendance", title: "My Attendance",   sub: "Your attendance history.", icon: "calendar-check" },
  { id: "marks",       label: "Marks",      title: "My Marks",        sub: "Your scores and progress.", icon: "award" },
  { id: "fees",        label: "Fees",       title: "Fee Status",      sub: "Your fee payments and dues.", icon: "wallet" },
  { id: "homework",    label: "Homework",   title: "My Homework",     sub: "Assignments from your teachers.", icon: "book" },
  { id: "notes",       label: "Notes",      title: "Teacher Notes",   sub: "Notes your teachers have written about you.", icon: "edit" },
];

const ICONS = {
  grid: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  users: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  "calendar-check": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></svg>',
  award: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><polyline points="8.21 13.89 7 22 12 19 17 22 15.79 13.88"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  "user-plus": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
};

/* ============================================================
   APP MOUNT
   ============================================================ */
function mountApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");

  // Profile section
  $("#profile-name").textContent = state.user.name || state.user.username;
  $("#profile-role").textContent = roleLabel(state.user.role);
  $("#profile-inst-tag").textContent = "· " + (state.user.institute || "");
  $("#profile-avatar").textContent = initials(state.user.name || state.user.username);
  $("#sb-institute").textContent = state.user.institute || "Institute";

  // Hide search for students (no list to search)
  if (state.user.role === "student") {
    $(".search-box").style.display = "none";
  } else {
    $(".search-box").style.display = "";
  }

  buildNav();
  go("dashboard");
}

function buildNav() {
  const nav = $("#nav-menu");
  nav.innerHTML = "";

  const items = isStaff() ? TEACHER_NAV : STUDENT_NAV;
  const sectionTitle = document.createElement("div");
  sectionTitle.className = "nav-section-title";
  sectionTitle.textContent = "Workspace";
  nav.appendChild(sectionTitle);

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "nav-link";
    btn.dataset.page = item.id;
    btn.innerHTML = `${ICONS[item.icon] || ""}<span>${escapeHtml(item.label)}</span>`;
    btn.addEventListener("click", () => go(item.id));
    nav.appendChild(btn);
  });
}

function go(pageId) {
  state.page = pageId;
  const items = isStaff() ? TEACHER_NAV : STUDENT_NAV;
  const meta = items.find((i) => i.id === pageId) || items[0];

  $("#page-title").textContent = meta.title;
  $("#page-sub").textContent = meta.sub;

  $$(".nav-link").forEach((l) => {
    l.classList.toggle("active", l.dataset.page === pageId);
  });

  // Close mobile sidebar
  $("#sidebar").classList.remove("is-open");
  state.sidebarOpen = false;

  renderPage(pageId);
}

/* ============================================================
   DATA FETCH WRAPPERS
   ============================================================ */
async function fetchAll() {
  const tasks = [];
  if (isStaff()) {
    tasks.push(
      apiCall("getStudents").then((r) => state.students = normalizeList(r, ["students", "data"])),
      apiCall("getTeachers").then((r) => state.teachers = normalizeList(r, ["teachers", "data"])),
      apiCall("getAttendance").then((r) => state.attendance = normalizeList(r, ["attendance", "data"])),
      apiCall("getMarks").then((r) => state.marks = normalizeList(r, ["marks", "data"])),
      apiCall("getFees").then((r) => state.fees = normalizeList(r, ["fees", "data"])),
      apiCall("getHomework").then((r) => state.homework = normalizeList(r, ["homework", "data"])),
      apiCall("getNotes").then((r) => state.notes = normalizeList(r, ["notes", "data"])),
    );
  } else {
    // Student fetches their own data
    const u = state.user.username;
    tasks.push(
      apiCall("getAttendance", { username: u }).then((r) => state.attendance = normalizeList(r, ["attendance", "data"])),
      apiCall("getMarks", { username: u }).then((r) => state.marks = normalizeList(r, ["marks", "data"])),
      apiCall("getFees", { username: u }).then((r) => state.fees = normalizeList(r, ["fees", "data"])),
      apiCall("getHomework", { username: u }).then((r) => state.homework = normalizeList(r, ["homework", "data"])),
      apiCall("getNotes", { username: u }).then((r) => state.notes = normalizeList(r, ["notes", "data"])),
    );
  }
  await Promise.allSettled(tasks);
}

function normalizeList(res, keys) {
  if (Array.isArray(res)) return res;
  for (const k of keys) {
    if (Array.isArray(res?.[k])) return res[k];
  }
  if (res && typeof res === "object") {
    // Look for any array property
    for (const key of Object.keys(res)) {
      if (Array.isArray(res[key])) return res[key];
    }
  }
  return [];
}

/* Filter helpers — student-only */
function studentOwn(list, fields = ["username", "studentUsername", "student"]) {
  if (state.user.role !== "student") return list;
  const u = String(state.user.username).toLowerCase();
  return list.filter((row) => {
    return fields.some((f) => String(row?.[f] || "").toLowerCase() === u);
  });
}

/* ============================================================
   RENDER ROUTER
   ============================================================ */
async function renderPage(pageId) {
  const area = $("#page-area");
  area.innerHTML = `<div class="card empty-state">Loading...</div>`;
  showLoader(true);

  try {
    await fetchAll();
  } catch (err) {
    console.warn("fetchAll error:", err);
  } finally {
    showLoader(false);
  }

  switch (pageId) {
    case "dashboard":  return renderDashboard();
    case "students":   return renderStudents();
    case "teachers":   return renderTeachers();
    case "attendance": return renderAttendance();
    case "marks":      return renderMarks();
    case "fees":       return renderFees();
    case "homework":   return renderHomework();
    case "notes":      return renderNotes();
    case "profile":    return renderProfile();
    default:           return renderDashboard();
  }
}

/* ============================================================
   PAGE: DASHBOARD
   ============================================================ */
function renderDashboard() {
  const area = $("#page-area");

  if (isStaff()) {
    const totalStudents = state.students.length;
    const totalTeachers = state.teachers.length;

    const today = todayISO();
    const todaysAtt = state.attendance.filter((a) => String(a.date || "").startsWith(today.slice(0,10)));
    const present = todaysAtt.filter((a) => String(a.status).toLowerCase() === "present").length;
    const attendancePct = todaysAtt.length ? Math.round((present / todaysAtt.length) * 100) : 0;

    const pendingFees = state.fees.filter((f) =>
      ["pending","unpaid","due","overdue"].includes(String(f.status || "").toLowerCase())
    ).length;
    const collected = state.fees
      .filter((f) => String(f.status || "").toLowerCase() === "paid")
      .reduce((sum, f) => sum + Number(f.amount || 0), 0);

    const openHomework = state.homework.length;
    const totalNotes = state.notes.length;

    area.innerHTML = `
      <div class="page">
        <div class="kpi-grid">
          ${kpiCard({ icon: "users",  color: "blue",   label: "Students",       value: totalStudents, foot: "across your institute" })}
          ${kpiCard({ icon: "user-plus", color: "violet", label: "Teachers",    value: totalTeachers, foot: "in your team" })}
          ${kpiCard({ icon: "calendar-check", color: "green", label: "Today's attendance", value: attendancePct + "%", foot: `${present}/${todaysAtt.length || 0} present` })}
          ${kpiCard({ icon: "wallet", color: "amber",  label: "Pending fees",   value: pendingFees,   foot: `₹${collected.toLocaleString()} collected total` })}
          ${kpiCard({ icon: "book",   color: "blue",   label: "Active homework", value: openHomework,  foot: "assignments tracked" })}
          ${kpiCard({ icon: "edit",   color: "violet", label: "Anecdotal notes", value: totalNotes,    foot: "written by teachers" })}
        </div>

        <div class="two-col">
          <div class="card">
            <div class="section-head" style="margin-bottom:14px">
              <div>
                <h3>Recent students</h3>
                <p>Your latest enrolments</p>
              </div>
              <button class="btn btn-ghost" id="quick-add-student">${ICONS.plus} Add student</button>
            </div>
            ${
              state.students.length === 0
                ? `<div class="empty-state">No students yet. Add your first student to get started.</div>`
                : `<div class="table-wrap"><table class="data">
                    <thead><tr><th>Name</th><th>Username</th><th>Class</th></tr></thead>
                    <tbody>
                      ${state.students.slice(0, 6).map(s => `
                        <tr>
                          <td><div style="display:flex;align-items:center;gap:10px;">
                            <div class="avatar" style="width:30px;height:30px;font-size:11px;">${initials(s.name || s.username)}</div>
                            <span style="font-weight:500">${escapeHtml(s.name || "—")}</span>
                          </div></td>
                          <td style="color:var(--text-muted)">${escapeHtml(s.username || "")}</td>
                          <td>${s.class ? `<span class="pill info">${escapeHtml(s.class)}</span>` : `<span class="pill muted">—</span>`}</td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table></div>`
            }
          </div>

          <div class="card">
            <div class="section-head" style="margin-bottom:14px">
              <div><h3>Fee reminders</h3><p>Students with dues</p></div>
            </div>
            ${
              pendingFees === 0
                ? `<div class="empty-state">All clear. No pending fees.</div>`
                : `<div class="list">
                    ${state.fees
                      .filter(f => ["pending","unpaid","due","overdue"].includes(String(f.status || "").toLowerCase()))
                      .slice(0, 5)
                      .map(f => `
                        <div class="list-item">
                          <div class="list-item-head">
                            <div>
                              <div class="list-item-title">${escapeHtml(f.name || f.username || "Student")}</div>
                              <div class="list-item-meta">
                                <span>₹${Number(f.amount || 0).toLocaleString()}</span>
                                ${f.dueDate ? `<span>Due ${escapeHtml(formatDate(f.dueDate))}</span>` : ""}
                              </div>
                            </div>
                            <span class="pill warning">${ICONS.bell} Pending</span>
                          </div>
                        </div>
                      `).join("")}
                  </div>`
            }
          </div>
        </div>
      </div>
    `;

    const quickAdd = $("#quick-add-student");
    if (quickAdd) quickAdd.addEventListener("click", () => openStudentModal());
  } else {
    // STUDENT DASHBOARD
    const myAtt = studentOwn(state.attendance);
    const myMarks = studentOwn(state.marks);
    const myFees = studentOwn(state.fees);
    const myHw = studentOwn(state.homework);
    const myNotes = studentOwn(state.notes, ["studentUsername","username","student"]);

    const present = myAtt.filter(a => String(a.status).toLowerCase() === "present").length;
    const attPct = myAtt.length ? Math.round((present / myAtt.length) * 100) : 0;

    const pendingFee = myFees.filter(f => ["pending","unpaid","due","overdue"].includes(String(f.status || "").toLowerCase()));
    const totalDue = pendingFee.reduce((sum, f) => sum + Number(f.amount || 0), 0);

    const avgMark = myMarks.length
      ? Math.round(myMarks.reduce((s, m) => s + (Number(m.marks || m.score || 0) / Number(m.maxMarks || m.totalMarks || 100)) * 100, 0) / myMarks.length)
      : 0;

    area.innerHTML = `
      <div class="page">
        <div class="profile-banner">
          <div class="avatar">${initials(state.user.name)}</div>
          <div>
            <h2>Welcome back, ${escapeHtml(state.user.name)}</h2>
            <p>${escapeHtml(state.user.institute)} · Student</p>
          </div>
        </div>

        <div class="kpi-grid">
          ${kpiCard({ icon: "calendar-check", color: "green", label: "Attendance",  value: attPct + "%", foot: `${present}/${myAtt.length} classes attended` })}
          ${kpiCard({ icon: "award",    color: "violet", label: "Avg score",        value: avgMark + "%", foot: `${myMarks.length} tests recorded` })}
          ${kpiCard({ icon: "wallet",   color: pendingFee.length ? "amber" : "green", label: "Fee status", value: pendingFee.length ? `₹${totalDue.toLocaleString()}` : "Cleared", foot: pendingFee.length ? "amount due" : "all dues paid" })}
          ${kpiCard({ icon: "book",     color: "blue",   label: "Homework",         value: myHw.length, foot: "active assignments" })}
        </div>

        <div class="two-col">
          <div class="card">
            <div class="section-head" style="margin-bottom:12px">
              <div><h3>Latest homework</h3><p>From your teachers</p></div>
            </div>
            ${ myHw.length === 0
              ? `<div class="empty-state">No assignments right now. Enjoy the break!</div>`
              : `<div class="list">${myHw.slice(0,4).map(homeworkRow).join("")}</div>` }
          </div>
          <div class="card">
            <div class="section-head" style="margin-bottom:12px">
              <div><h3>Recent teacher notes</h3><p>What teachers say about you</p></div>
            </div>
            ${ myNotes.length === 0
              ? `<div class="empty-state">No notes yet.</div>`
              : `<div class="list">${myNotes.slice(0,4).map(noteRow).join("")}</div>` }
          </div>
        </div>
      </div>
    `;
  }
}

function kpiCard({ icon, color, label, value, foot }) {
  return `
    <div class="kpi">
      <div class="kpi-icon ${color}">${ICONS[icon] || ""}</div>
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-foot">${escapeHtml(foot || "")}</div>
    </div>
  `;
}

/* ============================================================
   PAGE: STUDENTS (teacher)
   ============================================================ */
function renderStudents() {
  const area = $("#page-area");
  if (!isStaff()) {
    area.innerHTML = `<div class="card empty-state">Access denied.</div>`;
    return;
  }
  const search = String($("#global-search").value || "").toLowerCase();
  const list = state.students.filter(s => {
    if (!search) return true;
    return [s.name, s.username, s.class, s.email]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(search));
  });

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} student${list.length === 1 ? "" : "s"}</h3>
            <p>Add, view and remove students in your institute.</p>
          </div>
          <button class="btn btn-primary" id="add-student-btn">${ICONS.plus} Add student</button>
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No students yet. Click "Add student" to create one.</div>`
          : `<div class="table-wrap"><table class="data">
              <thead><tr><th>Name</th><th>Username</th><th>Class</th><th>Contact</th><th></th></tr></thead>
              <tbody>
                ${list.map(s => `
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:10px;">
                      <div class="avatar" style="width:32px;height:32px;font-size:12px;">${initials(s.name || s.username)}</div>
                      <span style="font-weight:600">${escapeHtml(s.name || "—")}</span>
                    </div></td>
                    <td style="color:var(--text-muted)">${escapeHtml(s.username || "")}</td>
                    <td>${s.class ? `<span class="pill info">${escapeHtml(s.class)}</span>` : `<span class="pill muted">—</span>`}</td>
                    <td style="color:var(--text-muted);font-size:13px">${escapeHtml(s.contact || s.email || "—")}</td>
                    <td>
                      <div class="row-actions">
                        <button class="btn btn-ghost" data-act="delete-student" data-username="${escapeHtml(s.username)}">${ICONS.trash}</button>
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table></div>`
        }
      </div>
    </div>
  `;

  $("#add-student-btn").addEventListener("click", () => openStudentModal());
  $$('button[data-act="delete-student"]').forEach(btn => {
    btn.addEventListener("click", () => deleteStudent(btn.dataset.username));
  });
}

function openStudentModal() {
  openModal({
    title: "Add new student",
    body: `
      <form id="student-form" class="auth-form">
        <div class="field-row">
          <div class="field">
            <label>Full name</label>
            <input type="text" id="s-name" required placeholder="Student's full name" />
          </div>
          <div class="field">
            <label>Class</label>
            <input type="text" id="s-class" placeholder="e.g. Grade 8" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Username</label>
            <input type="text" id="s-username" required placeholder="login username" />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="text" id="s-password" required placeholder="Initial password" />
          </div>
        </div>
        <div class="field">
          <label>Contact (optional)</label>
          <input type="text" id="s-contact" placeholder="Phone or email" />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Create student</span>
            <span class="btn-spinner"></span>
          </button>
        </div>
      </form>
    `,
    onMount: (root) => {
      root.querySelector("#student-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button[type=submit]");
        setBtnLoading(btn, true);
        try {
          await apiCall("addStudent", {
            name: $("#s-name").value.trim(),
            username: $("#s-username").value.trim(),
            password: $("#s-password").value,
            class: $("#s-class").value.trim(),
            contact: $("#s-contact").value.trim(),
          });
          toast("Student added", "success");
          closeModal();
          renderPage(state.page);
        } catch (err) {
          toast(err.message || "Could not add student", "error");
        } finally {
          setBtnLoading(btn, false);
        }
      });
    },
  });
}

async function deleteStudent(username) {
  if (!confirm(`Remove student "${username}"? This cannot be undone.`)) return;
  showLoader(true);
  try {
    await apiCall("deleteStudent", { username });
    toast("Student removed", "success");
    renderPage(state.page);
  } catch (err) {
    toast(err.message || "Could not remove", "error");
  } finally {
    showLoader(false);
  }
}

/* ============================================================
   PAGE: TEACHERS (teacher)
   ============================================================ */
function renderTeachers() {
  const area = $("#page-area");
  if (!isStaff()) {
    area.innerHTML = `<div class="card empty-state">Access denied.</div>`;
    return;
  }

  const me = String(state.user.username).toLowerCase();
  const canManage = isOwnerLike();

  // Order: owner first, then co-owners, then teachers — alphabetical inside each group
  const sorted = [...state.teachers].sort((a, b) => {
    const rank = (r) => (r === "owner" ? 0 : r === "coowner" ? 1 : 2);
    const ra = rank(String(a.role || "").toLowerCase());
    const rb = rank(String(b.role || "").toLowerCase());
    if (ra !== rb) return ra - rb;
    return String(a.name || a.username).localeCompare(String(b.name || b.username));
  });

  const rolePill = (r) => {
    const role = String(r || "").toLowerCase();
    if (role === "owner")   return `<span class="pill warn">Owner</span>`;
    if (role === "coowner") return `<span class="pill info">Co-owner</span>`;
    return `<span class="pill muted">Teacher</span>`;
  };

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${sorted.length} member${sorted.length === 1 ? "" : "s"}</h3>
            <p>${ canManage
              ? "Manage your teaching team. Promote a teacher to co-owner to give them full access."
              : "Your institute's teaching team." }</p>
          </div>
          ${ canManage
            ? `<button class="btn btn-primary" id="add-teacher-btn">${ICONS.plus} Add teacher</button>`
            : "" }
        </div>
        ${ sorted.length === 0
          ? `<div class="empty-state">No teachers added yet.</div>`
          : `<div class="table-wrap"><table class="data">
              <thead><tr>
                <th>Name</th><th>Role</th><th>Username</th><th>Subject</th>
                ${ canManage ? "<th></th>" : "" }
              </tr></thead>
              <tbody>
                ${sorted.map(t => {
                  const tu = String(t.username).toLowerCase();
                  const tr = String(t.role || "").toLowerCase();
                  const isMe = tu === me;
                  const isOwnerRow = tr === "owner";
                  return `
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:10px;">
                      <div class="avatar" style="width:32px;height:32px;font-size:12px;">${initials(t.name || t.username)}</div>
                      <span style="font-weight:600">${escapeHtml(t.name || "—")}</span>
                      ${ isMe ? `<span class="pill info">You</span>` : "" }
                    </div></td>
                    <td>${rolePill(tr)}</td>
                    <td style="color:var(--text-muted)">${escapeHtml(t.username || "")}</td>
                    <td>${t.subject ? `<span class="pill violet">${escapeHtml(t.subject)}</span>` : `<span class="pill muted">—</span>`}</td>
                    ${ canManage ? `<td>
                      <div class="row-actions">
                        ${ isOwnerRow || isMe ? "" : (
                          tr === "coowner"
                            ? `<button class="btn btn-ghost btn-sm" data-act="set-role" data-username="${escapeHtml(t.username)}" data-make="false">Demote</button>`
                            : `<button class="btn btn-ghost btn-sm" data-act="set-role" data-username="${escapeHtml(t.username)}" data-make="true">Make co-owner</button>`
                        )}
                        ${ isOwnerRow || isMe
                          ? ""
                          : `<button class="btn btn-ghost" data-act="delete-teacher" data-username="${escapeHtml(t.username)}">${ICONS.trash}</button>` }
                      </div>
                    </td>` : "" }
                  </tr>
                `;}).join("")}
              </tbody>
            </table></div>`
        }
      </div>
    </div>
  `;

  if (canManage) {
    $("#add-teacher-btn")?.addEventListener("click", () => openTeacherModal());
    $$('button[data-act="delete-teacher"]').forEach(btn => {
      btn.addEventListener("click", () => deleteTeacher(btn.dataset.username));
    });
    $$('button[data-act="set-role"]').forEach(btn => {
      btn.addEventListener("click", () =>
        setTeacherRole(btn.dataset.username, btn.dataset.make === "true"));
    });
  }
}

async function setTeacherRole(username, makeCoOwner) {
  const verb = makeCoOwner ? "promote to co-owner" : "demote to teacher";
  if (!confirm(`Are you sure you want to ${verb} "${username}"?`)) return;
  showLoader(true);
  try {
    await apiCall("setTeacherRole", { username, makeCoOwner });
    toast(makeCoOwner ? "Promoted to co-owner" : "Set back to teacher", "success");
    renderPage(state.page);
  } catch (err) {
    toast(err.message || "Could not change role", "error");
  } finally {
    showLoader(false);
  }
}

function openTeacherModal() {
  openModal({
    title: "Add teacher",
    body: `
      <form id="teacher-form" class="auth-form">
        <div class="field-row">
          <div class="field">
            <label>Full name</label>
            <input type="text" id="t-name" required />
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" id="t-email" placeholder="teacher@institute.com" />
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Username</label>
            <input type="text" id="t-username" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="text" id="t-password" required />
          </div>
        </div>
        <div class="field">
          <label>Subject (optional)</label>
          <input type="text" id="t-subject" placeholder="e.g. Mathematics" />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Create teacher</span>
            <span class="btn-spinner"></span>
          </button>
        </div>
      </form>
    `,
    onMount: (root) => {
      root.querySelector("#teacher-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button[type=submit]");
        setBtnLoading(btn, true);
        try {
          await apiCall("addTeacher", {
            name: $("#t-name").value.trim(),
            email: $("#t-email").value.trim(),
            username: $("#t-username").value.trim(),
            password: $("#t-password").value,
            subject: $("#t-subject").value.trim(),
          });
          toast("Teacher added", "success");
          closeModal();
          renderPage(state.page);
        } catch (err) {
          toast(err.message || "Could not add teacher", "error");
        } finally {
          setBtnLoading(btn, false);
        }
      });
    },
  });
}

async function deleteTeacher(username) {
  if (!confirm(`Remove teacher "${username}"? This cannot be undone.`)) return;
  showLoader(true);
  try {
    await apiCall("deleteTeacher", { username });
    toast("Teacher removed", "success");
    renderPage(state.page);
  } catch (err) {
    toast(err.message || "Could not remove", "error");
  } finally {
    showLoader(false);
  }
}

/* ============================================================
   PAGE: ATTENDANCE
   ============================================================ */
function renderAttendance() {
  const area = $("#page-area");

  if (isStaff()) {
    const date = todayISO();
    area.innerHTML = `
      <div class="page">
        <div class="card">
          <div class="att-controls">
            <div class="field" style="margin:0">
              <label>Date</label>
              <input type="date" id="att-date" value="${date}" />
            </div>
            <button class="btn btn-ghost" id="load-att-btn">Load</button>
          </div>
          <div id="attendance-list"></div>
        </div>
      </div>
    `;
    const renderRows = () => {
      const d = $("#att-date").value;
      const wrap = $("#attendance-list");
      if (!state.students.length) {
        wrap.innerHTML = `<div class="empty-state">Add students first to mark attendance.</div>`;
        return;
      }
      const todayMap = new Map(
        state.attendance
          .filter(a => String(a.date || "").startsWith(d))
          .map(a => [String(a.username || a.studentUsername).toLowerCase(), String(a.status || "").toLowerCase()])
      );
      wrap.innerHTML = `
        <div style="border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden">
          ${state.students.map(s => {
            const status = todayMap.get(String(s.username).toLowerCase()) || "";
            return `
              <div class="attendance-row">
                <div class="avatar" style="width:36px;height:36px;font-size:13px;">${initials(s.name || s.username)}</div>
                <div>
                  <div style="font-weight:600">${escapeHtml(s.name || s.username)}</div>
                  <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(s.username)}${s.class ? " · " + escapeHtml(s.class) : ""}</div>
                </div>
                <div class="att-buttons" data-username="${escapeHtml(s.username)}">
                  <button class="att-btn ${status === "present" ? "active present" : ""}" data-status="present">Present</button>
                  <button class="att-btn ${status === "absent" ? "active absent" : ""}" data-status="absent">Absent</button>
                  <button class="att-btn ${status === "late" ? "active late" : ""}" data-status="late">Late</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
      $$(".att-buttons").forEach((row) => {
        row.addEventListener("click", async (e) => {
          const btn = e.target.closest(".att-btn");
          if (!btn) return;
          const username = row.dataset.username;
          const status = btn.dataset.status;
          row.querySelectorAll(".att-btn").forEach(b => b.classList.remove("active","present","absent","late"));
          btn.classList.add("active", status);
          try {
            await apiCall("markAttendance", { username, date: d, status });
            toast("Attendance saved", "success", 1500);
          } catch (err) {
            toast(err.message || "Failed to save", "error");
          }
        });
      });
    };
    $("#load-att-btn").addEventListener("click", async () => {
      showLoader(true);
      try {
        state.attendance = normalizeList(await apiCall("getAttendance"), ["attendance","data"]);
      } catch {}
      showLoader(false);
      renderRows();
    });
    renderRows();
  } else {
    // Student view
    const list = studentOwn(state.attendance);
    const present = list.filter(a => String(a.status).toLowerCase() === "present").length;
    const absent  = list.filter(a => String(a.status).toLowerCase() === "absent").length;
    const late    = list.filter(a => String(a.status).toLowerCase() === "late").length;
    const pct = list.length ? Math.round((present / list.length) * 100) : 0;

    area.innerHTML = `
      <div class="page">
        <div class="kpi-grid">
          ${kpiCard({ icon: "calendar-check", color: "green", label: "Attendance", value: pct + "%", foot: `${present}/${list.length} classes` })}
          ${kpiCard({ icon: "calendar-check", color: "amber", label: "Late", value: late, foot: "times late" })}
          ${kpiCard({ icon: "calendar-check", color: "red", label: "Absent", value: absent, foot: "classes missed" })}
        </div>
        <div class="card">
          <div class="section-head" style="margin-bottom:14px"><div><h3>History</h3></div></div>
          ${ list.length === 0
            ? `<div class="empty-state">No attendance recorded yet.</div>`
            : `<div class="table-wrap"><table class="data">
                <thead><tr><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  ${list
                    .slice()
                    .sort((a,b) => String(b.date).localeCompare(String(a.date)))
                    .map(a => `
                    <tr>
                      <td>${escapeHtml(formatDate(a.date))}</td>
                      <td>${attendancePill(a.status)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table></div>`
          }
        </div>
      </div>
    `;
  }
}

function attendancePill(status) {
  const s = String(status || "").toLowerCase();
  if (s === "present") return `<span class="pill success">Present</span>`;
  if (s === "absent")  return `<span class="pill danger">Absent</span>`;
  if (s === "late")    return `<span class="pill warning">Late</span>`;
  return `<span class="pill muted">—</span>`;
}

/* ============================================================
   PAGE: MARKS
   ============================================================ */
function renderMarks() {
  const area = $("#page-area");
  const list = isStaff() ? state.marks : studentOwn(state.marks);

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} entr${list.length === 1 ? "y" : "ies"}</h3>
            <p>${isStaff() ? "Record marks for tests and exams." : "Your test scores."}</p>
          </div>
          ${ isStaff()
            ? `<button class="btn btn-primary" id="add-mark-btn">${ICONS.plus} Add mark</button>` : "" }
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No marks recorded yet.</div>`
          : `<div class="table-wrap"><table class="data">
              <thead><tr>
                ${isStaff() ? "<th>Student</th>" : ""}
                <th>Subject</th><th>Test</th><th>Score</th><th>Date</th>
              </tr></thead>
              <tbody>
                ${list.map(m => {
                  const score = Number(m.marks || m.score || 0);
                  const max = Number(m.maxMarks || m.totalMarks || 100);
                  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
                  return `<tr>
                    ${isStaff() ? `<td><span style="font-weight:600">${escapeHtml(m.name || m.username || "—")}</span></td>` : ""}
                    <td>${escapeHtml(m.subject || "—")}</td>
                    <td style="color:var(--text-muted)">${escapeHtml(m.test || m.exam || "—")}</td>
                    <td><strong>${score}</strong> / ${max} <span class="pill ${pct >= 75 ? "success" : pct >= 50 ? "info" : "danger"}" style="margin-left:8px">${pct}%</span></td>
                    <td style="color:var(--text-muted)">${escapeHtml(formatDate(m.date))}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table></div>`
        }
      </div>
    </div>
  `;

  if (isStaff()) {
    $("#add-mark-btn").addEventListener("click", () => openMarkModal());
  }
}

function openMarkModal() {
  openModal({
    title: "Record marks",
    body: `
      <form id="mark-form" class="auth-form">
        <div class="field">
          <label>Student</label>
          <select id="m-username" required>
            <option value="">Select a student…</option>
            ${state.students.map(s => `<option value="${escapeHtml(s.username)}">${escapeHtml(s.name || s.username)}</option>`).join("")}
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>Subject</label><input type="text" id="m-subject" required /></div>
          <div class="field"><label>Test / Exam</label><input type="text" id="m-test" placeholder="e.g. Unit 1" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Marks scored</label><input type="number" id="m-marks" required min="0" /></div>
          <div class="field"><label>Out of</label><input type="number" id="m-max" required min="1" value="100" /></div>
        </div>
        <p class="hint" style="margin:-4px 0 8px;color:var(--text-muted);font-size:12px;">
          The mark will be saved with today's date automatically.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Save mark</span><span class="btn-spinner"></span>
          </button>
        </div>
      </form>
    `,
    onMount: (root) => {
      root.querySelector("#mark-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button[type=submit]");
        setBtnLoading(btn, true);
        try {
          await apiCall("addMark", {
            username: $("#m-username").value,
            subject: $("#m-subject").value.trim(),
            test: $("#m-test").value.trim(),
            marks: Number($("#m-marks").value),
            maxMarks: Number($("#m-max").value),
          });
          toast("Mark added", "success");
          closeModal();
          renderPage(state.page);
        } catch (err) {
          toast(err.message || "Failed", "error");
        } finally {
          setBtnLoading(btn, false);
        }
      });
    },
  });
}

/* ============================================================
   PAGE: FEES
   ============================================================ */
function renderFees() {
  const area = $("#page-area");
  const list = isStaff() ? state.fees : studentOwn(state.fees);

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} record${list.length === 1 ? "" : "s"}</h3>
            <p>${isStaff() ? "Track payments and dues. Send reminders for pending fees." : "Your fee payment history."}</p>
          </div>
          ${ isStaff()
            ? `<button class="btn btn-primary" id="add-fee-btn">${ICONS.plus} Add fee record</button>` : "" }
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No fee records yet.</div>`
          : `<div class="table-wrap"><table class="data">
              <thead><tr>
                ${isStaff() ? "<th>Student</th>" : ""}
                <th>Description</th><th>Amount</th><th>Due date</th><th>Status</th>
                ${isStaff() ? "<th></th>" : ""}
              </tr></thead>
              <tbody>
                ${list.map(f => {
                  const status = String(f.status || "pending").toLowerCase();
                  const isPaid = status === "paid";
                  return `<tr>
                    ${isStaff() ? `<td><strong>${escapeHtml(f.name || f.username || "—")}</strong></td>` : ""}
                    <td>${escapeHtml(f.description || "Tuition fee")}</td>
                    <td><strong>₹${Number(f.amount || 0).toLocaleString()}</strong></td>
                    <td style="color:var(--text-muted)">${escapeHtml(formatDate(f.dueDate))}</td>
                    <td>${ isPaid ? `<span class="pill success">Paid</span>` : `<span class="pill warning">Pending</span>` }</td>
                    ${isStaff() ? `<td><div class="row-actions">
                      ${ !isPaid ? `<button class="btn btn-ghost" data-act="remind-fee" data-username="${escapeHtml(f.username || "")}" data-amount="${Number(f.amount || 0)}">${ICONS.bell} Remind</button>
                                    <button class="btn btn-success" data-act="paid-fee" data-id="${escapeHtml(f.id || f.username || "")}" data-username="${escapeHtml(f.username || "")}">Mark paid</button>`
                                : `` }
                    </div></td>` : ""}
                  </tr>`;
                }).join("")}
              </tbody>
            </table></div>`
        }
      </div>
    </div>
  `;

  if (isStaff()) {
    $("#add-fee-btn").addEventListener("click", () => openFeeModal());
    $$('button[data-act="paid-fee"]').forEach(b => b.addEventListener("click", () => markFeePaid(b.dataset.id, b.dataset.username)));
    $$('button[data-act="remind-fee"]').forEach(b => b.addEventListener("click", () => {
      toast(`Reminder noted for ${b.dataset.username}: ₹${Number(b.dataset.amount).toLocaleString()} pending`, "warning");
    }));
  }
}

function openFeeModal() {
  openModal({
    title: "Add fee record",
    body: `
      <form id="fee-form" class="auth-form">
        <div class="field">
          <label>Student</label>
          <select id="f-username" required>
            <option value="">Select a student…</option>
            ${state.students.map(s => `<option value="${escapeHtml(s.username)}">${escapeHtml(s.name || s.username)}</option>`).join("")}
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>Description</label><input type="text" id="f-desc" placeholder="e.g. April tuition" required /></div>
          <div class="field"><label>Amount (₹)</label><input type="number" id="f-amount" min="0" required /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Due date</label><input type="date" id="f-due" value="${todayISO()}" /></div>
          <div class="field"><label>Status</label>
            <select id="f-status">
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Save record</span><span class="btn-spinner"></span>
          </button>
        </div>
      </form>
    `,
    onMount: (root) => {
      root.querySelector("#fee-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button[type=submit]");
        setBtnLoading(btn, true);
        try {
          await apiCall("addFee", {
            username: $("#f-username").value,
            description: $("#f-desc").value.trim(),
            amount: Number($("#f-amount").value),
            dueDate: $("#f-due").value,
            status: $("#f-status").value,
          });
          toast("Fee record saved", "success");
          closeModal();
          renderPage(state.page);
        } catch (err) {
          toast(err.message || "Failed", "error");
        } finally {
          setBtnLoading(btn, false);
        }
      });
    },
  });
}

async function markFeePaid(id, username) {
  showLoader(true);
  try {
    await apiCall("updateFee", { id, username, status: "paid" });
    toast("Marked as paid", "success");
    renderPage(state.page);
  } catch (err) {
    toast(err.message || "Failed", "error");
  } finally {
    showLoader(false);
  }
}

/* ============================================================
   PAGE: HOMEWORK
   ============================================================ */
function homeworkRow(h) {
  return `
    <div class="list-item">
      <div class="list-item-head">
        <div>
          <div class="list-item-title">${escapeHtml(h.title || "Untitled")}</div>
          <div class="list-item-meta">
            ${h.subject ? `<span class="pill violet">${escapeHtml(h.subject)}</span>` : ""}
            ${h.dueDate ? `<span>Due ${escapeHtml(formatDate(h.dueDate))}</span>` : ""}
            ${h.username || h.studentUsername ? `<span>For ${escapeHtml(h.name || h.username || h.studentUsername)}</span>` : `<span>For all</span>`}
          </div>
        </div>
      </div>
      ${ h.description ? `<div class="list-item-body">${escapeHtml(h.description)}</div>` : "" }
    </div>
  `;
}

function renderHomework() {
  const area = $("#page-area");
  const list = isStaff() ? state.homework : studentOwn(state.homework);

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} assignment${list.length === 1 ? "" : "s"}</h3>
            <p>${isStaff() ? "Assign and review homework." : "Your homework assignments."}</p>
          </div>
          ${ isStaff()
            ? `<button class="btn btn-primary" id="add-hw-btn">${ICONS.plus} Assign homework</button>` : "" }
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No homework yet.</div>`
          : `<div class="list">${list.map(homeworkRow).join("")}</div>` }
      </div>
    </div>
  `;

  if (isStaff()) {
    $("#add-hw-btn").addEventListener("click", () => openHomeworkModal());
  }
}

function openHomeworkModal() {
  openModal({
    title: "Assign homework",
    body: `
      <form id="hw-form" class="auth-form">
        <div class="field-row">
          <div class="field"><label>Title</label><input type="text" id="h-title" required /></div>
          <div class="field"><label>Subject</label><input type="text" id="h-subject" /></div>
        </div>
        <div class="field">
          <label>Description</label>
          <textarea id="h-desc" rows="3" placeholder="Details about the assignment"></textarea>
        </div>
        <div class="field-row">
          <div class="field"><label>Assign to</label>
            <select id="h-username">
              <option value="">All students</option>
              ${state.students.map(s => `<option value="${escapeHtml(s.username)}">${escapeHtml(s.name || s.username)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Due date</label><input type="date" id="h-due" /></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Assign</span><span class="btn-spinner"></span>
          </button>
        </div>
      </form>
    `,
    onMount: (root) => {
      root.querySelector("#hw-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button[type=submit]");
        setBtnLoading(btn, true);
        try {
          await apiCall("addHomework", {
            title: $("#h-title").value.trim(),
            subject: $("#h-subject").value.trim(),
            description: $("#h-desc").value.trim(),
            username: $("#h-username").value,
            dueDate: $("#h-due").value,
          });
          toast("Homework assigned", "success");
          closeModal();
          renderPage(state.page);
        } catch (err) {
          toast(err.message || "Failed", "error");
        } finally {
          setBtnLoading(btn, false);
        }
      });
    },
  });
}

/* ============================================================
   PAGE: NOTES
   ============================================================ */
function noteRow(n) {
  return `
    <div class="list-item">
      <div class="list-item-head">
        <div>
          <div class="list-item-title">${escapeHtml(n.title || "Note")}</div>
          <div class="list-item-meta">
            ${n.studentUsername || n.username ? `<span>About ${escapeHtml(n.name || n.studentUsername || n.username)}</span>` : ""}
            ${n.author || n.teacher ? `<span>by ${escapeHtml(n.author || n.teacher)}</span>` : ""}
            ${n.date ? `<span>${escapeHtml(formatDate(n.date))}</span>` : ""}
          </div>
        </div>
      </div>
      ${ n.note || n.body ? `<div class="list-item-body">${escapeHtml(n.note || n.body)}</div>` : "" }
    </div>
  `;
}

function renderNotes() {
  const area = $("#page-area");
  const list = isStaff()
    ? state.notes
    : studentOwn(state.notes, ["studentUsername","username","student"]);

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} note${list.length === 1 ? "" : "s"}</h3>
            <p>${isStaff() ? "Capture observations and anecdotal notes about your students." : "Notes your teachers have written about you."}</p>
          </div>
          ${ isStaff()
            ? `<button class="btn btn-primary" id="add-note-btn">${ICONS.plus} Add note</button>` : "" }
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No notes yet.</div>`
          : `<div class="list">${list.map(noteRow).join("")}</div>` }
      </div>
    </div>
  `;

  if (isStaff()) {
    $("#add-note-btn").addEventListener("click", () => openNoteModal());
  }
}

function openNoteModal() {
  const chip = (text, kind) =>
    `<button type="button" class="remark-chip ${kind}" data-text="${escapeHtml(text)}">${escapeHtml(text)}</button>`;

  openModal({
    title: "New anecdotal note",
    body: `
      <form id="note-form" class="auth-form">
        <div class="field">
          <label>Student</label>
          <select id="n-username" required>
            <option value="">Select a student…</option>
            ${state.students.map(s => `<option value="${escapeHtml(s.username)}">${escapeHtml(s.name || s.username)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label>Quick remark</label>
          <div class="remark-tabs">
            <button type="button" class="remark-tab is-active" data-tab="positive">Positive</button>
            <button type="button" class="remark-tab" data-tab="negative">Needs work</button>
          </div>
          <div class="remark-grid" id="remark-grid-positive">
            ${POSITIVE_REMARKS.map(r => chip(r, "positive")).join("")}
          </div>
          <div class="remark-grid hidden" id="remark-grid-negative">
            ${NEGATIVE_REMARKS.map(r => chip(r, "negative")).join("")}
          </div>
          <small class="hint" style="color:var(--text-muted);font-size:12px;">
            Tap a remark to use it as the title — add more detail below if you like.
          </small>
        </div>

        <div class="field">
          <label>Title</label>
          <input type="text" id="n-title" required placeholder="e.g. Strong participation today" />
        </div>
        <div class="field">
          <label>Additional details (optional)</label>
          <textarea id="n-body" rows="3" placeholder="Add any extra context for this note…"></textarea>
        </div>
        <p class="hint" style="margin:-4px 0 8px;color:var(--text-muted);font-size:12px;">
          Today's date is added automatically when you save.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Save note</span><span class="btn-spinner"></span>
          </button>
        </div>
      </form>
    `,
    onMount: (root) => {
      // Tab switching between positive / negative remark grids
      const tabs = root.querySelectorAll(".remark-tab");
      tabs.forEach(t => t.addEventListener("click", () => {
        tabs.forEach(x => x.classList.toggle("is-active", x === t));
        const which = t.dataset.tab;
        root.querySelector("#remark-grid-positive").classList.toggle("hidden", which !== "positive");
        root.querySelector("#remark-grid-negative").classList.toggle("hidden", which !== "negative");
      }));

      // Clicking a chip fills the title (and selects it visually)
      const titleInput = root.querySelector("#n-title");
      root.querySelectorAll(".remark-chip").forEach(c => {
        c.addEventListener("click", () => {
          titleInput.value = c.dataset.text;
          root.querySelectorAll(".remark-chip").forEach(x => x.classList.remove("is-selected"));
          c.classList.add("is-selected");
        });
      });

      root.querySelector("#note-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button[type=submit]");
        setBtnLoading(btn, true);
        try {
          await apiCall("addNote", {
            studentUsername: $("#n-username").value,
            title: $("#n-title").value.trim(),
            note: $("#n-body").value.trim(),
            author: state.user.name || state.user.username,
          });
          toast("Note saved", "success");
          closeModal();
          renderPage(state.page);
        } catch (err) {
          toast(err.message || "Failed", "error");
        } finally {
          setBtnLoading(btn, false);
        }
      });
    },
  });
}

/* ============================================================
   PAGE: PROFILE (student)
   ============================================================ */
function renderProfile() {
  const area = $("#page-area");
  const u = state.user;

  area.innerHTML = `
    <div class="page">
      <div class="profile-banner">
        <div class="avatar">${initials(u.name)}</div>
        <div>
          <h2>${escapeHtml(u.name)}</h2>
          <p>${escapeHtml(u.institute)} · ${escapeHtml(u.role)}</p>
        </div>
      </div>
      <div class="card">
        <div class="section-head" style="margin-bottom:14px">
          <div><h3>Account details</h3><p>Your profile information.</p></div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <tbody>
              <tr><td style="width:200px;color:var(--text-muted)">Full name</td><td><strong>${escapeHtml(u.name)}</strong></td></tr>
              <tr><td style="color:var(--text-muted)">Username</td><td>${escapeHtml(u.username)}</td></tr>
              <tr><td style="color:var(--text-muted)">Role</td><td><span class="pill info">${escapeHtml(u.role)}</span></td></tr>
              <tr><td style="color:var(--text-muted)">Institute</td><td>${escapeHtml(u.institute)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================
   GLOBAL EVENT BINDINGS
   ============================================================ */
function bindShell() {
  $("#logout-btn").addEventListener("click", () => {
    if (!confirm("Sign out of Tuition Manager?")) return;
    clearSession();
    location.reload();
  });

  $("#menu-toggle").addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    $("#sidebar").classList.toggle("is-open", state.sidebarOpen);
  });

  // Click outside sidebar (mobile) closes it
  document.addEventListener("click", (e) => {
    if (!state.sidebarOpen) return;
    const sb = $("#sidebar");
    if (!sb.contains(e.target) && !$("#menu-toggle").contains(e.target)) {
      state.sidebarOpen = false;
      sb.classList.remove("is-open");
    }
  });

  let searchTimeout;
  $("#global-search").addEventListener("input", () => {
    if (state.user?.role !== "teacher") return;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (state.page === "students") renderStudents();
    }, 200);
  });
}

/* ============================================================
   BOOT
   ============================================================ */
function boot() {
  bindAuth();
  bindShell();

  const session = loadSession();
  if (session && session.username && session.institute) {
    state.user = session;
    mountApp();
  }
}

boot();
