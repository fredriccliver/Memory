import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { exec, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Memory, StorageType } from '../../src/index';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.GRAPH_VIEWER_PORT) || 3333;

/**
 * 지정된 포트를 사용 중인 프로세스의 PID를 반환합니다.
 *
 * @param port - 확인할 포트 번호
 * @returns 포트를 사용 중인 PID, 없으면 null
 */
function getProcessOnPort(port: number): number | null {
  try {
    const cmd =
      process.platform === 'win32'
        ? `netstat -ano | findstr :${port} | findstr LISTENING`
        : `lsof -ti :${port}`;
    const output = execSync(cmd, { encoding: 'utf-8' }).trim();
    const pid = parseInt(output.split('\n')[0], 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * 지정된 포트를 사용 중인 프로세스를 종료합니다.
 *
 * @param port - 해제할 포트 번호
 * @returns 프로세스 종료 성공 여부
 */
function killProcessOnPort(port: number): boolean {
  const pid = getProcessOnPort(port);
  if (!pid) return false;

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`🔪 Killed existing process (PID: ${pid}) on port ${port}`);
    return true;
  } catch (err) {
    console.error(`⚠️ Failed to kill process (PID: ${pid}):`, err);
    return false;
  }
}

async function main() {
  const existingPid = getProcessOnPort(PORT);
  if (existingPid) {
    console.log(`⚠️ Port ${PORT} is already in use (PID: ${existingPid})`);
    killProcessOnPort(PORT);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const memory = new Memory();

  await memory.initialize({
    type: StorageType.POSTGRES,
    connectionString:
      process.env.MEMORY_DATABASE_URL || 'postgresql://postgres:postgres@localhost:54332/postgres',
  });

  const storage = memory.getStorage();

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://localhost:${PORT}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    const setCors = (headers: Record<string, string>) => ({ ...corsHeaders, ...headers });

    try {
      if (url.pathname === '/') {
        res.writeHead(200, setCors({ 'Content-Type': 'text/html; charset=utf-8' }));
        res.end(readFileSync(join(__dirname, 'index.html'), 'utf-8'));
        return;
      }

      if (url.pathname === '/api/entities') {
        const entities = await storage.getAllEntityIds();
        res.writeHead(200, setCors({ 'Content-Type': 'application/json' }));
        res.end(JSON.stringify(entities));
        return;
      }

      if (url.pathname === '/api/graph') {
        const entityId = url.searchParams.get('entityId');
        if (!entityId) {
          res.writeHead(400, setCors({ 'Content-Type': 'application/json' }));
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

        res.writeHead(200, setCors({ 'Content-Type': 'application/json' }));
        res.end(JSON.stringify({ nodes, links }));
        return;
      }

      res.writeHead(404, setCors({ 'Content-Type': 'text/plain' }));
      res.end('Not Found');
    } catch (error) {
      console.error('API Error:', error);
      res.writeHead(500, setCors({ 'Content-Type': 'application/json' }));
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

  /**
   * Graceful shutdown handler.
   * SIGINT (Ctrl+C) 및 SIGTERM (터미널 종료) 모두 처리하여
   * 포트가 정상 반환되도록 합니다.
   */
  async function shutdown() {
    console.log('\n🔌 Shutting down...');
    server.close();
    await memory.close();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(error => {
  console.error('❌ Failed to start Graph Viewer:', error);
  process.exit(1);
});
