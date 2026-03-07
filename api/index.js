// Vercel serverless entry: forward every request to the Express app
const app = require("../server.js");
module.exports = (req, res) => app(req, res);
