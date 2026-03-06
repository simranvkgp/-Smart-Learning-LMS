# Smart Learning LMS

A Node.js + Express Learning Management System (LMS) with role-based access (Admin, Teacher, Student). Teachers create courses and assessments; students enroll, submit assignments, take quizzes, and download certificates after passing.

## Features

- **Roles:** Admin, Teacher, Student (JWT login)
- **Teacher:** Create courses (PDF, image, SCORM), add assignments (due dates) and quiz questions; view enrollments; grade submissions
- **Student:** Browse/enroll in courses; view assignments; submit work (PDF or text); take quizzes (50%+ to get certificate); download certificates
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

## Environment Variables

- `PORT`: Server port (default: 5000)
- `MONGO_URI`: MongoDB connection string
- `JWT_SECRET`: Secret used to sign JWT tokens (set a strong value in production)

## Project Structure

- `server.js` – Express app, routes, APIs
- `models/` – User, Course, Enrollment, Question, QuizAttempt, Assignment, AssignmentSubmission
- `public/` – static pages (login/register/dashboards) and uploads

## License

ISC (see `LICENSE`)
