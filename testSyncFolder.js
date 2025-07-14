const fs = require("fs/promises");
const path = require("path");
const chokidar = require("chokidar");
const WebSocket = require("ws");
const mammoth = require("mammoth");
const JSZip = require("jszip");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf");

const results = { resumes: [] };
const watchers = new Map();
const processingQueue = [];

const wss = {
  clients: new Set([{ readyState: 1, send: console.log }]), // Simulated WebSocket client
};

// Dummy processor
function processQueue() {
  console.log("🚀 (Simulated) Processing Queue...");
}

// Dummy Express-like request and response
const req = {
  body: {
    folderPath: "./resumes", // ✅ Change to your actual test folder
  },
};

const res = {
  status: (code) => ({
    json: (data) => console.log(`📤 Response ${code}:`, data),
  }),
};

// ✅ Cleaned syncFolder function (without requiring req.user)
async function syncFolder(req, res) {
  try {
    const { folderPath } = req.body;
    if (!folderPath) {
      throw new Error("Missing folderPath in request body");
    }

    const files = await fs.readdir(folderPath);
    if (files.length === 0) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ message: "Folder is empty" }));
        }
      });
      return res.status(200).json({ message: "Folder is empty" });
    }

    const normalizedPath = path.normalize(folderPath);
    if (watchers.has(normalizedPath)) {
      await watchers.get(normalizedPath).close();
      watchers.delete(normalizedPath);
    }

    const watcher = chokidar.watch(folderPath, {
      persistent: true,
      ignoreInitial: false,
      depth: 99,
      usePolling: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
      ignored: [
        /(^|[\/\\])\../,
        `${folderPath}/invalid-format/**`,
        `${folderPath}/duplicates/**`,
        `${folderPath}/failed-processing/**`,
      ],
      ignorePermissionErrors: true,
    });

    watchers.set(normalizedPath, watcher);

    watcher
      .on("add", async (filePath) => {
        const relativePath = path.relative(folderPath, filePath);
        if (
          relativePath.startsWith("invalid-format") ||
          relativePath.startsWith("duplicates") ||
          relativePath.startsWith("failed-processing")
        ) {
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        if (![".pdf", ".docx", ".doc"].includes(ext)) return;

        try {
          const stats = await fs.stat(filePath);
          const fileSizeInMB = stats.size / (1024 * 1024);
          if (fileSizeInMB > 5) throw new Error("Too large");

          if (ext === ".docx") {
            const buffer = await fs.readFile(filePath);
            const zip = new JSZip();
            await zip.loadAsync(buffer);
            const required = [
              "word/document.xml",
              "word/_rels/document.xml.rels",
            ];
            const missing = required.filter((f) => !zip.file(f));
            if (missing.length) throw new Error("Invalid DOCX");
          }

          if (ext === ".doc") {
            const buffer = await fs.readFile(filePath);
            const result = await mammoth.extractRawText({ buffer });
            if (!result.value?.trim()) throw new Error("Empty DOC");
          }

          if (ext === ".pdf") {
            const buffer = await fs.readFile(filePath);
            const typedArray = new Uint8Array(buffer);
            await pdfjsLib.getDocument({ data: typedArray }).promise;
          }

          console.log(`📦 File queued: ${path.basename(filePath)}`);
          processingQueue.push(filePath);
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  message: `File queued: ${path.basename(filePath)}`,
                  queueLength: processingQueue.length,
                })
              );
            }
          });

          processQueue();
        } catch (err) {
          const invalidFolder = path.join(folderPath, "invalid-format");
          await fs.mkdir(invalidFolder, { recursive: true });
          await fs.rename(filePath, path.join(invalidFolder, path.basename(filePath)));
          results.resumes.push({
            filename: path.basename(filePath),
            status: "invalid-format",
            reason: err.message,
            timestamp: new Date().toISOString(),
          });
        }
      })
      .on("error", (err) => {
        console.error("❌ Watcher error:", err.message);
      });

    console.log(`👁️ Watching folder: ${folderPath}`);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({ message: `Started watching folder: ${folderPath}` })
        );
      }
    });

    res.status(200).json({ message: `Started watching folder: ${folderPath}` });
  } catch (error) {
    console.error("❌ syncFolder crashed:", error.message);
    res.status(500).json({ message: `Error: ${error.message}` });
  }
}

// ✅ Run directly for testing
if (require.main === module) {
  syncFolder(req, res);
}

module.exports = { syncFolder };
