# Companion Workspace

A warm, private companion app with:
- account signup and login flow
- authenticated personal workspace sessions
- text chat workspace
- voice call mode
- SQLite-backed accounts, sessions, messages, and long-term memory
- relationship-aware conversation replies from friendly to intimate partner energy
- profile dashboard with memory timeline
- JSON and CSV conversation exports
- admin access portal and analytics

## Run

npm install
npm start

Then open http://localhost:3000

## Admin access

Password: SecurePartner2026!

## Tests

npm test

Account-owned API requests use the bearer token returned by `/api/signup` or
`/api/login`. Anonymous sessions remain available through `/api/session`.
