import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { startServer } from '../src/server/webServer.js';

async function collectStreamEvents(url, { expectFrame = true, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const result = { status: null, frame: null, events: [] };

    const finish = (value) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      request.destroy();
      resolve(value);
    };

    const fail = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      request.destroy();
      reject(error);
    };

    const request = http.get(url, { headers: { Accept: 'text/event-stream' } }, (response) => {
      if (response.statusCode !== 200) {
        fail(new Error(`Unexpected status code ${response.statusCode}`));
        return;
      }

      response.setEncoding('utf8');
      let buffer = '';

      response.on('data', (chunk) => {
        if (finished) {
          return;
        }
        buffer += chunk;
        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex !== -1) {
          const raw = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          boundaryIndex = buffer.indexOf('\n\n');
          if (!raw.trim()) {
            continue;
          }
          const event = parseSseEvent(raw);
          result.events.push(event);
          if (event.type === 'status' && !result.status) {
            result.status = event;
            if (!expectFrame) {
              finish(result);
              return;
            }
          }
          if (event.type === 'frame') {
            result.frame = event;
            finish(result);
            return;
          }
          if (event.type === 'error') {
            fail(new Error(event.data?.message ?? 'Stream error'));
            return;
          }
        }
      });

      response.on('error', fail);
      response.on('close', () => {
        if (!finished) {
          fail(new Error('Stream closed before expected events'));
        }
      });
    });

    request.on('error', fail);

    const timeoutId = setTimeout(() => {
      fail(new Error('Timed out waiting for stream events'));
    }, timeoutMs);
  });
}

function parseSseEvent(block) {
  const lines = block.split(/\r?\n/);
  let type = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  let data = null;
  if (dataLines.length > 0) {
    const text = dataLines.join('\n');
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { type, data, raw: block };
}

function formatBaseUrl(host, port) {
  const normalizedHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1'
    : host?.startsWith('::ffff:')
      ? host.slice(7)
      : host;
  return `http://${normalizedHost}:${port}`;
}

test('mission stream emits frames with fast pacing presets', async (t) => {
  const { server, port, host } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = formatBaseUrl(host, port);
  const { status, frame } = await collectStreamEvents(`${baseUrl}/api/stream?speed=4x&history=0`, {
    timeoutMs: 45000,
  });

  assert.ok(status?.data);
  assert.equal(status.data.state, 'running');
  assert.equal(status.data.speed, '4x');
  assert.equal(status.data.includeHistory, false);
  assert.equal(status.data.frameIntervalMs, 100);
  assert.equal(status.data.missionRate, 4);

  assert.ok(frame?.data?.time?.get);
  assert.ok(typeof frame.data.time.getSeconds === 'number');
  assert.ok(Array.isArray(frame.data.checklists?.active));
}, { timeout: 60000 });

test('mission stream toggles history payloads when requested', async (t) => {
  const { server, port, host } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = formatBaseUrl(host, port);
  const { status, frame } = await collectStreamEvents(`${baseUrl}/api/stream?speed=real&sample=1&history=1`, {
    timeoutMs: 60000,
  });

  assert.ok(status?.data?.includeHistory);
  assert.ok(frame?.data?.resourceHistory);
  assert.equal(frame.data.resourceHistory?.meta?.enabled, true);
  assert.ok(Array.isArray(frame.data.resourceHistory?.power)
    || Array.isArray(frame.data.resourceHistory?.thermal));
}, { timeout: 70000 });
