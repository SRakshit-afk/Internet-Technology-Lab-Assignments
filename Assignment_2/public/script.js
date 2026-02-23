const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${protocol}://${window.location.host}`);

let currentUser = null;
let currentTags = [];
let currentRoom = null;

// --- WEBSOCKET HANDLERS ---
ws.onopen = () => console.log("Connected to Server");

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const { type, payload } = data;

    if (type === "login_success") {
        currentUser = payload.username;
        currentTags = payload.tags;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('main-app').style.display = 'block';
        document.getElementById('user-display').innerText = `Logged in as: ${currentUser} (${currentTags.join(', ')})`;
    } 
    else if (type === "error") {
        alert("Error: " + payload);
    }
    else if (type === "system_message") {
        // Just log or small toast could be here
        console.log("System:", payload);
    }
    else if (type === "history_update") {
        // Clear current feed
        const feedId = (payload.length > 0 && payload[0].type === 'group') ? 'group-feed' : 'public-feed';
        const feed = document.getElementById(feedId);
        if(feed) feed.innerHTML = "";
        
        // Render all posts
        payload.forEach(post => renderPost(post));
    }
    else if (type === "post_update") {
        // Check if existing post (update comment) or new post
        const existingElement = document.getElementById(`post-${payload.id}`);
        if (existingElement) {
            updatePostComments(payload);
        } else {
            renderPost(payload);
        }
    }
};

// --- LOGIC ---

function login() {
    const u = document.getElementById('loginUser').value;
    const p = document.getElementById('loginPass').value;
    const t = document.getElementById('loginTags').value;
    
    if(!u || !p) return alert("Please fill username and password");

    ws.send(JSON.stringify({
        type: "login",
        payload: { username: u, password: p, tags: t }
    }));
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');

    if(tab === 'public') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('public-panel').style.display = 'block';
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('group-panel').style.display = 'block';
    }
}

function joinGroup() {
    const room = document.getElementById('roomInput').value;
    if(!room) return;
    
    currentRoom = room;
    // Enable controls
    const controls = document.getElementById('group-controls');
    controls.style.opacity = "1";
    controls.style.pointerEvents = "auto";
    
    // Clear old group feed
    document.getElementById('group-feed').innerHTML = "";

    ws.send(JSON.stringify({
        type: 'join_group',
        payload: { room: room }
    }));
}

async function uploadPost(type) {
    const prefix = type === 'group' ? 'group' : 'public';
    const fileInput = document.getElementById(`${prefix}File`);
    const tagInput = document.getElementById(`${prefix}Tag`);
    const commentInput = document.getElementById(`${prefix}Comment`);

    // CHANGED: Allow post if EITHER file OR comment exists
    const hasFile = fileInput.files.length > 0;
    const hasText = commentInput.value.trim().length > 0;

    if (!hasFile && !hasText) {
        return alert("Please enter a message or select an image");
    }

    let base64 = null;
    if (hasFile) {
        base64 = await getBase64(fileInput.files[0]);
    }
    
    ws.send(JSON.stringify({
        type: 'upload_post',
        payload: {
            image: base64, // Can be null now
            comment: commentInput.value,
            tag: tagInput.value,
            room: type === 'group' ? currentRoom : null
        }
    }));

    // Reset inputs
    fileInput.value = "";
    commentInput.value = "";
}

function sendComment(postId, tagRequired) {
    // Client side check (server also checks)
    if (!currentTags.includes(tagRequired.toLowerCase()) && tagRequired !== 'general' && tagRequired !== '') {
        return alert(`You need the tag '${tagRequired}' to comment!`);
    }

    const input = document.getElementById(`input-${postId}`);
    const text = input.value;
    if(!text) return;

    ws.send(JSON.stringify({
        type: 'add_comment',
        payload: { postId, text }
    }));
    
    input.value = "";
}

// --- RENDERING ---

// In public/script.js

function renderPost(post) {
    const feedId = post.type === 'group' ? 'group-feed' : 'public-feed';
    const feed = document.getElementById(feedId);
    
    const div = document.createElement('div');
    div.className = 'post';
    div.id = `post-${post.id}`;
    
    const tagDisplay = post.tag ? `<span class="tag-badge">${post.tag}</span>` : '';

    // CHANGED: Only create the <img> HTML if an imageUrl exists
    const imgHtml = post.imageUrl ? `<img src="${post.imageUrl}" alt="User Upload">` : '';

    let commentsHtml = post.comments.map(c => 
        `<div class="single-comment"><b>${c.username}:</b> ${c.text}</div>`
    ).join('');

    div.innerHTML = `
        <div class="post-header">
            <span>Posted by <b>${post.username}</b></span>
            ${tagDisplay}
        </div>
        
        ${imgHtml} <div class="post-caption" style="font-size: 1.1em; margin-top: 5px;">
            ${post.comment || ''}
        </div>
        
        <div class="comments-section">
            <div class="comment-list" id="comments-${post.id}">
                ${commentsHtml}
            </div>
            <div class="comment-input-area">
                <input type="text" id="input-${post.id}" placeholder="Reply...">
                <button onclick="sendComment(${post.id}, '${post.tag || 'general'}')">Send</button>
            </div>
        </div>
    `;

    feed.prepend(div);
}

function updatePostComments(post) {
    const commentList = document.getElementById(`comments-${post.id}`);
    if(commentList) {
        commentList.innerHTML = post.comments.map(c => 
            `<div class="single-comment"><b>${c.username}:</b> ${c.text}</div>`
        ).join('');
    }
}

function getBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

// --- THEME TOGGLE LOGIC ---

function toggleTheme() {
    const body = document.body;
    body.classList.toggle('light-mode');
    
    const isLight = body.classList.contains('light-mode');
    localStorage.setItem('chobi_debo_theme', isLight ? 'light' : 'dark');
    
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        toggleBtn.innerText = isLight ? '🌙 Dark Mode' : '☀️ Light Mode';
    }
}

// Check local storage on page load to apply saved theme
window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('chobi_debo_theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) toggleBtn.innerText = '🌙 Dark Mode';
    }
});