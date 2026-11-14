const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);

// Serve the frontend from ./public
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

// username -> socket ID (one active connection per username)
const users = new Map();

function sendToUser(username, event, payload) {
  const socketId = users.get(username);
  if (socketId) io.to(socketId).emit(event, payload);
}

io.on("connection", (socket) => {
  socket.on("join", (rawName, ack) => {
    const name = String(rawName || "").trim().slice(0, 25);
    if (!name) {
      if (typeof ack === "function") ack({ ok: false, error: "Enter a valid username." });
      else socket.emit("join-error", "Enter a valid username.");
      return;
    }

    const existingId = users.get(name);
    if (existingId && existingId !== socket.id) {
      if (typeof ack === "function") ack({ ok: false, error: "That username is already online." });
      else socket.emit("join-error", "That username is already online.");
      return;
    }

    socket.username = name;
    users.set(name, socket.id);
    if (typeof ack === "function") ack({ ok: true, name });
    socket.emit("joined", name);
    io.emit("users-update", [...users.keys()]);
  });

  socket.on("chat-message", ({ to, message } = {}) => {
    if (!socket.username || !users.has(to)) return;
    const text = String(message || "").trim().slice(0, 2000);
    if (!text) return;
    sendToUser(to, "chat-message", {
      from: socket.username, message: text, time: Date.now()
    });
    socket.emit("message-sent", { to, message: text, time: Date.now() });
  });

  // WebRTC signaling: offer, answer, ICE candidate
  socket.on("offer", ({ to, offer, callType } = {}) => {
    if (!socket.username || !users.has(to) || !offer) return;
    sendToUser(to, "offer", { offer, from: socket.username, callType: callType || "video" });
  });

  socket.on("answer", ({ to, answer } = {}) => {
    if (!socket.username || !users.has(to) || !answer) return;
    sendToUser(to, "answer", { answer, from: socket.username });
  });

  socket.on("candidate", ({ to, candidate } = {}) => {
    if (!socket.username || !users.has(to) || !candidate) return;
    sendToUser(to, "candidate", { candidate, from: socket.username });
  });

  socket.on("reject-call", ({ to } = {}) => {
    if (!socket.username || !users.has(to)) return;
    sendToUser(to, "call-rejected", { from: socket.username });
  });

  socket.on("end-call", ({ to } = {}) => {
    if (!socket.username || !users.has(to)) return;
    sendToUser(to, "end-call", { from: socket.username });
  });

  socket.on("disconnect", () => {
    const name = socket.username;
    // Don't remove a newer session that reused the same username
    if (name && users.get(name) === socket.id) {
      users.delete(name);
      io.emit("users-update", [...users.keys()]);
      // Inform peers that this user is no longer online
      io.emit("user-disconnected", { name });
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chat Call App listening on http://localhost:${PORT}`);
});
