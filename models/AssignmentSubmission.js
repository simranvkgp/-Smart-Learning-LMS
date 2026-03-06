const mongoose = require("mongoose");

const assignmentSubmissionSchema = new mongoose.Schema({
  assignmentId: { type: String, required: true },
  courseId: { type: String, required: true },
  courseTitle: { type: String, required: true },
  assignmentTitle: { type: String, required: true },
  studentEmail: { type: String, required: true },
  content: { type: String, default: "" },
  attachmentPath: { type: String, default: "" },
  submittedAt: { type: Date, default: Date.now },
  marks: { type: Number, default: null },
  feedback: { type: String, default: "" },
  gradedAt: { type: Date, default: null },
  gradedBy: { type: String, default: "" }
});

module.exports = mongoose.model("AssignmentSubmission", assignmentSubmissionSchema);
