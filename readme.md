# OP25 Metadata Server

The **OP25 Metadata Server** is a lightweight Node.js service designed to run the OP25 decoder process, parse its output for useful metadata (such as talkgroup IDs and live talk durations), and broadcast that metadata in real time via Server-Sent Events (SSE). This project replicates your default service configuration and provides a simple HTTP endpoint for consuming metadata.

## Features

- **OP25 Process Integration:**\
  Spawns the OP25 process using a specified working directory and command-line arguments (replicating your systemd service).

- **Real-Time Parsing:**\
  Processes line-based OP25 output to extract metadata (e.g., talkgroup IDs) and calculates live talk durations.

- **Server-Sent Events (SSE):**\
  Streams metadata updates in real time to connected clients.

- **Auto-Restart:**\
  Automatically restarts the OP25 process if it exits unexpectedly (after a 5-second delay).

- **Simple Configuration:**\
  Uses a `.env` file for configuration (port, working directory, command, arguments, etc.). Authentication is optional (default is no token required).

## Requirements

- Node.js (v12 or higher recommended)

- Python (or your OP25 runtime environment) configured for Boatbod's OP25 decoder

- OP25 decoder installed and configured in the expected working directory

- A Linux environment (or VM) with the necessary SDR hardware for production

## Setup

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/xtraorange/op25-metadata-server

    cd op25-metadata-server
    ```

2.  **Install Dependencies:**

    ```bash
    npm install
    ```

3.  **Create a `.env` file** in the project root with content similar to:

    ```ini
    PORT=3000

    # TOKEN is optional; leave blank to disable authentication

    # TOKEN=

    # Working directory for OP25

    OP25_CWD=/home/ansible/op25/op25/gr-op25_repeater/apps

    # Command to run OP25 (full path to rx.py)

    OP25_COMMAND=/home/ansible/op25/op25/gr-op25_repeater/apps/rx.py

    # Command-line arguments for rx.py replicating your systemd defaults:

    OP25_ARGS=--args rtl -N "LNA:40" -U -O op25loop -T trunk.tsv -S 1024000 -l http:0.0.0.0:8000 -c 5.0
    ```

## Running the Server

Start the OP25 Metadata Server with:

```bash
node op25-metadata-hub.js
```

The service will:

- Launch the OP25 process in the configured working directory using the provided command and arguments.

- Monitor its stdout to extract metadata.

- Publish metadata updates via SSE on the `/metadata` endpoint.

- Automatically restart the OP25 process if it exits (after 5 seconds).

## Endpoints

- **`/metadata` (SSE):**\
  Clients can subscribe to this endpoint to receive real-time metadata updates. If a `TOKEN` is configured in the `.env` file, clients must supply it as a query parameter (e.g., `?token=your-token`). If no token is set, the endpoint is open.

- **`/active` (Optional):**\
  Returns the current active talkgroup tracking data in JSON format.

## Example Code

### client.js

A simple Node.js client to subscribe to the SSE stream:

```js
const EventSource = require("eventsource");

const token = ""; // Set token if required.
const url = token
  ? `http://localhost:3000/metadata?token=${token}`
  : "http://localhost:3000/metadata";

console.log(`Connecting to SSE stream at ${url}...`);
const es = new EventSource(url);

es.onmessage = (event) => {
  try {
    const metadata = JSON.parse(event.data);
    console.log("Received metadata update:", metadata);
  } catch (err) {
    console.error("Error parsing metadata:", err, event.data);
  }
};

es.onerror = (err) => {
  console.error("EventSource error:", err);
};
```

Run the client with:

```bash
node client.js
```

## Testing the Metadata Stream

A simple webpage (e.g., `index.html`) is provided to test the SSE output. Open it in your browser:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>OP25 Metadata Server Output</title>
    <style>
      body {
        font-family: monospace;
        margin: 20px;
        background: #f7f7f7;
      }
      pre {
        background: #fff;
        border: 1px solid #ddd;
        padding: 10px;
        max-height: 80vh;
        overflow-y: auto;
      }
    </style>
  </head>
  <body>
    <h1>OP25 Metadata Server Output</h1>
    <pre id="output">Waiting for updates...</pre>
    <script>
      const url = "http://localhost:3000/metadata";
      const output = document.getElementById("output");
      const eventSource = new EventSource(url);
      eventSource.onmessage = function (event) {
        output.textContent += event.data + "\n";
      };
      eventSource.onerror = function (err) {
        output.textContent +=
          "EventSource error: " + JSON.stringify(err) + "\n";
      };
    </script>
  </body>
</html>
```

## Language Choice Discussion

**Node.js:**

- Excellent for building real-time, event-driven web services with non-blocking I/O.

- Provides a unified JavaScript stack for both server and client development.

- Rich ecosystem (Express, SSE libraries) simplifies development.

**Python:**

- May integrate more naturally with your existing OP25 API project if it is Python-based.

- Frameworks like Flask or FastAPI support SSE and robust process management.

- Keeping everything in Python might simplify maintenance if your team is more familiar with it.

**Recommendation:**\
Choose Node.js if you value the real-time web functionality and non-blocking model it provides. Choose Python if you prefer a unified language across your OP25 projects and require tighter integration with existing Python code.

## License

This project is released under the MIT License.

## Acknowledgments

- Inspired by Boatbod's and Osmocom's OP25 for digital voice decoding.

- Built using Node.js, Express, and express-sse.

- Thanks to the SDR community for ongoing support and development.

```

```
