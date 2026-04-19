const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// username -> socketId
let users = {};

io.on("connection", (socket) => {

    // JOIN (reconnect-safe overwrite)
    socket.on("join", (name) => {
        socket.username = name;

        users[name] = socket.id;

        io.emit("users-update", Object.keys(users));
    });

    // CALL SIGNALING
    socket.on("offer", ({ to, offer, from }) => {
        const toSocket = users[to];
        if (toSocket) {
            io.to(toSocket).emit("offer", { offer, from });
        }
    });

    socket.on("answer", ({ to, answer }) => {
        const toSocket = users[to];
        if (toSocket) {
            io.to(toSocket).emit("answer", { answer });
        }
    });

    socket.on("candidate", ({ to, candidate }) => {
        const toSocket = users[to];
        if (toSocket) {
            io.to(toSocket).emit("candidate", { candidate });
        }
    });

    // REJECT CALL
    socket.on("reject-call", ({ to, from }) => {
        const toSocket = users[to];
        if (toSocket) {
            io.to(toSocket).emit("call-rejected", { from });
        }
    });

    // DISCONNECT SAFE CLEANUP
    socket.on("disconnect", () => {
        const name = socket.username;

        if (name && users[name] === socket.id) {
            delete users[name];
            io.emit("users-update", Object.keys(users));
        }
    });

});

server.listen(3000, () => {
    console.log("Server running on port 3000");
});