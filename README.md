# ERLC Dispatch Radio

A browser-based, private, multi-frequency dispatch radio. It uses Node.js, Socket.IO for signaling, and WebRTC for live voice.

## Features

- Police, Sheriff, Fire, EMS, Dispatch, Traffic, and Air Support frequencies.
- Users monitor all frequencies and can mute each incoming frequency independently.
- One selected transmit frequency at a time.
- Push-to-talk microphone with per-frequency audio tracks.
- Dispatcher roster, online status, activity log, and volume slider.
- Shared private room code.

## Requirements

- Node.js 18 or newer.
- A host that supports a long-running Node.js server and WebSocket connections.
- HTTPS in production. Browsers generally require a secure context for microphone access.
- For reliable connections across restrictive networks, configure a TURN server (see below).

## Run locally

1. Install Node.js.
2. Extract this project.
3. Open a terminal in the project folder.
4. Install dependencies:

   ```bash
   npm install
   ```

5. Copy `.env.example` to `.env`.
6. Change `RADIO_ACCESS_CODE` in `.env` to a private code. Do not share the `.env` file publicly.
7. Start the server:

   ```bash
   npm start
   ```

8. Visit `http://localhost:3000`.

For another device to connect, host the site on an HTTPS-capable server or use a secure development tunnel. `localhost` microphone access works on the same computer.

## Deploy

Deploy this folder to a Node.js host such as Render, Railway, or another service that supports persistent WebSocket connections.

- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `RADIO_ACCESS_CODE` = your private room code
- Set `PORT` only if your host requires it; most hosts provide it automatically.
- Enable HTTPS on the host.

Do not deploy with the example room code.

## Voice connectivity / TURN

The client includes public Google STUN servers. STUN is enough for many connections, but some networks require a TURN relay. For production community use, set up a TURN service such as coturn and add its `urls`, `username`, and `credential` to the `iceServers` array in `public/app.js`. Keep TURN credentials private; for a public deployment, issue short-lived credentials from your server rather than hard-coding permanent credentials in client code.

## Important limitations

- This is a standalone website; it does not hook into Roblox/ERLC's built-in voice chat or automatically identify in-game units.
- The room code is a simple shared access gate, not individual accounts or role-based permissions. Anyone who knows it can join.
- Voice is peer-to-peer WebRTC mesh. It is intended for small community groups; large groups may need an SFU media server (for example, mediasoup or LiveKit).
- Use headphones to reduce feedback.
- Follow your community's privacy and recording rules. This app does not record calls.

## Put this project on GitHub and deploy it

1. Sign in at https://github.com and create a **New repository**. Give it a name such as `erlc-dispatch-radio`.
2. Extract the downloaded ZIP on your computer. Open the extracted `erlc-dispatch-radio` folder.
3. In the new GitHub repository, choose **Add file → Upload files**. Upload the contents of the extracted folder (including `public/`, `server.js`, `package.json`, `render.yaml`, and `.gitignore`). Do not upload your `.env` file or any private room code.
4. Commit the uploaded files to the repository's main branch.
5. On Render, create a new **Blueprint** and connect/select that GitHub repository. Render reads `render.yaml` and sets up the Node web service.
6. In the Render service's environment settings, set `RADIO_ACCESS_CODE` to a long private code. Never put this code in a source file or commit it to GitHub.
7. Deploy. Open the HTTPS URL Render gives you. Share that website address and the private radio room code with your dispatch team.

GitHub stores the source code; the Render Node service runs the Socket.IO/WebRTC signaling backend. GitHub Pages alone cannot run this backend, so do not deploy this project as a Pages-only static site.
