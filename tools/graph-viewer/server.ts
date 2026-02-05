import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Memory, StorageType } from '../../src/index';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.GRAPH_VIEWER_PORT) || 3333;

async function main() {
  const memory = new Memory();

  await memory.initialize({
    type: StorageType.POSTGRES,
    connectionString:
      process.env.MEMORY_DATABASE_URL || 'postgresql://postgres:postgres@localhost:54332/postgres',
  });

  const storage = memory.getStorage();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://localhost:${PORT}`);

    try {
      if (url.pathname === '/') {
        const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (url.pathname === '/api/entities') {
        const entities = await storage.getAllEntityIds();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entities));
        return;
      }

      if (url.pathname === '/api/graph') {
        const entityId = url.searchParams.get('entityId');
        if (!entityId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'entityId required' }));
          return;
        }

        const memories = await storage.getMemoriesByEntity(entityId);
        const nodes = memories.map(m => ({
          id: m.id,
          content: m.content,
          entityId: m.entityId,
          edgeCount: m.outgoingEdges.length,
          createdAt: m.createdAt.toISOString(),
        }));

        const nodeIds = new Set(memories.map(m => m.id));
        const links = memories.flatMap(m =>
          m.outgoingEdges
            .filter(targetId => nodeIds.has(targetId))
            .map(targetId => ({ source: m.id, target: targetId })),
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nodes, links }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (error) {
      console.error('API Error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  });

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`🚀 Graph Viewer running at ${url}`);

    const openCmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${openCmd} ${url}`);
  });

  process.on('SIGINT', async () => {
    console.log('\n🔌 Shutting down...');
    await memory.close();
    server.close();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ Failed to start Graph Viewer:', error);
  process.exit(1);
});
