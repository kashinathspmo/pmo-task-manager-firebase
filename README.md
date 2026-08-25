# PMO Task Manager, Firebase Edition

This version uses the approved-looking Craft Silicon email addresses supplied for the four PMO users. GitHub Pages hosts the frontend, Firebase Authentication handles login/logout, and Cloud Firestore stores shared tasks.

## Allowed users

| Website username | Firebase Authentication email | Role |
|---|---|---|
| `nagarajan` | `nagarajan.p@craftsilicon.com` | Manager |
| `manopriya` | `manopriya.k@craftsilicon.com` | Team Member |
| `nidhi` | `nidhi.s@craftsilicon.com` | Team Member |
| `kashinath` | `kashinath.s@craftsilicon.com` | Team Member |

There is no public sign-up page. Create these four accounts manually in Firebase Authentication. If you use `PMO@123` initially, replace it with a different strong password for each person before entering real operational information. Never save passwords in this repository.

# Browser-only beginner setup

You do not need to install Git, Node.js, Firebase CLI, VS Code, or any other application.

## Part 1: Create Firebase

1. Open the Firebase Console in your browser.
2. Sign in using a company-approved Google account.
3. Select **Create a project**.
4. Project name: `PMO Daily Task Manager`.
5. Leave Google Analytics disabled unless your company allows it.
6. Finish creating the project.

## Part 2: Register the web application

1. From Firebase Project Overview, click the Web icon `</>`.
2. App nickname: `PMO Task Manager Web`.
3. Do not enable Firebase Hosting because GitHub Pages will host the website.
4. Select **Register app**.
5. Firebase displays a `firebaseConfig` block. Keep this page open because the values are required in GitHub.

## Part 3: Enable secure email/password login

1. In Firebase, open **Build > Authentication**.
2. Select **Get started**.
3. Open **Sign-in method**.
4. Select **Email/Password**.
5. Enable Email/Password and save.
6. Do not add a public Create Account or Sign Up function.

## Part 4: Create the four accounts

Open **Authentication > Users > Add user** and create these users one at a time:

1. `nagarajan.p@craftsilicon.com`
2. `manopriya.k@craftsilicon.com`
3. `nidhi.s@craftsilicon.com`
4. `kashinath.s@craftsilicon.com`

For initial setup, enter the password `PMO@123` for each account. The website login usernames remain `nagarajan`, `manopriya`, `nidhi`, and `kashinath`.

## Part 5: Create Firestore

1. Open **Build > Firestore Database**.
2. Select **Create database**.
3. Choose **Production mode**.
4. Select a location approved by your company.
5. Finish creating the database.

## Part 6: Publish the security rules

1. In the extracted ZIP, open `firestore.rules` with Notepad.
2. Select and copy the full file.
3. In Firebase, open **Firestore Database > Rules**.
4. Delete the existing rules.
5. Paste the copied rules.
6. Select **Publish**.

The rules allow only the four listed Craft Silicon email identities. Nagarajan has manager access. Team members can update tasks assigned to their own short username. Unauthenticated users and unmatched accounts are denied.

## Part 7: Create the GitHub repository

1. Sign in to GitHub in your browser.
2. Select the `+` icon and then **New repository**.
3. Repository name: `pmo-task-manager-firebase`.
4. Use a private repository if your company account and GitHub plan support GitHub Pages from private repositories.
5. Select **Create repository**.

Do not upload the Excel tracker or operational data to the source repository.

## Part 8: Upload this project

1. Extract this ZIP.
2. In the GitHub repository, select **Add file > Upload files**.
3. Upload all extracted files and folders.
4. Commit message: `Add secure Firebase PMO task manager`.
5. Select **Commit changes**.
6. Confirm that `.github/workflows/deploy.yml` exists in GitHub.

If `.github` was skipped because it is hidden:

1. Select **Add file > Create new file**.
2. Enter `.github/workflows/deploy.yml` as the filename.
3. Open that file from the extracted project, copy its contents, paste them into GitHub, and commit.

## Part 9: Add Firebase values as GitHub secrets

Open **Repository > Settings > Secrets and variables > Actions**. Create these repository secrets using the corresponding values from Firebase's `firebaseConfig` block:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Example: if Firebase shows `apiKey: "abc123"`, create the secret named `VITE_FIREBASE_API_KEY` with value `abc123`. Do not include quotation marks. Never upload a service-account JSON/private key.

## Part 10: Deploy the website

1. Open **Repository > Settings > Pages**.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. Open the repository **Actions** tab.
4. Open **Deploy GitHub Pages**.
5. Use **Run workflow** if it did not start automatically.
6. Check that both Build and Deploy are green.
7. Return to **Settings > Pages** and open the published link.

## Part 11: Sign in

Use the short username on the website:

- `nagarajan`
- `manopriya`
- `nidhi`
- `kashinath`

Use the matching Firebase password. The top navigation includes a Logout button.

## Security behavior

- Anyone who knows the GitHub Pages URL can load the public login screen.
- Only a valid allowlisted Firebase account can enter the application.
- Firestore rules independently restrict data requests to the four supplied Craft Silicon email addresses.
- There is no public self-registration in the website.
- Removing a user from Firebase Authentication prevents that account from signing in.
- Adding a fifth user requires updating both `src/main.tsx` and `firestore.rules`, then republishing the rules and GitHub site.
- The frontend code and Firebase web configuration are public in a browser application. Passwords, service-account credentials, and task records are not intentionally stored in the frontend source.

## First use

1. Sign in as `nagarajan`.
2. The manager's initial visit creates the default recurring templates if none exist.
3. Open Settings to review recurring task templates.
4. Test with sample/non-sensitive data first.
5. Confirm manager and team-member permissions before adding real company information.
