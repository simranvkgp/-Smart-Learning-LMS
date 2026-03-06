const mongoose = require("mongoose");

const quizAttemptSchema = new mongoose.Schema({
  email: { type: String, required: true },
  courseId: { type: String, required: true },
  courseTitle: { type: String, required: true },
  score: { type: Number, required: true },
  totalQuestions: { type: Number, required: true },
  passed: { type: Boolean, required: true },
  attemptedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("QuizAttempt", quizAttemptSchema);
