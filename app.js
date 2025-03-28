// op25-metadata-hub.js
require("dotenv").config();
const { spawn } = require("child_process");
const express = require("express");
const SSE = require("express-sse");
const fs = require("fs");
const path = require("path");

// Set a fixed minimum verbosity level (for OP25 arguments)
const MIN_VERBOSITY = 3;

// Load configuration from .env
const config = {
  port: process.env.PORT || 3000,
  token: process.env.TOKEN || null, // If null, no authentication enforced
  op25Cwd: process.env.OP25_CWD || process.cwd(),
  op25Command: process.env.OP25_COMMAND, // full path to rx.py
  // Split OP25_ARGS on spaces while handling quoted strings:
  op25Args: process.env.OP25_ARGS
    ? process.env.OP25_ARGS.match(/(?:[^\s"]+|"[^"]*")+/g).map((arg) =>
        arg.replace(/"/g, "")
      )
    : [],
};

// Load the regex configuration from regex-config.json
let regexConfig = [];
try {
  const configPath = path.join(__dirname, "regex-config.json");
  const configData = fs.readFileSync(configPath, "utf8");
  regexConfig = JSON.parse(configData);
  console.log("Loaded regex configuration:", regexConfig);
} catch (err) {
  console.error("Error loading regex-config.json:", err);
}

/**
 * Ensure that the verbosity level in the OP25 arguments is at least MIN_VERBOSITY.
 * Checks for "-v" or "--verbosity". If not found, adds "-v MIN_VERBOSITY".
 * If found but lower than MIN_VERBOSITY, updates its value.
 */
function ensureVerbosity(args) {
  let foundVerbosity = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-v" || args[i] === "--verbosity") {
      foundVerbosity = true;
      const currentVal = parseInt(args[i + 1]);
      if (isNaN(currentVal) || currentVal < MIN_VERBOSITY) {
        console.log(
          `Verbosity level (${currentVal}) is below minimum (${MIN_VERBOSITY}). Updating it.`
        );
        args[i + 1] = MIN_VERBOSITY.toString();
      }
    }
  }
  if (!foundVerbosity) {
    console.log(
      `Verbosity not set. Adding minimum verbosity: ${MIN_VERBOSITY}`
    );
    args.push("-v", MIN_VERBOSITY.toString());
  }
  return args;
}

// Enforce minimum verbosity on the OP25 arguments.
config.op25Args = ensureVerbosity(config.op25Args);

const sse = new SSE();

// Map to track active talkgroups: { talkgroup: { startTime, lastSeen, duration, active } }
const talkgroups = new Map();

/**
 * Start the OP25 process using the configured command, arguments, and working directory.
 * Automatically restarts after 5 seconds if it exits.
 */
function startOP25() {
  const args = config.op25Args;
  console.log("Launching OP25 process:");
  console.log(`  Command: ${config.op25Command}`);
  console.log(`  Args: ${args.join(" ")}`);
  console.log(`  Working Directory: ${config.op25Cwd}`);

  const op25Process = spawn(config.op25Command, args, { cwd: config.op25Cwd });

  // Process stdout data
  op25Process.stdout.on("data", (data) => {
    processOP25Data(data.toString());
  });

  // Process stderr data as well
  op25Process.stderr.on("data", (data) => {
    processOP25Data(data.toString());
  });

  op25Process.on("close", (code) => {
    console.log(
      `OP25 process exited with code ${code}. Restarting in 5 seconds...`
    );
    setTimeout(startOP25, 5000);
  });

  op25Process.on("error", (err) => {
    console.error("Error starting OP25 process:", err);
    setTimeout(startOP25, 5000);
  });
}

/**
 * Process a block of OP25 output data (from stdout or stderr).
 */
function processOP25Data(data) {
  const lines = data.split("\n");
  lines.forEach((line) => {
    if (line.trim() === "") return;

    // Check for voice timeout signal to mark transmission end.
    if (line.toLowerCase().includes("voice timeout")) {
      console.log(
        "Detected voice timeout; marking all active talkgroups as ended."
      );
      for (const [tg, entry] of talkgroups.entries()) {
        if (entry.active) {
          entry.active = false;
          sse.send({
            talkgroup: tg,
            active: false,
            timestamp: Date.now(),
            event: "voice_timeout",
          });
        }
      }
      return;
    }

    // Check for UI Timeout as an alternative indicator.
    if (line.toLowerCase().includes("ui timeout")) {
      console.log(
        "Detected UI Timeout; marking all active talkgroups as ended."
      );
      for (const [tg, entry] of talkgroups.entries()) {
        if (entry.active) {
          entry.active = false;
          sse.send({
            talkgroup: tg,
            active: false,
            timestamp: Date.now(),
            event: "ui_timeout",
          });
        }
      }
      return;
    }

    // Try to parse the line using the regex configuration.
    const metadata = parseOP25Line(line);
    if (metadata) {
      updateTalkDuration(metadata);
      sse.send(metadata);
    } else {
      // No regex matched; simply log the line.
      console.log("No regex matched for line:", line);
    }
  });
}

/**
 * Parse an OP25 log line using the regex configuration.
 * Returns an object with extracted fields and a short "name" identifier.
 * If no rule matches, returns null.
 */
function parseOP25Line(line) {
  for (const rule of regexConfig) {
    const regex = new RegExp(rule.pattern, "i");
    const match = line.match(regex);
    if (match) {
      const extracted = {
        message: line,
        timestamp: Date.now(),
        name: rule.name,
      };
      for (const field in rule.fields) {
        const groupIndex = rule.fields[field];
        extracted[field] = match[groupIndex];
      }
      console.log(`Rule "${rule.name}" matched. Extracted:`, extracted);
      return extracted;
    }
  }
  // Return null if no rule matched
  return null;
}

/**
 * Update or create an entry for a talkgroup and update its duration.
 */
function updateTalkDuration(metadata) {
  const tg = metadata.talkgroup;
  if (!tg) return;
  let entry = talkgroups.get(tg);
  if (!entry || entry.active === false) {
    entry = {
      startTime: metadata.timestamp,
      lastSeen: metadata.timestamp,
      duration: 0,
      active: true,
      name: metadata.name || null,
    };
    talkgroups.set(tg, entry);
  } else {
    entry.lastSeen = metadata.timestamp;
    entry.duration = Math.floor((entry.lastSeen - entry.startTime) / 1000);
  }
  metadata.duration = entry.duration;
  metadata.active = entry.active;
}

// --- Set up Express server with CORS and SSE endpoint ---
const app = express();

// Enable CORS for all routes (adjust "*" if needed)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

app.get("/metadata", (req, res) => {
  if (config.token && req.query.token !== config.token) {
    return res.status(401).send("Unauthorized");
  }
  sse.init(req, res);
});

app.get("/active", (req, res) => {
  res.json(Array.from(talkgroups.entries()));
});

app.listen(config.port, () => {
  console.log(`OP25 Metadata Hub is running on port ${config.port}`);
  startOP25();
});
