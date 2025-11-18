// server.js

const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// ----- 1. MIDDLEWARE -----

// Parse JSON bodies (from fetch/post)
app.use(express.json());
// Parse URL-encoded bodies (from forms if you use them)
app.use(express.urlencoded({ extended: true }));

// Serve all HTML/CSS/JS/images from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

// ----- 2. "FAKE DATABASE" IN MEMORY -----


// Each user: { username, password, email, role }  role = "student" or "admin"
const users = [];

// Each booking:
// { id, username, room, date, startTime, endTime, purpose, status }
// status = "pending" | "approved" | "denied"

const bookings = [];
let nextBookingId = 1;

// ----- 3. ROUTES FOR ACCOUNTS -----

// Register (student or admin)
app.post("/api/register", (req, res) => {
  const { username, password, email, role } = req.body;

  if (!username || !password || !email || !role) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  // Check if username already exists
  const existing = users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );
  if (existing) {
    return res
      .status(400)
      .json({ success: false, message: "Username already taken" });
  }

  users.push({ username, password, email, role });
  console.log("Registered user:", username, "role:", role);

  return res.json({ success: true, message: "Account created" });
});

// Login
app.post("/api/login", (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const user = users.find(
    (u) =>
      u.username.toLowerCase() === username.toLowerCase() &&
      u.password === password &&
      u.role === role
  );

  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: "Invalid username/password/role" });
  }

  // For simplicity, we don't create sessions. Front-end just stores username.
  return res.json({
    success: true,
    message: "Login successful",
    username: user.username,
    role: user.role,
  });
});

// ----- 4. ROUTES FOR BOOKINGS -----

// Create a booking (student)
app.post("/api/bookings", (req, res) => {
  const { username, room, date, startTime, endTime, purpose } = req.body;

  if (!username || !room || !date || !startTime || !endTime || !purpose) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  const booking = {
    id: nextBookingId++,
    username,
    room,
    date,
    startTime,
    endTime,
    purpose,
    status: "pending",
  };

  bookings.push(booking);
  console.log("New booking:", booking);

  return res.json({ success: true, message: "Booking created", booking });
});

// Get bookings for ONE student (for past/upcoming appointments page)
app.get("/api/my-bookings", (req, res) => {
  const username = req.query.username;
  if (!username) {
    return res.status(400).json({ success: false, message: "Missing username" });
  }

  const myBookings = bookings.filter(
    (b) => b.username.toLowerCase() === username.toLowerCase()
  );

  return res.json({ success: true, bookings: myBookings });
});

// ----- 5. ADMIN ROUTES -----

// Get all PENDING bookings (for approvals.html)
app.get("/api/admin/pending-bookings", (req, res) => {
  const pending = bookings.filter((b) => b.status === "pending");
  return res.json({ success: true, bookings: pending });
});

// Approve booking
app.post("/api/admin/approve/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const booking = bookings.find((b) => b.id === id);
  if (!booking) {
    return res.status(404).json({ success: false, message: "Booking not found" });
  }
  booking.status = "approved";
  return res.json({ success: true, booking });
});

// Deny booking
app.post("/api/admin/deny/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const booking = bookings.find((b) => b.id === id);
  if (!booking) {
    return res.status(404).json({ success: false, message: "Booking not found" });
  }
  booking.status = "denied";
  return res.json({ success: true, booking });
});

// 6. START SERVER 
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
