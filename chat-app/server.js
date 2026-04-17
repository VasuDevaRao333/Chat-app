const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + "_" + file.originalname)
});
const upload = multer({ storage });

app.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({ filePath: "/uploads/" + req.file.filename });
});

// USER SOCKETS
let users = {}; // username: socket.id

io.on("connection", (socket) => {

    socket.on("join", name => {
        users[name] = socket.id;
        console.log(name + " joined");
    });

    // CHAT MESSAGES
    socket.on("private-message", ({ to, message, from }) => {
        const toSocket = users[to];
        if (toSocket) io.to(toSocket).emit("private-message", { from, message });
    });

    // FILE MESSAGES
    socket.on("file-message", ({ to, filePath, from }) => {
        const toSocket = users[to];
        if (toSocket) io.to(toSocket).emit("file-message", { from, filePath });
    });

    // TYPING INDICATOR
    socket.on("typing", ({ to, from }) => {
        const toSocket = users[to];
        if (toSocket) io.to(toSocket).emit("typing", { from });
    });

    // WEBRTC SIGNALING
    socket.on("offer", ({ to, offer, from, type }) => {
        const toSocket = users[to];
        if (toSocket) io.to(toSocket).emit("offer", { offer, from, type });
    });

    socket.on("answer", ({ to, answer, from }) => {
        const toSocket = users[to];
        if (toSocket) io.to(toSocket).emit("answer", { answer, from });
    });

    socket.on("candidate", ({ to, candidate, from }) => {
        const toSocket = users[to];
        if (toSocket) io.to(toSocket).emit("candidate", { candidate, from });
    });

    // DISCONNECT
    socket.on("disconnect", () => {
        const name = Object.keys(users).find(k => users[k] === socket.id);
        if (name) delete users[name];
        console.log(name + " disconnected");
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));