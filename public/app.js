const state = {
  data: null,
  userId: localStorage.getItem("aq-user") || "u-employee",
  view: localStorage.getItem("aq-view") || "dashboard"
};

const $ = selector => document.querySelector(selector);
const view = $("#view");
const alerts = $("#alerts");
const periodLabels = { "goal-setting": "Goal Setting", q1: "Q1", q2: "Q2", q3: "Q3", q4: "Q4 / Annual" };
const periods = ["q1", "q2", "q3", "q4"];

function currentUser() {
  return state.data.users.find(user => user.id === state.userId);
}

function userName(id) {
  return state.data.users.find(user => user.id === id)?.name || "Unknown";
}

function employeeGoals(employeeId) {
  return state.data.goals.filter(goal => goal.employeeId === employeeId && goal.status !== "archived");
}

function teamMembers(managerId = state.userId) {
  return state.data.users.filter(user => user.managerId === managerId && user.role === "employee");
}

function period() {
  return state.data.cycle.activePeriod;
}

function isQuarterOpen() {
  return periods.includes(period()) && state.data.cycle.windows[period()].status === "open";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, match => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[match]));
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function badge(status) {
  const tone = status === "locked" || status === "Completed" || status === "approved" ? "ok" : status === "returned" || status === "open" ? "warn" : status === "draft" ? "" : "danger";
  return `<span class="badge ${tone}">${escapeHtml(status)}</span>`;
}

function goalScore(goal, p = period()) {
  const update = goal.actuals?.[p];
  if (!update || update.actual === "") return null;
  let raw = 0;
  if (goal.uomType === "Timeline") {
    const completion = new Date(update.actual);
    const deadline = new Date(goal.deadline || goal.target);
    raw = completion <= deadline ? 1 : Math.max(0, 1 - ((completion - deadline) / 86400000) / 90);
  } else if (goal.uomType === "Zero") {
    raw = Number(update.actual) === 0 ? 1 : 0;
  } else if (goal.direction === "max") {
    raw = Number(update.actual) === 0 ? 1 : Number(goal.target) / Number(update.actual);
  } else {
    raw = Number(update.actual) / Number(goal.target);
  }
  return Math.round(Math.max(0, Math.min(1.5, raw)) * 100);
}

function weightedProgress(goals, p = period()) {
  const locked = goals.filter(goal => goal.status === "locked");
  if (!locked.length) return 0;
  const total = locked.reduce((sum, goal) => sum + ((goalScore(goal, p) || 0) * Number(goal.weightage || 0)), 0);
  return Math.round(total / 100);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": state.userId,
      ...(options.headers || {})
    }
  });
  if (path.endsWith(".csv")) return response;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  state.data = payload;
  render();
  return payload;
}

async function load() {
  const response = await fetch("/api/bootstrap", { headers: { "x-user-id": state.userId } });
  state.data = await response.json();
  if (!state.data.users.some(user => user.id === state.userId)) state.userId = state.data.users[0].id;
  render();
}

function show(message, error = false) {
  alerts.innerHTML = `<div class="notice ${error ? "error" : ""}">${escapeHtml(message)}</div>`;
  setTimeout(() => { alerts.innerHTML = ""; }, 4500);
}

function navItems(user) {
  const base = [{ id: "dashboard", label: "Dashboard" }, { id: "goals", label: "Goals" }];
  if (user.role === "employee") base.push({ id: "checkins", label: "My Check-ins" });
  if (user.role === "manager") base.push({ id: "approvals", label: "Approvals" }, { id: "checkins", label: "Team Check-ins" }, { id: "shared", label: "Shared KPIs" });
  if (user.role === "admin") base.push({ id: "admin", label: "Admin / HR" }, { id: "shared", label: "Shared KPIs" });
  base.push({ id: "analytics", label: "Analytics" }, { id: "audit", label: "Audit Trail" });
  return base;
}

function renderShell() {
  const user = currentUser();
  $("#userSelect").innerHTML = state.data.users.map(item => `<option value="${item.id}" ${item.id === state.userId ? "selected" : ""}>${item.name} · ${item.role}</option>`).join("");
  $("#roleLabel").textContent = `${user.role.toUpperCase()} · ${user.department}`;
  $("#pageTitle").textContent = navItems(user).find(item => item.id === state.view)?.label || "Dashboard";
  $("#activeWindow").textContent = periodLabels[period()];
  $("#activeWindowDate").textContent = `Opens ${state.data.cycle.windows[period()].opens}`;
  $("#reportLink").style.display = ["manager", "admin"].includes(user.role) ? "inline-flex" : "none";
  $("#reportLink").href = `/api/report.csv?user=${state.userId}`;
  const allowed = navItems(user);
  if (!allowed.some(item => item.id === state.view)) state.view = "dashboard";
  $("#nav").innerHTML = allowed.map(item => `<button class="${state.view === item.id ? "active" : ""}" data-nav="${item.id}">${item.label}</button>`).join("");
}

function render() {
  renderShell();
  const routes = {
    dashboard: renderDashboard,
    goals: renderGoals,
    approvals: renderApprovals,
    checkins: renderCheckins,
    shared: renderShared,
    admin: renderAdmin,
    analytics: renderAnalytics,
    audit: renderAudit
  };
  (routes[state.view] || renderDashboard)();
}

function renderDashboard() {
  const user = currentUser();
  if (user.role === "employee") return renderEmployeeDashboard(user);
  if (user.role === "manager") return renderManagerDashboard(user);
  return renderAdminDashboard();
}

function renderEmployeeDashboard(user) {
  const goals = employeeGoals(user.id);
  const total = goals.reduce((sum, goal) => sum + Number(goal.weightage || 0), 0);
  const locked = goals.filter(goal => goal.status === "locked").length;
  const notes = state.data.notifications.filter(item => item.toUserId === user.id).slice(0, 5);
  view.innerHTML = `
    <div class="grid four">
      ${stat("Goals", goals.length, "Maximum 8")}
      ${stat("Weightage", `${total}%`, "Must equal 100%")}
      ${stat("Locked", locked, "Approved goals")}
      ${stat("Progress", `${weightedProgress(goals)}%`, `${periodLabels[period()]} score`)}
    </div>
    <div class="grid two">
      <section class="panel">
        <div class="panel-header"><h2>My Goals</h2><button data-view="goals">Open Goals</button></div>
        ${goalTable(goals, { compact: true })}
      </section>
      <section class="panel">
        <h2>Notifications</h2>
        ${notes.length ? notes.map(note => `<p>${badge(note.type)} ${escapeHtml(note.message)}</p>`).join("") : empty()}
      </section>
    </div>
  `;
}

function renderManagerDashboard(user) {
  const team = teamMembers(user.id);
  const pending = team.filter(employee => employeeGoals(employee.id).some(goal => goal.status === "submitted"));
  view.innerHTML = `
    <div class="grid four">
      ${stat("Team Members", team.length, "Direct reports")}
      ${stat("Pending Approval", pending.length, "Goal sheets")}
      ${stat("Check-in Window", isQuarterOpen() ? "Open" : "Closed", periodLabels[period()])}
      ${stat("Open Escalations", state.data.escalations.filter(item => item.managerId === user.id && item.status === "open").length, "Rule based")}
    </div>
    <section class="panel">
      <div class="panel-header"><h2>Team Progress</h2><button data-view="checkins">Check-ins</button></div>
      ${teamTable(team)}
    </section>
  `;
}

function renderAdminDashboard() {
  const employees = state.data.users.filter(user => user.role === "employee");
  view.innerHTML = `
    <div class="grid four">
      ${stat("Employees", employees.length, "In hierarchy")}
      ${stat("Managers", state.data.users.filter(user => user.role === "manager").length, "L1 approvers")}
      ${stat("Goal Records", state.data.goals.length, "Across cycles")}
      ${stat("Audit Events", state.data.auditLogs.length, "Governance trail")}
    </div>
    <section class="panel">
      <h2>Completion Dashboard</h2>
      ${completionBars()}
    </section>
  `;
}

function stat(label, value, hint) {
  return `<section class="panel stat"><span class="eyebrow">${label}</span><strong>${value}</strong><small>${hint}</small></section>`;
}

function renderGoals() {
  const user = currentUser();
  const employeeId = user.role === "employee" ? user.id : $("#employeeFilter")?.value || state.data.users.find(item => item.role === "employee")?.id;
  const goals = employeeGoals(employeeId);
  const canCreate = user.role === "employee" && goals.every(goal => ["draft", "returned"].includes(goal.status)) && goals.length < 8;
  view.innerHTML = `
    <div class="grid">
      ${user.role !== "employee" ? employeeFilter(employeeId) : ""}
      <section class="panel">
        <div class="panel-header">
          <div><h2>Goal Sheet</h2><small>Total weightage: ${goals.reduce((sum, goal) => sum + Number(goal.weightage || 0), 0)}% · Status: ${goalSheetStatus(goals)}</small></div>
          <div class="actions">
            ${user.role === "employee" ? `<button data-submit-goals="${user.id}">Submit for Approval</button>` : ""}
          </div>
        </div>
        ${goalTable(goals, { editable: user.role === "employee" || user.role === "admin" })}
      </section>
      ${canCreate ? goalForm() : ""}
    </div>
  `;
}

function goalSheetStatus(goals) {
  if (!goals.length) return "empty";
  if (goals.every(goal => goal.status === "locked")) return "locked";
  if (goals.some(goal => goal.status === "submitted")) return "submitted";
  if (goals.some(goal => goal.status === "returned")) return "returned";
  return "draft";
}

function goalForm() {
  return `
    <section class="panel">
      <h2>Add Goal</h2>
      <form id="goalForm" class="form-grid">
        ${input("thrustArea", "Thrust Area", "Revenue Growth")}
        ${input("title", "Goal Title", "Increase enterprise revenue", "wide")}
        ${select("uomType", "UoM", ["Numeric", "%", "Timeline", "Zero"])}
        ${select("direction", "Formula", [["min", "Min · higher is better"], ["max", "Max · lower is better"]])}
        ${input("target", "Target", "100")}
        ${input("deadline", "Deadline", "2027-03-31", "", "date")}
        ${input("weightage", "Weightage %", "20", "", "number")}
        ${textarea("description", "Description", "Describe the measurable outcome.", "full")}
        <div class="actions full"><button type="submit">Add Draft Goal</button></div>
      </form>
    </section>
  `;
}

function renderApprovals() {
  const user = currentUser();
  const team = teamMembers(user.id);
  view.innerHTML = `
    <section class="panel">
      <h2>Manager Approval Workflow</h2>
      ${team.map(employee => approvalCard(employee)).join("") || empty()}
    </section>
  `;
}

function approvalCard(employee) {
  const goals = employeeGoals(employee.id);
  const submitted = goals.some(goal => goal.status === "submitted");
  return `
    <div class="panel">
      <div class="panel-header">
        <div><h3>${escapeHtml(employee.name)}</h3><small>${employee.department} · ${goalSheetStatus(goals)}</small></div>
        <div class="actions">
          <button ${submitted ? "" : "disabled"} data-decision="approve" data-employee="${employee.id}">Approve & Lock</button>
          <button class="secondary" ${submitted ? "" : "disabled"} data-decision="return" data-employee="${employee.id}">Return</button>
        </div>
      </div>
      ${goalTable(goals, { managerEdit: submitted })}
      <textarea data-return-comment="${employee.id}" placeholder="Return comment or discussion note"></textarea>
    </div>
  `;
}

function renderCheckins() {
  const user = currentUser();
  if (user.role === "employee") {
    view.innerHTML = `
      <section class="panel">
        <div class="panel-header"><div><h2>Quarterly Achievement Capture</h2><small>${isQuarterOpen() ? "Window is open" : "Ask Admin to open a quarterly demo window"}</small></div></div>
        ${goalTable(employeeGoals(user.id), { actualEdit: isQuarterOpen() })}
      </section>
      <section class="panel"><h2>Manager Feedback</h2>${checkinList(user.id)}</section>
    `;
    return;
  }
  const team = teamMembers(user.id);
  view.innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>Team Check-ins</h2><small>${periodLabels[period()]} · ${isQuarterOpen() ? "Open" : "Closed"}</small></div>
      ${team.map(employee => managerCheckinCard(employee)).join("") || empty()}
    </section>
  `;
}

function managerCheckinCard(employee) {
  const goals = employeeGoals(employee.id);
  return `
    <div class="panel">
      <div class="panel-header"><div><h3>${employee.name}</h3><small>Weighted progress: ${weightedProgress(goals)}%</small></div>${badge(goalSheetStatus(goals))}</div>
      ${goalTable(goals, { compact: true, showActuals: true })}
      <form class="checkin-form" data-checkin="${employee.id}">
        <textarea name="comment" placeholder="Structured check-in comment covering progress, blockers, and next actions"></textarea>
        <div class="actions"><button ${isQuarterOpen() ? "" : "disabled"}>Save Check-in</button></div>
      </form>
      ${checkinList(employee.id)}
    </div>
  `;
}

function checkinList(employeeId) {
  const rows = state.data.checkins.filter(item => item.employeeId === employeeId);
  return rows.length ? rows.map(item => `<p>${badge(item.period.toUpperCase())} ${escapeHtml(item.comment)} <small>by ${userName(item.managerId)} · ${formatDate(item.createdAt)}</small></p>`).join("") : empty();
}

function renderShared() {
  const user = currentUser();
  const eligible = user.role === "manager" ? teamMembers(user.id) : state.data.users.filter(item => item.role === "employee");
  view.innerHTML = `
    <section class="panel">
      <h2>Push Shared Departmental KPI</h2>
      <form id="sharedForm" class="form-grid">
        ${input("thrustArea", "Thrust Area", "Operational Excellence")}
        ${input("title", "Shared KPI Title", "Reduce customer response TAT", "wide")}
        ${select("uomType", "UoM", ["Numeric", "%", "Timeline", "Zero"])}
        ${select("direction", "Formula", [["min", "Min · higher is better"], ["max", "Max · lower is better"]])}
        ${input("target", "Target", "4")}
        ${input("deadline", "Deadline", "2027-03-31", "", "date")}
        ${input("weightage", "Default Weightage %", "10", "", "number")}
        <label class="field full"><span>Recipients</span><select name="employeeIds" multiple size="5">${eligible.map(employee => `<option value="${employee.id}">${employee.name} · ${employee.department}</option>`).join("")}</select></label>
        ${textarea("description", "Description", "Title and target are read-only for recipients; they may adjust weightage only.", "full")}
        <div class="actions full"><button>Push KPI</button></div>
      </form>
    </section>
    <section class="panel"><h2>Existing Shared Goals</h2>${goalTable(state.data.goals.filter(goal => goal.sharedGroupId), { compact: true })}</section>
  `;
}

function renderAdmin() {
  const employees = state.data.users.filter(user => user.role === "employee");
  view.innerHTML = `
    <div class="grid two">
      <section class="panel">
        <h2>Cycle Management</h2>
        <form id="cycleForm" class="form-grid">
          ${select("activePeriod", "Open Window", Object.keys(state.data.cycle.windows).map(key => [key, `${periodLabels[key]} · ${state.data.cycle.windows[key].opens}`]), "wide")}
          <div class="actions full"><button>Open Selected Window</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>Exception Handling</h2>
        <form id="unlockForm" class="form-grid">
          ${select("employeeId", "Employee", employees.map(employee => [employee.id, employee.name]), "wide")}
          <div class="actions full"><button class="secondary">Unlock Locked Goals</button></div>
        </form>
      </section>
    </div>
    <section class="panel"><h2>Org Hierarchy</h2>${orgTable()}</section>
    <section class="panel"><h2>Escalation Log</h2>${escalationTable()}</section>
  `;
  $("#cycleForm [name=activePeriod]").value = period();
}

function renderAnalytics() {
  const summary = state.data.summary;
  view.innerHTML = `
    <div class="grid two">
      <section class="panel"><h2>Completion Heatmap</h2>${completionBars()}</section>
      <section class="panel"><h2>Goal Distribution</h2>${bars(summary.thrustCounts)}</section>
      <section class="panel"><h2>Status Mix</h2>${bars(summary.statusCounts)}</section>
      <section class="panel"><h2>Manager Effectiveness</h2>${managerBars()}</section>
    </div>
  `;
}

function renderAudit() {
  view.innerHTML = `
    <section class="panel">
      <h2>Audit Trail</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
          <tbody>${state.data.auditLogs.map(log => `<tr><td>${formatDate(log.createdAt)}</td><td>${userName(log.actorId)}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.entityType)}</td><td>${escapeHtml(log.field)}</td><td>${escapeHtml(log.before)}</td><td>${escapeHtml(log.after)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </section>
  `;
}

function goalTable(goals, options = {}) {
  if (!goals.length) return empty();
  const p = period();
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Goal</th><th>Thrust Area</th><th>UoM</th><th>Target</th><th>Weight</th><th>Status</th>${options.showActuals || options.actualEdit ? "<th>Actual</th><th>Progress</th>" : ""}<th>Actions</th></tr>
        </thead>
        <tbody>
          ${goals.map(goal => {
            const actualCell = options.actualEdit ? actualForm(goal, p) : options.showActuals ? `${escapeHtml(goal.actuals?.[p]?.actual || "")} ${badge(goal.actuals?.[p]?.status || "No update")}` : "";
            return `
              <tr>
                <td><strong>${escapeHtml(goal.title)}</strong><br><small>${escapeHtml(goal.description || "")}</small>${goal.sharedGroupId ? `<br><span class="readonly">Shared KPI · owner ${userName(goal.primaryOwnerId)}</span>` : ""}</td>
                <td>${editableCell(goal, "thrustArea", goal.thrustArea, options)}</td>
                <td>${escapeHtml(goal.uomType)}<br><small>${goal.direction === "max" ? "Target ÷ Achievement" : goal.uomType === "Zero" ? "0 = 100%" : goal.uomType === "Timeline" ? "By deadline" : "Achievement ÷ Target"}</small></td>
                <td>${editableCell(goal, "target", goal.target, options)}</td>
                <td>${editableCell(goal, "weightage", goal.weightage, options, "number")}%</td>
                <td>${badge(goal.status)}</td>
                ${options.showActuals || options.actualEdit ? `<td>${actualCell}</td><td>${goalScore(goal, p) ?? 0}%</td>` : ""}
                <td>${options.managerEdit || options.editable ? `<button class="secondary" data-save-goal="${goal.id}">Save</button>` : ""}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function editableCell(goal, field, value, options, type = "text") {
  const editable = options.managerEdit || options.editable;
  const blockedShared = goal.readonlySharedFields && ["thrustArea", "target"].includes(field) && currentUser().id === goal.employeeId;
  if (!editable || blockedShared) return escapeHtml(value);
  if (goal.status === "locked" && currentUser().role !== "admin") return escapeHtml(value);
  return `<input type="${type}" data-goal-field="${field}" data-goal-id="${goal.id}" value="${escapeHtml(value)}">`;
}

function actualForm(goal, p) {
  const current = goal.actuals?.[p] || {};
  const type = goal.uomType === "Timeline" ? "date" : goal.uomType === "Zero" || goal.uomType === "Numeric" || goal.uomType === "%" ? "number" : "text";
  return `
    <div class="grid">
      <input type="${type}" data-actual="${goal.id}" value="${escapeHtml(current.actual || "")}">
      <select data-actual-status="${goal.id}">
        ${["Not Started", "On Track", "Completed"].map(status => `<option ${current.status === status ? "selected" : ""}>${status}</option>`).join("")}
      </select>
      <button data-save-actual="${goal.id}">Save Actual</button>
    </div>
  `;
}

function teamTable(team) {
  if (!team.length) return empty();
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Employee</th><th>Department</th><th>Goal Sheet</th><th>Progress</th><th>Check-in</th></tr></thead>
        <tbody>${team.map(employee => {
          const goals = employeeGoals(employee.id);
          const done = state.data.checkins.some(item => item.employeeId === employee.id && item.period === period());
          return `<tr><td>${employee.name}</td><td>${employee.department}</td><td>${badge(goalSheetStatus(goals))}</td><td><div class="progress"><span style="width:${Math.min(100, weightedProgress(goals))}%"></span></div> ${weightedProgress(goals)}%</td><td>${badge(done ? "Completed" : "Pending")}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>
  `;
}

function employeeFilter(employeeId) {
  const employees = currentUser().role === "manager" ? teamMembers(currentUser().id) : state.data.users.filter(user => user.role === "employee");
  return `<label class="field" id="employeeFilterWrap"><span>Employee</span><select id="employeeFilter">${employees.map(employee => `<option value="${employee.id}" ${employee.id === employeeId ? "selected" : ""}>${employee.name}</option>`).join("")}</select></label>`;
}

function completionBars() {
  return state.data.summary.completion.map(item => `
    <div class="bar-row">
      <strong>${item.period.toUpperCase()}</strong>
      <div><small>Employees ${item.actualDone}/${item.total}</small><div class="progress"><span style="width:${item.actualRate}%"></span></div><small>Managers ${item.managerDone}/${item.total}</small><div class="progress"><span style="width:${item.managerRate}%"></span></div></div>
      <span>${item.managerRate}%</span>
    </div>
  `).join("");
}

function bars(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return empty();
  const max = Math.max(...entries.map(([, value]) => value));
  return entries.map(([label, value]) => `<div class="bar-row"><strong>${escapeHtml(label)}</strong><div class="progress"><span style="width:${Math.round((value / max) * 100)}%"></span></div><span>${value}</span></div>`).join("");
}

function managerBars() {
  const managers = state.data.users.filter(user => user.role === "manager");
  const counts = {};
  for (const manager of managers) {
    const team = teamMembers(manager.id);
    const done = team.filter(employee => state.data.checkins.some(item => item.employeeId === employee.id && item.period === period())).length;
    counts[manager.name] = team.length ? Math.round((done / team.length) * 100) : 0;
  }
  return bars(counts);
}

function orgTable() {
  return `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Manager</th></tr></thead><tbody>${state.data.users.map(user => `<tr><td>${user.name}</td><td>${user.role}</td><td>${user.department}</td><td>${userName(user.managerId)}</td></tr>`).join("")}</tbody></table></div>`;
}

function escalationTable() {
  if (!state.data.escalations.length) return empty();
  return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>Manager</th><th>Period</th><th>Reason</th><th>Level</th><th>Status</th></tr></thead><tbody>${state.data.escalations.map(item => `<tr><td>${userName(item.employeeId)}</td><td>${userName(item.managerId)}</td><td>${item.period}</td><td>${item.reason}</td><td>${item.level}</td><td>${badge(item.status)}</td></tr>`).join("")}</tbody></table></div>`;
}

function input(name, label, placeholder, cls = "", type = "text") {
  return `<label class="field ${cls}"><span>${label}</span><input type="${type}" name="${name}" placeholder="${placeholder}"></label>`;
}

function textarea(name, label, placeholder, cls = "") {
  return `<label class="field ${cls}"><span>${label}</span><textarea name="${name}" placeholder="${placeholder}"></textarea></label>`;
}

function select(name, label, items, cls = "") {
  return `<label class="field ${cls}"><span>${label}</span><select name="${name}">${items.map(item => Array.isArray(item) ? `<option value="${item[0]}">${item[1]}</option>` : `<option>${item}</option>`).join("")}</select></label>`;
}

function empty() {
  return $("#emptyState").innerHTML;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.addEventListener("change", event => {
  if (event.target.id === "userSelect") {
    state.userId = event.target.value;
    localStorage.setItem("aq-user", state.userId);
    state.view = "dashboard";
    localStorage.setItem("aq-view", state.view);
    load();
  }
  if (event.target.id === "employeeFilter") renderGoals();
});

document.addEventListener("click", async event => {
  const nav = event.target.closest("[data-nav]");
  const viewButton = event.target.closest("[data-view]");
  const saveGoal = event.target.closest("[data-save-goal]");
  const submit = event.target.closest("[data-submit-goals]");
  const decision = event.target.closest("[data-decision]");
  const saveActual = event.target.closest("[data-save-actual]");
  try {
    if (nav) {
      state.view = nav.dataset.nav;
      localStorage.setItem("aq-view", state.view);
      return render();
    }
    if (viewButton) {
      state.view = viewButton.dataset.view;
      localStorage.setItem("aq-view", state.view);
      return render();
    }
    if (event.target.id === "refreshBtn") return load();
    if (saveGoal) {
      const id = saveGoal.dataset.saveGoal;
      const fields = [...document.querySelectorAll(`[data-goal-id="${id}"]`)];
      const payload = Object.fromEntries(fields.map(field => [field.dataset.goalField, field.value]));
      await api(`/api/goals/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      return show("Goal saved.");
    }
    if (submit) {
      await api(`/api/goals/${submit.dataset.submitGoals}/submit`, { method: "POST" });
      return show("Goal sheet submitted to L1 manager.");
    }
    if (decision) {
      const employeeId = decision.dataset.employee;
      const comment = document.querySelector(`[data-return-comment="${employeeId}"]`)?.value || "";
      await api(`/api/goals/${employeeId}/decision`, { method: "POST", body: JSON.stringify({ decision: decision.dataset.decision, comment }) });
      return show(decision.dataset.decision === "approve" ? "Goals approved and locked." : "Goals returned for rework.");
    }
    if (saveActual) {
      const id = saveActual.dataset.saveActual;
      const actual = document.querySelector(`[data-actual="${id}"]`).value;
      const status = document.querySelector(`[data-actual-status="${id}"]`).value;
      await api(`/api/goals/${id}/actual`, { method: "POST", body: JSON.stringify({ actual, status, period: period() }) });
      return show("Achievement update saved.");
    }
  } catch (error) {
    show(error.message, true);
  }
});

document.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    if (event.target.id === "goalForm") {
      await api("/api/goals", { method: "POST", body: JSON.stringify(formData(event.target)) });
      return show("Draft goal added.");
    }
    if (event.target.classList.contains("checkin-form")) {
      await api("/api/checkins", { method: "POST", body: JSON.stringify({ employeeId: event.target.dataset.checkin, period: period(), comment: event.target.comment.value }) });
      return show("Check-in comment recorded.");
    }
    if (event.target.id === "sharedForm") {
      const payload = formData(event.target);
      payload.employeeIds = [...event.target.employeeIds.selectedOptions].map(option => option.value);
      await api("/api/shared-goals", { method: "POST", body: JSON.stringify(payload) });
      return show("Shared KPI pushed to selected employees.");
    }
    if (event.target.id === "cycleForm") {
      await api("/api/cycle", { method: "POST", body: JSON.stringify(formData(event.target)) });
      return show("Cycle window updated.");
    }
    if (event.target.id === "unlockForm") {
      await api("/api/unlock", { method: "POST", body: JSON.stringify(formData(event.target)) });
      return show("Employee goals unlocked for exception handling.");
    }
  } catch (error) {
    show(error.message, true);
  }
});

load();
