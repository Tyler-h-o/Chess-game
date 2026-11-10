/*
 * Engine checks: perft counts and bot-vs-bot matches.
 *
 * Node:     node tests/engine-tests.js perft
 *           node tests/engine-tests.js match 500 1000 20
 * Browser:  open tests/index.html?t=perft  or  ?t=match&a=500&b=1000&n=20
 */
(function (root) {
  'use strict';
  var Core = typeof ChessCore !== 'undefined' ? ChessCore : require('../src/engine.js');

  var KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  var PERFT = [
    { name: 'start', fen: null, counts: [20, 400, 8902, 197281] },
    { name: 'kiwipete', fen: KIWIPETE, counts: [48, 2039, 97862] },
    { name: 'endgame (pos 3)', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238] },
    { name: 'promotions (pos 5)', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379] }
  ];

  function runPerft() {
    var lines = [], ok = true;
    PERFT.forEach(function (t) {
      var c = Core();
      if (t.fen) c.load(t.fen);
      var fenBefore = c.fen();
      t.counts.forEach(function (want, i) {
        var got = c.perft(i + 1);
        if (got !== want) ok = false;
        lines.push((got === want ? 'ok   ' : 'FAIL ') + t.name + ' depth ' + (i + 1) + ': ' + got + ' (expected ' + want + ')');
      });
      if (c.fen() !== fenBefore) { ok = false; lines.push('FAIL ' + t.name + ': position changed after perft'); }
    });

    // Rules spot checks.
    function check(name, cond) { if (!cond) ok = false; lines.push((cond ? 'ok   ' : 'FAIL ') + name); }
    var c = Core();
    ['f2f3', 'e7e5', 'g2g4'].forEach(function (m) { c.move(m); });
    var mate = c.move('d8h4');
    check('fool\'s mate SAN is Qh4#', mate && mate.san === 'Qh4#');
    check('fool\'s mate status', c.status().reason === 'checkmate' && c.status().result === '0-1');
    c.load('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    check('stalemate', c.status().reason === 'stalemate');
    c.load('8/8/4k3/8/8/3K4/8/6N1 w - - 0 1');
    check('insufficient material (K+N v K)', c.status().reason === 'insufficient material');
    c.load('8/8/4k3/8/8/3K4/8/6R1 w - - 99 80');
    c.move('g1g2');
    check('fifty-move rule', c.status().reason === 'fifty-move rule');
    c.reset();
    ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'].forEach(function (m) { c.move(m); });
    check('no threefold after two occurrences', !c.status().over);
    c.move('f6g8');
    check('threefold repetition', c.status().reason === 'threefold repetition');
    c.load('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    check('castling SAN', c.move('e1g1').san === 'O-O' && c.move('e8c8').san === 'O-O-O');
    check('castling FEN', c.fen() === '2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2');
    c.load('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1');
    c.move('e2e4');
    check('en passant square set', c.fen().split(' ')[3] === 'e3');
    var epm = c.move('d4e3');
    check('en passant capture', epm && epm.ep && epm.san === 'dxe3' && c.piece('e4') === '');
    c.load('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    check('four promotion choices', c.moves('a7').length === 4);
    check('promotion SAN', c.move('a7a8q').san === 'a8=Q+');
    c.load('k7/8/8/8/8/8/4K3/R6R w - - 0 1');
    check('rook disambiguation by file', c.move('a1d1').san === 'Rad1');
    c.load('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    check('bot finds mate in one', c.think(2000, { time: 300 }) === 'a1a8');
    return { ok: ok, text: lines.join('\n') };
  }

  // Material balance in pawns from White's side, used to adjudicate long games.
  function material(c) {
    var v = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }, s = 0, files = 'abcdefgh', f, r, ch;
    for (f = 0; f < 8; f++) for (r = 1; r <= 8; r++) {
      ch = c.piece(files.charAt(f) + r);
      if (ch) s += ch === ch.toUpperCase() ? v[ch.toLowerCase()] : -v[ch];
    }
    return s;
  }

  // One game. Returns 1 (white wins), 0.5, or 0.
  function playGame(white, black, opts) {
    var ref = Core(), bots = [Core(), Core()], moves = [], st, mv, level;
    for (;;) {
      st = ref.status();
      if (st.over) return st.result === '1-0' ? 1 : (st.result === '0-1' ? 0 : 0.5);
      if (moves.length >= 300) {
        var m = material(ref);
        return m >= 3 ? 1 : (m <= -3 ? 0 : 0.5);
      }
      level = ref.turn() === 'w' ? white : black;
      mv = bots[moves.length & 1].botMove(ref.START_FEN, moves, level, opts);
      if (!mv || !ref.move(mv)) throw new Error('bad move ' + mv + ' after ' + moves.join(' '));
      moves.push(mv);
    }
  }

  // A plays B for n games, alternating colours. Score is from B's side.
  function runMatch(a, b, n, opts) {
    var w = 0, d = 0, l = 0, i, r;
    for (i = 0; i < n; i++) {
      r = i % 2 === 0 ? 1 - playGame(a, b, opts) : playGame(b, a, opts);
      if (r === 1) w++; else if (r === 0) l++; else d++;
    }
    return {
      ok: w > l,
      text: 'bot ' + b + ' vs bot ' + a + ' over ' + n + ' games: +' + w + ' =' + d + ' -' + l +
        ' (' + (100 * (w + d / 2) / n).toFixed(0) + '% for ' + b + ')'
    };
  }

  root.EngineTests = { runPerft: runPerft, runMatch: runMatch };

  if (typeof process !== 'undefined' && process.argv && typeof document === 'undefined') {
    var arg = process.argv.slice(2), res;
    if (arg[0] === 'match') res = runMatch(+arg[1] || 500, +arg[2] || 1000, +arg[3] || 20, { time: +arg[4] || 100 });
    else res = runPerft();
    console.log(res.text);
    process.exit(res.ok ? 0 : 1);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
