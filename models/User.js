const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: {
    type: String,
    enum: ["student", "teacher", "admin"],
    default: "student"
  },
  lastLogin: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: false
  },
  loginCount: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model("User", userSchema);