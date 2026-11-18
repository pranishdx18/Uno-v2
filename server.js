// UNO Online: zero dependencies. Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path');
const rooms = {}, C = ['R', 'Y', 'G', 'B'], DRAW = { '+2': 2, '+4': 4, 'rev+4': 4, '+6': 6, '+10': 10 };
let cid = 0;
const rnd = n => Math.floor(Math.random() * n), uid = () => Math.random().toString(36).slice(2, 10);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const top = r => r.disc[r.disc.length - 1];
const live = r => r.players.filter(p => !p.out).length;

// Card counts follow the real decks: Classic 108, No Mercy 168 (edit here to tweak)
function deck(m) {
  const d = [], nm = m == 'nomercy', add = (c, v, n) => { while (n--) d.push({ id: cid++, c, v }); };
  for (const c of C) {
    add(c, '0', 1);
    for (let n = 1; n < 10; n++) add(c, '' + n, 2);
    for (const v of nm ? ['skip', 'rev', '+2', '+4', 'skipall', 'discard'] : ['skip', 'rev', '+2']) add(c, v, nm ? 3 : 2);
  }
  if (nm) { add('W', 'rev+4', 4); add('W', '+6', 4); add('W', '+10', 4); add('W', 'roulette', 8); }
  else { add('W', 'wild', 4); add('W', '+4', 4); }
  return shuffle(d);
}
function take(r, n) {
  const a = [];
  while (n--) {
    if (!r.deck.length) { const t = r.disc.pop(); r.deck = shuffle(r.disc); r.disc = [t]; }
    if (!r.deck.length) break;
    a.push(r.deck.pop());
  }
  return a;
}
// No Mercy: 25+ cards and you're out
function mercy(r, p) {
  if (r.mode == 'nomercy' && p.hand.length >= 25) {
    r.deck.unshift(...p.hand); p.hand = []; p.out = true;
    r.log.push(p.name + ' is out (25+ cards)!');
    const l = r.players.filter(x => !x.out);
    if (l.length == 1) r.winner = l[0].id;
  }
}
const give = (r, p, n) => { p.hand.push(...take(r, n)); mercy(r, p); };
const nxt = (r, i, n = 1) => { while (n--) { do i = (i + r.dir + r.players.length) % r.players.length; while (r.players[i].out); } return i; };
const step = (r, n = 1) => { r.turn = nxt(r, r.turn, n); r.drew = false; };
const ok = (r, c) => {
  const t = top(r);
  if (r.pend) return DRAW[c.v] >= DRAW[t.v]; // stack same or higher
  return c.c == 'W' || c.c == r.color || c.v == t.v;
};
function view(r, p) {
  return {
    code: r.code, mode: r.mode, started: r.started, host: r.host, me: p.id, turn: r.turn, color: r.color,
    pend: r.pend, winner: r.winner, top: top(r), deckN: r.deck.length, drew: r.drew, hand: p.hand, log: r.log.slice(-4),
    players: r.players.map(q => ({ id: q.id, name: q.name, n: q.hand.length, out: q.out }))
  };
}
const send = r => r.players.forEach(p => p.res && p.res.write('data:' + JSON.stringify(view(r, p)) + '\n\n'));
function join(r, name) {
  if (r.started) throw Error('Game already started');
  if (r.players.length >= 10) throw Error('Room is full (10 max)');
  const p = { id: uid(), name: (name || 'Player').trim().slice(0, 14) || 'Player', hand: [] };
  r.players.push(p); r.host = r.host || p.id; send(r);
  return { room: r.code, pid: p.id };
}
function act(b) {
  if (b.t == 'create') {
    let code; do code = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms[code]);
    const r = rooms[code] = { code, mode: b.mode == 'nomercy' ? 'nomercy' : 'classic', players: [], started: false, deck: [], disc: [], turn: 0, dir: 1, pend: 0, log: [] };
    return join(r, b.name);
  }
  const r = rooms[(b.room || '').toUpperCase()];
  if (!r) throw Error('Room not found');
  if (b.t == 'join') return join(r, b.name);
  const p = r.players.find(x => x.id == b.pid);
  if (!p) throw Error('You are not in this room');

  if (b.t == 'start') {
    if (r.host != p.id || (r.started && !r.winner)) throw Error('Only the host can start');
    if (r.players.length < 2) throw Error('Need at least 2 players');
    r.deck = shuffle(deck(r.mode)); r.disc = []; r.started = true; r.winner = null; r.dir = 1; r.pend = 0; r.turn = 0; r.drew = false; r.log = [];
    r.players.forEach(x => { x.out = false; x.hand = take(r, 7); });
    r.disc = r.deck.splice(r.deck.findIndex(x => /^\d$/.test(x.v)), 1); r.color = top(r).c;
  } else {
    if (!r.started || r.winner || r.players[r.turn] !== p) throw Error('Not your turn');
    const nm = r.mode == 'nomercy';
    if (b.t == 'play') {
      const c = p.hand.find(x => x.id == b.card);
      if (!c || !ok(r, c)) throw Error("You can't play that card");
      if (c.c == 'W' && !C.includes(b.color)) throw Error('Pick a color');
      p.hand = p.hand.filter(x => x !== c); r.disc.push(c); r.color = c.c == 'W' ? b.color : c.c;
      r.log.push(p.name + ' played ' + (c.c == 'W' ? '' : c.c + ' ') + c.v);
      const v = c.v; let skip = 1;
      if (v == 'discard') { const rm = p.hand.filter(x => x.c == c.c); p.hand = p.hand.filter(x => x.c != c.c); r.disc.splice(r.disc.length - 1, 0, ...rm); }
      if (v == 'rev' || v == 'rev+4') { r.dir *= -1; if (v == 'rev' && live(r) == 2) skip = 2; }
      if (v == 'skip') skip = 2;
      if (v == 'skipall') skip = live(r);
      if (DRAW[v] && v != 'rev+4' || v == 'rev+4') {
        if (nm) r.pend += DRAW[v];
        else { give(r, r.players[nxt(r, r.turn)], DRAW[v]); skip = 2; }
      }
      if (v == 'roulette') { // next player draws until the chosen color shows up
        const q = r.players[nxt(r, r.turn)]; let g;
        do { g = take(r, 1)[0]; if (g) q.hand.push(g); } while (g && g.c != r.color && q.hand.length < 25);
        mercy(r, q); skip = 2;
      }
      if (!p.hand.length && !r.winner) r.winner = p.id;
      if (!r.winner) step(r, skip);
    } else if (b.t == 'draw') {
      if (r.drew) throw Error('You already drew');
      if (r.pend) { give(r, p, r.pend); r.log.push(p.name + ' took +' + r.pend); r.pend = 0; if (!r.winner) step(r); }
      else if (nm) { // No Mercy: draw until you can play
        let g; do { g = take(r, 1)[0]; if (g) p.hand.push(g); } while (g && !ok(r, g) && p.hand.length < 25);
        mercy(r, p); r.drew = !p.out; if (p.out && !r.winner) step(r);
      } else { const g = take(r, 1)[0]; if (g) p.hand.push(g); r.drew = true; if (!g || !ok(r, g)) step(r); }
    } else if (b.t == 'pass') {
      if (!r.drew) throw Error('Draw first');
      step(r);
    }
  }
  send(r);
  return { ok: 1 };
}

http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname == '/events') {
    const r = rooms[u.searchParams.get('room')], p = r && r.players.find(x => x.id == u.searchParams.get('pid'));
    if (!p) return s.writeHead(404).end();
    s.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    p.res = s; q.on('close', () => { if (p.res === s) p.res = null; });
    return s.write('data:' + JSON.stringify(view(r, p)) + '\n\n');
  }
  if (u.pathname == '/act' && q.method == 'POST') {
    let b = ''; q.on('data', d => b += d).on('end', () => {
      let out; try { out = act(JSON.parse(b)); } catch (e) { out = { err: e.message }; }
      s.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
    });
    return;
  }
  s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fs.readFileSync(path.join(__dirname, 'index.html')));
}).listen(process.env.PORT || 3000, () => console.log('UNO running on port ' + (process.env.PORT || 3000)));

setInterval(() => Object.values(rooms).forEach(r => r.players.forEach(p => p.res && p.res.write(':\n\n'))), 20000);
