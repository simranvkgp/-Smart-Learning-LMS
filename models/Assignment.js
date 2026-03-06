const mongoose = require("mongoose");

const assignmentSchema = new mongoose.Schema({
  courseId: { type: String, required: true },
  courseTitle: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  dueDate: { type: Date, required: true },
  teacherEmail: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Assignment", assignmentSchema);
