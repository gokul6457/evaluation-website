// TECHNITEX API – Express + Postgres (serverless-friendly, no sockets, no local disk)
const express = require('express'), { Pool } = require('pg'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const local = /localhost|127\.0\.0\.1/.test(DB_URL || '');
const pool = new Pool({
  connectionString: DB_URL, max: 3, idleTimeoutMillis: 10000,
  ssl: local || !DB_URL ? false : { rejectUnauthorized: false }
});

const q = (sql, p = [], c = pool) => c.query(sql, p).then(r => r.rows);
const tx = async fn => { const c = await pool.connect(); try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r } catch (e) { await c.query('rollback').catch(() => {}); throw e } finally { c.release() } };

const SCHEMA = `
create table if not exists admins(id serial primary key, username text unique not null, pass_hash text not null);
create table if not exists teams(id serial primary key, number text unique not null, name text not null, remarks text default '');
create table if not exists rounds(id serial primary key, name text not null, max_marks double precision not null check(max_marks>0), status text not null default 'active', "position" integer not null default 0);
create table if not exists scores(team_id integer references teams(id) on delete cascade, round_id integer references rounds(id) on delete cascade, marks double precision not null check(marks>=0), primary key(team_id,round_id));
create table if not exists score_history(id serial primary key, team_label text, round_label text, old_marks double precision, new_marks double precision, admin text, at text default to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
create table if not exists settings(key text primary key, value text);`;

let ready;
const init = () => ready || (ready = (async () => {
  if (!SECRET || SECRET.length < 16) throw Object.assign(new Error('Set JWT_SECRET (16+ chars)'), {
    status: 503, publicMessage: 'Server setup is incomplete. Add JWT_SECRET (16+ characters) in Vercel Environment Variables.'
  });
  if (!DB_URL) throw Object.assign(new Error('Set DATABASE_URL'), {
    status: 503, publicMessage: 'Database is not configured. Add DATABASE_URL in Vercel Environment Variables.'
  });
  try { await pool.query(SCHEMA) } catch (e) {
    e.status = 503;
    e.publicMessage = 'Cannot connect to PostgreSQL. Check DATABASE_URL and allow Vercel to connect to the database.';
    throw e;
  }
  const { ADMIN_USER: u, ADMIN_PASSWORD: p } = process.env;
  if (u && p) {
    const cur = (await q('select pass_hash from admins where username=$1', [u]))[0];
    if (!cur || !bcrypt.compareSync(p, cur.pass_hash))
      await q('insert into admins(username,pass_hash) values($1,$2) on conflict(username) do update set pass_hash=excluded.pass_hash', [u, bcrypt.hashSync(p, 10)]);
  }
})().catch(e => { ready = null; throw e }));

const setS = (k, v, c = pool) => q('insert into settings values($1,$2) on conflict(key) do update set value=excluded.value', [k, v], c);
const who = r => { try { const c = (r.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('tk=')); return jwt.verify(c.slice(3), SECRET).u } catch { return null } };
const auth = (r, s, n) => { r.user = who(r); r.user ? n() : s.status(401).json({ error: 'Login required' }) };
const need = (c, m) => { if (!c) throw Object.assign(new Error(m), { status: 400 }) };
const str = (v, n = 80) => String(v ?? '').trim().slice(0, n);
const h = fn => (r, s, n) => Promise.resolve(fn(r, s, n)).catch(n);   // async error -> error handler
const id = v => { const n = Number(v); need(Number.isInteger(n), 'Invalid id'); return n };

async function state(c = pool) {
  const [teams, rounds, scores, st] = await Promise.all([
    q(`select id,number,name,remarks from teams order by case when number ~ '^[0-9]+$' then number::int end, number`, [], c),
    q('select id,name,max_marks,status,"position" as position from rounds order by "position",id', [], c),
    q('select team_id,round_id,marks from scores', [], c),
    q('select key,value from settings', [], c)]);
  return { teams, rounds, scores, settings: Object.fromEntries(st.map(r => [r.key, r.value])) };
}
async function board(c = pool) {
  const s = await state(c), m = {}; s.scores.forEach(x => m[x.team_id + '_' + x.round_id] = x.marks);
  const mx = s.rounds.reduce((a, r) => a + r.max_marks, 0);
  const a = s.teams.map(t => ({ ...t, tot: Math.round(s.rounds.reduce((x, r) => x + (m[t.id + '_' + r.id] || 0), 0) * 100) / 100 })).sort((x, y) => y.tot - x.tot);
  a.forEach((t, i) => t.rank = i && a[i - 1].tot === t.tot ? a[i - 1].rank : i + 1);
  return { a, m, s, mx };
}
const ranks = async c => Object.fromEntries((await board(c)).a.map(t => [t.id, t.rank]));

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.get('/api/health', h(async (r, s) => {
  await init();
  await pool.query('select 1');
  s.set('Cache-Control', 'no-store').json({ status: 'ok' });
}));
app.use('/api', h(async (r, s, n) => { await init(); n() }));

const fails = {};
app.post('/api/login', h(async (r, s) => {
  const k = r.ip, f = fails[k] || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 9e5) { f.n = 0; f.t = Date.now() }
  if (f.n >= 10) return s.status(429).json({ error: 'Too many attempts. Try again later.' });
  const u = (await q('select * from admins where username=$1', [str(r.body.username)]))[0];
  if (!u || !bcrypt.compareSync(String(r.body.password || ''), u.pass_hash)) { f.n++; fails[k] = f; return s.status(401).json({ error: 'Invalid username or password' }) }
  delete fails[k];
  s.setHeader('Set-Cookie', `tk=${jwt.sign({ u: u.username }, SECRET, { expiresIn: '8h' })}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : ''}`);
  s.json({ user: u.username });
}));
app.post('/api/logout', (r, s) => { s.setHeader('Set-Cookie', 'tk=; HttpOnly; Path=/; Max-Age=0'); s.json({ ok: 1 }) });
app.get('/api/me', (r, s) => s.json({ user: who(r) }));
app.get('/api/public', h(async (r, s) => {
  const d = await state(), me = who(r);
  if (!me) d.teams.forEach(t => delete t.remarks);
  s.set('Cache-Control', 'no-store'); s.json({ ...d, me });
}));

const team = r => { const n = str(r.body.number, 10), m = str(r.body.name, 60); need(n && m, 'Team number and name are required'); return [n, m] };
app.post('/api/teams', auth, h(async (r, s) => { await q('insert into teams(number,name) values($1,$2)', team(r)); s.json({ ok: 1 }) }));
app.put('/api/teams/:id', auth, h(async (r, s) => { const [n, m] = team(r); const x = await pool.query('update teams set number=$1,name=$2 where id=$3', [n, m, id(r.params.id)]); need(x.rowCount, 'Team not found'); s.json({ ok: 1 }) }));
app.delete('/api/teams/:id', auth, h(async (r, s) => { await q('delete from teams where id=$1', [id(r.params.id)]); s.json({ ok: 1 }) }));

const rd = b => { const n = str(b.name, 60), x = Number(b.max_marks), st = b.status === 'completed' ? 'completed' : 'active'; need(n && Number.isFinite(x) && x > 0, 'Round name and a maximum above 0 are required'); return [n, x, st] };
app.post('/api/rounds', auth, h(async (r, s) => { await q('insert into rounds(name,max_marks,status,"position") values($1,$2,$3,(select coalesce(max("position"),0)+1 from rounds))', rd(r.body)); s.json({ ok: 1 }) }));
app.put('/api/rounds/:id', auth, h(async (r, s) => {
  const [n, x, st] = rd(r.body), i = id(r.params.id);
  need(!(await q('select 1 from scores where round_id=$1 and marks>$2', [i, x]))[0], 'Existing marks exceed the new maximum');
  const u = await pool.query('update rounds set name=$1,max_marks=$2,status=$3 where id=$4', [n, x, st, i]); need(u.rowCount, 'Round not found'); s.json({ ok: 1 });
}));
app.delete('/api/rounds/:id', auth, h(async (r, s) => { await q('delete from rounds where id=$1', [id(r.params.id)]); s.json({ ok: 1 }) }));

app.put('/api/scores', auth, h(async (r, s) => {
  const { entries = [], remarks = {} } = r.body; need(Array.isArray(entries), 'Invalid data');
  await tx(async c => {
    let snap = false;
    for (const x of entries) {
      const rr = (await q('select * from rounds where id=$1', [Number(x.round_id)], c))[0], t = (await q('select * from teams where id=$1', [Number(x.team_id)], c))[0];
      need(rr && t, 'Unknown team or round');
      const old = (await q('select marks from scores where team_id=$1 and round_id=$2', [t.id, rr.id], c))[0], nv = x.marks === null || x.marks === '' ? null : Number(x.marks);
      need(nv === null || (Number.isFinite(nv) && nv >= 0 && nv <= rr.max_marks), `Marks for ${t.name} in ${rr.name} must be between 0 and ${rr.max_marks}`);
      if ((old ? old.marks : null) === nv) continue;
      if (!snap) { await setS('prev_ranks', JSON.stringify(await ranks(c)), c); snap = true }
      if (nv === null) await q('delete from scores where team_id=$1 and round_id=$2', [t.id, rr.id], c);
      else await q('insert into scores values($1,$2,$3) on conflict(team_id,round_id) do update set marks=excluded.marks', [t.id, rr.id, nv], c);
      await q('insert into score_history(team_label,round_label,old_marks,new_marks,admin) values($1,$2,$3,$4,$5)', [`#${t.number} ${t.name}`, rr.name, old ? old.marks : null, nv, r.user], c);
    }
    for (const [i, v] of Object.entries(remarks)) await q('update teams set remarks=$1 where id=$2', [str(v, 300), id(i)], c);
  });
  s.json({ ok: 1 });
}));
app.get('/api/history', auth, h(async (r, s) => s.json(await q('select * from score_history order by id desc limit 200'))));
app.put('/api/settings', auth, h(async (r, s) => {
  if (['Upcoming', 'Live', 'Completed'].includes(r.body.event_status)) await setS('event_status', r.body.event_status);
  if (r.body.event_name) await setS('event_name', str(r.body.event_name, 80)); s.json({ ok: 1 });
}));
app.get('/api/export.csv', auth, h(async (r, s) => {
  const { a, m, s: st, mx } = await board(), c = v => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v };
  const L = [['Rank', 'Team No', 'Team', ...st.rounds.map(x => `${x.name} (/${x.max_marks})`), 'Total', 'Max', 'Percent'], ...a.map(t => [t.rank, t.number, t.name, ...st.rounds.map(x => m[t.id + '_' + x.id] ?? ''), t.tot, mx, mx ? (t.tot / mx * 100).toFixed(2) : '0'])];
  s.type('text/csv').attachment('technitex-results.csv').send(L.map(x => x.map(c).join(',')).join('\r\n'));
}));
app.get('/api/backup', auth, h(async (r, s) => { const d = { ...(await state()), history: await q('select * from score_history order by id') }; s.attachment('technitex-backup.json').json(d) }));
app.post('/api/restore', auth, h(async (r, s) => {
  const d = r.body.data; need(d && Array.isArray(d.teams) && Array.isArray(d.rounds) && Array.isArray(d.scores), 'Invalid backup file');
  await tx(async c => {
    await c.query('delete from scores; delete from score_history; delete from teams; delete from rounds');
    for (const t of d.teams) await q('insert into teams(id,number,name,remarks) values($1,$2,$3,$4)', [t.id, str(t.number, 10), str(t.name, 60), str(t.remarks, 300)], c);
    for (const x of d.rounds) await q('insert into rounds(id,name,max_marks,status,"position") values($1,$2,$3,$4,$5)', [x.id, str(x.name, 60), x.max_marks, x.status === 'completed' ? 'completed' : 'active', x.position | 0], c);
    for (const x of d.scores) await q('insert into scores values($1,$2,$3)', [x.team_id, x.round_id, x.marks], c);
    for (const x of d.history || []) await q('insert into score_history(team_label,round_label,old_marks,new_marks,admin,at) values($1,$2,$3,$4,$5,$6)', [x.team_label, x.round_label, x.old_marks, x.new_marks, x.admin, x.at], c);
    // keep serial sequences ahead of restored ids
    for (const t of ['teams', 'rounds']) await c.query(`select setval(pg_get_serial_sequence('${t}','id'), greatest((select coalesce(max(id),0) from ${t}),1))`);
    await setS('prev_ranks', '', c);
  });
  s.json({ ok: 1 });
}));
app.post('/api/reset', auth, h(async (r, s) => {
  need(r.body.confirm === 'RESET', 'Confirmation required');
  await tx(async c => { await c.query('delete from scores; delete from score_history'); await setS('prev_ranks', '', c); if (r.body.mode === 'all') await c.query('delete from teams; delete from rounds') });
  s.json({ ok: 1 });
}));
app.use('/api', (r, s) => s.status(404).json({ error: 'Not found' }));
app.use((er, r, s, n) => {
  const uq = er.code === '23505', fk = er.code === '23503';
  if (!uq && !fk && (!er.status || er.status >= 500)) console.error(er);
  s.status(uq ? 409 : fk ? 400 : er.status || 500).json({ error: uq ? 'That team number already exists' : fk ? 'Invalid reference' : er.publicMessage || (er.status ? er.message : 'Server error') });
});
module.exports = app;
