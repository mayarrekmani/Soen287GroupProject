// ================================================
// server.js  — FULL WORKING VERSION
// ================================================

const express = require("express");
const path = require("path");
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ================================================
// IN-MEMORY DATABASE
// ================================================

// Users
const users = []; // { username, password, email, role }

// Resources (rooms)
const resources = []; 
/*
  {
    id,
    name,
    description,
    location,
    capacity,
    blocked: false
  }
*/

// Schedules
const schedule = {};
/*
  schedule = {
     "2025-02-14": {
        "Study Room A": [ {time:"09:00", status:"available"}, ... ]
     }
  }
*/

// Bookings
const bookings = []; 
/*
  {
    id,
    username,
    room,
    date,
    startTime,
    endTime,
    status
  }
*/

let nextResourceId = 1;
let nextBookingId = 1;

// ================================================
// 1. USER ACCOUNT ROUTES
// ================================================

// Register
app.post("/api/register", (req, res) => {
  const { username, password, email, role } = req.body;

  if (!username || !password || !email || !role) {
    return res.json({ success: false, message: "Missing fields" });
  }

  if (users.find((u) => u.username === username)) {
    return res.json({
      success: false,
      message: "Username already exists",
    });
  }

  users.push({ username, password, email, role });

  return res.json({ success: true });
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body;

  const user = users.find(
    (u) => u.username === username && u.password === password && u.role === role
  );

  if (!user) {
    return res.json({
      success: false,
      message: "Invalid login",
    });
  }

  return res.json({
    success: true,
    username,
    role,
  });
});

// ================================================
// 2. ADMIN: RESOURCE MANAGEMENT
// ================================================

// Create resource
app.post("/api/admin/resources", (req, res) => {
  const { name, description, location, capacity } = req.body;

  if (!name || !location || !capacity) {
    return res.json({
      success: false,
      message: "Name, location, and capacity required",
    });
  }

  if (resources.find((r) => r.name === name)) {
    return res.json({
      success: false,
      message: "Resource name already exists",
    });
  }

  const resource = {
    id: nextResourceId++,
    name,
    description: description || "",
    location,
    capacity: Number(capacity),
    blocked: false, // ⭐ NEW — rooms start unblocked
  };

  resources.push(resource);

  return res.json({
    success: true,
    resource,
  });
});

// Get all resources
app.get("/api/admin/resources", (req, res) => {
  return res.json({
    success: true,
    resources,
  });
});

// ================================================
// 3. ADMIN: BLOCK / UNBLOCK ROOMS (PERMANENT)
// ================================================

// Permanently block a room
app.post("/api/admin/block-room", (req, res) => {
  const { room } = req.body;

  if (!room) {
    return res.json({ success: false, message: "Missing room name" });
  }

  const resource = resources.find((r) => r.name === room);
  if (!resource) {
    return res.json({ success: false, message: "Resource not found" });
  }

  resource.blocked = true;

  return res.json({
    success: true,
    message: "Room blocked",
    resource,
  });
});

// Permanently unblock room
app.post("/api/admin/unblock-room", (req, res) => {
  const { room } = req.body;

  if (!room) {
    return res.json({ success: false, message: "Missing room name" });
  }

  const resource = resources.find((r) => r.name === room);
  if (!resource) {
    return res.json({ success: false, message: "Resource not found" });
  }

  resource.blocked = false;

  return res.json({
    success: true,
    message: "Room unblocked",
    resource,
  });
});

// ================================================
// 4. ADMIN: SET AVAILABILITY (DYNAMIC OR DEFAULT)
// ================================================

// Helper to generate 1-hour slots
function generateSlots(start, end) {
  const result = [];
  let h = start;

  while (h < end) {
    const padded = h.toString().padStart(2, "0") + ":00";
    result.push({ time: padded, status: "available" });
    h++;
  }
  return result;
}

// Create schedule for a whole week (Mon–Fri)
function createWeeklySchedule(room, startHour, endHour) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  days.forEach((d) => {
    const dateKey = d; // Using weekdays as identifiers
    if (!schedule[dateKey]) schedule[dateKey] = {};
    schedule[dateKey][room] = generateSlots(startHour, endHour);
  });
}

// Admin sets room schedule
app.post("/api/admin/set-availability", (req, res) => {
  const { room, startHour, endHour, mode } = req.body;

  const resource = resources.find((r) => r.name === room);
  if (!resource) {
    return res.json({ success: false, message: "Room not found" });
  }

  const start = Number(startHour);
  const end = Number(endHour);

  if (mode === "default") {
    // 8am to 7pm
    createWeeklySchedule(room, 8, 19);
  } else {
    // custom dynamic hours
    if (isNaN(start) || isNaN(end) || start >= end) {
      return res.json({
        success: false,
        message: "Invalid hours",
      });
    }
    createWeeklySchedule(room, start, end);
  }

  return res.json({
    success: true,
    message: "Schedule applied",
  });
});

// Get schedule for students/admin
app.get("/api/schedule", (req, res) => {
  return res.json({
    success: true,
    schedule,
  });
});

// ================================================
// 5. STUDENT BOOKINGS (1h slots)
// ================================================
function nextHour(t) {
  const h = Number(t.split(":")[0]);
  return (h + 1).toString().padStart(2, "0") + ":00";
}

app.post("/api/bookings", (req, res) => {
  const { username, room, date, slot } = req.body;

  if (!username || !room || !date || !slot) {
    return res.json({ success: false, message: "Missing fields" });
  }

  if (!schedule[date] || !schedule[date][room]) {
    return res.json({ success: false, message: "No schedule for that room/day" });
  }

  const sl = schedule[date][room].find((s) => s.time === slot);
  if (!sl || sl.status !== "available") {
    return res.json({
      success: false,
      message: "Slot unavailable",
    });
  }

  sl.status = "unavailable";

  const booking = {
    id: nextBookingId++,
    username,
    room,
    date,
    startTime: slot,
    endTime: nextHour(slot),
    status: "pending",
  };

  bookings.push(booking);

  return res.json({
    success: true,
    booking,
  });
});

// Student booking history
app.get("/api/my-bookings", (req, res) => {
  const { username } = req.query;

  const list = bookings.filter((b) => b.username === username);

  return res.json({
    success: true,
    bookings: list,
  });
});

// ================================================
// 6. ADMIN: APPROVE / DENY BOOKINGS
// ================================================

app.get("/api/admin/pending-bookings", (req, res) => {
  return res.json({
    success: true,
    bookings: bookings.filter((b) => b.status === "pending"),
  });
});

app.post("/api/admin/approve/:id", (req, res) => {
  const id = Number(req.params.id);

  const b = bookings.find((x) => x.id === id);
  if (!b) return res.json({ success: false, message: "Not found" });

  b.status = "approved";

  return res.json({ success: true, booking: b });
});

app.post("/api/admin/deny/:id", (req, res) => {
  const id = Number(req.params.id);

  const b = bookings.find((x) => x.id === id);
  if (!b) return res.json({ success: false, message: "Not found" });

  b.status = "denied";

  // make slot available again
  if (schedule[b.date] && schedule[b.date][b.room]) {
    const sl = schedule[b.date][b.room].find((s) => s.time === b.startTime);
    if (sl) sl.status = "available";
  }

  return res.json({ success: true, booking: b });
});


// ================================================
// 7. Change Username
// ================================================

// CHANGE USERNAME
app.post("/api/change-username", (req, res) => {
  const { oldUsername, newUsername } = req.body;

  if (!oldUsername || !newUsername) {
    return res
      .status(400)
      .json({ success: false, message: "Missing fields" });
  }

  const user = users.find(
    (u) => u.username.toLowerCase() === oldUsername.toLowerCase()
  );

  if (!user) {
    return res
      .status(404)
      .json({ success: false, message: "Old username not found" });
  }

  // Check if new username exists
  const taken = users.find(
    (u) => u.username.toLowerCase() === newUsername.toLowerCase()
  );

  if (taken) {
    return res
      .status(400)
      .json({ success: false, message: "That username is already taken" });
  }

  // Update
  user.username = newUsername;

  console.log(`Changed username: ${oldUsername} → ${newUsername}`);

  return res.json({ success: true });
});

// ================================================
// 8. Forget Password
// ================================================



// RESET PASSWORD (fake system just validates email)
app.post("/api/reset-password", (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required." });
  }

  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );

  if (!user) {
    return res
      .status(404)
      .json({ success: false, message: "No account found with that email." });
  }

  console.log(`Password reset requested for: ${email}`);

  // In a real system we would send email — here we just simulate success
  return res.json({
    success: true,
    message: "Reset email sent successfully.",
  });
});


// ================================================
// START SERVER
// ================================================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
