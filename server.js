require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.RADIO_ACCESS_CODE || "change-this-before-deploying";

const CHANNELS = [
  "POLICE 1", "POLICE 2", "POLICE 3",
  "SHERIFF 1", "SHERIFF 2",
  "FIRE 1", "FIRE 2",
  "EMS 1", "EMS 2",
  "DISPATCH", "TRAFFIC", "AIR SUPPORT"
];

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

// Each connected user subscribes to every frequency so they can listen to
// several channels at once. The client controls which incoming channels are muted.
const users = new Map();

function safeName(value) {
  return String(value || "Dispatcher").trim().replace(/[<>]/g, "").slice(0, 24) || "Dispatcher";
}

io.on("connection", (socket) => {
  socket.on("join-radio", (payload = {}, callback = () => {}) => {
    if (socket.data.joined) return callback({ ok: false, error: "Already joined." });

    const roomCode = String(payload.roomCode || "");
    const name = safeName(payload.name);

    if (roomCode !== ACCESS_CODE) {
      return callback({ ok: false, error: "That radio room code is incorrect." });
    }

    socket.data.joined = true;
    socket.data.name = name;
    socket.data.roomCode = roomCode;
    socket.data.channels = new Set(CHANNELS);
    socket.join(roomCode); // room-wide roster and activity updates

    for (const channel of CHANNELS) {
      const room = `${roomCode}:${channel}`;
      const existing = [...(io.sockets.adapter.rooms.get(room) || [])]
        .filter((id) => id !== socket.id)
        .map((id) => ({ id, name: users.get(id)?.name || "Dispatcher" }));

      socket.join(room);
      socket.emit("channel-peers", { channel, peers: existing });
      socket.to(room).emit("peer-joined", {
        channel,
        peer: { id: socket.id, name }
      });
    }

    users.set(socket.id, { name, roomCode });
    callback({ ok: true, id: socket.id, channels: CHANNELS });
    io.to(roomCode).emit("roster-update", getRoster(roomCode));
    io.to(roomCode).emit("radio-log", {
      message: `${name} joined the radio network.`,
      time: Date.now()
    });
  });

  // Relay WebRTC signaling only when both users are members of the same
  // authenticated room and frequency.
  socket.on("rtc-signal", (payload = {}) => {
    if (!socket.data.joined) return;
    const target = io.sockets.sockets.get(payload.target);
    const channel = CHANNELS.includes(payload.channel) ? payload.channel : null;
    if (!target || !channel || !target.data.joined) return;
    if (target.data.roomCode !== socket.data.roomCode) return;

    io.to(target.id).emit("rtc-signal", {
      from: socket.id,
      fromName: socket.data.name,
      channel,
      description: payload.description,
      candidate: payload.candidate
    });
  });

  socket.on("transmitting", (payload = {}) => {
    if (!socket.data.joined) return;
    const channel = CHANNELS.includes(payload.channel) ? payload.channel : null;
    if (!channel) return;
    socket.to(`${socket.data.roomCode}:${channel}`).emit("transmitter-state", {
      id: socket.id,
      name: socket.data.name,
      channel,
      active: Boolean(payload.active)
    });
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (!user) return;
    for (const channel of CHANNELS) {
      socket.to(`${user.roomCode}:${channel}`).emit("peer-left", {
        id: socket.id,
        channel
      });
    }
    users.delete(socket.id);
    io.to(user.roomCode).emit("roster-update", getRoster(user.roomCode));
    io.to(user.roomCode).emit("radio-log", {
      message: `${user.name} disconnected.`,
      time: Date.now()
    });
  });
});

function getRoster(roomCode) {
  return [...users.entries()]
    .filter(([, user]) => user.roomCode === roomCode)
    .map(([id, user]) => ({ id, name: user.name }));
}

server.listen(PORT, () => {
  console.log(`ERLC Dispatch Radio listening on port ${PORT}`);
});
