// Vercel serverless entry: rewrite sends every request to /api?path=/original-path
// so this single handler runs; we set req.url from path for Express.
const url = require("url");
const app = require("../server.js");
module.exports = (req, res) => {
  const parsed = url.parse(req.url || "/", true);
  const path = (parsed.query && parsed.query.path) || "/";
  const pathOnly = path.indexOf("?") >= 0 ? path.split("?")[0] : path;
  const rest = (parsed.search || "").replace(/^\?path=[^&]*&?/, "") || "";
  req.url = (pathOnly.startsWith("/") ? pathOnly : "/" + pathOnly) + (rest ? (rest.startsWith("?") ? rest : "?" + rest) : "");
  app(req, res);
};
