/* UI for the offline chess game. Depends only on ChessCore (engine.js). */
(function () {
  'use strict';

  var STORE_KEY = 'chess-offline.v1';
  var START_RATING = 800, K_FACTOR = 32;
  var FILES = 'abcdefgh';
  var BOTS = [
    { elo: 500, name: 'Beginner' },
    { elo: 1000, name: 'Casual' },
    { elo: 1500, name: 'Club' },
    { elo: 2000, name: 'Expert' }
  ];
  var MIN_BOT_DELAY = 350;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function botName(elo) {
    for (var i = 0; i < BOTS.length; i++) if (BOTS[i].elo === elo) return BOTS[i].name;
    return 'Bot';
  }
  function isBotElo(elo) { return BOTS.some(function (b) { return b.elo === elo; }); }

  // ---------------------------------------------------------------- pieces
  // Hand-drawn piece shapes on a 100 x 100 grid. Fill and outline colours come
  // from CSS on the <svg class="pc w|b">; --dt is the contrasting detail colour.
  var BASE = '<path d="M24 90v-5q0-7 8-7h36q8 0 8 7v5z"/>';
  var SHAPES = {
    p: '<path d="M39 46h22l-2 7q1 14 11 25H30q10-11 11-25z"/><circle cx="50" cy="31" r="13"/>',
    r: '<path d="M35 38h30l4 40H31z"/><path d="M29 16h10v8h6v-8h10v8h6v-8h10v22H29z"/>',
    n: '<path d="M32 78C32 62 47 57 44 44L32 51 22 45 23 37C28 28 34 21 44 17L47 7 56 17C73 24 79 46 72 78Z"/>' +
       '<circle cx="40" cy="31" r="2.8" style="fill:var(--dt);stroke:none"/>' +
       '<path d="M58 24C66 32 69 46 67 62" style="fill:none;stroke:var(--dt);stroke-width:2.5"/>',
    b: '<path d="M43 61q0 9-11 17h36q-11-8-11-17z"/><path d="M37 54h26v7H37z"/>' +
       '<path d="M50 18C38 30 33 42 40 54h20c7-12 2-24-10-36z"/><circle cx="50" cy="13" r="5"/>' +
       '<path d="M56 31l-8 11" style="fill:none;stroke:var(--dt);stroke-width:3"/>',
    q: '<path d="M34 62h32l4 16H30z"/><path d="M22 32l12 30h32l12-30-15 16-13-24-13 24z"/>' +
       '<circle cx="22" cy="29" r="4.5"/><circle cx="50" cy="20" r="4.5"/><circle cx="78" cy="29" r="4.5"/>',
    k: '<path d="M34 62h32l4 16H30z"/><path d="M47 5h6v7h7v6h-7v9h-6v-9h-7v-6h7z"/>' +
       '<path d="M50 34c-6-9-22-8-22 4 0 9 6 15 6 24h32c0-9 6-15 6-24 0-12-16-13-22-4z"/>'
  };

  function injectPieceSymbols() {
    var html = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>';
    Object.keys(SHAPES).forEach(function (t) {
      html += '<symbol id="pc-' + t + '" viewBox="0 0 100 100">' + SHAPES[t] + BASE + '</symbol>';
    });
    var holder = document.createElement('div');
    holder.innerHTML = html + '</defs></svg>';
    document.body.insertBefore(holder.firstChild, document.body.firstChild);
  }

  // ch is a FEN letter: upper case for White, lower case for Black.
  function pieceSvg(ch) {
    var t = ch.toLowerCase();
    return '<svg class="pc ' + (ch === t ? 'b' : 'w') + '" viewBox="0 0 100 100"><use href="#pc-' + t + '"/></svg>';
  }

  // ----------------------------------------------------------------- board
  function squareAt(orient, row, col) {
    var f = orient === 'w' ? col : 7 - col, r = orient === 'w' ? 8 - row : row + 1;
    return FILES.charAt(f) + r;
  }

  // Draw a position. o: orient, last [from, to], sel, targets {sq: isCapture},
  // check (king square), mine (colour whose pieces can be picked up).
  function drawBoard(el, c, o) {
    var html = '', row, col, name, ch, cls, f, r;
    for (row = 0; row < 8; row++) {
      for (col = 0; col < 8; col++) {
        name = squareAt(o.orient, row, col);
        f = name.charCodeAt(0) - 97; r = +name.charAt(1);
        ch = c.piece(name);
        cls = 'sq ' + ((f + r) % 2 === 0 ? 'l' : 'd');
        if (o.last && (o.last[0] === name || o.last[1] === name)) cls += ' last';
        if (o.sel === name) cls += ' sel';
        if (o.check === name) cls += ' chk';
        if (ch && o.mine && (ch === ch.toUpperCase() ? 'w' : 'b') === o.mine) cls += ' mine';
        html += '<div class="' + cls + '" data-sq="' + name + '">';
        if (col === 0) html += '<span class="co rank">' + r + '</span>';
        if (row === 7) html += '<span class="co file">' + name.charAt(0) + '</span>';
        if (ch) html += pieceSvg(ch);
        if (o.targets && o.targets.hasOwnProperty(name)) html += '<span class="hint' + (o.targets[name] ? ' cap' : '') + '"></span>';
        html += '</div>';
      }
    }
    el.innerHTML = html;
  }

  // --------------------------------------------------------------- storage
  var store = { games: [], current: null, prefs: { bot: 1000, color: 'random' } };
  var storageOk = true;

  function validGame(g) {
    return !!g && typeof g === 'object' && typeof g.id === 'string' && isBotElo(g.bot) &&
      (g.color === 'w' || g.color === 'b') &&
      (g.result === 'win' || g.result === 'draw' || g.result === 'loss') &&
      Array.isArray(g.moves) && g.moves.length <= 2000 &&
      g.moves.every(function (m) { return typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m); });
  }

  // Rebuild a stored game from its moves so nothing unchecked reaches the page.
  function cleanGame(g) {
    if (!validGame(g)) return null;
    var c = ChessCore(), sans = [], i, d;
    var startFen = typeof g.startFen === 'string' && c.load(g.startFen) ? c.fen() : c.START_FEN;
    c.load(startFen);
    for (i = 0; i < g.moves.length; i++) {
      d = c.move(g.moves[i]);
      if (!d) return null;
      sans.push(d.san);
    }
    var t = Date.parse(g.endedAt);
    return {
      id: g.id.slice(0, 64), bot: g.bot, color: g.color, result: g.result,
      reason: String(g.reason || '').slice(0, 40),
      startFen: startFen, moves: g.moves.slice(), sans: sans,
      endedAt: new Date(isNaN(t) ? Date.now() : t).toISOString()
    };
  }

  function loadStore() {
    try {
      var probe = STORE_KEY + '.probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object') return;
      if (Array.isArray(d.games)) store.games = d.games.map(cleanGame).filter(Boolean);
      if (d.current && typeof d.current === 'object') store.current = d.current;
      if (d.prefs && typeof d.prefs === 'object') {
        if (isBotElo(d.prefs.bot)) store.prefs.bot = d.prefs.bot;
        if (['w', 'b', 'random'].indexOf(d.prefs.color) >= 0) store.prefs.color = d.prefs.color;
      }
    } catch (e) {
      storageOk = false;
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, games: store.games, current: store.current, prefs: store.prefs }));
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    $('storage-warning').hidden = storageOk;
  }

  // ----------------------------------------------------------------- stats
  // Everything on the dashboard is derived from the list of finished games.
  function computeStats(games) {
    var s = {
      n: games.length, w: 0, d: 0, l: 0, rating: START_RATING, history: [START_RATING],
      perGame: [], perBot: {}, streakType: null, streak: 0, bestWinStreak: 0, peak: START_RATING
    };
    BOTS.forEach(function (b) { s.perBot[b.elo] = { n: 0, w: 0, d: 0, l: 0 }; });
    var winRun = 0;
    games.forEach(function (g) {
      var score = g.result === 'win' ? 1 : (g.result === 'draw' ? 0.5 : 0);
      var expected = 1 / (1 + Math.pow(10, (g.bot - s.rating) / 400));
      var before = s.rating;
      s.rating = before + K_FACTOR * (score - expected);
      s.history.push(s.rating);
      s.perGame.push({ before: before, after: s.rating });
      if (s.rating > s.peak) s.peak = s.rating;
      var key = g.result === 'win' ? 'w' : (g.result === 'draw' ? 'd' : 'l');
      s[key]++; s.perBot[g.bot][key]++; s.perBot[g.bot].n++;
      if (s.streakType === g.result) s.streak++; else { s.streakType = g.result; s.streak = 1; }
      winRun = g.result === 'win' ? winRun + 1 : 0;
      if (winRun > s.bestWinStreak) s.bestWinStreak = winRun;
    });
    return s;
  }

  // ------------------------------------------------------------ bot runner
  // Runs the engine in a Web Worker built from a Blob (fine on file://), and
  // falls back to the main thread if the browser refuses to create one.
  function BotRunner() {
    var worker = null, pending = {}, nextId = 1, localCore = null;

    function runLocal(job) {
      setTimeout(function () {
        var mv = null;
        try {
          if (!localCore) localCore = ChessCore();
          mv = localCore.botMove(job.fen, job.moves, job.level);
        } catch (e) { mv = null; }
        job.cb(mv);
      }, 30);
    }

    function failOver() {
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
      worker = null;
      var jobs = pending; pending = {};
      Object.keys(jobs).forEach(function (id) { runLocal(jobs[id]); });
    }

    try {
      var src = ChessCore.toString() + '\nvar core=ChessCore();self.onmessage=function(e){var d=e.data,mv=null;' +
        'try{mv=core.botMove(d.fen,d.moves,d.level);}catch(x){mv=null;}self.postMessage({id:d.id,move:mv});};';
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (e) {
        var job = pending[e.data.id];
        if (!job) return;
        delete pending[e.data.id];
        job.cb(e.data.move);
      };
      worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); failOver(); };
    } catch (e) {
      worker = null;
    }

    return {
      usingWorker: function () { return !!worker; },
      request: function (fen, moves, level, cb) {
        var job = { fen: fen, moves: moves, level: level, cb: cb };
        if (!worker) { runLocal(job); return; }
        var id = nextId++;
        pending[id] = job;
        try { worker.postMessage({ id: id, fen: fen, moves: moves, level: level }); }
        catch (e) { failOver(); }
      }
    };
  }

  // ------------------------------------------------------------ play state
  var core = ChessCore();
  var runner = null;
  var game = null;            // { id, bot, color, startFen, moves, sans, over, summary }
  var sel = null, targets = {}, drag = null, ghost = null;
  var thinking = false, botReq = 0, promoOpen = false;
  var boardEl, tab = 'play';

  function playerMoved() {
    return !!game && game.moves.length >= (game.color === 'w' ? 1 : 2);
  }
  function canMove() {
    return !!game && !game.over && !thinking && !promoOpen && core.turn() === game.color;
  }
  function lastMove() {
    if (!game || !game.moves.length) return null;
    var m = game.moves[game.moves.length - 1];
    return [m.slice(0, 2), m.slice(2, 4)];
  }

  function persistCurrent() {
    store.current = game && !game.over
      ? { id: game.id, bot: game.bot, color: game.color, startFen: game.startFen, moves: game.moves.slice() }
      : null;
    saveStore();
  }

  function startGame() {
    var choice = store.prefs.color;
    var color = choice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : choice;
    botReq++; thinking = false;
    core.reset();
    game = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      bot: store.prefs.bot, color: color, startFen: core.START_FEN,
      moves: [], sans: [], over: false, summary: null
    };
    sel = null; targets = {};
    closePromo();
    persistCurrent();
    renderPlay();
    if (core.turn() !== game.color) requestBot();
  }

  function resume() {
    var cur = store.current;
    if (!cur || !isBotElo(cur.bot) || (cur.color !== 'w' && cur.color !== 'b') || !Array.isArray(cur.moves)) return false;
    var startFen = typeof cur.startFen === 'string' && core.load(cur.startFen) ? cur.startFen : core.START_FEN;
    core.load(startFen);
    var sans = [], i, d;
    for (i = 0; i < cur.moves.length; i++) {
      d = core.move(cur.moves[i]);
      if (!d) { core.reset(); return false; }
      sans.push(d.san);
    }
    game = {
      id: String(cur.id || Date.now().toString(36)), bot: cur.bot, color: cur.color, startFen: startFen,
      moves: cur.moves.slice(), sans: sans, over: false, summary: null
    };
    var st = core.status();
    if (st.over) { finishFromStatus(st); return true; }
    if (core.turn() !== game.color) requestBot();
    return true;
  }

  function finishFromStatus(st) {
    var outcome = 'draw';
    if (st.result !== '1/2-1/2') outcome = (st.result === '1-0') === (game.color === 'w') ? 'win' : 'loss';
    finish(outcome, st.reason);
  }

  function finish(outcome, reason) {
    botReq++; thinking = false;
    var before = computeStats(store.games).rating;
    store.games.push({
      id: game.id, bot: game.bot, color: game.color, result: outcome, reason: reason,
      startFen: game.startFen, moves: game.moves.slice(), sans: game.sans.slice(),
      endedAt: new Date().toISOString()
    });
    var after = computeStats(store.games).rating;
    game.over = true;
    game.summary = { outcome: outcome, reason: reason, before: before, after: after };
    sel = null; targets = {};
    closePromo();
    persistCurrent();
    renderPlay();
    if (tab === 'dash') renderDash();
  }

  function playMove(uci) {
    var d = core.move(uci);
    if (!d) return false;
    game.moves.push(d.uci); game.sans.push(d.san);
    sel = null; targets = {};
    var st = core.status();
    if (st.over) { finishFromStatus(st); return true; }
    persistCurrent();
    renderPlay();
    if (core.turn() !== game.color) requestBot();
    return true;
  }

  function requestBot() {
    if (!runner) runner = BotRunner();
    var id = ++botReq, t0 = Date.now();
    thinking = true;
    renderPlay();
    runner.request(game.startFen, game.moves.slice(), game.bot, function (uci) {
      if (id !== botReq) return;
      setTimeout(function () {
        if (id !== botReq) return;
        thinking = false;
        if (!uci || !playMove(uci)) {
          renderPlay();
          $('status').textContent = 'The bot could not find a move. Start a new game.';
        }
      }, Math.max(0, MIN_BOT_DELAY - (Date.now() - t0)));
    });
  }

  function resign() {
    if (!game || game.over) return;
    if (!playerMoved()) {
      // Nothing played yet: drop the game without recording it.
      botReq++; thinking = false;
      game = null; core.reset(); sel = null; targets = {};
      closePromo();
      persistCurrent();
      renderPlay();
      return;
    }
    finish('loss', 'resignation');
  }

  // ----------------------------------------------------------- interaction
  function select(sq) {
    sel = sq; targets = {};
    core.moves(sq).forEach(function (m) { targets[m.to] = m.capture; });
  }
  function clearSelection() { sel = null; targets = {}; }

  function squareFromPoint(x, y) {
    var rect = boardEl.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return null;
    var col = Math.min(7, Math.floor((x - rect.left) / (rect.width / 8)));
    var row = Math.min(7, Math.floor((y - rect.top) / (rect.height / 8)));
    return squareAt(game.color, row, col);
  }

  function isMine(sq) {
    var ch = core.piece(sq);
    return !!ch && (ch === ch.toUpperCase() ? 'w' : 'b') === game.color;
  }

  function tryMove(from, to) {
    var opts = core.moves(from).filter(function (m) { return m.to === to; });
    if (!opts.length) return;
    if (opts.length > 1) { openPromo(from, to); return; }
    playMove(opts[0].uci);
  }

  function openPromo(from, to) {
    promoOpen = true;
    sel = null; targets = {};
    drawPlayBoard();
    var white = game.color === 'w', html = '<div class="promo-box"><div>Promote to</div><div class="opts">';
    ['q', 'r', 'b', 'n'].forEach(function (p) {
      html += '<button type="button" data-promo="' + p + '" title="' +
        { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p] + '">' + pieceSvg(white ? p.toUpperCase() : p) + '</button>';
    });
    html += '</div><button type="button" data-promo="">Cancel</button></div>';
    var el = $('promo');
    el.innerHTML = html;
    el.hidden = false;
    el.onclick = function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var p = b.getAttribute('data-promo');
      closePromo();
      if (p) playMove(from + to + p); else renderPlay();
    };
  }
  function closePromo() {
    promoOpen = false;
    var el = $('promo');
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }

  function removeGhost() {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
  }
  function markOver(sq) {
    var prev = boardEl.querySelector('.sq.over');
    if (prev) prev.classList.remove('over');
    if (sq && targets.hasOwnProperty(sq)) {
      var el = boardEl.querySelector('[data-sq="' + sq + '"]');
      if (el) el.classList.add('over');
    }
  }

  function onPointerDown(e) {
    if (!canMove()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    if (sel && sel !== sq && targets.hasOwnProperty(sq)) {   // second click of click-click
      tryMove(sel, sq);
      return;
    }
    if (!isMine(sq)) { clearSelection(); drawPlayBoard(); return; }
    var wasSelected = sel === sq;
    select(sq);
    drawPlayBoard();
    drag = { sq: sq, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, wasSelected: wasSelected };
    // Keep receiving this pointer on the board even though its squares get redrawn.
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or stale pointer */ }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return;
      drag.moved = true;
      var size = boardEl.getBoundingClientRect().width / 8;
      ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.style.width = ghost.style.height = size + 'px';
      ghost.innerHTML = pieceSvg(core.piece(drag.sq));
      document.body.appendChild(ghost);
      var origin = boardEl.querySelector('[data-sq="' + drag.sq + '"]');
      if (origin) origin.classList.add('dragging');
    }
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    markOver(squareFromPoint(e.clientX, e.clientY));
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    removeGhost();
    try { boardEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (e.type === 'pointercancel') { drawPlayBoard(); return; }
    if (d.moved) {
      var sq = squareFromPoint(e.clientX, e.clientY);
      if (sq && sq !== d.sq && targets.hasOwnProperty(sq)) { tryMove(d.sq, sq); return; }
      drawPlayBoard();                       // dropped somewhere illegal: snap back
    } else if (d.wasSelected) {
      clearSelection();                      // clicking the selected piece again deselects
      drawPlayBoard();
    }
  }

  // ------------------------------------------------------------- rendering
  function drawPlayBoard() {
    var orient = game ? game.color : 'w';
    drawBoard(boardEl, core, {
      orient: orient, last: lastMove(), sel: sel, targets: targets,
      check: core.inCheck() ? core.kingSquare(core.turn()) : null,
      mine: canMove() ? game.color : null
    });
  }

  function movesHtml(sans, cur, startFen, clickable) {
    if (!sans.length) return '<li class="empty">No moves yet.</li>';
    var parts = String(startFen || '').split(' ');
    var blackFirst = parts[1] === 'b', num = parseInt(parts[5], 10) || 1;
    var html = '', i = 0, cell;
    cell = function (idx) {
      if (idx < 0 || idx >= sans.length) return '<span class="m"></span>';
      return '<span class="m' + (idx === cur ? ' cur' : '') + '"' + (clickable ? ' data-ply="' + (idx + 1) + '"' : '') + '>' + esc(sans[idx]) + '</span>';
    };
    if (blackFirst) { html += '<li><span class="n">' + num + '.</span><span class="m">...</span>' + cell(0) + '</li>'; i = 1; num++; }
    for (; i < sans.length; i += 2, num++) {
      html += '<li><span class="n">' + num + '.</span>' + cell(i) + cell(i + 1) + '</li>';
    }
    return html;
  }

  function barHtml(color, title, sub, extra) {
    return '<span class="dot ' + color + '"></span><span>' + esc(title) + '</span>' +
      (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + (extra || '');
  }

  function fmtDelta(before, after) {
    var d = Math.round(after) - Math.round(before);
    return Math.round(before) + ' to ' + Math.round(after) + ' (' + (d >= 0 ? '+' : '') + d + ')';
  }

  function renderPlay() {
    var stats = computeStats(store.games);
    var botElo = game ? game.bot : store.prefs.bot;
    var myColor = game ? game.color : 'w', theirs = myColor === 'w' ? 'b' : 'w';

    $('bar-top').innerHTML = barHtml(theirs, botName(botElo) + ' bot', '~' + botElo,
      thinking ? '<span class="thinking">thinking...</span>' : '');
    $('bar-bottom').innerHTML = barHtml(myColor, 'You', 'rating ' + Math.round(stats.rating));

    drawPlayBoard();

    var status = $('status'), cls = 'status', html;
    if (!game) {
      html = 'Pick an opponent and a colour, then start a game.';
    } else if (game.over) {
      var s = game.summary;
      if (s.reason === 'resignation') html = 'You resigned.';
      else if (s.outcome === 'win') html = 'You won by ' + esc(s.reason) + '.';
      else if (s.outcome === 'loss') html = 'You lost by ' + esc(s.reason) + '.';
      else html = 'Draw by ' + esc(s.reason) + '.';
      if (s.outcome !== 'draw') cls += ' ' + s.outcome;
      html += '<span class="sub">Rating ' + fmtDelta(s.before, s.after) + '</span>';
    } else if (thinking || core.turn() !== game.color) {
      html = 'Waiting for the bot...';
    } else {
      html = (core.inCheck() ? 'Check. ' : '') + 'Your move (' + (game.color === 'w' ? 'White' : 'Black') + ').';
    }
    status.className = cls;
    status.innerHTML = html;

    var list = $('moves');
    list.innerHTML = movesHtml(game ? game.sans : [], game ? game.sans.length - 1 : -1, game ? game.startFen : '', false);
    list.scrollTop = list.scrollHeight;

    var active = !!game && !game.over;
    $('btn-resign').disabled = !active;
    $('btn-resign').textContent = active && !playerMoved() ? 'Abort game' : 'Resign';
    $('btn-new').textContent = active ? 'New game' : 'Start game';

    Array.prototype.forEach.call($('bot-picker').children, function (b) {
      b.classList.toggle('on', +b.getAttribute('data-bot') === store.prefs.bot);
    });
    Array.prototype.forEach.call($('color-picker').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-color') === store.prefs.color);
    });
  }

  // ------------------------------------------------------------- dashboard
  var replay = null;           // { g, idx, fens, lasts }
  var rcore = ChessCore();

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function pgnResult(g) {
    if (g.result === 'draw') return '1/2-1/2';
    return (g.result === 'win') === (g.color === 'w') ? '1-0' : '0-1';
  }

  function buildPgn(g) {
    var d = new Date(g.endedAt), res = pgnResult(g);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var date = isNaN(d.getTime()) ? '????.??.??' : d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
    var bot = botName(g.bot) + ' bot (~' + g.bot + ')';
    var tags = [
      ['Event', 'Offline game against a bot'], ['Site', 'Local'], ['Date', date], ['Round', '-'],
      ['White', g.color === 'w' ? 'Player' : bot], ['Black', g.color === 'b' ? 'Player' : bot], ['Result', res]
    ];
    if (g.startFen && g.startFen !== rcore.START_FEN) { tags.push(['SetUp', '1']); tags.push(['FEN', g.startFen]); }
    if (g.reason) tags.push(['Termination', g.reason]);
    var out = tags.map(function (t) { return '[' + t[0] + ' "' + String(t[1]).replace(/["\\]/g, '') + '"]'; }).join('\n') + '\n\n';
    var parts = String(g.startFen || '').split(' ');
    var black = parts[1] === 'b', num = parseInt(parts[5], 10) || 1, words = [];
    g.sans.forEach(function (s, i) {
      if (!black) words.push(num + '.');
      else if (i === 0) words.push(num + '...');
      words.push(s);
      if (black) num++;
      black = !black;
    });
    words.push(res);
    var line = '';
    words.forEach(function (w) {
      if (line.length + w.length + 1 > 78) { out += line + '\n'; line = w; }
      else line += (line ? ' ' : '') + w;
    });
    return out + line + '\n';
  }

  function sparkHtml(history) {
    if (history.length < 2) return '<p class="muted">Finish a game to start your rating history.</p>';
    var W = 600, H = 140, L = 44, Rr = 12, T = 12, Bm = 22;
    var lo = Math.min.apply(null, history), hi = Math.max.apply(null, history);
    if (hi - lo < 20) { hi += 10; lo -= 10; }
    var n = history.length - 1;
    function x(i) { return L + (W - L - Rr) * i / n; }
    function y(v) { return T + (H - T - Bm) * (1 - (v - lo) / (hi - lo)); }
    var pts = history.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    var last = history[n];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Rating after each game">' +
      '<line x1="' + L + '" y1="' + y(hi) + '" x2="' + (W - Rr) + '" y2="' + y(hi) + '" style="stroke:var(--line)"/>' +
      '<line x1="' + L + '" y1="' + y(lo) + '" x2="' + (W - Rr) + '" y2="' + y(lo) + '" style="stroke:var(--line)"/>' +
      '<text class="axis" x="' + (L - 6) + '" y="' + (y(hi) + 4) + '" text-anchor="end">' + Math.round(hi) + '</text>' +
      '<text class="axis" x="' + (L - 6) + '" y="' + (y(lo) + 4) + '" text-anchor="end">' + Math.round(lo) + '</text>' +
      '<text class="axis" x="' + L + '" y="' + (H - 4) + '">start</text>' +
      '<text class="axis" x="' + (W - Rr) + '" y="' + (H - 4) + '" text-anchor="end">game ' + n + '</text>' +
      '<polyline points="' + pts + '" style="fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"/>' +
      '<circle cx="' + x(n).toFixed(1) + '" cy="' + y(last).toFixed(1) + '" r="4" style="fill:var(--accent)"/>' +
      '</svg>';
  }

  function statHtml(k, v, s) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s || '&nbsp;') + '</div></div>';
  }

  function renderDash() {
    var s = computeStats(store.games);
    var rate = s.n ? Math.round(100 * s.w / s.n) + '%' : '-';
    var streak = '-';
    if (s.streak) {
      var word = s.streakType === 'win' ? 'win' : (s.streakType === 'loss' ? 'loss' : 'draw');
      streak = s.streak + ' ' + word + (s.streak === 1 ? '' : (word === 'loss' ? 'es' : 's'));
    }
    $('stats').innerHTML =
      statHtml('Estimated rating', Math.round(s.rating), 'peak ' + Math.round(s.peak) + ', starts at ' + START_RATING) +
      statHtml('Games', s.n, '<span class="w-c">' + s.w + ' W</span> / <span class="d-c">' + s.d + ' D</span> / <span class="l-c">' + s.l + ' L</span>') +
      statHtml('Win rate', rate, s.n ? s.w + ' of ' + s.n + ' won' : 'no games yet') +
      statHtml('Current streak', streak, 'best win streak ' + s.bestWinStreak);

    $('spark').innerHTML = sparkHtml(s.history);

    var rows = '<tr><th>Bot</th><th class="num">Played</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Score</th></tr>';
    BOTS.forEach(function (b) {
      var r = s.perBot[b.elo];
      rows += '<tr><td>' + esc(b.name) + ' <span class="muted">~' + b.elo + '</span></td><td class="num">' + r.n +
        '</td><td class="num">' + r.w + '</td><td class="num">' + r.d + '</td><td class="num">' + r.l +
        '</td><td class="num">' + (r.n ? Math.round(100 * (r.w + r.d / 2) / r.n) + '%' : '-') + '</td></tr>';
    });
    $('bot-table').innerHTML = rows;

    var games = $('games');
    if (!store.games.length) {
      games.innerHTML = '<p class="muted">No finished games yet. They will show up here with a move-by-move replay.</p>';
    } else {
      var html = '<div class="games-wrap"><table><tr><th>Date</th><th>Opponent</th><th>You played</th><th>Result</th>' +
        '<th class="num">Moves</th><th>Ended by</th><th class="num">Rating</th></tr>';
      for (var i = store.games.length - 1; i >= 0; i--) {
        var g = store.games[i], pg = s.perGame[i], delta = Math.round(pg.after) - Math.round(pg.before);
        html += '<tr class="game' + (replay && replay.g.id === g.id ? ' open' : '') + '" data-game="' + i + '" tabindex="0">' +
          '<td>' + esc(fmtDate(g.endedAt)) + '</td>' +
          '<td>' + esc(botName(g.bot)) + ' <span class="muted">~' + g.bot + '</span></td>' +
          '<td>' + (g.color === 'w' ? 'White' : 'Black') + '</td>' +
          '<td><span class="pill ' + g.result + '">' + { win: 'Win', loss: 'Loss', draw: 'Draw' }[g.result] + '</span></td>' +
          '<td class="num">' + Math.ceil(g.moves.length / 2) + '</td>' +
          '<td>' + esc(g.reason) + '</td>' +
          '<td class="num">' + Math.round(pg.after) + ' <span class="muted">(' + (delta >= 0 ? '+' : '') + delta + ')</span></td></tr>';
      }
      games.innerHTML = html + '</table></div>';
    }
    renderReplay();
  }

  function openReplay(g) {
    var fens = [], lasts = [null], i, d;
    rcore.load(g.startFen || rcore.START_FEN);
    fens.push(rcore.fen());
    for (i = 0; i < g.moves.length; i++) {
      d = rcore.move(g.moves[i]);
      if (!d) break;
      fens.push(rcore.fen());
      lasts.push([d.from, d.to]);
    }
    replay = { g: g, idx: fens.length - 1, fens: fens, lasts: lasts };
    renderDash();
    $('replay').scrollIntoView({ block: 'nearest' });
  }

  function replayGo(idx) {
    if (!replay) return;
    replay.idx = Math.max(0, Math.min(replay.fens.length - 1, idx));
    renderReplay();
  }

  function renderReplay() {
    var box = $('replay');
    if (!replay || store.games.indexOf(replay.g) < 0) { replay = null; box.hidden = true; return; }
    box.hidden = false;
    var g = replay.g;
    $('replay-title').textContent = { win: 'Win', loss: 'Loss', draw: 'Draw' }[g.result] + ' as ' +
      (g.color === 'w' ? 'White' : 'Black') + ' against ' + botName(g.bot) + ' (~' + g.bot + '), ' + fmtDate(g.endedAt);
    rcore.load(replay.fens[replay.idx]);
    drawBoard($('replay-board'), rcore, {
      orient: g.color, last: replay.lasts[replay.idx],
      check: rcore.inCheck() ? rcore.kingSquare(rcore.turn()) : null
    });
    $('replay-pos').textContent = 'Move ' + replay.idx + ' of ' + (replay.fens.length - 1);
    var list = $('replay-moves');
    list.innerHTML = movesHtml(g.sans, replay.idx - 1, g.startFen, true);
    var cur = list.querySelector('.cur');
    if (cur) list.scrollTop = Math.max(0, cur.offsetTop - list.offsetTop - list.clientHeight / 2);
    else list.scrollTop = 0;
    $('replay-pgn').value = buildPgn(g);
  }

  function copyPgn() {
    var ta = $('replay-pgn'), btn = $('replay-copy');
    function done(ok) {
      btn.textContent = ok ? 'Copied' : 'Select the text above and copy it';
      setTimeout(function () { btn.textContent = 'Copy PGN'; }, 1800);
    }
    function legacy() {
      var ok = false;
      try { ta.focus(); ta.select(); ok = document.execCommand('copy'); } catch (e) { ok = false; }
      done(ok);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(function () { done(true); }, legacy);
        return;
      }
    } catch (e) { /* fall through */ }
    legacy();
  }

  // ---------------------------------------------------------- data in/out
  function exportData() {
    var data = JSON.stringify({ app: 'chess-offline', version: 1, exportedAt: new Date().toISOString(), games: store.games }, null, 1);
    try {
      var url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = 'chess-stats-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      $('data-msg').textContent = 'Exported ' + store.games.length + ' games.';
    } catch (e) {
      $('data-msg').textContent = 'Export failed in this browser.';
    }
  }

  // Merge by game id, keep date order. Returns a message for the user.
  function importData(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { return 'That file is not valid JSON.'; }
    var list = Array.isArray(d) ? d : (d && Array.isArray(d.games) ? d.games : null);
    if (!list) return 'No games found in that file.';
    var have = {}, added = 0, skipped = 0;
    store.games.forEach(function (g) { have[g.id] = true; });
    list.forEach(function (raw) {
      var g = cleanGame(raw);
      if (!g) { skipped++; return; }
      if (have[g.id]) return;
      have[g.id] = true;
      store.games.push(g);
      added++;
    });
    store.games.sort(function (a, b) { return a.endedAt < b.endedAt ? -1 : (a.endedAt > b.endedAt ? 1 : 0); });
    saveStore();
    return 'Imported ' + added + ' new game' + (added === 1 ? '' : 's') +
      (skipped ? ', skipped ' + skipped + ' that could not be read' : '') + '.';
  }

  // ---------------------------------------------------------------- modal
  var modalOk = null;
  function askConfirm(text, okLabel, onOk) {
    $('modal-text').textContent = text;
    $('modal-ok').textContent = okLabel;
    modalOk = onOk;
    $('modal').hidden = false;
    $('modal-ok').focus();
  }
  function closeModal() { $('modal').hidden = true; modalOk = null; }

  // ------------------------------------------------------------------ init
  function showTab(name) {
    tab = name;
    $('tab-play').hidden = name !== 'play';
    $('tab-dash').hidden = name !== 'dash';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    if (name === 'dash') renderDash(); else renderPlay();
  }

  function init() {
    injectPieceSymbols();
    boardEl = $('board');
    loadStore();
    $('storage-warning').hidden = storageOk;

    $('bot-picker').innerHTML = BOTS.map(function (b) {
      return '<button type="button" data-bot="' + b.elo + '">' + esc(b.name) + '<small>~' + b.elo + ' Elo</small></button>';
    }).join('');

    $('bot-picker').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      store.prefs.bot = +b.getAttribute('data-bot');
      saveStore(); renderPlay();
    });
    $('color-picker').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      store.prefs.color = b.getAttribute('data-color');
      saveStore(); renderPlay();
    });
    $('btn-new').addEventListener('click', function () {
      if (game && !game.over && playerMoved()) {
        askConfirm('Resign the current game and start a new one? It will count as a loss.', 'Resign and start', function () {
          finish('loss', 'resignation');
          startGame();
        });
      } else {
        startGame();
      }
    });
    $('btn-resign').addEventListener('click', function () {
      if (!game || game.over) return;
      if (!playerMoved()) { resign(); return; }
      askConfirm('Resign this game?', 'Resign', resign);
    });

    boardEl.addEventListener('pointerdown', onPointerDown);
    boardEl.addEventListener('pointermove', onPointerMove);
    boardEl.addEventListener('pointerup', onPointerUp);
    boardEl.addEventListener('pointercancel', onPointerUp);
    boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
    });

    $('games').addEventListener('click', function (e) {
      var row = e.target.closest('tr.game');
      if (row) openReplay(store.games[+row.getAttribute('data-game')]);
    });
    $('games').addEventListener('keydown', function (e) {
      var row = e.target.closest('tr.game');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openReplay(store.games[+row.getAttribute('data-game')]); }
    });
    $('replay-close').addEventListener('click', function () { replay = null; renderDash(); });
    document.querySelector('.replay-nav').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !replay) return;
      var nav = b.getAttribute('data-nav');
      replayGo(nav === 'start' ? 0 : nav === 'end' ? replay.fens.length - 1 : replay.idx + (nav === 'next' ? 1 : -1));
    });
    $('replay-moves').addEventListener('click', function (e) {
      var m = e.target.closest('[data-ply]');
      if (m) replayGo(+m.getAttribute('data-ply'));
    });
    $('replay-copy').addEventListener('click', copyPgn);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('modal').hidden) { closeModal(); return; }
      if (tab !== 'dash' || !replay || !$('modal').hidden) return;
      if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); replayGo(replay.idx - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); replayGo(replay.idx + 1); }
      else if (e.key === 'Home') { e.preventDefault(); replayGo(0); }
      else if (e.key === 'End') { e.preventDefault(); replayGo(replay.fens.length - 1); }
    });

    $('btn-export').addEventListener('click', exportData);
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      var file = this.files && this.files[0], input = this;
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { $('data-msg').textContent = importData(String(reader.result)); input.value = ''; renderDash(); };
      reader.onerror = function () { $('data-msg').textContent = 'Could not read that file.'; input.value = ''; };
      reader.readAsText(file);
    });
    $('btn-clear').addEventListener('click', function () {
      askConfirm('Delete every saved game and reset your rating? This cannot be undone.', 'Delete everything', function () {
        store.games = []; replay = null;
        saveStore(); renderDash();
        $('data-msg').textContent = 'All saved games were deleted.';
      });
    });

    $('modal-cancel').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    $('modal-ok').addEventListener('click', function () { var fn = modalOk; closeModal(); if (fn) fn(); });

    if (!resume()) { store.current = null; }
    renderPlay();

    // Small handle for automated checks; the page itself never reads it.
    window.ChessApp = {
      state: function () {
        return {
          game: game ? { bot: game.bot, color: game.color, moves: game.moves.slice(), sans: game.sans.slice(), over: game.over, summary: game.summary } : null,
          thinking: thinking, fen: core.fen(), games: store.games.length,
          rating: computeStats(store.games).rating, worker: runner ? runner.usingWorker() : null, storageOk: storageOk
        };
      },
      importData: importData,
      buildPgn: buildPgn
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
