# Realtime Chat Demo

An interactive demo showcasing the `@realtime-message/sdk` features.

## Features Demonstrated

- **Connection Management** - Connect/disconnect with status indicators
- **Channel Subscription** - Join/leave chat rooms
- **Broadcast Messaging** - Send and receive real-time messages
- **Presence Tracking** - See who's online with join/leave notifications
- **Typing Indicators** - Real-time typing status

## Quick Start

1. **Start the server** (from the project root):
   ```bash
   npm run dev:server
   ```

2. **Start the demo** (from this directory):
   ```bash
   npm install
   npm run dev
   ```

3. Open http://localhost:5173 in your browser

4. Open multiple browser tabs to see real-time communication in action!

## Usage

1. Click **Connect** to establish a WebSocket connection
2. Enter your name and room name
3. Click **Join Room** to enter the chat
4. Start chatting! Open another tab to test real-time messaging

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS v4
- @realtime-message/sdk
