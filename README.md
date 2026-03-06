# Smart Learning LMS

A Node.js + Express learning management system with roles (Admin, Teacher, Student). Teachers create courses (PDF, SCORM, images), add assignments and quiz questions. Students enroll, submit assignments, take quizzes, and get certificates after passing.

## Features

- **Roles:** Admin, Teacher, Student (JWT login)
- **Teacher:** Add courses (PDF, image, SCORM), assignments with due dates, quiz questions; view enrollments and grade assignment submissions
- **Student:** Browse courses, enroll, view assignments (course name + due date), submit assignments (PDF or text), take quiz (50% to get certificate), download certificate
- **Admin:** Manage users, courses, enrollments

## Tech Stack

- Node.js, Express, MongoDB (Mongoose), JWT, Multer, bcrypt, PDFKit, adm-zip

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/simranvkgp/Smart-Learning-LMS.git
   cd Smart-Learning-LMS
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment**
   - Copy `.env.example` to `.env`
   - Set `MONGO_URI` (MongoDB connection string) and `JWT_SECRET`

4. **Run**
   ```bash
   npm start
   ```
   Server runs at `http://localhost:5000` (or your `PORT`).

5. **First use**
   - Open the app, register as Admin/Teacher/Student, then login.

## Project Structure

- `server.js` – Express app, routes, APIs
- `models/` – User, Course, Enrollment, Question, QuizAttempt, Assignment, AssignmentSubmission
- `public/` – login, register, admin-dashboard, dashboard (teacher), student-dashboard, my-courses; uploads folder for files

## License

ISC
