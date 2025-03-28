// op25-metadata-hub.js
require("dotenv").config();
const { spawn } = require("child_process");
const express = require("express");
const SSE = require("express-sse");

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

const sse = new SSE();

// Map to track active talkgroups: { talkgroup: { startTime, lastSeen, duration } }
const talkgroups = new Map();

/**
 * Start the OP25 process using the default command/args/working directory.
 * The process is automatically restarted after 5 seconds if it exits.
 */
function startOP25() {
  const args = config.op25Args;
  console.log("Launching OP25 process:");
  console.log(`  Command: ${config.op25Command}`);
  console.log(`  Args: ${args.join(" ")}`);
  console.log(`  Working Directory: ${config.op25Cwd}`);

  const op25Process = spawn(config.op25Command, args, { cwd: config.op25Cwd });

  op25Process.stdout.on("data", (data) => {
    const lines = data.toString().split("\n");
    lines.forEach((line) => {
      if (line.trim() === "") return;
      const metadata = parseOP25Line(line);
      if (metadata) {
        updateTalkDuration(metadata);
        // Publish the metadata update via SSE
        sse.send(metadata);
      }
    });
  });

  op25Process.stderr.on("data", (data) => {
    console.error("OP25 stderr:", data.toString());
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
 * Example parser: If a line contains "TGID:" then extract the talkgroup ID.
 */
function parseOP25Line(line) {
  // For demonstration, if line contains "TGID:" we extract numeric ID
  if (!line.includes("TGID:")) {
    return { message: line, timestamp: Date.now() };
  }
  const tgMatch = line.match(/TGID[:=]\s*(\d+)/i);
  const talkgroup = tgMatch ? tgMatch[1] : null;
  return {
    talkgroup,
    message: line,
    timestamp: Date.now(),
  };
}

/**
 * Update the duration for the given talkgroup in metadata.
 */
function updateTalkDuration(metadata) {
  const tg = metadata.talkgroup;
  if (!tg) return; // nothing to track
  let entry = talkgroups.get(tg);
  if (!entry) {
    entry = {
      startTime: metadata.timestamp,
      lastSeen: metadata.timestamp,
      duration: 0,
    };
    talkgroups.set(tg, entry);
  } else {
    entry.lastSeen = metadata.timestamp;
    entry.duration = Math.floor((entry.lastSeen - entry.startTime) / 1000);
  }
  metadata.duration = entry.duration;
}

// --- Set up Express server with SSE endpoint ---
const app = express();

app.get("/metadata", (req, res) => {
  // If a token is set, enforce authentication.
  if (config.token && req.query.token !== config.token) {
    return res.status(401).send("Unauthorized");
  }
  sse.init(req, res);
});

// Optional endpoint to return current active talkgroup info.
app.get("/active", (req, res) => {
  res.json(Array.from(talkgroups.entries()));
});

app.listen(config.port, () => {
  console.log(`OP25 Metadata Hub is running on port ${config.port}`);
  startOP25();
});
