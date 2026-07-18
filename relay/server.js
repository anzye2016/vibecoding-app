import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 8766;
const TOKEN = process.env.RELAY_TOKEN || "vibecoding-default-token";

const rooms = new Map();

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const room = url.searchParams.get("room");
  const role = url.searchParams.get("role");
  const token = url.searchParams.get("token");

  if (!room) {
    ws.close(1008, "missing room");
    return;
  }
  if (!role || !["pc", "phone"].includes(role)) {
    ws.close(1008, "invalid role (use pc or phone)");
    return;
  }
  if (token !== TOKEN) {
    ws.close(1008, "invalid token");
    return;
  }

  if (!rooms.has(room)) {
    rooms.set(room, { pc: null, phone: null });
  }
  const pair = rooms.get(room);

  if (role === "pc") {
    if (pair.pc) {
      try { pair.pc.close(1000, "replaced"); } catch {}
    }
    pair.pc = ws;
    console.log(`[${room}] PC connected`);
    notifyPhone(room, { type: "status", online: true });
  } else {
    if (pair.phone) {
      try { pair.phone.close(1000, "replaced"); } catch {}
    }
    pair.phone = ws;
    console.log(`[${room}] Phone connected`);
    if (pair.pc) {
      ws.send(JSON.stringify({ type: "status", online: true }));
    } else {
      ws.send(JSON.stringify({ type: "status", online: false }));
    }
  }

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (role === "phone") {
      if (pair.pc && pair.pc.readyState === 1) {
        pair.pc.send(JSON.stringify(msg));
      } else {
        ws.send(JSON.stringify({ type: "error", text: "PC not connected" }));
      }
    } else if (role === "pc") {
      if (pair.phone && pair.phone.readyState === 1) {
        pair.phone.send(JSON.stringify(msg));
      }
    }
  });

  ws.on("close", () => {
    if (role === "pc") {
      if (pair.pc === ws) {
        pair.pc = null;
        notifyPhone(room, { type: "status", online: false });
        console.log(`[${room}] PC disconnected`);
      }
    } else {
      if (pair.phone === ws) {
        pair.phone = null;
        console.log(`[${room}] Phone disconnected`);
      }
    }
    if (!pair.pc && !pair.phone) {
      rooms.delete(room);
    }
  });

  ws.on("error", () => {});
});

function notifyPhone(room, msg) {
  const pair = rooms.get(room);
  if (pair && pair.phone && pair.phone.readyState === 1) {
    pair.phone.send(JSON.stringify(msg));
  }
}

console.log(`Relay listening on :${PORT}`);
