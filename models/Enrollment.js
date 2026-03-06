const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema({
  email: String,
  courseId: String,
  courseTitle: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Enrollment", enrollmentSchema);