// Colyseus sidecar entrypoint for Live Agent Mode realtime state.
import { createServer } from 'node:http';
import express from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import {
  AGENT_RUNTIME_ROOM_NAME,
  AgentRuntimeRoom,
  readRuntimeDocument,
  runtimeFilePath,
} from './agent-runtime-room.mjs';

const DEFAULT_REALTIME_PORT = 8591;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

export async function createRealtimeServer({
  port = intEnv('VW_REALTIME_PORT', DEFAULT_REALTIME_PORT),
  host = process.env.VW_REALTIME_HOST || '0.0.0.0',
  dataDir = process.env.VW_DATA_DIR || '.local-data',
} = {}) {
  const httpServer = createServer();
  const gameServer = new Server({
    greet: false,
    transport: new WebSocketTransport({
      server: httpServer,
      maxPayload: intEnv('VW_REALTIME_MAX_PAYLOAD_BYTES', DEFAULT_MAX_PAYLOAD_BYTES),
    }),
    express: (app) => {
      app.disable('x-powered-by');
      app.use(express.json({ limit: '64kb' }));
      app.get('/healthz', (_req, res) => {
        res.json({
          ok: true,
          service: 'virtual-world-realtime',
          room: AGENT_RUNTIME_ROOM_NAME,
          port: httpServer.address()?.port || port,
          dataDir,
          runtimeFile: runtimeFilePath(dataDir),
          time: new Date().toISOString(),
        });
      });
      app.get('/api/agent-runtime', (_req, res) => {
        res.json(readRuntimeDocument(dataDir));
      });
    },
  });

  gameServer.define(AGENT_RUNTIME_ROOM_NAME, AgentRuntimeRoom, { dataDir });
  await gameServer.listen(port, host);

  return {
    gameServer,
    httpServer,
    host,
    port: httpServer.address()?.port || port,
    dataDir,
    async close() {
      await gameServer.gracefullyShutdown(false);
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await createRealtimeServer();
  console.log(`Virtual World realtime sidecar listening on ${server.host}:${server.port}`);
  console.log(`Runtime data: ${server.dataDir}`);
}
