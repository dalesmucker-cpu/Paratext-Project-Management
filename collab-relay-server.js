/**
 * Standalone WebSocket Collaboration Relay Server for Paratext Project Manager
 * 
 * Dependencies:
 *   npm install ws
 * 
 * To run:
 *   node collab-relay-server.js
 */

const http = require('http');
const WebSocket = require('ws');

// Simple HTTP server to handle health checks (required by hosting providers like Render, Fly.io, etc.)
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK - Paratext Project Manager Collaboration Relay Server is active.\n');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
  }
});

const wss = new WebSocket.Server({ server });

// Map to track rooms: roomId -> { host: socket, guests: Map(username -> socket), usernames: Set(username) }
const rooms = new Map();

wss.on('connection', (ws) => {
  let myRoomId = null;
  let myUsername = null;
  let myRole = null; // 'host' | 'guest'

  ws.on('message', (messageStr) => {
    try {
      const msg = JSON.parse(messageStr);

      // Handle Host Room creation
      if (msg.type === 'host_room') {
        const { roomId, username } = msg.payload;
        if (!roomId || !username) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Falta Room ID o Nombre de Usuario.' } }));
          return;
        }

        // Clean up room if host reconnects or if room already exists
        if (rooms.has(roomId)) {
          const existing = rooms.get(roomId);
          // If the host is already active, prevent duplicate host
          if (existing.host && existing.host.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'La sala ya está siendo alojada por otro usuario.' } }));
            return;
          }
          // Otherwise, clear the dead room
          rooms.delete(roomId);
        }

        myRoomId = roomId;
        myUsername = username;
        myRole = 'host';

        rooms.set(roomId, {
          host: ws,
          hostUsername: username,
          guests: new Map(),
          usernames: new Set([username]),
        });

        ws.send(JSON.stringify({ type: 'handshake_ack', payload: { role: 'host' } }));
        broadcastUserList(roomId);
        console.log(`[Host Created] Room: ${roomId} by User: ${username}`);
        return;
      }

      // Handle Guest Room joining
      if (msg.type === 'join_room') {
        const { roomId, username } = msg.payload;
        if (!roomId || !username) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Falta Room ID o Nombre de Usuario.' } }));
          return;
        }

        if (!rooms.has(roomId)) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: `La sala "${roomId}" no existe o el anfitrión no ha iniciado sesión.` } }));
          return;
        }

        const room = rooms.get(roomId);
        if (room.usernames.has(username)) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'El nombre de usuario ya está en uso en esta sala.' } }));
          return;
        }

        myRoomId = roomId;
        myUsername = username;
        myRole = 'guest';

        room.guests.set(username, ws);
        room.usernames.add(username);

        ws.send(JSON.stringify({ type: 'handshake_ack', payload: { role: 'guest' } }));

        // Notify host that guest joined
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({ type: 'user_joined', payload: { username } }));
        }

        broadcastUserList(roomId);

        // Send system notice to the room
        broadcastToRoom(roomId, {
          type: 'chat_message',
          payload: { user: 'Sistema', message: `${username} se ha unido a la colaboración.`, timestamp: Date.now() }
        }, null);

        console.log(`[Guest Joined] Room: ${roomId}, User: ${username}`);
        return;
      }

      // Forward broadcast payloads to other members in the room
      if (myRoomId && rooms.has(myRoomId)) {
        if (msg.type === 'broadcast') {
          broadcastToRoom(myRoomId, msg.payload, ws);
        } else if (msg.type === 'send_to') {
          const { target, payload } = msg;
          sendToUser(myRoomId, target, payload);
        }
      }

    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  ws.on('close', () => {
    if (myRoomId && rooms.has(myRoomId)) {
      const room = rooms.get(myRoomId);

      if (myRole === 'host') {
        console.log(`[Host Left] Room closed: ${myRoomId}`);
        // Host disconnected: notify and disconnect all guests
        broadcastToRoom(myRoomId, {
          type: 'status_update',
          payload: { role: 'none', error: 'El anfitrión ha cerrado la sesión.' }
        }, ws);

        for (const guestWs of room.guests.values()) {
          if (guestWs.readyState === WebSocket.OPEN) {
            guestWs.close();
          }
        }
        rooms.delete(myRoomId);
      } else if (myRole === 'guest') {
        console.log(`[Guest Left] Room: ${myRoomId}, User: ${myUsername}`);
        room.guests.delete(myUsername);
        room.usernames.delete(myUsername);

        broadcastUserList(myRoomId);
        broadcastToRoom(myRoomId, {
          type: 'chat_message',
          payload: { user: 'Sistema', message: `${myUsername} ha salido de la colaboración.`, timestamp: Date.now() }
        }, null);
      }
    }
  });
});

function broadcastToRoom(roomId, msg, excludeWs) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);

  if (room.host && room.host !== excludeWs && room.host.readyState === WebSocket.OPEN) {
    room.host.send(data);
  }
  for (const guestWs of room.guests.values()) {
    if (guestWs !== excludeWs && guestWs.readyState === WebSocket.OPEN) {
      guestWs.send(data);
    }
  }
}

function sendToUser(roomId, targetUsername, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);

  if (targetUsername === 'host' || targetUsername === room.hostUsername) {
    if (room.host && room.host.readyState === WebSocket.OPEN) {
      room.host.send(data);
    }
  } else {
    const guestWs = room.guests.get(targetUsername);
    if (guestWs && guestWs.readyState === WebSocket.OPEN) {
      guestWs.send(data);
    }
  }
}

function broadcastUserList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const users = Array.from(room.usernames);
  broadcastToRoom(roomId, { type: 'user_list', payload: { users } }, null);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`);
});
