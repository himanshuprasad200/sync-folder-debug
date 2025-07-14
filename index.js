const express = require("express");
const bodyParser = require("body-parser");
const { syncFolder } = require("./testSyncFolder");
const app = express();

app.use(bodyParser.json());
app.post("/api/sync", (req, res) => syncFolder(req, res));
app.listen(3000, () => console.log("🚀 Listening on http://localhost:3000"));
