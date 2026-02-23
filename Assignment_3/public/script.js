const socket = io();

let currentMode = "global";
let currentRoom = "";
let currentPrivateUser = "";
let unreadCounts = {}; // Keeps track of unread messages per user

const STORAGE_KEY_USER = "chat_app_username";
const STORAGE_KEY_GLOBAL = "chat_history_global";
const STORAGE_KEY_GROUP_PREFIX = "chat_history_group_";

window.onload = () => {
  // Check for saved username or trigger modal
  const savedUser = localStorage.getItem(STORAGE_KEY_USER);
  if (savedUser) {
    username = savedUser;
    socket.emit("user_connected", savedUser); 
  } else {
    document.getElementById("user-modal").style.display = "flex";
  }
  
  loadMessagesFromStorage("global");
  socket.emit("request_global_history");
};

// Initial user setup
function saveInitialUser() {
  const input = document.getElementById("username-init").value.trim();
  if (input) {
    localStorage.setItem(STORAGE_KEY_USER, input);
    document.getElementById("user-modal").style.display = "none";
    location.reload(); // Refresh to set state
  }
}

// UI Mode Switching (Global vs Group)
function setMode(mode, targetName = null) {
  currentMode = mode;
  
  if (mode === "group" && targetName) currentRoom = targetName;
  if (mode === "private" && targetName) currentPrivateUser = targetName;
  
  // Clear active highlights
  document.querySelectorAll('.chat-item').forEach(item => {
    item.classList.remove('active');
  });

  const titleEl = document.getElementById("active-chat-title");
  const chatWindow = document.getElementById("chat-window");
  chatWindow.innerHTML = "";

  if (mode === "global") {
    document.getElementById("item-global").classList.add("active");
    titleEl.innerText = "Global Feed";
    loadMessagesFromStorage("global");
    socket.emit("request_global_history");
    
  } else if (mode === "group") {
    const activeGroupEl = document.getElementById(`item-${currentRoom}`);
    if (activeGroupEl) activeGroupEl.classList.add("active");
    titleEl.innerText = `Group: ${currentRoom}`;
    loadMessagesFromStorage(currentRoom);
    
  } else if (mode === "private") {
    // Highlight the user in the new online list
    const activeUserEl = document.getElementById(`item-user-${currentPrivateUser}`);
    if (activeUserEl) activeUserEl.classList.add("active");
    titleEl.innerText = `Chat with ${currentPrivateUser}`;
    // Load local history for this specific 1-on-1 chat
    loadMessagesFromStorage(`private_${currentPrivateUser}`); 

    unreadCounts[currentPrivateUser] = 0; // Reset the count to zero
    updateBadge(currentPrivateUser);      // Hide the badge
  }
}

// File Preview Logic
const fileInput = document.getElementById("fileInput");
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    document.getElementById("file-preview").style.display = "flex";
    document.getElementById("file-name").innerText = fileInput.files[0].name;
  }
});

function clearFile() {
  fileInput.value = "";
  document.getElementById("file-preview").style.display = "none";
}

function handleEnter(event) {
  if (event.key === "Enter") sendMessage();
}

function getBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

// Group Logic
function createGroup() {
  const room = document.getElementById("roomInput").value.trim();
  const user = localStorage.getItem(STORAGE_KEY_USER);
  if (!room) return alert("Enter a room name!");
  socket.emit("create_group", { room, username: user });
}

function joinGroup() {
  const room = document.getElementById("roomInput").value.trim();
  const user = localStorage.getItem(STORAGE_KEY_USER);
  if (!room) return alert("Enter a room name!");
  socket.emit("join_group", { room, username: user });
}

// Send Message with OTP Confirmation and Media Support
async function sendMessage() {
  const msgInput = document.getElementById("msgInput");
  const text = msgInput.value.trim();
  const file = fileInput.files[0];
  const user = localStorage.getItem(STORAGE_KEY_USER);

  if (!text && !file) return;

  // Requirement: OTP Confirmation [cite: 16]
  if (/\b\d{6}\b/.test(text)) {
    const confirmed = confirm("Warning: You are sending a 6-digit code (OTP). This is private information. Send anyway?");
    if (!confirmed) return;
  }

  let imageBase64 = null;
  if (file) {
    imageBase64 = await getBase64(file);
  }

  const msgId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

  const payload = {
    id: msgId,
    username: user,
    text: text,
    image: imageBase64,
    room: currentMode === "group" ? currentRoom : null,
  };

  // Route the message based on the current mode
  if (currentMode === "global") {
    socket.emit("public_message", payload);
  } else if (currentMode === "group") {
    if (!currentRoom) return alert("Join a group first!");
    socket.emit("group_message", payload);
  } else if (currentMode === "private") {
    if (!currentPrivateUser) return alert("Select a user first!");
    payload.targetUser = currentPrivateUser; // Tell the backend who to send it to
    socket.emit("private_message", payload);
  }

  msgInput.value = "";
  clearFile();
}

// Message Controls
function deleteMessage(id) {
  if (!confirm("Delete this message?")) return;
  socket.emit("delete_message", { id, mode: currentMode, room: currentRoom });
}

function editMessage(id, oldText) {
  const newText = prompt("Edit your message:", oldText);
  if (newText !== null && newText !== oldText) {
    socket.emit("edit_message", { id, mode: currentMode, room: currentRoom, newText });
  }
}

// Storage Helpers
function getStorageKey(context) {
  return context === "global" ? STORAGE_KEY_GLOBAL : STORAGE_KEY_GROUP_PREFIX + context;
}

function updateStorage(context, callback) {
  const key = getStorageKey(context);
  let history = JSON.parse(localStorage.getItem(key) || "[]");
  history = callback(history);
  localStorage.setItem(key, JSON.stringify(history));
}

// Socket Event Handlers
socket.on("group_success", (room) => {
  // 1. Add to sidebar list FIRST so it exists in the DOM
  const list = document.getElementById("dynamic-groups");
  if (!document.getElementById(`item-${room}`)) {
    const div = document.createElement("div");
    div.id = `item-${room}`;
    div.className = "chat-item"; // Don't add 'active' here, setMode handles it
    
    // IMPORTANT: Pass the specific room name to setMode!
    div.onclick = () => setMode('group', room); 
    
    div.innerHTML = `
      <div class="avatar"></div>
      <div class="chat-info">
        <span class="chat-name">${room}</span>
        <span class="chat-preview">Group Chat</span>
      </div>`;
    list.appendChild(div);
  }

  // 2. NOW switch the mode and highlight it
  setMode("group", room);
});

socket.on("group_error", (msg) => alert(msg));

socket.on("history_response", (historyData) => {
  const context = currentMode === "global" ? "global" : currentRoom;
  if (!context) return;
  localStorage.setItem(getStorageKey(context), JSON.stringify(historyData));
  document.getElementById("chat-window").innerHTML = "";
  historyData.forEach((msg) => appendMessage(msg));
});

socket.on("receive_public", (data) => {
  updateStorage("global", (history) => {
    history.push(data);
    if (history.length > 50) history.shift();
    return history;
  });
  if (currentMode === "global") appendMessage(data);
});

socket.on("receive_group", (data) => {
  if (currentRoom) {
    updateStorage(currentRoom, (history) => {
      history.push(data);
      if (history.length > 50) history.shift();
      return history;
    });
  }
  if (currentMode === "group") appendMessage(data);
});

socket.on("message_deleted", ({ id }) => {
  const el = document.getElementById(`msg-${id}`);
  if (el) el.remove();
  const context = currentMode === "global" ? "global" : currentRoom;
  updateStorage(context, (history) => history.filter((m) => m.id !== id));
});

socket.on("message_updated", ({ id, newText }) => {
  const textEl = document.querySelector(`#msg-${id} .msg-text`);
  if (textEl) textEl.innerText = newText + " (edited)";
  const context = currentMode === "global" ? "global" : currentRoom;
  updateStorage(context, (history) => {
    const msg = history.find((m) => m.id === id);
    if (msg) msg.text = newText;
    return history;
  });
});

// AI Trolling Response Handler [cite: 12, 13]
socket.on("system_message", (msg) => {
  addSystemMessage(msg);
});

// UI Rendering
function appendMessage(data) {
  const chat = document.getElementById("chat-window");
  if (document.getElementById(`msg-${data.id}`)) return;

  const myName = localStorage.getItem(STORAGE_KEY_USER);
  const isMe = myName !== "" && data.username === myName;

  const div = document.createElement("div");
  div.id = `msg-${data.id}`;
  div.className = isMe ? "message self" : "message other";

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let content = `<div class="msg-header">
                    <span class="meta">${isMe ? "You" : data.username}</span>`;
  if (isMe) {
    const safeText = (data.text || "").replace(/'/g, "\\'");
    content += `
        <div class="msg-actions">
            <i class="fas fa-edit" onclick="editMessage('${data.id}', '${safeText}')"></i>
            <i class="fas fa-trash" onclick="deleteMessage('${data.id}')"></i>
        </div>`;
  }
  content += `</div>`;

  if (data.image) content += `<img src="${data.image}" class="msg-img" />`;
  if (data.text) content += `<div class="msg-text">${data.text}</div>`;
  
  content += `<span class="msg-meta">${time} ${isMe ? '✓✓' : ''}</span>`;

  div.innerHTML = content;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function addSystemMessage(msg) {
  const chat = document.getElementById("chat-window");
  const div = document.createElement("div");
  div.className = "date-divider system-msg";
  div.innerHTML = `<span>${msg}</span>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function loadMessagesFromStorage(context) {
  const key = getStorageKey(context);
  const history = JSON.parse(localStorage.getItem(key) || "[]");
  const chat = document.getElementById("chat-window");
  chat.innerHTML = "";
  history.forEach((msg) => appendMessage(msg));
}

/**
 * DARK MODE TOGGLE LOGIC
 */
const themeToggleBtn = document.querySelector('.toggle-theme');

// 1. Check for saved theme preference on load
const currentTheme = localStorage.getItem('kotha_theme') || 'light';

if (currentTheme === 'dark') {
    document.body.classList.add('dark-theme');
    themeToggleBtn.classList.replace('fa-sun', 'fa-moon');
}

// 2. Listen for clicks on the theme toggle button
themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    
    let theme = 'light';
    if (document.body.classList.contains('dark-theme')) {
        theme = 'dark';
        themeToggleBtn.classList.replace('fa-sun', 'fa-moon');
    } else {
        themeToggleBtn.classList.replace('fa-moon', 'fa-sun');
    }
    
    // Save preference to localStorage so it survives tab reloads
    localStorage.setItem('kotha_theme', theme);
});

// Promise-based function to handle the custom OTP UI
function confirmOTPWarning() {
  return new Promise((resolve) => {
    const modal = document.getElementById("otp-modal");
    modal.style.display = "flex";

    // If they click Send Anyway
    document.getElementById("confirm-otp").onclick = () => {
      modal.style.display = "none";
      resolve(true); // Promise resolves to true
    };

    // If they click Cancel
    document.getElementById("cancel-otp").onclick = () => {
      modal.style.display = "none";
      resolve(false); // Promise resolves to false
    };
  });
}

// --- 1-ON-1 CHAT SOCKET EVENTS ---

// Populate the left sidebar with online users
socket.on("update_online_users", (users) => {
  const list = document.getElementById("online-users-list");
  list.innerHTML = "";
  const myName = localStorage.getItem(STORAGE_KEY_USER);

  users.forEach(user => {
    if (user === myName) return; // Don't show yourself in the list

    const div = document.createElement("div");
    div.id = `item-user-${user}`;
    div.className = "chat-item";
    div.onclick = () => setMode('private', user);
    
    // UI: Adds a green online status dot next to their name
// Inside socket.on("update_online_users", (users) => { ...

    // UI: Adds the green dot, name, AND the new unread badge
    div.innerHTML = `
      <div style="width: 12px; height: 12px; background: #27ae60; border-radius: 50%; margin: 0 15px 0 5px; flex-shrink: 0; box-shadow: 0 0 0 2px var(--bg-light);"></div>
      <div class="chat-info">
        <span class="chat-name">${user}</span>
        <span class="chat-preview">Online Now</span>
      </div>
      <span class="unread-badge" id="badge-${user}"></span>`; // <-- NEW BADGE
      
    list.appendChild(div);
    
    // Check if they already had unread messages before the list refreshed
    updateBadge(user);
  });
});

// Handle incoming 1-on-1 messages
socket.on("receive_private", (data) => {
  const myName = localStorage.getItem(STORAGE_KEY_USER);
  
  // Figure out who the "other" person is so we save it in the right history bucket
  const otherPerson = data.username === myName ? data.targetUser : data.username;
  const storageContext = `private_${otherPerson}`;

  updateStorage(storageContext, (history) => {
    history.push(data);
    if (history.length > 50) history.shift(); // Keep history manageable
    return history;
  });

  // If we are actively looking at the chat with this person, render it immediately
  // Inside socket.on("receive_private", (data) => { ...

  // If we are actively looking at the chat with this person, render it immediately
  if (currentMode === "private" && currentPrivateUser === otherPerson) {
    appendMessage(data);
  } else if (data.username !== myName) {
    // THEY SENT A MESSAGE AND WE AREN'T LOOKING!
    // Increase their unread count by 1
    unreadCounts[otherPerson] = (unreadCounts[otherPerson] || 0) + 1;
    updateBadge(otherPerson); // Show the red dot
  }
});

// Helper to show/hide the red dot
function updateBadge(user) {
  const badge = document.getElementById(`badge-${user}`);
  if (badge) {
    const count = unreadCounts[user] || 0;
    if (count > 0) {
      badge.innerText = count;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }
}