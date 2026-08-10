#!/usr/bin/env node
/**
 * Serve the editor against a local photo and write the manifest back beside it.
 *
 *   npx image-aware ./laptop.jpg
 *   npx image-aware ./laptop.jpg --port 5123 --open
 *
 * Zero dependencies on purpose: this is the one piece of the project that runs
 * on a user's machine outside a browser, and it should not drag a server
 * framework along with it.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
};

function parseArgs(argv) {
  const options = { image: null, port: 5123, open: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') options.port = Number(argv[++i]);
    else if (arg === '--open' || arg === '-o') options.open = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('-')) options.image ??= arg;
  }
  return options;
}

const USAGE = `
  image-aware — mark flat surfaces on a photo

  Usage
    npx image-aware <image> [options]

  Options
    -p, --port <n>   Port to listen on (default 5123)
    -o, --open       Open a browser window
    -h, --help       Show this message

  Saves to <image-without-extension>.surfaces.json, next to the photo.
`;

const options = parseArgs(process.argv.slice(2));

if (options.help || !options.image) {
  console.log(USAGE);
  process.exit(options.image ? 0 : 1);
}

const imagePath = resolve(process.cwd(), options.image);

try {
  await access(imagePath);
} catch {
  console.error(`Cannot read image: ${imagePath}`);
  process.exit(1);
}

const imageName = basename(imagePath);
const manifestPath = join(dirname(imagePath), `${imageName.replace(/\.[^.]+$/, '')}.surfaces.json`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': type });
  response.end(body);
}

async function serveFile(response, path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return send(response, 404, 'Not found');
    response.writeHead(200, {
      'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(response);
  } catch {
    send(response, 404, 'Not found');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path === '/api/session') {
    return send(
      response,
      200,
      JSON.stringify({
        imageUrl: '/api/image',
        imageSrc: imageName,
        manifestPath,
        hasManifest: await exists(manifestPath),
      }),
      MIME['.json'],
    );
  }

  if (path === '/api/image') {
    return serveFile(response, imagePath);
  }

  if (path === '/api/manifest') {
    if (request.method === 'GET') {
      if (!(await exists(manifestPath))) return send(response, 404, 'No manifest yet');
      return send(response, 200, await readFile(manifestPath, 'utf8'), MIME['.json']);
    }

    if (request.method === 'PUT') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        // Parse before writing so a malformed body cannot clobber a good file.
        JSON.parse(body);
      } catch (error) {
        return send(response, 400, `Invalid JSON: ${error.message}`);
      }
      await writeFile(manifestPath, `${body}\n`, 'utf8');
      console.log(`  saved  ${manifestPath}`);
      return send(response, 200, 'ok');
    }

    return send(response, 405, 'Method not allowed');
  }

  // Static editor assets, with a directory-traversal guard.
  const requested = resolve(DIST, `.${path === '/' ? '/index.html' : path}`);
  if (!requested.startsWith(DIST)) return send(response, 403, 'Forbidden');
  if (!(await exists(requested))) return serveFile(response, join(DIST, 'index.html'));
  return serveFile(response, requested);
});

if (!(await exists(DIST))) {
  console.error(`Editor build not found at ${DIST}. Run "pnpm build" in @image-aware/editor.`);
  process.exit(1);
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\n  Port ${options.port} is already in use.` +
        `\n  Either stop whatever is on it, or pick another:` +
        `\n\n    npx image-aware ${options.image} --port ${options.port + 1}\n`,
    );
    process.exit(1);
  }
  throw error;
});

server.listen(options.port, () => {
  const url = `http://localhost:${options.port}`;
  console.log(`
  image-aware

    editor  ${url}
    photo   ${imagePath}
    saves   ${manifestPath}

  Press Ctrl+C to stop.
`);
  if (options.open) {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    import('node:child_process').then(({ spawn }) => {
      spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    });
  }
});
