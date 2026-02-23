const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
// Increased buffer size is still good to allow the upload *to* the server
const io = new Server(server, {
  maxHttpBufferSize: 1e8, // 100MB limit
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// --- CONSTANTS & SETUP ---
const DATA_FILE = path.join(__dirname, "chat_data.json");
// Define where images will be saved
const UPLOAD_DIR = path.join(__dirname, "public/uploads");

// Ensure the upload directory exists on startup
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log("Created upload directory at: " + UPLOAD_DIR);
}

let globalHistory = [];
let groupHistory = {};
const connectedUsers = new Map();

// --- HELPER FUNCTIONS ---

// 1. Load data from file
if (fs.existsSync(DATA_FILE)) {
  try {
    const fileData = fs.readFileSync(DATA_FILE, "utf8");
    const parsedData = JSON.parse(fileData);
    globalHistory = parsedData.globalHistory || [];
    groupHistory = parsedData.groupHistory || {};
    console.log("Chat history loaded from disk.");
  } catch (err) {
    console.error("Error reading data file:", err);
    // If file is corrupted, start fresh to prevent crash
    globalHistory = [];
    groupHistory = {};
  }
}

// 2. Save data to file
function saveData() {
  const dataToSave = { globalHistory, groupHistory };
  // Use async write to prevent blocking the event loop
  fs.writeFile(DATA_FILE, JSON.stringify(dataToSave, null, 2), (err) => {
      if (err) console.error("Error saving chat data:", err);
  });
}

// 3. NEW: Helper to save Base64 image to disk
function saveImageToDisk(base64Data) {
    try {
        // Regex to extract the content type and base64 payload
        // Matches strings like: data:image/jpeg;base64,/9j/4AAQSkZJRgABA...
        const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

        if (!matches || matches.length !== 3) {
            console.error("Invalid base64 image data format");
            return null;
        }

        const contentType = matches[1]; // e.g., 'image/jpeg'
        const rawBase64 = matches[2];
        const buffer = Buffer.from(rawBase64, 'base64');

        // Determine file extension based on content type
        let extension = 'jpg'; // default
        if (contentType === 'image/png') extension = 'png';
        else if (contentType === 'image/gif') extension = 'gif';
        else if (contentType.includes('svg')) extension = 'svg';

        // Generate a unique filename using timestamp and random number
        const filename = `${Date.now()}-${Math.floor(Math.random() * 1000000)}.${extension}`;
        const filePath = path.join(UPLOAD_DIR, filename);

        // Write the file to disk synchronously to ensure it exists before we send the URL
        fs.writeFileSync(filePath, buffer);
        console.log(`Image saved: ${filename}`);

        // Return the public URL path to the image
        return `/uploads/${filename}`;

    } catch (error) {
        console.error("Error saving image to disk:", error);
        return null;
    }
}

// 4. Trolling Detection
function getSoothingResponse(text) {
  if (!text) return null;
  // More robust pattern matching using word boundaries (\b) so "shater" doesn't trigger "hate"
  const trollPatterns = [/\bpagol\b/i, /\bstupid\b/i, /\bidiot\b/i, /\bhate\b/i, /\bbad\b/i];
  if (trollPatterns.some(pattern => pattern.test(text))) {
    const msgs = [
      "It seems like things are a bit stressful right now. Let's try to keep the chat friendly.",
      "Take a deep breath. Your peace of mind is more important than this argument.",
      "A soft answer turns away wrath. Let's communicate with kindness.",
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  return null;
}


// --- SOCKET CONNECTION HANDLERS ---
io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // Send history on connection
  socket.emit("history_response", globalHistory);

  // Register User Online
  socket.on("user_connected", (username) => {
    connectedUsers.set(socket.id, username);
    io.emit("update_online_users", Array.from(connectedUsers.values()));
  });

  // --- GLOBAL MESSAGE HANDLER ---
  socket.on("public_message", (data) => {
    const soothing = getSoothingResponse(data.text);
    if (soothing) return socket.emit("system_message", soothing);

    // IMAGE HANDLING START
    if (data.image) {
        const imageUrl = saveImageToDisk(data.image);
        if (imageUrl) {
            // Replace base64 string with the new file URL
            data.image = imageUrl;
        } else {
            // If saving failed, remove the image data so we don't save broken base64
            delete data.image;
            socket.emit("system_message", "Failed to upload image.");
        }
    }
    // IMAGE HANDLING END

    globalHistory.push(data);
    if (globalHistory.length > 50) globalHistory.shift();
    
    saveData(); 
    io.emit("receive_public", data); 
  });

  socket.on("request_global_history", () => {
    socket.emit("history_response", globalHistory);
  });

  // --- GROUP HANDLERS ---
  socket.on("create_group", (data) => {
    const { room, username } = data;
    if (groupHistory[room]) return socket.emit("group_error", `Group exists!`);
    
    groupHistory[room] = [];
    saveData(); 
    joinRoomInternal(socket, room, username);
  });

  socket.on("join_group", (data) => {
    const { room, username } = data;
    if (!groupHistory[room]) return socket.emit("group_error", `Group not found!`);
    joinRoomInternal(socket, room, username);
  });

  function joinRoomInternal(socket, room, username) {
    if (socket.currentRoom) socket.leave(socket.currentRoom);
    socket.join(room);
    socket.currentRoom = room;
    socket.username = username;

    socket.emit("group_success", room);
    socket.emit("history_response", groupHistory[room]);
    socket.to(room).emit("system_message", `${username} has joined.`);
  }

  // --- GROUP MESSAGE HANDLER ---
  socket.on("group_message", (data) => {
    const { room, text } = data;
    if (!groupHistory[room]) return;

    const soothing = getSoothingResponse(text);
    if (soothing) return socket.emit("system_message", soothing);

    // IMAGE HANDLING START
    if (data.image) {
        const imageUrl = saveImageToDisk(data.image);
        if (imageUrl) {
            // Replace base64 string with the new file URL
            data.image = imageUrl;
        } else {
            delete data.image;
            socket.emit("system_message", "Failed to upload image.");
        }
    }
    // IMAGE HANDLING END

    groupHistory[room].push(data);
    if (groupHistory[room].length > 50) groupHistory[room].shift();
    
    saveData(); 
    io.to(room).emit("receive_group", data);
  });

  // --- PRIVATE MESSAGE HANDLER ---
  socket.on("private_message", (data) => {
    // We don't save private chat history to the server file in this version, 
    // but we still need to handle images if they are sent privately.
    if (data.image) {
        const imageUrl = saveImageToDisk(data.image);
        if (imageUrl) {
            data.image = imageUrl;
        } else {
            delete data.image;
            socket.emit("system_message", "Failed to upload image in DM.");
        }
    }

    let targetSocketId = null;
    for (let [id, user] of connectedUsers.entries()) {
        if (user === data.targetUser) {
            targetSocketId = id;
            break;
        }
    }

    if (targetSocketId) {
        io.to(targetSocketId).emit("receive_private", data);
    }
    // Send back to sender so they see the image URL version
    socket.emit("receive_private", data); 
  });

  // --- MESSAGE CONTROLS ---
  socket.on("delete_message", (data) => {
    const { id, room, mode } = data;
    // Note: This basic delete does not delete the actual image file from the uploads folder.
    // That is a more advanced feature for later.
    if (mode === "global") {
      globalHistory = globalHistory.filter((msg) => msg.id !== id);
      saveData(); 
      io.emit("message_deleted", { id });
    } else if (groupHistory[room]) {
      groupHistory[room] = groupHistory[room].filter((msg) => msg.id !== id);
      saveData(); 
      io.to(room).emit("message_deleted", { id });
    }
  });

  socket.on("edit_message", (data) => {
    const { id, room, mode, newText } = data;
    const updateMsg = (list) => {
      const msg = list.find((m) => m.id === id);
      if (msg) { msg.text = newText; return true; }
      return false;
    };

    if (mode === "global") {
      if (updateMsg(globalHistory)) {
        saveData(); 
        io.emit("message_updated", { id, newText });
      }
    } else if (groupHistory[room] && updateMsg(groupHistory[room])) {
      saveData(); 
      io.to(room).emit("message_updated", { id, newText });
    }
  });

  socket.on("disconnect", () => {
    console.log(`User Disconnected: ${socket.id}`);
    connectedUsers.delete(socket.id);
    io.emit("update_online_users", Array.from(connectedUsers.values()));
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));