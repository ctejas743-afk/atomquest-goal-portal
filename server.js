const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = path.join(ROOT, "backend", "data", "db.json");

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function send(res, status, payload, headers = jsonHeaders) {
  res.writeHead(status, headers);
  res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function user(db, idValue) {
  return db.users.find(item => item.id === idValue);
}

function managedEmployeeIds(db, managerId) {
  return db.users.filter(item => item.managerId === managerId).map(item => item.id);
}

function canSeeEmployee(db, actor, employeeId) {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  if (actor.id === employeeId) return true;
  if (actor.role === "manager") return managedEmployeeIds(db, actor.id).includes(employeeId);
  return false;
}

function addAudit(db, actorId, action, entityType, entityId, field, before, after) {
  db.auditLogs.unshift({
    id: id("audit"),
    entityType,
    entityId,
    actorId,
    action,
    field,
    before: valueForLog(before),
    after: valueForLog(after),
    createdAt: new Date().toISOString()
  });
}

function valueForLog(value) {
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function notify(db, toUserId, message, type = "info") {
  db.notifications.unshift({
    id: id("notification"),
    toUserId,
    message,
    type,
    read: false,
    createdAt: new Date().toISOString()
  });
}

function validateGoalSet(goals) {
  const active = goals.filter(goal => goal.status !== "archived");
  if (active.length === 0) return ["Add at least one goal."];
  if (active.length > 8) return ["Maximum 8 goals are allowed per employee."];
  const total = active.reduce((sum, goal) => sum + Number(goal.weightage || 0), 0);
  const errors = [];
  if (total !== 100) errors.push(`Total weightage must equal 100%. Current total is ${total}%.`);
  const low = active.find(goal => Number(goal.weightage || 0) < 10);
  if (low) errors.push("Minimum weightage per individual goal is 10%.");
  for (const goal of active) {
    if (!goal.thrustArea || !goal.title || goal.weightage === undefined || goal.target === undefined || goal.target === "") {
      errors.push("Every goal needs a thrust area, title, target, and weightage.");
      break;
    }
  }
  return errors;
}

function scoreGoal(goal, period) {
  const update = goal.actuals && goal.actuals[period];
  if (!update || update.actual === "" || update.actual === undefined || update.actual === null) return null;
  let raw = 0;
  if (goal.uomType === "Timeline") {
    const completion = new Date(update.actual);
    const deadline = new Date(goal.deadline || goal.target);
    raw = completion <= deadline ? 1 : Math.max(0, 1 - ((completion - deadline) / (1000 * 60 * 60 * 24)) / 90);
  } else if (goal.uomType === "Zero") {
    raw = Number(update.actual) === 0 ? 1 : 0;
  } else if (goal.direction === "max") {
    raw = Number(update.actual) === 0 ? 1 : Number(goal.target) / Number(update.actual);
  } else {
    raw = Number(update.actual) / Number(goal.target);
  }
  return Math.max(0, Math.min(1.5, raw)) * 100;
}

function weightedProgress(goals, period) {
  const visible = goals.filter(goal => goal.status === "locked");
  if (!visible.length) return 0;
  const weighted = visible.reduce((sum, goal) => {
    const score = scoreGoal(goal, period);
    return sum + ((score || 0) * Number(goal.weightage || 0));
  }, 0);
  return Math.round(weighted / 100);
}

function getSummary(db) {
  const employees = db.users.filter(item => item.role === "employee");
  const periods = ["q1", "q2", "q3", "q4"];
  const completion = periods.map(period => {
    const actualDone = employees.filter(employee => db.goals.some(goal => goal.employeeId === employee.id && goal.actuals && goal.actuals[period])).length;
    const managerDone = employees.filter(employee => db.checkins.some(checkin => checkin.employeeId === employee.id && checkin.period === period)).length;
    return {
      period,
      actualDone,
      managerDone,
      total: employees.length,
      actualRate: employees.length ? Math.round((actualDone / employees.length) * 100) : 0,
      managerRate: employees.length ? Math.round((managerDone / employees.length) * 100) : 0
    };
  });
  const thrustCounts = {};
  const statusCounts = {};
  for (const goal of db.goals) {
    thrustCounts[goal.thrustArea] = (thrustCounts[goal.thrustArea] || 0) + 1;
    statusCounts[goal.status] = (statusCounts[goal.status] || 0) + 1;
  }
  return { completion, thrustCounts, statusCounts };
}

function enrich(db) {
  return {
    cycle: db.cycle,
    users: db.users,
    goals: db.goals,
    checkins: db.checkins,
    auditLogs: db.auditLogs,
    notifications: db.notifications,
    escalations: db.escalations,
    summary: getSummary(db)
  };
}

async function api(req, res, url) {
  const db = readDb();
  const actor = user(db, req.headers["x-user-id"] || url.searchParams.get("user"));
  const parts = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      return send(res, 200, enrich(db));
    }

    if (req.method === "POST" && url.pathname === "/api/goals") {
      if (!actor || actor.role === "manager") return send(res, 403, { error: "Only employees or admins can create goals here." });
      const payload = await body(req);
      const employeeId = actor.role === "admin" ? payload.employeeId : actor.id;
      if (!canSeeEmployee(db, actor, employeeId)) return send(res, 403, { error: "You cannot create for this employee." });
      const existing = db.goals.filter(goal => goal.employeeId === employeeId && goal.status !== "archived");
      if (existing.length >= 8) return send(res, 400, { error: "Maximum 8 goals are allowed per employee." });
      const goal = {
        id: id("goal"),
        employeeId,
        createdBy: actor.id,
        primaryOwnerId: employeeId,
        thrustArea: payload.thrustArea || "",
        title: payload.title || "",
        description: payload.description || "",
        uomType: payload.uomType || "Numeric",
        direction: payload.uomType === "Timeline" ? "timeline" : payload.uomType === "Zero" ? "zero" : payload.direction || "min",
        target: payload.target,
        deadline: payload.deadline || payload.target,
        weightage: Number(payload.weightage || 0),
        status: "draft",
        managerDecision: "draft",
        sharedGroupId: null,
        readonlySharedFields: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lockedAt: null,
        actuals: {}
      };
      db.goals.push(goal);
      addAudit(db, actor.id, "create", "goal", goal.id, "goal", "", goal.title);
      writeDb(db);
      return send(res, 201, enrich(db));
    }

    if (req.method === "PUT" && parts[0] === "api" && parts[1] === "goals" && parts[2]) {
      const payload = await body(req);
      const goal = db.goals.find(item => item.id === parts[2]);
      if (!goal) return send(res, 404, { error: "Goal not found." });
      if (!actor || !canSeeEmployee(db, actor, goal.employeeId)) return send(res, 403, { error: "Access denied." });
      const isLocked = goal.status === "locked";
      const managerApprovalEdit = actor.role === "manager" && goal.status === "submitted";
      const adminUnlockEdit = actor.role === "admin";
      const employeeDraftEdit = actor.id === goal.employeeId && ["draft", "returned"].includes(goal.status);
      if (!managerApprovalEdit && !adminUnlockEdit && !employeeDraftEdit) {
        return send(res, 409, { error: "This goal is locked or not editable in the current workflow." });
      }
      const fields = ["thrustArea", "title", "description", "uomType", "direction", "target", "deadline", "weightage"];
      for (const field of fields) {
        if (!(field in payload)) continue;
        if (goal.readonlySharedFields && ["title", "target", "deadline", "uomType", "direction"].includes(field) && actor.id === goal.employeeId) continue;
        const before = goal[field];
        goal[field] = field === "weightage" ? Number(payload[field]) : payload[field];
        if (before !== goal[field] && (isLocked || goal.lockedAt || actor.role === "admin")) {
          addAudit(db, actor.id, "update", "goal", goal.id, field, before, goal[field]);
        }
      }
      goal.updatedAt = new Date().toISOString();
      writeDb(db);
      return send(res, 200, enrich(db));
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "goals" && parts[3] === "submit") {
      const employeeId = parts[2];
      if (!actor || actor.id !== employeeId) return send(res, 403, { error: "Only the employee can submit their own goals." });
      const goals = db.goals.filter(goal => goal.employeeId === employeeId && ["draft", "returned"].includes(goal.status));
      const allEmployeeGoals = db.goals.filter(goal => goal.employeeId === employeeId && goal.status !== "archived");
      const errors = validateGoalSet(allEmployeeGoals);
      if (errors.length) return send(res, 400, { error: errors.join(" ") });
      for (const goal of goals) {
        goal.status = "submitted";
        goal.managerDecision = "submitted";
        goal.updatedAt = new Date().toISOString();
        addAudit(db, actor.id, "submit", "goal", goal.id, "status", "draft", "submitted");
      }
      const employee = user(db, employeeId);
      notify(db, employee.managerId, `${employee.name} submitted goals for approval.`, "submission");
      writeDb(db);
      return send(res, 200, enrich(db));
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "goals" && parts[3] === "decision") {
      const employeeId = parts[2];
      const payload = await body(req);
      if (!actor || actor.role !== "manager" || !managedEmployeeIds(db, actor.id).includes(employeeId)) {
        return send(res, 403, { error: "Only the L1 manager can decide this goal sheet." });
      }
      const goals = db.goals.filter(goal => goal.employeeId === employeeId && goal.status === "submitted");
      if (!goals.length) return send(res, 400, { error: "No submitted goals found." });
      if (payload.decision === "approve") {
        const errors = validateGoalSet(db.goals.filter(goal => goal.employeeId === employeeId && goal.status !== "archived"));
        if (errors.length) return send(res, 400, { error: errors.join(" ") });
        for (const goal of goals) {
          goal.status = "locked";
          goal.managerDecision = "approved";
          goal.lockedAt = new Date().toISOString();
          goal.updatedAt = new Date().toISOString();
          addAudit(db, actor.id, "approve", "goal", goal.id, "status", "submitted", "locked");
        }
        notify(db, employeeId, "Your goal sheet was approved and locked.", "approval");
      } else {
        for (const goal of goals) {
          goal.status = "returned";
          goal.managerDecision = "returned";
          goal.updatedAt = new Date().toISOString();
          addAudit(db, actor.id, "return", "goal", goal.id, "status", "submitted", "returned");
        }
        notify(db, employeeId, `Your goal sheet was returned for rework: ${payload.comment || "Please review."}`, "return");
      }
      writeDb(db);
      return send(res, 200, enrich(db));
    }

    if (req.method === "POST" && url.pathname === "/api/shared-goals") {
      if (!actor || !["manager", "admin"].includes(actor.role)) return send(res, 403, { error: "Only managers or admins can push shared goals." });
      const payload = await body(req);
      const recipients = (payload.employeeIds || []).filter(employeeId => canSeeEmployee(db, actor, employeeId));
      if (!recipients.length) return send(res, 400, { error: "Select at least one eligible recipient." });
      const groupId = id("shared");
      const primaryOwnerId = payload.primaryOwnerId && recipients.includes(payload.primaryOwnerId) ? payload.primaryOwnerId : recipients[0];
      for (const employeeId of recipients) {
        const goal = {
          id: id("goal"),
          employeeId,
          createdBy: actor.id,
          primaryOwnerId,
          thrustArea: payload.thrustArea,
          title: payload.title,
          description: payload.description || "Shared departmental KPI",
          uomType: payload.uomType || "Numeric",
          direction: payload.uomType === "Timeline" ? "timeline" : payload.uomType === "Zero" ? "zero" : payload.direction || "min",
          target: payload.target,
          deadline: payload.deadline || payload.target,
          weightage: Number(payload.weightage || 10),
          status: "draft",
          managerDecision: "draft",
          sharedGroupId: groupId,
          readonlySharedFields: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lockedAt: null,
          actuals: {}
        };
        db.goals.push(goal);
        addAudit(db, actor.id, "push_shared", "goal", goal.id, "sharedGroupId", "", groupId);
        notify(db, employeeId, `A shared KPI was added to your goal sheet: ${goal.title}.`, "shared-goal");
      }
      writeDb(db);
      return send(res, 201, enrich(db));
    }

    if (req.method === "POST" && parts[0] === "api" && parts[1] === "goals" && parts[3] === "actual") {
      const goal = db.goals.find(item => item.id === parts[2]);
      const payload = await body(req);
      if (!goal) return send(res, 404, { error: "Goal not found." });
      const period = payload.period || db.cycle.activePeriod;
      if (!["q1", "q2", "q3", "q4"].includes(period) || db.cycle.windows[period].status !== "open") {
        return send(res, 400, { error: "Achievement capture is available only during an open quarterly window." });
      }
      if (!actor || actor.id !== goal.employeeId) return send(res, 403, { error: "Only the goal owner can update achievements." });
      if (goal.status !== "locked") return send(res, 409, { error: "Goals must be approved and locked before achievement updates." });
      const update = { actual: payload.actual, status: payload.status || "On Track", updatedBy: actor.id, updatedAt: new Date().toISOString() };
      const targets = goal.sharedGroupId && goal.primaryOwnerId === actor.id
        ? db.goals.filter(item => item.sharedGroupId === goal.sharedGroupId)
        : [goal];
      for (const item of targets) {
        const before = item.actuals[period];
        item.actuals[period] = update;
        addAudit(db, actor.id, "achievement_update", "goal", item.id, period, before, update);
      }
      notify(db, user(db, goal.employeeId).managerId, `${user(db, goal.employeeId).name} updated ${period.toUpperCase()} achievement for ${goal.title}.`, "achievement");
      writeDb(db);
      return send(res, 200, enrich(db));
    }

    if (req.method === "POST" && url.pathname === "/api/checkins") {
      const payload = await body(req);
      if (!actor || actor.role !== "manager" || !managedEmployeeIds(db, actor.id).includes(payload.employeeId)) {
        return send(res, 403, { error: "Only the L1 manager can record this check-in." });
      }
      const period = payload.period || db.cycle.activePeriod;
      if (!["q1", "q2", "q3", "q4"].includes(period) || db.cycle.windows[period].status !== "open") {
        return send(res, 400, { error: "Manager check-ins are available only during an open quarterly window." });
      }
      const checkin = {
        id: id("checkin"),
        employeeId: payload.employeeId,
        managerId: actor.id,
        period,
        comment: payload.comment || "",
        createdAt: new Date().toISOString()
      };
      db.checkins.unshift(checkin);
      addAudit(db, actor.id, "checkin", "checkin", checkin.id, "comment", "", checkin.comment);
      notify(db, payload.employeeId, `${actor.name} recorded your ${period.toUpperCase()} check-in.`, "checkin");
      writeDb(db);
      return send(res, 201, enrich(db));
    }

    if (req.method === "POST" && url.pathname === "/api/cycle") {
      if (!actor || actor.role !== "admin") return send(res, 403, { error: "Only Admin / HR can manage cycles." });
      const payload = await body(req);
      if (!db.cycle.windows[payload.activePeriod]) return send(res, 400, { error: "Invalid period." });
      for (const key of Object.keys(db.cycle.windows)) db.cycle.windows[key].status = "closed";
      db.cycle.windows[payload.activePeriod].status = "open";
      db.cycle.activePeriod = payload.activePeriod;
      addAudit(db, actor.id, "cycle_update", "cycle", db.cycle.id, "activePeriod", "", payload.activePeriod);
      writeDb(db);
      return send(res, 200, enrich(db));
    }

    if (req.method === "POST" && url.pathname === "/api/unlock") {
      if (!actor || actor.role !== "admin") return send(res, 403, { error: "Only Admin / HR can unlock goals." });
      const payload = await body(req);
      const employeeGoals = db.goals.filter(goal => goal.employeeId === payload.employeeId && goal.status === "locked");
      for (const goal of employeeGoals) {
        goal.status = "returned";
        addAudit(db, actor.id, "unlock", "goal", goal.id, "status", "locked", "returned");
      }
      notify(db, payload.employeeId, "Admin unlocked your goal sheet for exception handling.", "unlock");
      writeDb(db);
      return send(res, 200, enrich(db));
    }

    if (req.method === "GET" && url.pathname === "/api/report.csv") {
      if (!actor || !["manager", "admin"].includes(actor.role)) return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
      const rows = [["Employee", "Manager", "Department", "Goal", "Thrust Area", "UoM", "Target", "Weightage", "Q1 Actual", "Q2 Actual", "Q3 Actual", "Q4 Actual", "Status"]];
      for (const goal of db.goals) {
        const employee = user(db, goal.employeeId);
        const manager = user(db, employee.managerId);
        if (actor.role === "manager" && manager.id !== actor.id) continue;
        rows.push([
          employee.name,
          manager.name,
          employee.department,
          goal.title,
          goal.thrustArea,
          goal.uomType,
          goal.target,
          goal.weightage,
          goal.actuals.q1?.actual || "",
          goal.actuals.q2?.actual || "",
          goal.actuals.q3?.actual || "",
          goal.actuals.q4?.actual || "",
          goal.status
        ]);
      }
      const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
      return send(res, 200, csv, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=achievement-report.csv" });
    }

    return send(res, 404, { error: "API route not found." });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

function staticFile(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) filePath = path.join(PUBLIC_DIR, "index.html");
    fs.readFile(filePath, (readError, content) => {
      if (readError) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
      send(res, 200, content, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return api(req, res, url);
  return staticFile(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`AtomQuest Goal Portal running at http://${HOST}:${PORT}`);
});
