# Canvas to Classroom Converter

## TLDR

Canvas to Classroom Converter takes a Canvas IMS Common Cartridge (`.imscc`) export and prepares selected content for Google Classroom. It converts Canvas pages to Classroom materials, Canvas assignments/discussions to Classroom items, and Canvas QTI quizzes/question banks to Google Form quizzes with images preserved when the IMSCC export includes the image files.

Generated Classroom content is created in draft state. Due dates are intentionally stripped so teachers can review everything before publishing.

## What It Converts

- Canvas pages and web content -> Google Classroom materials.
- Canvas assignments and discussions -> Google Classroom coursework.
- Canvas QTI quizzes -> Google Form quizzes attached to Classroom assignments.
- Canvas question banks / quiz banks -> selectable Google Form quiz imports under the `Question Banks` topic.
- Compound Canvas questions such as dropdown/fill-in/matching-style prompts -> separate one-point Google Form questions where possible.
- Question and answer images -> uploaded temporarily through Drive so Google Forms can import them.

## Important Limits

- Canvas random question groups do not map exactly to Google Forms. When Canvas exports only bank references, the converter uses a related exported bank when it can and notes the fallback in the Form description.
- Private Canvas image URLs only work when the actual image file is included in the IMSCC package.
- Google Forms has stricter rules than Canvas, so some duplicate choices or unsupported question types may be normalized.

## Required Google Cloud APIs

Enable these APIs in the same Google Cloud project connected to Firebase:

- Google Classroom API
- Google Forms API
- Google Drive API

Firebase may also enable supporting services for you, but these are commonly needed for setup/deploy:

- Identity Toolkit API / Firebase Authentication
- Firebase Hosting API
- Firebase Management API

## Firebase Setup

1. Create or select a Google Cloud project.
2. Open Firebase and add Firebase to that project.
3. Add a Web App in Firebase project settings.
4. Enable Firebase Authentication.
5. In Authentication -> Sign-in method, enable Google.
6. Add your hosted domain to Authentication -> Settings -> Authorized domains.
7. Enable Firebase Hosting.

For the hosted app, Firebase Auth uses this redirect handler:

```text
https://YOUR_FIREBASE_HOSTING_DOMAIN/__/auth/handler
```

For this project, the production domain is typically:

```text
https://canvas-classroom-converter.firebaseapp.com/__/auth/handler
```

## OAuth Consent And Scopes

Configure the OAuth consent screen in Google Cloud Console. For testing, add your Google account as a test user if the app is in testing mode.

The app requests these scopes:

```text
openid
email
profile
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.topics
https://www.googleapis.com/auth/classroom.coursework.me
https://www.googleapis.com/auth/classroom.courseworkmaterials
https://www.googleapis.com/auth/classroom.coursework.students
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/forms.body
```

Why these are needed:

- Classroom courses read-only: list the teacher's active classes.
- Classroom topics: create or reuse topics.
- Classroom coursework/coursework materials: create draft assignments/materials.
- Drive file: upload and manage Docs, Forms, images, and package files created by the app.
- Forms body: create and populate Google Forms quizzes.

## Local Development

Install dependencies:

```bash
cd classroomrosetta
npm install
```

Run locally:

```bash
npm run start
```

Build:

```bash
npm run build
```

The Angular build outputs to the Firebase hosting public directory configured in `angular.json`.

## Firebase Deploy

From the Firebase folder:

```bash
firebase deploy --only hosting
```

If you are using the original Gulp helper workflow, configure `.env` first and run:

```bash
gulp fullSetupAndDeploy
```

## Environment Variables

The legacy setup uses `.env` values like:

```text
PROJECT_NAME=<Project name>
GCLOUD_PROJECT_ID=<Google Cloud project ID>
APP_NAME=<Angular app name>
DIST_PATH=<Distribution path>
FIREBASE_API_KEY=<Firebase web API key>
FIREBASE_AUTH_DOMAIN=<Firebase auth domain>
FIREBASE_PROJECT_ID=<Firebase project ID>
FIREBASE_STORAGE_BUCKET=<Firebase storage bucket>
FIREBASE_MESSAGING_SENDER_ID=<Firebase messaging sender ID>
FIREBASE_APP_ID=<Firebase app ID>
FIREBASE_CLIENT_ID=<Google OAuth web client ID>
APPS_SCRIPT_EXECUTION_API_URL=<Optional deployed Apps Script API URL>
```

## Teacher Workflow

1. Export a Canvas course or quiz set as IMSCC.
2. Open the app and sign in with Google.
3. Upload the `.imscc` file.
4. Expand topics, including `Question Banks`, and choose what to import.
5. Select one or more Google Classroom courses.
6. Submit selected items.
7. Review the draft Classroom content and generated Google Forms before publishing.
