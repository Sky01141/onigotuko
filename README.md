# CHASE! 3D online tag (Node.js + three.js)

No C. Server: Node.js (`ws`). Client: HTML/JS + three.js.

## Run locally
    npm install && npm start     # http://localhost:8080  (Node 18+)

## Deploy (Render)
Push to GitHub > Render "New > Blueprint" > select repo. Health check: /healthz. Client should use `wss://<host>/`.

## Status
Done: SOLO client (VTuber-style humanoid), authoritative server (rooms, roles, capture, timer, events, win).
Not yet: client ROOM UI/network, map vote, server items, reconnect, Owner/BAN, skins, 4 more maps, server-side obstacles.

## Protocol (JSON)
Client: {t:'j',room,name} {t:'s'} {t:'i',x,z,d,j}
Server: joined, lobby, start{you,hunter,seed,prep}, s{time,ar,prep,p:[[x,z,y,yaw,hunter]|null]}, ev{n}, cap{id,by}, end{w}, err

## Character
Procedural humanoid in makeChar() (client/index.html). For a truly realistic VTuber model, put a .vrm in client/assets and load it with three-vrm.

## v0.3 client (COM only)
Modes: TAG / HIDE & SEEK (30s hide time, FOUND state, direction-arrow items). Chests (click/F, OPEN button on mobile),
camera 3rd/close/1st (C/V, CAM button) with wall push-in, occluded name tags, 5 map themes, CHARACTER (saved in localStorage).
Server (server/server.js) still implements TAG only; HIDE & SEEK, chests, map vote, char sync are client-side for now.
