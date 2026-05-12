const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api", (req, res) => {
  res.json({ message: "API working" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});