// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 50 * 1024 * 1024 }); // 50MB limit

// Serve static files (including uploaded images)
app.use(express.static(path.join(__dirname, "public")));

// --- DATA PERSISTENCE ---
const DATA_FILE = path.join(__dirname, "database.json");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// In-memory data store (loaded from file)
let db = {
  users: [], // { username, password, tags: [] }
  posts: [], // { id, type, room, username, imageUrl, comment, tag, comments: [] }
};

// Load data on start
if (fs.existsSync(DATA_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE));
  } catch (e) {
    console.log("Error loading database, starting fresh.");
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// Helper: Save Base64 image to disk
function saveImage(base64Data, username) {
  if (!base64Data) return null;
  const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) return null;

  const buffer = Buffer.from(matches[2], "base64");
  const filename = `${Date.now()}_${username}.png`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

// --- WEBSOCKET SERVER ---
const clientInfo = new Map(); // Map<ws, { username, tags, room }>

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      const { type, payload } = data;

      switch (type) {
        // 1. LOGIN
        case "login":
          handleLogin(ws, payload);
          break;

        // 2. JOIN GROUP (Switch Room)
        case "join_group":
          handleJoinGroup(ws, payload);
          break;

        // 3. UPLOAD (Public or Group)
        case "upload_post":
          handleUpload(ws, payload);
          break;

        // 4. ADD COMMENT
        case "add_comment":
          handleComment(ws, payload);
          break;
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  });

  ws.on("close", () => {
    clientInfo.delete(ws);
  });
});

// --- HANDLERS ---

function handleLogin(ws, { username, password, tags }) {
  let user = db.users.find((u) => u.username === username);

  if (user) {
    // Check password
    if (user.password !== password) {
      ws.send(JSON.stringify({ type: "error", payload: "Invalid password" }));
      return;
    }
    // Update tags if provided, or keep existing
    if (tags) user.tags = tags.split(",").map((t) => t.trim().toLowerCase());
  } else {
    // Register new user
    user = {
      username,
      password,
      tags: tags
        ? tags.split(",").map((t) => t.trim().toLowerCase())
        : [],
    };
    db.users.push(user);
    saveData();
  }

  // Store session info
  clientInfo.set(ws, { username: user.username, tags: user.tags, room: null });

  // Notify success
  ws.send(
    JSON.stringify({
      type: "login_success",
      payload: { username: user.username, tags: user.tags },
    })
  );

  // Send Public Feed History immediately
  const publicHistory = db.posts.filter((p) => p.type === "public");
  ws.send(
    JSON.stringify({ type: "history_update", payload: publicHistory })
  );
}

function handleJoinGroup(ws, { room }) {
  const info = clientInfo.get(ws);
  if (!info) return;

  // Leave previous room if any (optional cleanup)
  const oldRoom = info.room;
  info.room = room;
  clientInfo.set(ws, info);

  // 1. Tell the user they successfully joined (so UI updates)
  ws.send(JSON.stringify({
      type: "room_joined", 
      payload: room
  }));

  // 2. Load History
  const groupHistory = db.posts.filter(
    (p) => p.type === "group" && p.room === room
  );
  ws.send(JSON.stringify({ type: "history_update", payload: groupHistory }));

  // 3. Notify OTHERS in the room
  broadcastNotification(room, `${info.username} has joined the group!`);
}

function handleUpload(ws, { image, comment, room, tag }) {
  const info = clientInfo.get(ws);
  if (!info) return;

  const imageUrl = saveImage(image, info.username);
  
  const newPost = {
    id: Date.now(), // Simple ID
    type: room ? "group" : "public",
    room: room || null,
    username: info.username,
    imageUrl: imageUrl,
    comment: comment,
    tag: tag ? tag.toLowerCase() : "general", // Tag of the image
    comments: [], // Array for replies
  };

  db.posts.push(newPost);
  saveData();

  // Broadcast
  broadcastPost(newPost);
}

function handleComment(ws, { postId, text }) {
  const info = clientInfo.get(ws);
  if (!info) return;

  const post = db.posts.find((p) => p.id === postId);
  if (!post) return;

  // --- PERMISSION CHECK ---
  // "People with Photography tag should be able to comment on Photography images"
  // Logic: User must have the tag that matches the post's tag.
  // Exception: If the post has no specific tag (e.g. "general"), maybe allow everyone?
  // Implementing strict check as requested:
  
  const userHasTag = info.tags.includes(post.tag);
  
  if (!userHasTag && post.tag !== "general" && post.tag !== "") {
      ws.send(JSON.stringify({
          type: "error", 
          payload: `You need the '${post.tag}' tag to comment on this!`
      }));
      return;
  }

  const newComment = {
      username: info.username,
      text: text,
      timestamp: Date.now()
  };

  post.comments.push(newComment);
  saveData();

  // Broadcast the updated post to everyone relevant
  broadcastPost(post); 
}

// --- BROADCAST HELPERS ---

function broadcastPost(post) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const info = clientInfo.get(client);
      if (!info) return;

      // If public, send to all. If group, send only to matching room members.
      if (post.type === "public") {
        client.send(JSON.stringify({ type: "post_update", payload: post }));
      } else if (post.type === "group" && info.room === post.room) {
        client.send(JSON.stringify({ type: "post_update", payload: post }));
      }
    }
  });
}

function broadcastNotification(room, message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const info = clientInfo.get(client);
      // Send to everyone in the room
      if (info && info.room === room) {
        client.send(JSON.stringify({ 
            type: "group_notification", 
            payload: message 
        }));
      }
    }
  });
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});