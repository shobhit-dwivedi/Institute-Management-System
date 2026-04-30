/* ============================================================
   Tuition Manager — Vanilla JS SaaS app
   Talks to Google Apps Script Web App via fetch
   ============================================================ */

const API_URL =
  "https://script.google.com/macros/s/AKfycbyVVfmyBFqf2_VrJVwTV_mkjL-pVXLtN1x78uzW-pdkY2Bb4TOk7omVdtHL3nAZKtOH/exec";

const STORAGE_KEY  = "tm_session_v1";
const CACHE_PREFIX = "tm_cache_v3:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

/* ============================================================
   APP STATE
   ============================================================ */
const state = {
  user: null,
  page: "dashboard",
  sidebarOpen: false,

  // Populated in ONE call by bootstrap()
  students: [],
  teachers: [],
  attendance: [],
  marks: [],
  fees: [],
  homework: [],
  notes: [],
  messages: [],

  profile: null,        // current user's editable profile row

  detailUsername: null, // teacher → student detail page
  chatPeer: null,       // open conversation in messages page

  loading: false,
  bootstrapped: false,
};

/* ============================================================
   LOCAL CACHE — bootstrap snapshot for instant cold-start
   ============================================================ */
function cacheKey() {
  if (!state.user) return null;
  return CACHE_PREFIX + state.user.institute + ":" + state.user.username;
}
function loadCache() {
  const k = cacheKey(); if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const blob = JSON.parse(raw);
    if (!blob || (Date.now() - (blob.t || 0)) > CACHE_TTL_MS) return null;
    return blob.data;
  } catch { return null; }
}
function saveCache(data) {
  const k = cacheKey(); if (!k) return;
  try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), data })); } catch {}
}
function applyBootstrap(data) {
  if (!data) return;
  state.students   = data.students   || [];
  state.teachers   = data.teachers   || [];
  state.attendance = data.attendance || [];
  state.marks      = data.marks      || [];
  state.fees       = data.fees       || [];
  state.homework   = data.homework   || [];
  state.notes      = data.notes      || [];
  state.messages   = data.messages   || [];
  state.profile    = data.profile    || state.profile;
  state.bootstrapped = true;
}

/* ============================================================
   API HELPERS
   ============================================================ */

/**
 * Generic POST to Apps Script.
 * Apps Script web apps don't accept custom headers from browsers without
 * triggering CORS preflight, so we send body as text/plain.
 */
async function apiCall(action, payload = {}) {
  // Always send the browser's current local date — the server uses it
  // for all "today" stamping so dates are correct regardless of where
  // the Apps Script project is hosted.
  const body = JSON.stringify({
    action,
    institute: state.user?.institute || payload.institute || "",
    clientToday: todayISO(),
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

/**
 * formatDate — displays a "yyyy-MM-dd" string as a readable local date.
 *
 * WHY the manual part-parse matters:
 *   new Date("2026-04-28") is treated as UTC midnight by the JS spec.
 *   In IST (UTC+5:30) that resolves to April 28 at 05:30 local — fine.
 *   But for any timezone WEST of UTC (UTC-x), UTC midnight becomes the
 *   PREVIOUS calendar day. Using new Date(year, month-1, day) always
 *   constructs local midnight, which is timezone-safe everywhere.
 *
 * The server now always sends clean "yyyy-MM-dd" strings (no time suffix),
 * so the regex branch is the only one that should ever run in practice.
 */
function formatDate(d) {
  if (!d) return "";
  try {
    const s = String(d).trim();
    // Match "yyyy-MM-dd" (with optional trailing time suffix from legacy rows)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      // Construct LOCAL midnight — never pass "yyyy-MM-dd" to new Date() directly
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (isNaN(date.getTime())) return s;
      return date.toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      });
    }
    // Fallback for any other format
    const date = new Date(s);
    if (isNaN(date.getTime())) return s;
    return date.toLocaleDateString(undefined, {
      year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return String(d);
  }
}

/**
 * todayISO — returns the browser's local date as "yyyy-MM-dd".
 *
 * ONLY used to pre-fill UI date-picker default values (attendance date
 * input, fee due date input, homework due date input).
 * It is NO LONGER sent to the server. The server generates all
 * "today" dates itself using istToday_() in IST (Asia/Kolkata).
 */
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
  { id: "students",   label: "Students",   title: "Students",    sub: "Tap any student to open their full profile.", icon: "users" },
  { id: "attendance", label: "Attendance", title: "Attendance",  sub: "Mark today's attendance in seconds.", icon: "calendar-check" },
  { id: "marks",      label: "Marks",      title: "Marks",       sub: "Record and review test scores.", icon: "award" },
  { id: "fees",       label: "Fees",       title: "Fees & Reminders", sub: "Track payments and send reminders.", icon: "wallet" },
  { id: "homework",   label: "Homework",   title: "Homework",    sub: "Assign and review homework.", icon: "book" },
  { id: "notes",      label: "Remarks",    title: "Remarks & Notes", sub: "Each remark counts +1 or −1 toward a student's score.", icon: "edit" },
  { id: "messages",   label: "Messages",   title: "Messages",    sub: "Chat with your students.", icon: "chat" },
  { id: "teachers",   label: "Teachers",   title: "Team",        sub: "Manage other teachers in your institute.", icon: "user-plus" },
  { id: "profile",    label: "My Profile", title: "My Profile",  sub: "Your account information.", icon: "user" },
];

const STUDENT_NAV = [
  { id: "dashboard",   label: "Dashboard",  title: "Dashboard",       sub: "Your learning at a glance.", icon: "grid" },
  { id: "attendance",  label: "Attendance", title: "My Attendance",   sub: "Calendar view of every class.", icon: "calendar-check" },
  { id: "marks",       label: "Marks",      title: "My Marks",        sub: "Sort by date, subject or score.", icon: "award" },
  { id: "notes",       label: "Remarks",    title: "Teacher Remarks", sub: "Your behavioural score, +1 / −1 per remark.", icon: "edit" },
  { id: "fees",        label: "Fees",       title: "Fee Status",      sub: "Your fee payments and dues.", icon: "wallet" },
  { id: "homework",    label: "Homework",   title: "My Homework",     sub: "Assignments from your teachers.", icon: "book" },
  { id: "teachers",    label: "Teachers",   title: "Teachers",        sub: "Meet your teachers.", icon: "user-plus" },
  { id: "messages",    label: "Messages",   title: "Messages",        sub: "Chat with your teachers.", icon: "chat" },
  { id: "profile",     label: "My Profile", title: "My Profile",      sub: "Edit your phone, address and more.", icon: "user" },
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
  chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
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
  $("#sidebar-backdrop")?.classList.remove("is-open");
  document.body.classList.remove("sb-locked");
  state.sidebarOpen = false;

  renderPage(pageId);
}

/* ============================================================
   DATA FETCH WRAPPERS
   ============================================================ */
/**
 * bootstrap — single API call that hydrates ALL dashboard data.
 * Returns immediately if a fresh local cache exists, then revalidates
 * in the background and re-renders the current page if anything changed.
 */
async function bootstrap({ force = false } = {}) {
  if (!force) {
    const cached = loadCache();
    if (cached) applyBootstrap(cached);
  }
  try {
    const res = await apiCall("bootstrap", {
      username: state.user.username,
      role: state.user.role,
    });
    applyBootstrap(res);
    saveCache(res);
    return true;
  } catch (err) {
    console.warn("bootstrap error:", err);
    return state.bootstrapped; // ok if we already had cache
  }
}

/**
 * fetchAll — kept as a thin wrapper so existing callers keep working.
 * Always calls bootstrap (one round-trip) instead of N calls.
 */
async function fetchAll() {
  await bootstrap({ force: true });
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

  // First-ever render? Show loader until bootstrap returns. After that,
  // navigation is instant — every page renders from in-memory state.
  if (!state.bootstrapped) {
    area.innerHTML = `<div class="card empty-state">Loading…</div>`;
    showLoader(true);
    await bootstrap();
    showLoader(false);
  }

  switch (pageId) {
    case "dashboard":     return renderDashboard();
    case "students":      return renderStudents();
    case "studentDetail": return renderStudentDetail();
    case "teachers":      return renderTeachers();
    case "attendance":    return renderAttendance();
    case "marks":         return renderMarks();
    case "fees":          return renderFees();
    case "homework":      return renderHomework();
    case "notes":         return renderNotes();
    case "messages":      return renderMessages();
    case "profile":       return renderProfile();
    default:              return renderDashboard();
  }
}

/**
 * Background revalidate — call after any mutation to refresh state.
 * Also re-renders the current page so the user sees authoritative data.
 */
async function revalidate() {
  const ok = await bootstrap({ force: true });
  if (ok) renderPage(state.page);
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
    // Exact match — server always returns clean "yyyy-MM-dd" strings now
    const todaysAtt = state.attendance.filter((a) => String(a.date || "") === today);
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

  // Group students by class — each class becomes a collapsible section.
  const groups = {};
  list.forEach(s => {
    const k = (s.class || "").trim() || "Unassigned";
    (groups[k] = groups[k] || []).push(s);
  });
  const classNames = Object.keys(groups).sort((a,b) =>
    a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)
  );

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} student${list.length === 1 ? "" : "s"} · ${classNames.length} class${classNames.length === 1 ? "" : "es"}</h3>
            <p>Tap any student to view their profile, attendance and remarks.</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost" id="bulk-att-btn">${ICONS["calendar-check"]} Mark today's attendance</button>
            <button class="btn btn-primary" id="add-student-btn">${ICONS.plus} Add student</button>
          </div>
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No students yet. Tap "Add student" to create one.</div>`
          : classNames.map(cls => {
              const items = groups[cls];
              return `
                <details class="class-group" open>
                  <summary>
                    <span class="cg-title">${escapeHtml(cls)}</span>
                    <span class="cg-count">${items.length}</span>
                    <button class="btn btn-ghost btn-sm cg-bulk" data-class="${escapeHtml(cls)}">Mark whole class present</button>
                  </summary>
                  <div class="cg-grid">
                    ${items.map(s => {
                      const sc = studentScore(s.username);
                      const scClass = sc > 0 ? "pos" : sc < 0 ? "neg" : "neutral";
                      return `
                      <button type="button" class="student-card" data-username="${escapeHtml(s.username)}">
                        <div class="avatar">${initials(s.name || s.username)}</div>
                        <div class="sc-body">
                          <div class="sc-name">${escapeHtml(s.name || "—")}</div>
                          <div class="sc-meta">@${escapeHtml(s.username)}${s.contact ? " · " + escapeHtml(s.contact) : ""}</div>
                        </div>
                        <span class="score-badge ${scClass}">${sc > 0 ? "+" : ""}${sc}</span>
                      </button>`;
                    }).join("")}
                  </div>
                </details>`;
            }).join("")
        }
      </div>
    </div>
  `;

  $("#add-student-btn").addEventListener("click", () => openStudentModal());
  $("#bulk-att-btn").addEventListener("click", () => openBulkAttendanceModal());
  $$(".student-card").forEach(c => c.addEventListener("click", () => goStudent(c.dataset.username)));
  $$(".cg-bulk").forEach(b => b.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    bulkMarkClass(b.dataset.class, "present");
  }));
}

/* Sum of +1 / −1 remarks for a student → behavioural score */
function studentScore(username) {
  const u = String(username || "").toLowerCase();
  return state.notes.reduce((acc, n) => {
    const who = String(n.studentUsername || n.username || "").toLowerCase();
    if (who !== u) return acc;
    return acc + Number(n.score || 0);
  }, 0);
}

function goStudent(username) {
  state.detailUsername = username;
  go("studentDetail");
}

/* Mark every student in a class with the same status, in one API call */
async function bulkMarkClass(className, status) {
  const ss = state.students.filter(s => (s.class || "Unassigned") === className);
  if (!ss.length) return;
  if (!confirm(`Mark ${ss.length} student${ss.length===1?"":"s"} in "${className}" as ${status}?`)) return;
  showLoader(true);
  try {
    await apiCall("markBulkAttendance", {
      usernames: ss.map(s => s.username),
      status, date: todayISO(), markedBy: state.user.username,
    });
    toast(`${ss.length} student${ss.length===1?"":"s"} marked ${status}`, "success");
    revalidate();
  } catch (err) {
    toast(err.message || "Could not mark", "error");
  } finally { showLoader(false); }
}

function openBulkAttendanceModal() {
  const classes = [...new Set(state.students.map(s => (s.class || "Unassigned")))].sort();
  openModal({
    title: "Mark today's attendance",
    body: `
      <form id="bulk-att-form" class="auth-form">
        <div class="field">
          <label>Class</label>
          <select id="ba-class" required>
            ${classes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select id="ba-status">
            <option value="present">Present (everyone)</option>
            <option value="absent">Absent (everyone)</option>
            <option value="late">Late (everyone)</option>
          </select>
        </div>
        <p class="hint" style="color:var(--text-muted);font-size:12px;margin:0;">
          You can correct individuals afterwards on the Attendance page.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">
            <span class="btn-label">Mark class</span><span class="btn-spinner"></span>
          </button>
        </div>
      </form>`,
    onMount: (root) => {
      root.querySelector("#bulk-att-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector("button[type=submit]");
        setBtnLoading(btn, true);
        try {
          closeModal();
          await bulkMarkClass(root.querySelector("#ba-class").value, root.querySelector("#ba-status").value);
        } finally { setBtnLoading(btn, false); }
      });
    },
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
          revalidate();
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
    state.students = state.students.filter(x => String(x.username).toLowerCase() !== String(username).toLowerCase());
    renderPage(state.page);
    await apiCall("deleteStudent", { username });
    toast("Student removed", "success");
    revalidate();
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

  // ---- Student view: read-only "Meet your teachers" ----
  if (!isStaff()) {
    const list = [...state.teachers].sort((a,b) =>
      String(a.name || a.username).localeCompare(String(b.name || b.username)));
    area.innerHTML = `
      <div class="page">
        <div class="card">
          <div class="section-head" style="margin-bottom:14px">
            <div><h3>${list.length} teacher${list.length===1?"":"s"}</h3>
            <p>Tap a teacher to start a chat.</p></div>
          </div>
          ${ list.length === 0
            ? `<div class="empty-state">No teachers yet.</div>`
            : `<div class="teacher-grid">${list.map(t => `
                <button type="button" class="teacher-card" data-username="${escapeHtml(t.username)}">
                  <div class="avatar">${initials(t.name || t.username)}</div>
                  <div class="tc-body">
                    <div class="tc-name">${escapeHtml(t.name || "—")}</div>
                    <div class="tc-meta">
                      ${t.subject ? `<span class="pill violet">${escapeHtml(t.subject)}</span>` : ""}
                      <span class="pill ${t.role==="owner"?"warn":t.role==="coowner"?"info":"muted"}">${escapeHtml(t.role || "teacher")}</span>
                    </div>
                    ${t.email || t.phone ? `<div class="tc-contact">${escapeHtml(t.email || t.phone)}</div>` : ""}
                  </div>
                  <span class="tc-arrow">${ICONS.chat}</span>
                </button>`).join("")}</div>`
          }
        </div>
      </div>`;
    $$(".teacher-card").forEach(c => c.addEventListener("click", () => {
      state.chatPeer = c.dataset.username;
      go("messages");
    }));
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
    state.teachers = state.teachers.map(t => (String(t.username).toLowerCase() === String(username).toLowerCase()) ? {...t, role: makeCoOwner ? "coowner" : "teacher"} : t);
    renderPage(state.page);
    await apiCall("setTeacherRole", { username, makeCoOwner });
    toast(makeCoOwner ? "Promoted to co-owner" : "Set back to teacher", "success");
    revalidate();
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
          revalidate();
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
    state.teachers = state.teachers.filter(x => String(x.username).toLowerCase() !== String(username).toLowerCase());
    renderPage(state.page);
    await apiCall("deleteTeacher", { username });
    toast("Teacher removed", "success");
    revalidate();
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
          // Exact match on "yyyy-MM-dd" — server always returns this clean format now.
          // The old .startsWith() was fragile and could match wrong dates.
          .filter(a => String(a.date || "") === d)
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
          // Optimistically patch local state so other pages see the change instantly
          const idx = state.attendance.findIndex(a =>
            String(a.username||"").toLowerCase() === String(username).toLowerCase() &&
            String(a.date||"") === d);
          if (idx >= 0) state.attendance[idx] = { ...state.attendance[idx], status };
          else state.attendance.push({ username, date: d, status, name: (state.students.find(s => String(s.username).toLowerCase()===String(username).toLowerCase())||{}).name || username });
          try {
            await apiCall("markAttendance", { username, date: d, status });
            toast("Attendance saved", "success", 1500);
            saveCache({
              students: state.students, teachers: state.teachers,
              attendance: state.attendance, marks: state.marks,
              fees: state.fees, homework: state.homework,
              notes: state.notes, messages: state.messages, profile: state.profile,
            });
          } catch (err) {
            toast(err.message || "Failed to save", "error");
          }
        });
      });
    };
    $("#load-att-btn").addEventListener("click", async () => {
      // "Load" button fetches fresh data from the server (in case another
      // teacher marked attendance after this page loaded), then re-renders.
      showLoader(true);
      try {
        state.attendance = normalizeList(await apiCall("getAttendance"), ["attendance","data"]);
      } catch {}
      showLoader(false);
      renderRows();
    });
    // Auto-refresh the attendance rows whenever the date picker changes.
    // No need to click "Load" — the cached state.attendance holds all dates.
    $("#att-date").addEventListener("change", () => renderRows());
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
          <div class="section-head" style="margin-bottom:14px"><div><h3>Calendar</h3><p>Green = present, red = absent, amber = late.</p></div></div>
          <div id="cal-host">${attendanceCalendar(list)}</div>
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
    function bindCal() {
      $$(".cal-prev,.cal-next").forEach(b => b.onclick = () => {
        $("#cal-host").innerHTML = attendanceCalendar(list, b.dataset.ym);
        bindCal();
      });
    }
    bindCal();
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
const _marksSort = { key: "date", dir: "desc" };
function _sortMarks(list) {
  const k = _marksSort.key;
  const d = _marksSort.dir === "asc" ? 1 : -1;
  return list.slice().sort((a,b) => {
    let av, bv;
    if (k === "marks") {
      av = (Number(a.maxMarks)||0) ? Number(a.marks||0)/Number(a.maxMarks||100) : Number(a.marks||0);
      bv = (Number(b.maxMarks)||0) ? Number(b.marks||0)/Number(b.maxMarks||100) : Number(b.marks||0);
      return (av - bv) * d;
    }
    av = String(a[k] || "").toLowerCase();
    bv = String(b[k] || "").toLowerCase();
    return av.localeCompare(bv) * d;
  });
}
function renderMarks() {
  const area = $("#page-area");
  const raw = isStaff() ? state.marks : studentOwn(state.marks);
  const list = _sortMarks(raw);
  const arrow = (k) => _marksSort.key === k ? (_marksSort.dir === "asc" ? " ▲" : " ▼") : "";

  area.innerHTML = `
    <div class="page">
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} entr${list.length === 1 ? "y" : "ies"}</h3>
            <p>${isStaff() ? "Record marks for tests and exams." : "Tap a column header to sort by date, subject or score."}</p>
          </div>
          ${ isStaff()
            ? `<button class="btn btn-primary" id="add-mark-btn">${ICONS.plus} Add mark</button>` : "" }
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No marks recorded yet.</div>`
          : `<div class="table-wrap"><table class="data sortable">
              <thead><tr>
                ${isStaff() ? "<th>Student</th>" : ""}
                <th class="sort-h" data-sort="subject">Subject${arrow("subject")}</th>
                <th class="sort-h" data-sort="test">Test${arrow("test")}</th>
                <th class="sort-h" data-sort="marks">Score${arrow("marks")}</th>
                <th class="sort-h" data-sort="date">Date${arrow("date")}</th>
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

  $$(".sort-h").forEach(h => h.addEventListener("click", () => {
    const k = h.dataset.sort;
    if (_marksSort.key === k) _marksSort.dir = _marksSort.dir === "asc" ? "desc" : "asc";
    else { _marksSort.key = k; _marksSort.dir = k === "date" ? "desc" : "asc"; }
    renderMarks();
  }));

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
          revalidate();
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
          revalidate();
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
    state.fees = state.fees.map(f => ((id && f.id===id) || (!id && String(f.username).toLowerCase()===String(username).toLowerCase() && String(f.status).toLowerCase()!=="paid")) ? {...f, status: "paid"} : f);
    renderPage(state.page);
    await apiCall("updateFee", { id, username, status: "paid" });
    toast("Marked as paid", "success");
    revalidate();
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
          revalidate();
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
  const score = Number(n.score || 0);
  const badge = score > 0
    ? `<span class="score-badge pos">+1</span>`
    : score < 0 ? `<span class="score-badge neg">−1</span>`
    : `<span class="score-badge neutral">0</span>`;
  return `
    <div class="list-item">
      <div class="list-item-head">
        <div>
          <div class="list-item-title">${badge} ${escapeHtml(n.title || "Note")}</div>
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

  // Total behavioural score for the student view (or whole-institute average for staff)
  const total = list.reduce((a, n) => a + Number(n.score || 0), 0);
  const positives = list.filter(n => Number(n.score || 0) > 0).length;
  const negatives = list.filter(n => Number(n.score || 0) < 0).length;
  const totalClass = total > 0 ? "pos" : total < 0 ? "neg" : "neutral";

  area.innerHTML = `
    <div class="page">
      ${ !isStaff()
        ? `<div class="kpi-grid">
             ${kpiCard({ icon: "edit", color: "violet", label: "Behavioural score", value: (total>0?"+":"")+total, foot: "Sum of all remarks" })}
             ${kpiCard({ icon: "edit", color: "green",  label: "Positive remarks", value: positives, foot: "+1 each" })}
             ${kpiCard({ icon: "edit", color: "red",    label: "Needs-work remarks", value: negatives, foot: "−1 each" })}
           </div>`
        : "" }
      <div class="card">
        <div class="section-head" style="margin-bottom:16px">
          <div>
            <h3>${list.length} remark${list.length === 1 ? "" : "s"} <span class="score-badge ${totalClass}" style="margin-left:6px">${total>0?"+":""}${total}</span></h3>
            <p>${isStaff() ? "Each remark adds +1 (positive) or −1 (needs work) to a student's score." : "Remarks your teachers have written about you."}</p>
          </div>
          ${ isStaff()
            ? `<button class="btn btn-primary" id="add-note-btn">${ICONS.plus} Add remark</button>` : "" }
        </div>
        ${ list.length === 0
          ? `<div class="empty-state">No remarks yet.</div>`
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
      let activeKind = "positive";
      const tabs = root.querySelectorAll(".remark-tab");
      tabs.forEach(t => t.addEventListener("click", () => {
        tabs.forEach(x => x.classList.toggle("is-active", x === t));
        activeKind = t.dataset.tab;
        root.querySelector("#remark-grid-positive").classList.toggle("hidden", activeKind !== "positive");
        root.querySelector("#remark-grid-negative").classList.toggle("hidden", activeKind !== "negative");
      }));

      // Clicking a chip fills the title (and selects it visually) AND sets kind
      const titleInput = root.querySelector("#n-title");
      root.querySelectorAll(".remark-chip").forEach(c => {
        c.addEventListener("click", () => {
          titleInput.value = c.dataset.text;
          activeKind = c.classList.contains("negative") ? "negative" : "positive";
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
            kind: activeKind,                           // "positive" → +1, "negative" → −1
            score: activeKind === "positive" ? 1 : -1,  // server understands both
            author: state.user.name || state.user.username,
          });
          toast("Remark saved", "success");
          closeModal();
          revalidate();
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
  // Hydrate from cached profile (saved in bootstrap), else fall back to session user
  const p = state.profile || {};
  const isStudent = String(u.role).toLowerCase() === "student";
  const extras = (p.extras && typeof p.extras === "object") ? p.extras : {};
  const extrasArr = Object.keys(extras).map(k => ({ key: k, val: extras[k] }));

  area.innerHTML = `
    <div class="page">
      <div class="profile-banner">
        <div class="avatar">${initials(u.name)}</div>
        <div>
          <h2>${escapeHtml(p.name || u.name)}</h2>
          <p>${escapeHtml(u.institute)} · ${escapeHtml(u.role)}${p.class ? " · " + escapeHtml(p.class) : ""}</p>
        </div>
      </div>

      <div class="card">
        <div class="section-head" style="margin-bottom:14px">
          <div><h3>Edit profile</h3><p>Updates save instantly to your record.</p></div>
        </div>
        <form id="profile-form" class="auth-form">
          <div class="field-row">
            <div class="field"><label>Full name</label>
              <input type="text" id="pf-name" value="${escapeHtml(p.name || u.name || "")}" required /></div>
            <div class="field"><label>Phone</label>
              <input type="text" id="pf-phone" value="${escapeHtml(p.phone || "")}" placeholder="+91 …" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Email</label>
              <input type="email" id="pf-email" value="${escapeHtml(p.email || "")}" /></div>
            <div class="field"><label>Other contact</label>
              <input type="text" id="pf-contact" value="${escapeHtml(p.contact || "")}" placeholder="Alternate number" /></div>
          </div>
          <div class="field"><label>Address</label>
            <textarea id="pf-address" rows="2">${escapeHtml(p.address || "")}</textarea></div>

          ${ isStudent
            ? `<div class="field"><label>Class</label>
                <input type="text" id="pf-class" value="${escapeHtml(p.class || "")}" placeholder="e.g. Grade 8" /></div>`
            : `<div class="field"><label>Subject(s) you teach</label>
                <input type="text" id="pf-subject" value="${escapeHtml(p.subject || "")}" placeholder="Comma separated" /></div>` }

          <div class="field">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label style="margin:0">Extra fields</label>
              <button type="button" class="btn btn-ghost btn-sm" id="pf-add-extra">+ Add field</button>
            </div>
            <div id="pf-extras">
              ${ extrasArr.length === 0
                ? `<small style="color:var(--text-muted);font-size:12px;">No extra fields. Add one for things like guardian name, blood group, hobbies.</small>`
                : extrasArr.map(e => extraFieldHtml(e.key, e.val)).join("") }
            </div>
          </div>

          <div class="modal-actions" style="margin-top:8px">
            <button type="submit" class="btn btn-primary">
              <span class="btn-label">Save profile</span><span class="btn-spinner"></span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  $("#pf-add-extra").addEventListener("click", () => {
    const wrap = $("#pf-extras");
    if (wrap.querySelector("small")) wrap.innerHTML = "";
    wrap.insertAdjacentHTML("beforeend", extraFieldHtml("", ""));
    bindExtraRemove();
  });
  bindExtraRemove();

  $("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    setBtnLoading(btn, true);
    // Collect extras
    const extrasOut = {};
    $$("#pf-extras .extra-row").forEach(row => {
      const k = row.querySelector(".ex-key").value.trim();
      const v = row.querySelector(".ex-val").value.trim();
      if (k) extrasOut[k] = v;
    });
    const payload = {
      username: u.username,
      name: $("#pf-name").value.trim(),
      phone: $("#pf-phone").value.trim(),
      email: $("#pf-email").value.trim(),
      contact: $("#pf-contact").value.trim(),
      address: $("#pf-address").value.trim(),
      extras: extrasOut,
    };
    if (isStudent) payload.class = ($("#pf-class")?.value || "").trim();
    else payload.subject = ($("#pf-subject")?.value || "").trim();
    try {
      // Optimistic local update
      state.profile = { ...(state.profile||{}), ...payload, extras: extrasOut };
      state.user.name = payload.name;
      saveSession(state.user);
      // Refresh sidebar avatar/name via re-mounting just the user header
      const sidebarName = document.querySelector("#sidebar .sb-user-name");
      if (sidebarName) sidebarName.textContent = payload.name;
      await apiCall("updateProfile", payload);
      toast("Profile updated", "success");
      revalidate();
    } catch (err) {
      toast(err.message || "Failed", "error");
    } finally { setBtnLoading(btn, false); }
  });
}

function extraFieldHtml(k, v) {
  return `<div class="extra-row">
    <input class="ex-key" type="text" value="${escapeHtml(k)}" placeholder="Field name (e.g. Guardian)" />
    <input class="ex-val" type="text" value="${escapeHtml(v)}" placeholder="Value" />
    <button type="button" class="btn btn-ghost btn-sm ex-rm">${ICONS.trash}</button>
  </div>`;
}
function bindExtraRemove() {
  $$(".ex-rm").forEach(b => b.onclick = () => b.closest(".extra-row").remove());
}

/* ============================================================
   ATTENDANCE CALENDAR — render a month grid coloured green/red/amber
   ============================================================ */
function attendanceCalendar(records, ym) {
  // ym = "YYYY-MM" (defaults to current month)
  const now = new Date();
  const [Y, M] = (ym || (now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0")))
    .split("-").map(Number);
  const first = new Date(Y, M - 1, 1);
  const daysInMonth = new Date(Y, M, 0).getDate();
  const startDow = first.getDay(); // 0 = Sun

  const map = {};
  records.forEach(r => {
    const d = String(r.date || "");
    if (d.startsWith(`${Y}-${String(M).padStart(2,"0")}`)) {
      map[d] = String(r.status || "").toLowerCase();
    }
  });

  const monthName = first.toLocaleString(undefined, { month: "long", year: "numeric" });
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-cell empty"></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${Y}-${String(M).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const st = map[iso] || "";
    const cls = st === "present" ? "present" : st === "absent" ? "absent" : st === "late" ? "late" : "";
    cells.push(`<div class="cal-cell ${cls}" title="${iso}${st ? " · " + st : ""}">${day}</div>`);
  }

  const present = Object.values(map).filter(v => v === "present").length;
  const absent  = Object.values(map).filter(v => v === "absent").length;
  const late    = Object.values(map).filter(v => v === "late").length;

  // Prev/next month nav
  const prev = M === 1 ? `${Y-1}-12` : `${Y}-${String(M-1).padStart(2,"0")}`;
  const next = M === 12 ? `${Y+1}-01` : `${Y}-${String(M+1).padStart(2,"0")}`;

  return `
    <div class="cal-wrap" data-ym="${Y}-${String(M).padStart(2,"0")}">
      <div class="cal-head">
        <button type="button" class="btn btn-ghost btn-sm cal-prev" data-ym="${prev}">‹</button>
        <strong>${escapeHtml(monthName)}</strong>
        <button type="button" class="btn btn-ghost btn-sm cal-next" data-ym="${next}">›</button>
        <span class="cal-legend">
          <span><i class="dot present"></i>Present ${present}</span>
          <span><i class="dot absent"></i>Absent ${absent}</span>
          <span><i class="dot late"></i>Late ${late}</span>
        </span>
      </div>
      <div class="cal-grid cal-dows">
        ${["S","M","T","W","T","F","S"].map(d => `<div class="cal-dow">${d}</div>`).join("")}
      </div>
      <div class="cal-grid">${cells.join("")}</div>
    </div>`;
}

/* ============================================================
   PAGE: STUDENT DETAIL (teacher → tap a student card)
   ============================================================ */
function renderStudentDetail() {
  const area = $("#page-area");
  const username = state.detailUsername;
  const student = state.students.find(s => String(s.username).toLowerCase() === String(username||"").toLowerCase());
  if (!student) {
    area.innerHTML = `<div class="card empty-state">Student not found. <button class="btn btn-ghost" id="back-students">Back to students</button></div>`;
    $("#back-students").onclick = () => go("students");
    return;
  }

  const att   = state.attendance.filter(a => String(a.username||"").toLowerCase() === String(username).toLowerCase());
  const marks = state.marks     .filter(m => String(m.username||"").toLowerCase() === String(username).toLowerCase());
  const fees  = state.fees      .filter(f => String(f.username||"").toLowerCase() === String(username).toLowerCase());
  const notes = state.notes     .filter(n => String(n.studentUsername||n.username||"").toLowerCase() === String(username).toLowerCase());
  const score = notes.reduce((a,n) => a + Number(n.score || 0), 0);
  const scoreClass = score > 0 ? "pos" : score < 0 ? "neg" : "neutral";

  const present = att.filter(a => String(a.status).toLowerCase()==="present").length;
  const pct = att.length ? Math.round((present/att.length)*100) : 0;

  area.innerHTML = `
    <div class="page">
      <div class="profile-banner">
        <button class="btn btn-ghost btn-sm" id="back-students" style="margin-right:10px">‹ Back</button>
        <div class="avatar">${initials(student.name || student.username)}</div>
        <div style="flex:1">
          <h2>${escapeHtml(student.name || student.username)}</h2>
          <p>@${escapeHtml(student.username)}${student.class ? " · " + escapeHtml(student.class) : ""}${student.contact ? " · " + escapeHtml(student.contact) : ""}</p>
        </div>
        <span class="score-badge ${scoreClass}" style="font-size:18px;padding:8px 14px">${score>0?"+":""}${score}</span>
      </div>

      <div class="kpi-grid">
        ${kpiCard({ icon:"calendar-check", color:"green", label:"Attendance", value: pct + "%", foot: `${present}/${att.length} classes` })}
        ${kpiCard({ icon:"award", color:"violet", label:"Marks recorded", value: marks.length, foot:"tests / exams" })}
        ${kpiCard({ icon:"wallet", color:"amber", label:"Pending fees", value: fees.filter(f=>String(f.status).toLowerCase()!=="paid").length, foot:"records" })}
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="section-head" style="margin-bottom:12px"><div><h3>Attendance calendar</h3></div>
            <button class="btn btn-ghost btn-sm" id="quick-att-btn">Mark today</button></div>
          <div id="cal-host">${attendanceCalendar(att)}</div>
        </div>

        <div class="card">
          <div class="section-head" style="margin-bottom:12px">
            <div><h3>Remarks (${notes.length})</h3>
              <p>Each remark is +1 or −1 toward this student's score.</p></div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-success btn-sm" id="quick-pos">+1 Positive</button>
              <button class="btn btn-ghost btn-sm" id="quick-neg" style="color:var(--danger)">−1 Needs work</button>
            </div>
          </div>
          ${ notes.length === 0
            ? `<div class="empty-state">No remarks yet.</div>`
            : `<div class="list">${notes
                .slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))
                .map(noteRow).join("")}</div>` }
        </div>
      </div>

      <div class="card">
        <div class="section-head" style="margin-bottom:12px"><div><h3>Marks history</h3></div></div>
        ${ marks.length === 0
          ? `<div class="empty-state">No marks recorded.</div>`
          : `<div class="table-wrap"><table class="data">
              <thead><tr><th>Subject</th><th>Test</th><th>Score</th><th>Date</th></tr></thead>
              <tbody>${marks
                .slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))
                .map(m => {
                  const max = Number(m.maxMarks || 100);
                  const sc = Number(m.marks || 0);
                  const p = max ? Math.round((sc/max)*100) : 0;
                  return `<tr>
                    <td>${escapeHtml(m.subject || "—")}</td>
                    <td style="color:var(--text-muted)">${escapeHtml(m.test || "—")}</td>
                    <td><strong>${sc}</strong> / ${max}
                      <span class="pill ${p>=75?"success":p>=50?"info":"danger"}" style="margin-left:6px">${p}%</span></td>
                    <td style="color:var(--text-muted)">${escapeHtml(formatDate(m.date))}</td>
                  </tr>`;
                }).join("")}</tbody>
            </table></div>` }
      </div>
    </div>`;

  $("#back-students").onclick = () => go("students");

  // Calendar prev/next month navigation — re-render only the cal host
  function bindCal() {
    $$(".cal-prev,.cal-next").forEach(b => b.onclick = () => {
      $("#cal-host").innerHTML = attendanceCalendar(att, b.dataset.ym);
      bindCal();
    });
  }
  bindCal();

  $("#quick-att-btn").onclick = async () => {
    showLoader(true);
    try {
      await apiCall("markAttendance", { username, date: todayISO(), status: "present" });
      toast("Marked present today", "success");
      revalidate();
    } catch (err) { toast(err.message || "Failed", "error"); }
    finally { showLoader(false); }
  };
  $("#quick-pos").onclick = () => quickRemark(username, 1);
  $("#quick-neg").onclick = () => quickRemark(username, -1);
}

async function quickRemark(username, score) {
  const text = prompt(score > 0 ? "Positive remark (e.g. Helped a classmate):" : "Needs-work remark (e.g. Did not finish homework):");
  if (!text) return;
  showLoader(true);
  try {
    await apiCall("addNote", {
      studentUsername: username, title: text, note: "",
      kind: score > 0 ? "positive" : "negative",
      score, author: state.user.name || state.user.username,
    });
    toast(`Remark added (${score>0?"+1":"−1"})`, "success");
    revalidate();
  } catch (err) { toast(err.message || "Failed", "error"); }
  finally { showLoader(false); }
}

/* ============================================================
   PAGE: MESSAGES — thread-based chat between teacher & student
   ============================================================ */
function renderMessages() {
  const area = $("#page-area");
  const me = String(state.user.username).toLowerCase();
  const isStudent = !isStaff();

  // Build the contact list = the people on the other side of any message,
  // plus all teachers (for students) or all students (for teachers).
  const baseContacts = isStudent ? state.teachers : state.students;
  const contactMap = new Map();
  baseContacts.forEach(c => contactMap.set(String(c.username).toLowerCase(), {
    username: c.username, name: c.name || c.username,
    sub: c.subject || c.class || "", lastMsg: "", lastDate: "",
  }));
  state.messages.forEach(m => {
    const peer = String(m.fromUser).toLowerCase() === me ? m.toUser : m.fromUser;
    const key = String(peer).toLowerCase();
    const prev = contactMap.get(key) || { username: peer, name: peer, sub: "", lastMsg: "", lastDate: "" };
    if (!prev.lastDate || String(m.date) > prev.lastDate) {
      prev.lastDate = m.date;
      prev.lastMsg = m.body;
    }
    contactMap.set(key, prev);
  });
  const contacts = [...contactMap.values()].sort((a,b) =>
    String(b.lastDate || "").localeCompare(String(a.lastDate || "")));

  // Choose a peer
  const peer = state.chatPeer || (contacts[0] && contacts[0].username);
  state.chatPeer = peer;
  const thread = peer ? state.messages.filter(m => {
    const f = String(m.fromUser).toLowerCase();
    const t = String(m.toUser).toLowerCase();
    const p = String(peer).toLowerCase();
    return (f === me && t === p) || (f === p && t === me);
  }).sort((a,b) => String(a.date).localeCompare(String(b.date))) : [];

  area.innerHTML = `
    <div class="page">
      <div class="card chat-card">
        <div class="chat-grid">
          <aside class="chat-list">
            <div class="chat-list-head">${contacts.length} ${isStudent ? "teacher" : "student"}${contacts.length===1?"":"s"}</div>
            ${ contacts.length === 0
              ? `<div class="empty-state" style="padding:20px">No contacts yet.</div>`
              : contacts.map(c => `
                <button type="button" class="chat-contact ${String(c.username).toLowerCase()===String(peer||"").toLowerCase()?"is-active":""}" data-username="${escapeHtml(c.username)}">
                  <div class="avatar">${initials(c.name)}</div>
                  <div class="cc-body">
                    <div class="cc-name">${escapeHtml(c.name)}</div>
                    <div class="cc-snip">${escapeHtml(c.lastMsg || c.sub || "Tap to chat")}</div>
                  </div>
                </button>`).join("") }
          </aside>

          <section class="chat-thread">
            ${ !peer
              ? `<div class="empty-state" style="margin:auto">Select someone to start chatting.</div>`
              : `
                <header class="chat-thread-head">
                  <div class="avatar">${initials((contactMap.get(String(peer).toLowerCase())||{}).name || peer)}</div>
                  <strong>${escapeHtml((contactMap.get(String(peer).toLowerCase())||{}).name || peer)}</strong>
                </header>
                <div class="chat-bubbles" id="chat-bubbles">
                  ${ thread.length === 0
                    ? `<div class="empty-state" style="margin:auto">Say hello — no messages yet.</div>`
                    : thread.map(m => {
                        const mine = String(m.fromUser).toLowerCase() === me;
                        return `<div class="bubble ${mine?"mine":"theirs"}">
                          <div class="bubble-body">${escapeHtml(m.body)}</div>
                          <div class="bubble-time">${escapeHtml(formatChatTime(m.date))}</div>
                        </div>`;
                      }).join("") }
                </div>
                <form class="chat-form" id="chat-form">
                  <input type="text" id="chat-input" placeholder="Type a message…" autocomplete="off" required />
                  <button type="submit" class="btn btn-primary">Send</button>
                </form>` }
          </section>
        </div>
      </div>
    </div>`;

  $$(".chat-contact").forEach(b => b.onclick = () => {
    state.chatPeer = b.dataset.username;
    renderMessages();
  });
  // Auto-scroll
  const bubbles = $("#chat-bubbles");
  if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;

  const form = $("#chat-form");
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    // Optimistic bubble
    const stamp = todayISO() + "T" + new Date().toTimeString().slice(0,8);
    state.messages.push({
      id: "tmp_" + Date.now(),
      fromUser: state.user.username, toUser: peer,
      body, date: stamp, read: false,
    });
    renderMessages();
    try {
      await apiCall("sendMessage", { fromUser: state.user.username, toUser: peer, body });
      revalidate();
    } catch (err) {
      toast(err.message || "Could not send", "error");
    }
  };
}

function formatChatTime(d) {
  if (!d) return "";
  const s = String(d);
  // Format "YYYY-MM-DDTHH:MM:SS" → "MMM D, HH:MM"
  const dt = new Date(s.length === 10 ? s + "T00:00:00" : s);
  if (isNaN(dt)) return s;
  return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
    $("#sidebar-backdrop").classList.toggle("is-open", state.sidebarOpen);
    document.body.classList.toggle("sb-locked", state.sidebarOpen);
  });

  // Click outside sidebar (mobile) closes it
  document.addEventListener("click", (e) => {
    if (!state.sidebarOpen) return;
    const sb = $("#sidebar");
    if (!sb.contains(e.target) && !$("#menu-toggle").contains(e.target)) {
      state.sidebarOpen = false;
      sb.classList.remove("is-open");
      $("#sidebar-backdrop").classList.remove("is-open");
      document.body.classList.remove("sb-locked");
    }
  });

  // Tapping the dark backdrop also closes the sidebar
  $("#sidebar-backdrop").addEventListener("click", () => {
    state.sidebarOpen = false;
    $("#sidebar").classList.remove("is-open");
    $("#sidebar-backdrop").classList.remove("is-open");
    document.body.classList.remove("sb-locked");
  });

  let searchTimeout;
  $("#global-search").addEventListener("input", () => {
    if (!isStaff()) return;
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
