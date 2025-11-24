// server.js

const express = require("express");
const path = require("path");
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ===== In-memory "DB" =====

const users = [];        
const resources = [];    
const schedule = {};     
const bookings = [];     
const blackouts = [];    

let nextResourceId = 1;
let nextBookingId = 1;
let nextBlackoutId = 1;

// ===== Helpers =====

function isRoomBlackout(room, date) {
  return blackouts.some(b => b.room === room && b.date === date);
}

function defaultTimes() {
  const arr = [];
  for (let h = 8; h <= 21; h++) {
    const hh = String(h).padStart(2, "0");
    arr.push(`${hh}:00`);
  }
  return arr;
}

function changeSlotStatus(date, room, time, status) {
  if (!schedule[date] || !schedule[date][room]) return;
  const slot = schedule[date][room].find(s => s.time === time);
  if (slot) slot.status = status;
}

function nextHour(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const nh = (h + 1).toString().padStart(2, "0");
  return `${nh}:${m.toString().padStart(2, "0")}`;
}

// ===== Accounts =====

app.post("/api/register", (req, res) => {
  const { username, password, email, role } = req.body;
  if (!username || !password || !email || !role)
    return res.json({ success: false, message: "Missing fields" });

  if (users.find(u => u.username === username))
    return res.json({ success: false, message: "Username exists" });

  users.push({ username, password, email, role });
  res.json({ success: true });
});

app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body;
  const user = users.find(
    u => u.username === username && u.password === password && u.role === role
  );

  if (!user) return res.json({ success: false, message: "Invalid login" });

  res.json({ success: true, username, role });
});

// ===== Admin: Resources =====

app.post("/api/admin/resources", (req, res) => {
  const { name, description, location, capacity } = req.body;

  if (!name || !location || !capacity)
    return res.json({ success: false, message: "Missing fields" });

  if (resources.find(r => r.name === name))
    return res.json({ success: false, message: "Room exists" });

  const resource = {
    id: nextResourceId++,
    name,
    description: description || "",
    location,
    capacity: Number(capacity),
    isBlocked: false
  };

  resources.push(resource);
  res.json({ success: true, resource });
});

app.post("/api/admin/resource/update", (req, res) => {
  const { oldName, name, description, location, capacity } = req.body;

  const r = resources.find(x => x.name === oldName);
  if (!r) return res.json({ success: false, message: "Resource not found" });

  if (oldName !== name && resources.find(x => x.name === name))
    return res.json({ success: false, message: "New name exists" });

  r.name = name;
  r.description = description || "";
  r.location = location;
  r.capacity = Number(capacity);

  // schedule rename
  for (const date in schedule) {
    if (schedule[date][oldName]) {
      schedule[date][name] = schedule[date][oldName];
      delete schedule[date][oldName];
    }
  }

  // booking rename
  bookings.forEach(b => { if (b.room === oldName) b.room = name; });

  // blackout rename
  blackouts.forEach(b => { if (b.room === oldName) b.room = name; });

  res.json({ success: true });
});

app.post("/api/admin/resource/delete", (req, res) => {
  const { name } = req.body;
  const index = resources.findIndex(r => r.name === name);

  if (index === -1)
    return res.json({ success: false, message: "Not found" });

  resources.splice(index, 1);

  for (const date in schedule) delete schedule[date][name];

  bookings.forEach(b => {
    if (b.room === name) b.status = "cancelled_resource_deleted";
  });

  for (let i = blackouts.length - 1; i >= 0; i--)
    if (blackouts[i].room === name) blackouts.splice(i, 1);

  res.json({ success: true });
});

app.get("/api/admin/resources", (req, res) => {
  res.json({ success: true, resources });
});

app.post("/api/admin/toggle-block", (req, res) => {
  const { room } = req.body;
  const r = resources.find(x => x.name === room);

  if (!r) return res.json({ success: false, message: "Room not found" });

  r.isBlocked = !r.isBlocked;
  res.json({ success: true, resource: r });
});

// ===== Base Availability =====

app.post("/api/admin/set-availability", (req, res) => {
  const { date, room, times } = req.body;

  if (!date || !room || !Array.isArray(times))
    return res.json({ success: false, message: "Missing fields" });

  if (!schedule[date]) schedule[date] = {};
  schedule[date][room] = times.map(t => ({ time: t, status: "available" }));

  res.json({ success: true });
});

// ======================================================
//   ⭐⭐⭐ ADDED: EXCEPTIONS SECTION ⭐⭐⭐
// ======================================================

// GET exception day view
app.get("/api/admin/day-schedule", (req, res) => {
  const { room, date } = req.query;

  if (!room || !date)
    return res.json({ success: false, message: "room & date required" });

  const day = schedule[date]?.[room] || null;

  let times, availableTimes;

  if (day) {
    times = day.map(s => s.time).sort();
    availableTimes = day.filter(s => s.status === "available").map(s => s.time);
  } else {
    // no schedule → default times
    times = defaultTimes();
    availableTimes = [];
  }

  if (isRoomBlackout(room, date))
    availableTimes = [];

  res.json({ success: true, times, availableTimes });
});

// SAVE EXCEPTION OVERRIDES
app.post("/api/admin/set-exception", (req, res) => {
  const { room, date, availableTimes } = req.body;

  if (!room || !date || !Array.isArray(availableTimes))
    return res.json({ success: false, message: "Missing fields" });

  if (isRoomBlackout(room, date))
    return res.json({
      success: false,
      message: "Cannot set exception on blackout day"
    });

  const baseTimes =
    schedule[date]?.[room]?.map(s => s.time) || defaultTimes();

  if (!schedule[date]) schedule[date] = {};

  schedule[date][room] = baseTimes.map(t => ({
    time: t,
    status: availableTimes.includes(t) ? "available" : "unavailable"
  }));

  // cancel bookings that become unavailable
  bookings.forEach(b => {
    if (
      b.room === room &&
      b.date === date &&
      (b.status === "pending" || b.status === "approved")
    ) {
      if (!availableTimes.includes(b.startTime)) {
        b.status = "cancelled_by_exception";
      }
    }
  });

  res.json({ success: true });
});

// ======================================================
//  END EXCEPTIONS SECTION
// ======================================================

// ===== Blackouts =====

app.post("/api/admin/blackouts", (req, res) => {
  const { room, date } = req.body;

  if (!room || !date)
    return res.json({ success: false, message: "room and date required" });

  if (!resources.find(r => r.name === room))
    return res.json({ success: false, message: "Room not found" });

  if (blackouts.some(b => b.room === room && b.date === date))
    return res.json({ success: true, message: "Already exists" });

  const blackout = { id: nextBlackoutId++, room, date };
  blackouts.push(blackout);

  bookings.forEach(b => {
    if (b.room === room && b.date === date) {
      if (b.status === "pending" || b.status === "approved")
        b.status = "cancelled_by_blackout";
    }
  });

  res.json({ success: true, blackout });
});

app.get("/api/admin/blackouts", (req, res) => {
  const { room } = req.query;
  let list = blackouts;
  if (room) list = list.filter(b => b.room === room);
  res.json({ success: true, blackouts: list });
});

app.post("/api/admin/blackouts/remove", (req, res) => {
  const { id } = req.body;

  const index = blackouts.findIndex(b => b.id === Number(id));
  if (index === -1)
    return res.json({ success: false, message: "Not found" });

  const removed = blackouts.splice(index, 1)[0];
  res.json({ success: true, blackout: removed });
});

// ===== Student schedule =====

app.get("/api/schedule", (req, res) => {
  const date = req.query.date;

  if (!date) return res.json({ success: false });

  const day = schedule[date] || {};

  const allowedRooms = Object.keys(day).filter(room => {
    const r = resources.find(x => x.name === room);
    return !(r?.isBlocked || isRoomBlackout(room, date));
  });

  const filtered = {};
  const timeSet = new Set();

  allowedRooms.forEach(room => {
    const slots = day[room] || [];
    filtered[room] = slots;
    slots.forEach(s => timeSet.add(s.time));
  });

  const times = Array.from(timeSet).sort();

  res.json({
    success: true,
    rooms: allowedRooms,
    times,
    schedule: filtered
  });
});

// ===== Booking =====

app.post("/api/bookings", (req, res) => {
  const { username, room, date, slots } = req.body;

  if (!username || !room || !date || !Array.isArray(slots))
    return res.json({ success: false });

  const resource = resources.find(r => r.name === room);
  if (resource?.isBlocked)
    return res.json({ success: false, message: "Room is blocked" });

  if (isRoomBlackout(room, date))
    return res.json({ success: false, message: "Blackout day" });

  const day = schedule[date];
  if (!day || !day[room])
    return res.json({ success: false, message: "No schedule" });

  for (const t of slots) {
    const slot = day[room].find(s => s.time === t);
    if (!slot || slot.status !== "available")
      return res.json({ success: false, message: `Slot ${t} unavailable` });
  }

  const created = [];

  slots.forEach(t => {
    const booking = {
      id: nextBookingId++,
      username,
      room,
      date,
      startTime: t,
      endTime: nextHour(t),
      status: "pending"
    };

    bookings.push(booking);
    changeSlotStatus(date, room, t, "unavailable");
    created.push(booking);
  });

  res.json({ success: true, bookings: created });
});

app.get("/api/my-bookings", (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ success: false });
  res.json({ success: true, bookings: bookings.filter(b => b.username === username) });
});

// ===== Admin approvals =====

app.get("/api/admin/pending-bookings", (req, res) => {
  res.json({
    success: true,
    bookings: bookings.filter(b => b.status === "pending")
  });
});

app.post("/api/admin/approve/:id", (req, res) => {
  const id = Number(req.params.id);
  const b = bookings.find(x => x.id === id);

  if (!b) return res.json({ success: false });
  b.status = "approved";
  res.json({ success: true, booking: b });
});

app.post("/api/admin/deny/:id", (req, res) => {
  const id = Number(req.params.id);
  const b = bookings.find(x => x.id === id);

  if (!b) return res.json({ success: false });
  b.status = "denied";
  changeSlotStatus(b.date, b.room, b.startTime, "available");
  res.json({ success: true, booking: b });
});

// Forget password 


app.post("/api/reset-password-simple", (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword) {
    return res
      .status(400)
      .json({ success: false, message: "Missing email or new password." });
  }

  const user = users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );

  if (!user) {
    return res
      .status(404)
      .json({ success: false, message: "No account found with that email." });
  }

  // Update password
  user.password = newPassword;

  console.log(`Password reset for ${user.username} (${user.email})`);

  return res.json({ success: true });
});


// ===== Start =====

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
