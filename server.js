const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcrypt");
const fs = require("fs");
const multer = require("multer");
const AdmZip = require("adm-zip");
const PDFDocument = require("pdfkit");
const jwt = require("jsonwebtoken");

// ===== CONFIG =====
dotenv.config();
const app = express();

// ===== MODELS =====
const User = require("./models/User");
const Course = require("./models/Course");
const Enrollment = require("./models/Enrollment");
const Question = require("./models/Question");
const QuizAttempt = require("./models/QuizAttempt");
const Assignment = require("./models/Assignment");
const AssignmentSubmission = require("./models/AssignmentSubmission");

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // serves dashboard.html, student-dashboard.html etc

// ===== MONGODB CONNECTION =====
const mongoUri = process.env.MONGO_URI;
if (mongoUri) {
  mongoose.connect(mongoUri)
    .then(() => console.log("MongoDB Connected ✅"))
    .catch((err) => console.log("MongoDB Error:", err));
} else {
  console.warn("MONGO_URI not set – set it in Vercel Environment Variables for the app to work.");
}

// ===== UPLOAD FOLDER SETUP =====
// On Vercel, filesystem is read-only except /tmp; use /tmp for uploads there
const isVercel = Boolean(process.env.VERCEL);
const uploadBase = isVercel ? path.join("/tmp", "uploads") : path.join(__dirname, "public", "uploads");
const uploadDir = uploadBase;

function safeMkdir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn("Could not create upload dir (e.g. read-only fs):", dir, e.message);
  }
}
safeMkdir(uploadDir);
const scormDir = path.join(uploadBase, "scorm");
safeMkdir(scormDir);
const assignmentsUploadDir = path.join(uploadBase, "assignments");
safeMkdir(assignmentsUploadDir);

// ===== MULTER (FILE UPLOAD) =====
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

// No explicit file size limit here so large SCORM zips are accepted.
// If you want to limit size later, add a `limits: { fileSize: ... }` option.
const upload = multer({ storage });
const uploadAssignment = multer({
  storage: multer.diskStorage({
    destination: function (_req, _file, cb) { cb(null, assignmentsUploadDir); },
    filename: function (_req, file, cb) { cb(null, Date.now() + "-" + (file.originalname || "file.pdf")); }
  })
});

// ===== HOME ROUTE =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// =========================
// 1️⃣ REGISTER API
// =========================
app.post("/register", async (req, res) => {
  try {
    // Ensure DB is connected (important on Vercel serverless)
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "Database not connected. Please try again in a moment." });
    }

    const { email, password, role } = req.body || {};

    if (!email || !password) {
      return res.json({ message: "All fields required ❌" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.json({ message: "Email already registered ❌" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      email,
      password: hashedPassword,
      role: role || "student" // default student
    });

    await newUser.save();
    res.json({ message: "Registration Successful 🎉" });

  } catch (error) {
    console.error("Register error:", error);
    const msg = error.name === "MongoError" || error.name === "MongoServerError"
      ? "Database error. Check MONGO_URI and network."
      : "Registration failed. Please try again.";
    res.status(500).json({ message: msg });
  }
});


// =========================
// 2️⃣ LOGIN API (JWT BASED)
// =========================
app.post("/login", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "Database not connected. Please try again in a moment." });
    }

    const { email, password } = req.body || {};

    const user = await User.findOne({ email });
    if (!user) return res.json({ message: "User not found ❌" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.json({ message: "Invalid Password ❌" });

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server misconfigured (JWT). Contact support." });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ token, role: user.role });

  } catch (error) {
    console.error("Login error:", error);
    const msg = error.name === "MongoError" || error.name === "MongoServerError"
      ? "Database error. Check MONGO_URI and network."
      : "Login failed. Please try again.";
    res.status(500).json({ message: msg });
  }
});


// =========================
// 3️⃣ ADD COURSE (Teacher)
// =========================
// Wrap Multer so any upload error returns JSON (no HTML error page)
function addCourseWithUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error("Add-course upload error:", err);
      let msg = "Course Upload Failed ❌";
      if (err.code === "LIMIT_FILE_SIZE") msg = "File too large. Try a smaller zip (max 200 MB). ❌";
      else if (err.code === "LIMIT_UNEXPECTED_FILE") msg = "Unexpected file. Use PDF, Image, or SCORM field. ❌";
      else if (err.message) msg = err.message;
      return res.status(500).json({ message: msg });
    }
    next();
  });
}
app.post("/add-course",
  addCourseWithUpload,
  async (req, res) => {
    try {
      const { title, description, teacherEmail } = req.body;
      let fileList = [];
      try {
        const rawFiles = req.files || [];
        fileList = Array.isArray(rawFiles) ? rawFiles : (Object.values(rawFiles).flat && Object.values(rawFiles).flat()) || [];
      } catch (e) {
        console.error("Parse files error:", e);
      }

      const byField = {};
      fileList.forEach((f) => {
        const name = (f.fieldname || "").toLowerCase();
        if (!byField[name]) byField[name] = [];
        byField[name].push(f);
      });
      const first = (name) => (byField[name] && byField[name][0]) || null;

      // SCORM: prefer field "scorm", else any file ending in .zip
      let scormZip = first("scorm");
      if (!scormZip) {
        const zipFile = fileList.find((f) => String(f.originalname || f.filename || "").toLowerCase().endsWith(".zip"));
        if (zipFile) scormZip = zipFile;
      }
      const pdfFile = (first("pdf") && first("pdf") !== scormZip) ? first("pdf").filename : null;
      const imageFile = first("image") ? first("image").filename : null;

      const newCourse = new Course({
        title,
        description,
        pdf: pdfFile,
        image: imageFile,
        teacherEmail: teacherEmail || null
      });

      await newCourse.save();

      if (!scormZip) console.log("[SCORM] No zip in request. Fields:", Object.keys(byField), "files:", (fileList || []).map((f) => (f && { field: f.fieldname, name: f.originalname || f.filename })));
      const isZip = scormZip && String(scormZip.originalname || scormZip.filename || "").toLowerCase().endsWith(".zip");
      if (isZip) {
        const zipPath = scormZip.path || path.join(uploadDir, scormZip.filename);
        console.log("[SCORM] Extracting:", zipPath, "->", path.join(scormDir, newCourse._id.toString()));
        if (!fs.existsSync(zipPath)) {
          console.error("SCORM zip not found on disk:", zipPath);
          return res.json({ message: "Course saved but SCORM file was not received. Try again with a smaller zip or use the SCORM field. ❌" });
        }
        const extractTo = path.join(scormDir, newCourse._id.toString());
        try {
          const admZip = new AdmZip(zipPath);
          admZip.extractAllTo(extractTo, true);
          newCourse.scormPath = newCourse._id.toString();
          await newCourse.save();
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        } catch (extractErr) {
          console.error("SCORM extract error:", extractErr);
          if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
          return res.json({ message: "Course saved but SCORM extract failed. Use a valid .zip (e.g. from Windows “Compress to zip”). ❌" });
        }
      }

      res.json({
        message: isZip
          ? "Course Added Successfully 🎉 (with SCORM)"
          : "Course Added Successfully 🎉 (no SCORM zip was received – use the 📦 SCORM field and choose a .zip file)"
      });

    } catch (error) {
      console.log(error);
      res.json({ message: "Course Upload Failed ❌" });
    }
  }
);


// =========================
// 4️⃣ GET ALL COURSES (Teacher + Student)
// =========================
app.get("/courses", async (req, res) => {
  try {
    const courses = await Course.find();
    res.json(courses);
  } catch (error) {
    res.json({ message: "Error fetching courses ❌" });
  }
});


// =========================
// 5️⃣ DELETE COURSE (Teacher)
// =========================
app.delete("/delete-course/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (course?.scormPath) {
      const scormFolder = path.join(scormDir, course.scormPath);
      if (fs.existsSync(scormFolder)) {
        fs.rmSync(scormFolder, { recursive: true });
      }
    }
    await Course.findByIdAndDelete(req.params.id);
    res.json({ message: "Course Deleted Successfully 🗑️" });
  } catch (error) {
    res.json({ message: "Delete Failed ❌" });
  }
});


// =========================
// 6️⃣ UPDATE COURSE (Teacher)
// =========================
app.put("/update-course/:id", async (req, res) => {
  try {
    const { title, description } = req.body;

    await Course.findByIdAndUpdate(req.params.id, {
      title,
      description
    });

    res.json({ message: "Course Updated Successfully ✏️" });
  } catch (error) {
    res.json({ message: "Update Failed ❌" });
  }
});


// =========================
// 7️⃣ ENROLL COURSE (Student)
// =========================
app.post("/enroll", async (req, res) => {
  try {
    const { email, courseId, courseTitle } = req.body;

    if (!email || !courseId) {
      return res.json({ message: "Missing data ❌" });
    }

    const already = await Enrollment.findOne({ email, courseId });
    if (already) {
      return res.json({ message: "Already Enrolled ⚠️" });
    }

    const enrollment = new Enrollment({
      email,
      courseId,
      courseTitle
    });

    await enrollment.save();
    res.json({ message: "Enrollment Successful 🎓" });

  } catch (error) {
    console.log(error);
    res.json({ message: "Enrollment Failed ❌" });
  }
});


// =========================
// 8️⃣ STUDENT MY COURSES (FILTERED)
// =========================
app.get("/my-courses/:email", async (req, res) => {
  const myCourses = await Enrollment.find({ email: req.params.email });
  res.json(myCourses);
});


// =========================
// SERVE UPLOADS (PDF, IMAGE, SCORM – all teacher uploads in one folder)
// Students access everything via /uploads/...
// =========================
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// SCORM launcher: open package from /uploads/scorm/<id>/ so all content is under /uploads
app.get("/scorm-launch/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const folder = path.join(scormDir, id);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return res.status(404).send("SCORM package not found.");
  }
  const indexPath = path.join(folder, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.redirect("/uploads/scorm/" + id + "/index.html");
  }
  // No index.html: show file list; all links point under /uploads/scorm/
  const baseUrl = "/uploads/scorm/" + id + "/";
  function listDir(dir, prefix) {
    let html = "";
    const names = fs.readdirSync(dir);
    for (const name of names) {
      const full = path.join(dir, name);
      const rel = (prefix ? prefix + "/" : "") + name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        html += "<li><strong>" + rel + "/</strong><ul>" + listDir(full, rel) + "</ul></li>";
      } else {
        const url = baseUrl + rel.split("/").map(encodeURIComponent).join("/");
        html += '<li><a href="' + url + '" target="_blank">' + name + "</a></li>";
      }
    }
    return html;
  }
  const list = listDir(folder, "");
  res.send("<!DOCTYPE html><html><head><meta charset='utf-8'><title>Course Content</title></head><body><h2>Course content</h2><p>Open a file below (add <strong>index.html</strong> at the root of your zip for a single entry point).</p><ul>" + list + "</ul></body></html>");
});

// =========================
// GET ALL ENROLLMENTS (Teacher View – all enrollments, for admin)
// =========================
app.get("/teacher/enrollments", async (req, res) => {
  try {
    const enrollments = await Enrollment.find();
    res.json(enrollments);
  } catch (error) {
    res.json({ message: "Error loading enrollments ❌" });
  }
});

// =========================
// GET MY ENROLLMENTS (Teacher View – only students in this teacher's courses)
// =========================
app.get("/teacher/my-enrollments", async (req, res) => {
  try {
    const teacherEmail = req.query.email;
    if (!teacherEmail) {
      return res.json([]);
    }
    const myCourses = await Course.find({ teacherEmail }).select("_id");
    const courseIds = myCourses.map((c) => c._id.toString());
    const enrollments = await Enrollment.find({ courseId: { $in: courseIds } });
    res.json(enrollments);
  } catch (error) {
    res.json({ message: "Error loading enrollments ❌" });
  }
});

// =========================
// ADMIN ROUTES
// =========================

// Get All Users (Admin)
app.get("/admin/users", async (req, res) => {
  try {
    const users = await User.find().select("-password"); // Exclude password
    res.json(users);
  } catch (error) {
    res.json({ message: "Error loading users ❌" });
  }
});

// Get All Enrollments (Admin)
app.get("/admin/enrollments", async (req, res) => {
  try {
    const enrollments = await Enrollment.find();
    res.json(enrollments);
  } catch (error) {
    res.json({ message: "Error loading enrollments ❌" });
  }
});

// Delete User (Admin)
app.delete("/admin/user/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Also delete all enrollments for this user
    const user = await User.findById(userId);
    if (user) {
      await Enrollment.deleteMany({ email: user.email });
    }
    
    await User.findByIdAndDelete(userId);
    res.json({ message: "User deleted successfully 🗑️" });
  } catch (error) {
    console.log(error);
    res.json({ message: "Delete failed ❌" });
  }
});

// Update User (Admin)
app.put("/admin/user/:id", async (req, res) => {
  try {
    const { email, role, name } = req.body;
    
    const updateData = {};
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (name) updateData.name = name;
    
    await User.findByIdAndUpdate(req.params.id, updateData);
    res.json({ message: "User updated successfully ✏️" });
  } catch (error) {
    console.log(error);
    res.json({ message: "Update failed ❌" });
  }
});

// Delete Enrollment (Admin)
app.delete("/admin/enrollment/:id", async (req, res) => {
  try {
    await Enrollment.findByIdAndDelete(req.params.id);
    res.json({ message: "Enrollment deleted successfully 🗑️" });
  } catch (error) {
    console.log(error);
    res.json({ message: "Delete failed ❌" });
  }
});

// Update Enrollment (Admin)
app.put("/admin/enrollment/:id", async (req, res) => {
  try {
    const { email, courseId, courseTitle } = req.body;
    
    const updateData = {};
    if (email) updateData.email = email;
    if (courseId) updateData.courseId = courseId;
    if (courseTitle) updateData.courseTitle = courseTitle;
    
    await Enrollment.findByIdAndUpdate(req.params.id, updateData);
    res.json({ message: "Enrollment updated successfully ✏️" });
  } catch (error) {
    console.log(error);
    res.json({ message: "Update failed ❌" });
  }
});

// Delete Course (Admin - Enhanced)
app.delete("/admin/course/:id", async (req, res) => {
  try {
    const courseId = req.params.id;
    
    // Also delete all enrollments for this course
    await Enrollment.deleteMany({ courseId: courseId });
    
    // Delete course files if they exist
    const course = await Course.findById(courseId);
    if (course) {
      if (course.pdf) {
        const pdfPath = path.join(uploadDir, course.pdf);
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
      }
      if (course.image) {
        const imgPath = path.join(uploadDir, course.image);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
      }
      if (course.scormPath) {
        const scormFolder = path.join(scormDir, course.scormPath);
        if (fs.existsSync(scormFolder)) fs.rmSync(scormFolder, { recursive: true });
      }
    }
    
    await Course.findByIdAndDelete(courseId);
    res.json({ message: "Course and related enrollments deleted successfully 🗑️" });
  } catch (error) {
    console.log(error);
    res.json({ message: "Delete failed ❌" });
  }
});

// Update Course (Admin - Enhanced)
// Reuse the same upload wrapper so any file field is accepted (no "Unexpected field" errors).
app.put("/admin/course/:id",
  addCourseWithUpload,
  async (req, res) => {
    try {
      const { title, description } = req.body;
      const courseId = req.params.id;
      
      const updateData = {};
      if (title) updateData.title = title;
      if (description) updateData.description = description;
      
      // Handle file uploads (Multer any(): req.files is an array)
      const rawFiles = req.files || [];
      const fileList = Array.isArray(rawFiles) ? rawFiles : (Object.values(rawFiles).flat && Object.values(rawFiles).flat()) || [];
      const byField = {};
      fileList.forEach((f) => {
        if (!f) return;
        const name = (f.fieldname || "").toLowerCase();
        if (!byField[name]) byField[name] = [];
        byField[name].push(f);
      });
      const first = (name) => (byField[name] && byField[name][0]) || null;

      const pdfFile = first("pdf");
      const imageFile = first("image");

      if (pdfFile) {
        // Delete old PDF if exists
        const course = await Course.findById(courseId);
        if (course?.pdf) {
          const oldPdfPath = path.join(uploadDir, course.pdf);
          if (fs.existsSync(oldPdfPath)) fs.unlinkSync(oldPdfPath);
        }
        updateData.pdf = pdfFile.filename;
      }
      
      if (imageFile) {
        // Delete old image if exists
        const course = await Course.findById(courseId);
        if (course?.image) {
          const oldImgPath = path.join(uploadDir, course.image);
          if (fs.existsSync(oldImgPath)) fs.unlinkSync(oldImgPath);
        }
        updateData.image = imageFile.filename;
      }
      
      await Course.findByIdAndUpdate(courseId, updateData);
      res.json({ message: "Course updated successfully ✏️" });
    } catch (error) {
      console.log(error);
      res.json({ message: "Update failed ❌" });
    }
  }
);




// =========================
// QUIZ / ASSESSMENT (certificate eligibility: 50% required)
// =========================
const PASS_PERCENT = 50;

app.get("/api/certificate-eligible", async (req, res) => {
  try {
    const { email, courseId } = req.query;
    if (!email || !courseId) return res.json({ eligible: false, reason: "missing_params" });
    const questions = await Question.find({ courseId }).sort({ order: 1 });
    if (!questions.length) return res.json({ eligible: true, reason: "no_quiz" });
    const attempt = await QuizAttempt.findOne({ email, courseId, passed: true });
    if (attempt) return res.json({ eligible: true, reason: "already_passed" });
    res.json({ eligible: false, reason: "take_quiz", questionCount: questions.length });
  } catch (e) {
    res.json({ eligible: false, reason: "error" });
  }
});

app.get("/api/course/:courseId/questions", async (req, res) => {
  try {
    const questions = await Question.find({ courseId: req.params.courseId }).sort({ order: 1 });
    res.json(questions.map((q) => ({
      _id: q._id,
      questionText: q.questionText,
      options: q.options,
      order: q.order
    })));
  } catch (e) {
    res.json([]);
  }
});

app.post("/api/course/:courseId/submit-quiz", async (req, res) => {
  try {
    const { email, courseTitle, answers } = req.body;
    const courseId = req.params.courseId;
    if (!email || !courseId) return res.status(400).json({ message: "Missing email or courseId" });
    const questions = await Question.find({ courseId }).sort({ order: 1 });
    if (!questions.length) return res.json({ passed: true, score: 100, percentage: 100, message: "No quiz for this course." });
    let correct = 0;
    const answerMap = (answers || []).reduce((acc, a) => {
      acc[a.questionId] = a.selectedIndex;
      return acc;
    }, {});
    questions.forEach((q) => {
      if (Number(answerMap[q._id]) === Number(q.correctIndex)) correct++;
    });
    const percentage = Math.round((correct / questions.length) * 100);
    const passed = percentage >= PASS_PERCENT;
    await QuizAttempt.create({
      email,
      courseId,
      courseTitle: courseTitle || "Course",
      score: correct,
      totalQuestions: questions.length,
      passed
    });
    res.json({
      passed,
      score: correct,
      total: questions.length,
      percentage,
      message: passed ? "Congratulations! You are eligible for the certificate." : "You are not capable. Please prepare and try again."
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Quiz submit failed" });
  }
});

app.get("/teacher/course/:courseId/questions", async (req, res) => {
  try {
    const questions = await Question.find({ courseId: req.params.courseId }).sort({ order: 1 });
    res.json(questions);
  } catch (e) {
    res.json([]);
  }
});

app.post("/teacher/course/:courseId/questions", async (req, res) => {
  try {
    const { questionText, options, correctIndex } = req.body;
    if (!questionText || !options || !Array.isArray(options) || correctIndex == null) {
      return res.status(400).json({ message: "questionText, options (array), and correctIndex required" });
    }
    const count = await Question.countDocuments({ courseId: req.params.courseId });
    const q = await Question.create({
      courseId: req.params.courseId,
      questionText,
      options,
      correctIndex: Number(correctIndex),
      order: count
    });
    res.json(q);
  } catch (e) {
    res.status(500).json({ message: "Failed to add question" });
  }
});

app.delete("/teacher/question/:id", async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ message: "Question deleted" });
  } catch (e) {
    res.status(500).json({ message: "Delete failed" });
  }
});

// =========================
// ASSIGNMENTS (Teacher create, Student view with due-date alert)
// =========================
app.post("/teacher/assignment", async (req, res) => {
  try {
    const { courseId, courseTitle, title, description, dueDate, teacherEmail } = req.body;
    if (!courseId || !courseTitle || !title || !dueDate) {
      return res.status(400).json({ message: "courseId, courseTitle, title, and dueDate are required" });
    }
    const assignment = await Assignment.create({
      courseId,
      courseTitle: courseTitle || "Course",
      title,
      description: description || "",
      dueDate: new Date(dueDate),
      teacherEmail: teacherEmail || ""
    });
    res.json(assignment);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to create assignment" });
  }
});

app.get("/teacher/course/:courseId/assignments", async (req, res) => {
  try {
    const assignments = await Assignment.find({ courseId: req.params.courseId })
      .sort({ dueDate: 1 });
    res.json(assignments);
  } catch (e) {
    res.json([]);
  }
});

app.delete("/teacher/assignment/:id", async (req, res) => {
  try {
    await Assignment.findByIdAndDelete(req.params.id);
    res.json({ message: "Assignment deleted" });
  } catch (e) {
    res.status(500).json({ message: "Delete failed" });
  }
});

// Student: assignments for courses they are enrolled in (with course description)
app.get("/student/assignments", async (req, res) => {
  try {
    var studentEmail = req.query.email;
    if (!studentEmail) return res.json([]);
    var enrollments = await Enrollment.find({ email: studentEmail }).select("courseId").lean();
    var courseIds = enrollments.map(function(e) { return e && e.courseId; }).filter(Boolean);
    if (courseIds.length === 0) return res.json([]);

    var assignments = await Assignment.find({ courseId: { $in: courseIds } })
      .sort({ dueDate: 1 })
      .lean();

    var objectIds = [];
    for (var i = 0; i < courseIds.length; i++) {
      try {
        objectIds.push(new mongoose.Types.ObjectId(courseIds[i]));
      } catch (_) {}
    }
    var courses = objectIds.length > 0
      ? await Course.find({ _id: { $in: objectIds } }).select("_id description title").lean()
      : [];
    var courseMap = {};
    courses.forEach(function(c) {
      courseMap[String(c._id)] = { description: c.description || "", title: c.title || "" };
    });

    var out = assignments.map(function(a) {
      var c = courseMap[String(a.courseId)] || {};
      return {
        _id: a._id ? String(a._id) : a._id,
        title: a.title,
        description: a.description,
        courseId: a.courseId,
        courseTitle: a.courseTitle,
        dueDate: a.dueDate,
        courseDescription: c.description || "",
        courseName: c.title || a.courseTitle || "Course"
      };
    });
    res.json(out);
  } catch (e) {
    console.error("GET /student/assignments error:", e);
    res.status(500).json({ message: "Error loading assignments", error: String(e.message || e) });
  }
});

// Student: submit assignment (text and/or PDF). JSON body for text; multipart for file.
app.post("/student/assignment/:assignmentId/submit", function(req, res, next) {
  var ct = (req.headers["content-type"] || "").toLowerCase();
  if (ct.indexOf("multipart/form-data") !== -1) {
    return uploadAssignment.single("attachment")(req, res, function(err) {
      if (err) return res.status(500).json({ message: "Upload failed" });
      next();
    });
  }
  next();
}, async function(req, res) {
  try {
    var assignmentId = req.params.assignmentId;
    var studentEmail = (req.body && req.body.email) || "";
    var content = (req.body && req.body.content) || "";
    if (!studentEmail || !assignmentId) {
      return res.status(400).json({ message: "email and assignmentId required" });
    }
    var assignment = await Assignment.findById(assignmentId);
    if (!assignment) return res.status(404).json({ message: "Assignment not found" });
    var enrolled = await Enrollment.findOne({ email: studentEmail, courseId: String(assignment.courseId) });
    if (!enrolled) return res.status(403).json({ message: "You are not enrolled in this course" });

    var attachmentPath = "";
    if (req.file && req.file.filename) {
      attachmentPath = "assignments/" + req.file.filename;
    }

    var submission = await AssignmentSubmission.findOne({ assignmentId: String(assignmentId), studentEmail });
    if (submission) {
      submission.content = content;
      submission.submittedAt = new Date();
      if (attachmentPath) submission.attachmentPath = attachmentPath;
      await submission.save();
    } else {
      submission = await AssignmentSubmission.create({
        assignmentId: String(assignmentId),
        courseId: assignment.courseId,
        courseTitle: assignment.courseTitle,
        assignmentTitle: assignment.title,
        studentEmail: studentEmail,
        content: content,
        attachmentPath: attachmentPath
      });
    }
    res.json(submission);
  } catch (e) {
    console.error("Submit assignment error:", e);
    res.status(500).json({ message: "Submit failed" });
  }
});

// Student: my submissions (with marks) for all my assignments
app.get("/student/my-submissions", async (req, res) => {
  try {
    const studentEmail = req.query.email;
    if (!studentEmail) return res.json([]);
    const submissions = await AssignmentSubmission.find({ studentEmail }).sort({ submittedAt: -1 }).lean();
    res.json(submissions);
  } catch (e) {
    res.json([]);
  }
});

// Teacher: list submissions for an assignment
app.get("/teacher/assignment/:assignmentId/submissions", async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId);
    if (!assignment) return res.json([]);
    const submissions = await AssignmentSubmission.find({ assignmentId: req.params.assignmentId })
      .sort({ submittedAt: -1 })
      .lean();
    res.json(submissions);
  } catch (e) {
    res.json([]);
  }
});

// Teacher: grade a submission
app.put("/teacher/submission/:id/grade", async (req, res) => {
  try {
    const { marks, feedback } = req.body;
    const submission = await AssignmentSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: "Submission not found" });
    submission.marks = marks != null ? Number(marks) : null;
    submission.feedback = feedback != null ? String(feedback) : "";
    submission.gradedAt = new Date();
    submission.gradedBy = req.body.teacherEmail || "";
    await submission.save();
    res.json(submission);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Grade failed" });
  }
});

// =========================
// CERTIFICATE ROUTE (Certificate of Achievement - Professional Design)
// =========================
app.get("/certificate/:email/:course", (req, res) => {

  const { email, course } = req.params;
  const studentName = email.split('@')[0];
  const studentNameDisplay = studentName.charAt(0).toUpperCase() + studentName.slice(1);
  const courseDisplay = decodeURIComponent(course);
  const certDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Certificate of Achievement</title>
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Great+Vibes&family=Georgia&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          background: #b0b8c4;
          font-family: 'Montserrat', Arial, sans-serif;
          padding: 20px;
        }
        
        .certificate-wrapper {
          width: 100%;
          max-width: 1000px;
        }
        
        .certificate-container {
          background: #fff;
          position: relative;
          padding: 50px 60px 55px;
          border: 3px solid #c9a227;
          box-shadow: 0 15px 50px rgba(0,0,0,0.2);
        }
        
        /* Subtle diagonal stripe texture */
        .certificate-container::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 4px,
            rgba(0,0,0,0.015) 4px,
            rgba(0,0,0,0.015) 5px
          );
          pointer-events: none;
          z-index: 0;
        }
        
        /* Top-left L-shaped gold corner */
        .corner-tl {
          position: absolute;
          top: 15px;
          left: 15px;
          width: 50px;
          height: 50px;
          border-left: 3px solid #c9a227;
          border-top: 3px solid #c9a227;
          z-index: 2;
        }
        
        /* Top-right L-shaped gold corner */
        .corner-tr {
          position: absolute;
          top: 15px;
          right: 15px;
          width: 50px;
          height: 50px;
          border-right: 3px solid #c9a227;
          border-top: 3px solid #c9a227;
          z-index: 2;
        }
        
        /* Bottom-left blue & gold decorative shape */
        .deco-bottom-left {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 220px;
          height: 180px;
          z-index: 1;
          overflow: hidden;
        }
        
        .deco-bottom-left svg {
          position: absolute;
          bottom: -20px;
          left: -30px;
          width: 280px;
          height: 220px;
        }
        
        /* Bottom-right blue & gold decorative shape */
        .deco-bottom-right {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 220px;
          height: 180px;
          z-index: 1;
          overflow: hidden;
        }
        
        .deco-bottom-right svg {
          position: absolute;
          bottom: -20px;
          right: -30px;
          width: 280px;
          height: 220px;
          transform: scaleX(-1);
        }
        
        .certificate-content {
          position: relative;
          z-index: 2;
          text-align: center;
        }
        
        .cert-title-main {
          font-family: 'Montserrat', Arial, sans-serif;
          font-size: 42px;
          font-weight: 800;
          color: #000;
          letter-spacing: 4px;
          margin-bottom: 4px;
        }
        
        .cert-title-sub {
          font-family: 'Montserrat', Arial, sans-serif;
          font-size: 22px;
          font-weight: 600;
          color: #c9a227;
          letter-spacing: 3px;
          margin-bottom: 30px;
          padding-bottom: 12px;
          border-bottom: 2px solid #c9a227;
          display: inline-block;
        }
        
        .cert-intro {
          font-family: 'Montserrat', Arial, sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: #000;
          letter-spacing: 1px;
          margin-bottom: 20px;
        }
        
        .cert-name {
          font-family: 'Great Vibes', cursive;
          font-size: 52px;
          font-weight: 400;
          color: #c9a227;
          margin: 25px 0 30px;
          text-transform: capitalize;
        }
        
        .cert-body {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 16px;
          color: #000;
          line-height: 1.8;
          max-width: 720px;
          margin: 0 auto 25px;
        }
        
        .cert-body .course-name {
          font-weight: 700;
          font-style: italic;
        }
        
        .cert-date {
          font-family: 'Montserrat', Arial, sans-serif;
          font-size: 14px;
          color: #000;
          margin-bottom: 45px;
        }
        
        .cert-signatures {
          display: flex;
          justify-content: center;
          gap: 120px;
          align-items: flex-end;
        }
        
        .signature-block {
          text-align: center;
        }
        
        .signature-line {
          width: 180px;
          border-top: 2px solid #000;
          margin-bottom: 8px;
        }
        
        .signature-title {
          font-family: 'Montserrat', Arial, sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #000;
          letter-spacing: 2px;
        }
        
        .print-button {
          margin-top: 35px;
          text-align: center;
        }
        
        .print-button button {
          background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%);
          color: #fff;
          border: none;
          padding: 14px 40px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 1px;
          box-shadow: 0 4px 15px rgba(30,58,95,0.3);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .print-button button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(30,58,95,0.4);
        }
        
        @media print {
          body { background: #fff; padding: 0; }
          .certificate-wrapper { max-width: 100%; box-shadow: none; }
          .certificate-container {
            box-shadow: none;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .certificate-container::before,
          .corner-tl, .corner-tr,
          .cert-title-sub, .cert-name,
          .deco-bottom-left, .deco-bottom-right {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-button { display: none !important; }
        }
        
        @media (max-width: 700px) {
          .certificate-container { padding: 35px 25px 45px; }
          .cert-title-main { font-size: 28px; letter-spacing: 2px; }
          .cert-title-sub { font-size: 16px; }
          .cert-name { font-size: 38px; }
          .cert-body { font-size: 14px; }
          .cert-signatures { gap: 50px; flex-wrap: wrap; justify-content: center; }
        }
      </style>
    </head>
    <body>
      <div class="certificate-wrapper">
        <div class="certificate-container">
          <div class="corner-tl"></div>
          <div class="corner-tr"></div>
          
          <div class="deco-bottom-left">
            <svg viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#1e3a5f"/>
                  <stop offset="100%" style="stop-color:#2c5282"/>
                </linearGradient>
                <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style="stop-color:#c9a227"/>
                  <stop offset="100%" style="stop-color:#d4af37"/>
                </linearGradient>
              </defs>
              <path d="M0,160 Q0,80 40,60 Q80,40 120,80 Q160,120 200,100 L200,160 Z" fill="url(#blueGrad)" opacity="0.9"/>
              <path d="M0,140 Q30,100 70,90 Q110,80 150,110 L200,90" fill="none" stroke="url(#goldGrad)" stroke-width="2" opacity="0.8"/>
            </svg>
          </div>
          <div class="deco-bottom-right">
            <svg viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="blueGradR" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" style="stop-color:#1e3a5f"/>
                  <stop offset="100%" style="stop-color:#2c5282"/>
                </linearGradient>
                <linearGradient id="goldGradR" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" style="stop-color:#c9a227"/>
                  <stop offset="100%" style="stop-color:#d4af37"/>
                </linearGradient>
              </defs>
              <path d="M0,160 Q0,80 40,60 Q80,40 120,80 Q160,120 200,100 L200,160 Z" fill="url(#blueGradR)" opacity="0.9"/>
              <path d="M0,140 Q30,100 70,90 Q110,80 150,110 L200,90" fill="none" stroke="url(#goldGradR)" stroke-width="2" opacity="0.8"/>
            </svg>
          </div>
          
          <div class="certificate-content">
            <h1 class="cert-title-main">CERTIFICATE</h1>
            <p class="cert-title-sub">OF ACHIEVEMENT</p>
            
            <p class="cert-intro">THIS CERTIFICATE PROUDLY PRESENTED TO</p>
            
            <div class="cert-name">${studentNameDisplay}</div>
            
            <p class="cert-body">
              has successfully completed the course <span class="course-name">${courseDisplay}</span> with distinction and excellence.
            </p>
            
            <p class="cert-date">Date: ${certDate}</p>
            
            <div class="cert-signatures">
              <div class="signature-block">
                <div class="signature-line"></div>
                <p class="signature-title">SIGNATURE</p>
              </div>
              <div class="signature-block">
                <div class="signature-line"></div>
                <p class="signature-title">SIGNATURE</p>
              </div>
            </div>
          </div>
        </div>
        
        <div class="print-button">
          <button type="button" onclick="window.print()">🖨️ Print / Save as PDF</button>
          <p style="margin-top:12px;font-size:12px;color:#555;">Tip: In the print dialog, enable <strong>Background graphics</strong> so the PDF saves in full color.</p>
        </div>
      </div>
      <script>
        if (window.location.search.includes('print=1')) {
          window.onload = function() { window.print(); };
        }
      </script>
    </body>
    </html>
  `);
});

// =========================
// PDF CERTIFICATE ROUTE (legacy – same design: use "Download PDF" which opens certificate page with ?print=1)
// =========================
app.get("/certificate-pdf/:name/:course", (req, res) => {
  const { name, course } = req.params;
  const doc = new PDFDocument();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=certificate.pdf");
  doc.pipe(res);
  doc.fontSize(26).text("Certificate of Completion", { align: "center" });
  doc.moveDown();
  doc.fontSize(18).text("This is to certify that", { align: "center" });
  doc.moveDown();
  doc.fontSize(22).text(decodeURIComponent(name), { align: "center" });
  doc.moveDown();
  doc.fontSize(18).text("has successfully completed", { align: "center" });
  doc.moveDown();
  doc.fontSize(22).text(decodeURIComponent(course), { align: "center" });
  doc.end();
});

// =========================
// GLOBAL ERROR HANDLER (always return JSON, never HTML)
// =========================
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  if (res.headersSent) return next(err);
  let message = "Course Upload Failed ❌";
  if (err.code === "LIMIT_FILE_SIZE") message = "File too large. Try a smaller zip (max 200 MB). ❌";
  else if (err.code === "LIMIT_UNEXPECTED_FILE") message = "Unexpected file field. Use the form fields: PDF, Image, or SCORM. ❌";
  else if (err.message) message = err.message;
  res.status(500).json({ message, code: err.code || "SERVER_ERROR" });
});

// =========================
// SERVER START (skip on Vercel – runs as serverless function there)
// =========================
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    const local = `http://localhost:${PORT}`;
    const network = HOST === "0.0.0.0" ? ` http://<this-machine-ip>:${PORT}` : "";
    console.log(`🚀 LMS Server running at ${local}${network}`);
  });
}

module.exports = app;