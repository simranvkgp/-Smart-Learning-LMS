// Vercel serverless entry: forward every request to the Express app.
// Rewrite sends /login -> /api/login; strip /api so Express sees /login.
const app = require("../server.js");
module.exports = (req, res) => {
  const [path, query] = (req.url || "").split("?");
  const newPath = path.startsWith("/api") ? (path.slice(4) || "/") : path;
  req.url = query ? newPath + "?" + query : newPath;
  app(req, res);
};
