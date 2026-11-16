import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { openDatabase } from './db.mjs';
import { page, access, dashboard, electionPage, escape } from './views.mjs';

const derive = promisify(scrypt);
const db = await openDatabase();
const production = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
const stylesheet = await readFile(new URL('./style.css', import.meta.url));
const now = () => new Date().toISOString();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value) => value.trim().toLowerCase();

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64);
  return salt + ':' + key.toString('hex');
}

function validateCredentials(email, password) {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError(400, 'Enter a valid email address.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new RequestError(400, 'Use a password between 12 and 128 characters.');
  }
}

async function insertUnique(query, sql, params) {
  try {
    await query(sql, params);
    return true;
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    return false;
  }
}

async function seedAdmin() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL || '');
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email && !password && !production) return;
  validateCredentials(email, password);
  let [existing] = await db.query('SELECT role FROM users WHERE email = ?', [email]);
  if (!existing) {
    const created = await insertUnique(db.query, "INSERT INTO users VALUES (?, ?, ?, 'admin')", [
      randomUUID(), email, await passwordHash(password)
    ]);
    if (created) return;
    [existing] = await db.query('SELECT role FROM users WHERE email = ?', [email]);
  }
  if (existing?.role !== 'admin') throw new Error('ADMIN_EMAIL is already assigned to a voter.');
}
await seedAdmin();

function html(res, title, body, user, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page(title, body, user));
}

function redirect(res, location, cookie) {
  const headers = { Location: location };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(303, headers);
  res.end();
}

function sessionCookie(token, age) {
  return 'session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age +
    (production ? '; Secure' : '');
}

async function formBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    throw new RequestError(415, 'Submit the form from the voting portal.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new RequestError(413, 'The form is too large.');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function requireRole(user, role) {
  if (!user || (role && user.role !== role)) {
    throw new RequestError(403, 'Your account cannot perform this action.');
  }
}

async function getElection(query, id, lock = '') {
  const [election] = await query('SELECT * FROM elections WHERE id = ?' + lock, [id]);
  if (!election) throw new RequestError(404, 'Election not found.');
  return election;
}

async function createElection(form) {
  const title = (form.get('title') || '').trim();
  const description = (form.get('description') || '').trim();
  const candidates = (form.get('candidates') || '').split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (!title || title.length > 100 || description.length > 500) {
    throw new RequestError(400, 'Use a title of 1 to 100 characters and a description of up to 500 characters.');
  }
  if (candidates.length < 2 || candidates.length > 20 || candidates.some((name) => name.length > 80) ||
      new Set(candidates.map((name) => name.toLowerCase())).size !== candidates.length) {
    throw new RequestError(400, 'Enter 2 to 20 distinct candidates, one per line, with up to 80 characters each.');
  }
  const id = randomUUID();
  await db.transaction(async (query) => {
    await query("INSERT INTO elections VALUES (?, ?, ?, 'draft', ?)", [id, title, description, now()]);
    for (const name of candidates) {
      await query('INSERT INTO candidates VALUES (?, ?, ?)', [id, randomUUID(), name]);
    }
  });
  return id;
}

async function changeStatus(id, action) {
  const from = action === 'open' ? 'draft' : 'open';
  const to = action === 'open' ? 'open' : 'closed';
  const changed = await db.query(
    'UPDATE elections SET status = ? WHERE id = ? AND status = ?', [to, id, from]
  );
  if (!changed.affectedRows) throw new RequestError(409, 'This election can no longer make that transition.');
}

async function castVote(id, voterId, candidateId) {
  await db.transaction(async (query) => {
    const election = await getElection(query, id, ' FOR UPDATE');
    if (election.status !== 'open') throw new RequestError(409, 'Voting is closed for this election.');
    const [candidate] = await query('SELECT id FROM candidates WHERE election_id = ? AND id = ?', [id, candidateId]);
    if (!candidate) throw new RequestError(400, 'Choose a candidate from this election.');
    const inserted = await insertUnique(query,
      'INSERT INTO voter_participation VALUES (?, ?)', [id, voterId]
    );
    if (!inserted) throw new RequestError(409, 'Your ballot has already been recorded.');
    await query('INSERT INTO ballots VALUES (?, ?, ?)', [randomUUID(), id, candidateId]);
  });
}

export async function handleRequest(req, res) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  let user;
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      return res.end(stylesheet);
    }
    if (req.method === 'GET' && path === '/health') {
      await db.query('SELECT 1');
      return res.end('ok');
    }
    if (req.method !== 'GET' && req.method !== 'POST') throw new RequestError(405, 'Method unavailable.');
    const token = req.headers.cookie?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const tokenHash = token && digest(token);
    if (tokenHash) {
      [user] = await db.query(
        'SELECT u.id, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
        [tokenHash, now()]
      );
    }
    const route = path.match(/^\/elections\/([a-f0-9-]{36})(?:\/(vote|open|close))?$/);
    if (req.method === 'GET') {
      if (path === '/' && !user) return html(res, 'Sign in', access('login'), user);
      if (path === '/register' && !user) return html(res, 'Register', access('register'), user);
      if (!user) return redirect(res, '/');
      if (path === '/') {
        const rows = await db.query(
          "SELECT e.*, p.voter_id AS voted FROM elections e LEFT JOIN voter_participation p ON p.election_id = e.id AND p.voter_id = ? WHERE e.status <> 'draft' OR ? = 'admin' ORDER BY e.created_at DESC",
          [user.id, user.role]
        );
        return html(res, 'Elections', dashboard(rows, user), user);
      }
      if (route && !route[2]) {
        const id = route[1];
        const item = await getElection(db.query, id);
        if (item.status === 'draft' && user.role !== 'admin') throw new RequestError(404, 'Election not found.');
        const candidates = await db.query('SELECT id, name FROM candidates WHERE election_id = ? ORDER BY name', [id]);
        const results = await db.query('SELECT name, votes FROM election_results WHERE election_id = ? ORDER BY votes DESC, name', [id]);
        const [participation] = await db.query('SELECT voter_id FROM voter_participation WHERE election_id = ? AND voter_id = ?', [id, user.id]);
        return html(res, item.title, electionPage(item, candidates, results, participation, user), user);
      }
    } else {
      const protocol = production ? 'https://' : 'http://';
      if (req.headers.origin !== protocol + req.headers.host) {
        throw new RequestError(403, 'Open the form from this website and try again.');
      }
      const form = await formBody(req);
      if (path === '/logout') {
        if (tokenHash) await db.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
        return redirect(res, '/', sessionCookie('', 0));
      }
      if (path === '/login' || path === '/register') {
        if (user) return redirect(res, '/');
        const email = normalizeEmail(form.get('email') || '');
        const password = form.get('password') || '';
        validateCredentials(email, password);
        if (path === '/register') {
          const created = await insertUnique(db.query,
            "INSERT INTO users VALUES (?, ?, ?, 'voter')",
            [randomUUID(), email, await passwordHash(password)]
          );
          if (!created) throw new RequestError(409, 'This email already has an account.');
        }
        const [account] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        const stored = account?.password_hash;
        const calculated = await passwordHash(password, stored?.split(':')[0]);
        if (!stored || !timingSafeEqual(Buffer.from(stored), Buffer.from(calculated))) {
          throw new RequestError(401, 'Email or password is incorrect.');
        }
        const hours = 12;
        const freshToken = randomBytes(32).toString('hex');
        await db.query('DELETE FROM sessions WHERE expires_at <= ?', [now()]);
        await db.query('INSERT INTO sessions VALUES (?, ?, ?)', [
          digest(freshToken), account.id, new Date(Date.now() + hours * 3600000).toISOString()
        ]);
        return redirect(res, '/', sessionCookie(freshToken, hours * 3600));
      }
      if (path === '/elections') {
        requireRole(user, 'admin');
        return redirect(res, '/elections/' + await createElection(form));
      }
      if (route?.[2]) {
        const [, id, action] = route;
        if (action === 'vote') {
          requireRole(user, 'voter');
          await castVote(id, user.id, form.get('candidate'));
        } else {
          requireRole(user, 'admin');
          await changeStatus(id, action);
        }
        return redirect(res, '/elections/' + id);
      }
    }
    throw new RequestError(404, 'Page not found.');
  } catch (error) {
    const expected = error instanceof RequestError;
    if (!expected) console.error(error);
    if (!res.headersSent && !res.destroyed) {
      html(res, 'Request failed',
        '<section class="panel narrow"><h1>Request failed</h1><p>' +
        escape(expected ? error.message : 'Please try again in a moment.') +
        '</p><a href="/">Return to the portal</a></section>', user, expected ? error.status : 500);
    }
  }
}

export function listen() {
  return createServer(handleRequest).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
    console.log('Voting portal listening on port ' + (process.env.PORT || 3000));
  });
}



