const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  image: String,
  pdf: String,
  scormPath: String,  // folder name under uploads/scorm/ (extracted SCORM package)
  teacherEmail: String,  // email of teacher who created this course
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Course", courseSchema);