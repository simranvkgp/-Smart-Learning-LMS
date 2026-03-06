# Push Smart Learning LMS to Your GitHub

Follow these steps to upload your project to **https://github.com/simranvkgp**

---

## Step 1: Create the repository on GitHub

1. Open: **https://github.com/new**
2. Log in if needed (account: **simranvkgp**).
3. **Repository name:** type **Smart-Learning-LMS** (use a hyphen, no spaces).
4. Leave **Public** selected.
5. Do **not** check "Add a README file" or ".gitignore".
6. Click **Create repository**.

---

## Step 2: Push your project from your computer

Open **PowerShell** or **Command Prompt** and run:

```bash
cd c:\Users\Sparsh\Desktop\LMS
git push -u origin main
```

When asked:
- **Username:** `simranvkgp`
- **Password:** use a **Personal Access Token** (not your GitHub password).

### Create a token (if you don’t have one)

1. GitHub → click your profile picture (top right) → **Settings**.
2. Left sidebar → **Developer settings** → **Personal access tokens** → **Tokens (classic)**.
3. **Generate new token (classic)**.
4. Note: e.g. "LMS push". Check **repo**.
5. **Generate token** → copy the token (you won’t see it again).
6. When `git push` asks for **Password**, paste this token.

---

## Step 3: Confirm

After a successful push, open:

**https://github.com/simranvkgp/Smart-Learning-LMS**

You should see your project files there.
