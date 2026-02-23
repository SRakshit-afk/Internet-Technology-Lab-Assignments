const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = 3000;
const ADMIN_PASSWORD = "admin123";
const ADMIN_TOKEN = "MANAGER_ACCESS_GRANTED_TOKEN_99";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const dataStore = {};

const getStore = (ip) => {
  let clientIp = ip;
  if (clientIp === "::1") {
    clientIp = "127.0.0.1";
  } else if (clientIp.startsWith("::ffff:")) {
    clientIp = clientIp.replace("::ffff:", "");
  }

  if (!dataStore[clientIp]) {
    dataStore[clientIp] = {};
  }
  return dataStore[clientIp];
};

// --- Routes ---

app.get("/", (req, res) => {
  res.render("index");
});

app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({
      status: "SUCCESS",
      token: ADMIN_TOKEN,
      message: "You are now a Manager",
    });
  } else {
    res.status(401).json({ status: "FAIL", message: "Incorrect Password" });
  }
});

app.post("/api/put", (req, res) => {
  const { key, value } = req.body;
  const store = getStore(req.ip);

  if (!key || !value) return res.status(400).json({ message: "Missing data" });

  store[key] = value;

  const cleanIp =
    req.ip === "::1" ? "127.0.0.1" : req.ip.replace("::ffff:", "");
  console.log(`[${cleanIp}] PUT: ${key} = ${value}`);

  res.json({ status: "OK", message: `Stored ${key}` });
});

app.get("/api/get", (req, res) => {
  const { key, targetIp } = req.query;
  const clientToken = req.headers["x-auth-token"];

  if (!key) return res.status(400).json({ message: "Key is required" });

  let storeToRead;

  if (targetIp) {
    if (clientToken === ADMIN_TOKEN) {
      console.log(`[Manager] Accessing Target: [${targetIp}]`);
      storeToRead = getStore(targetIp);
    } else {
      return res
        .status(403)
        .json({ value: "ACCESS DENIED: Manager role required" });
    }
  } else {
    storeToRead = getStore(req.ip);
  }

  const value = storeToRead[key];
  const cleanIp =
    req.ip === "::1" ? "127.0.0.1" : req.ip.replace("::ffff:", "");
  console.log(`[${cleanIp}] GET: ${key} -> ${value || "<blank>"}`);

  res.json({ value: value ? value : "<blank>" });
});

app.listen(PORT,  () => {
  console.log(`Server is running!`);
  console.log(`- Local: http://localhost:${PORT}`);
});

