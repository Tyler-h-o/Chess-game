/*
 * ChessCore: a self-contained chess rules engine and search.
 *
 * The whole thing lives inside one factory function with no references to
 * outer scope, so `ChessCore.toString()` can be shipped into a Web Worker
 * built from a Blob (which works from file://).
 *
 * Board: 0x88 (square = rank * 16 + file, a1 = 0, h8 = 119).
 * Pieces: integers, type 1..6 (P N B R Q K), plus 8 for black.
 * Moves: integers, from | to << 7 | promo << 14 | flags << 17.
 */
function ChessCore() {
  'use strict';

  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var PIECE_CHARS = ' PNBRQK  pnbrqk';
  var FILES = 'abcdefgh';
  var F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;

  var KNIGHT_D = [-33, -31, -18, -14, 14, 18, 31, 33];
  var KING_D = [-17, -16, -15, -1, 1, 15, 16, 17];
  var BISHOP_D = [-17, -15, 15, 17];
  var ROOK_D = [-16, -1, 1, 16];

  // ---------------------------------------------------------------- Zobrist
  var seed = 0x2545F491;
  function rnd32() {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed | 0;
  }
  var zPieceLo = new Int32Array(16 * 128), zPieceHi = new Int32Array(16 * 128);
  var zCastleLo = new Int32Array(16), zCastleHi = new Int32Array(16);
  var zEpLo = new Int32Array(8), zEpHi = new Int32Array(8);
  var zi;
  for (zi = 0; zi < 16 * 128; zi++) { zPieceLo[zi] = rnd32(); zPieceHi[zi] = rnd32(); }
  for (zi = 0; zi < 16; zi++) { zCastleLo[zi] = rnd32(); zCastleHi[zi] = rnd32(); }
  for (zi = 0; zi < 8; zi++) { zEpLo[zi] = rnd32(); zEpHi[zi] = rnd32(); }
  var zSideLo = rnd32(), zSideHi = rnd32();

  // Castling rights: 1 = white king side, 2 = white queen side, 4 / 8 = black.
  var castleMask = new Int8Array(128);
  for (zi = 0; zi < 128; zi++) castleMask[zi] = 15;
  castleMask[0] = 15 & ~2; castleMask[4] = 15 & ~3; castleMask[7] = 15 & ~1;
  castleMask[112] = 15 & ~8; castleMask[116] = 15 & ~12; castleMask[119] = 15 & ~4;

  // ------------------------------------------------------------------ state
  var board = new Int8Array(128);
  var side = 0, castling = 0, ep = -1, halfmove = 0, fullmove = 1;
  var hLo = 0, hHi = 0;
  var kingSq = [4, 116];
  // Undo stack. stLo / stHi (the hash before each move) double as the
  // position history used for repetition detection.
  var stMove = [], stCap = [], stCastle = [], stEp = [], stHalf = [], stLo = [], stHi = [];
  var hply = 0;

  function xr(piece, sq) {
    var i = piece * 128 + sq;
    hLo ^= zPieceLo[i]; hHi ^= zPieceHi[i];
  }

  function computeHash() {
    hLo = 0; hHi = 0;
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (board[sq]) xr(board[sq], sq);
    }
    hLo ^= zCastleLo[castling]; hHi ^= zCastleHi[castling];
    if (ep >= 0) { hLo ^= zEpLo[ep & 7]; hHi ^= zEpHi[ep & 7]; }
    if (side) { hLo ^= zSideLo; hHi ^= zSideHi; }
  }

  function sqName(sq) { return FILES.charAt(sq & 7) + ((sq >> 4) + 1); }
  function sqFromName(s) {
    if (typeof s !== 'string' || s.length !== 2) return -1;
    var f = s.charCodeAt(0) - 97, r = s.charCodeAt(1) - 49;
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return r * 16 + f;
  }

  // -------------------------------------------------------------------- FEN
  function load(fen) {
    var parts = String(fen).trim().split(/\s+/);
    if (parts.length < 2) return false;
    var rows = parts[0].split('/');
    if (rows.length !== 8) return false;
    var nb = new Int8Array(128), ks = [-1, -1], r, f, i, ch, pc, sq;
    for (r = 0; r < 8; r++) {
      f = 0;
      for (i = 0; i < rows[r].length; i++) {
        ch = rows[r].charAt(i);
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        pc = PIECE_CHARS.indexOf(ch);
        if (pc < 1 || f > 7) return false;
        sq = (7 - r) * 16 + f;
        nb[sq] = pc;
        if ((pc & 7) === K) {
          if (ks[pc >> 3] >= 0) return false;
          ks[pc >> 3] = sq;
        }
        f++;
      }
      if (f !== 8) return false;
    }
    if (ks[0] < 0 || ks[1] < 0) return false;
    if (parts[1] !== 'w' && parts[1] !== 'b') return false;

    board = nb;
    kingSq = ks;
    side = parts[1] === 'w' ? 0 : 1;
    castling = 0;
    var c = parts[2] || '-';
    if (c.indexOf('K') >= 0 && board[4] === 6 && board[7] === 4) castling |= 1;
    if (c.indexOf('Q') >= 0 && board[4] === 6 && board[0] === 4) castling |= 2;
    if (c.indexOf('k') >= 0 && board[116] === 14 && board[119] === 12) castling |= 4;
    if (c.indexOf('q') >= 0 && board[116] === 14 && board[112] === 12) castling |= 8;
    ep = -1;
    var e = sqFromName(parts[3] || '-');
    if (e >= 0) {
      // Keep the en passant square only when a capture is actually possible,
      // so that repetition detection compares like with like.
      var capSq = e + (side === 0 ? -16 : 16);
      var theirs = P | ((side ^ 1) << 3), ours = P | (side << 3);
      if (!(capSq & 0x88) && board[capSq] === theirs && !board[e] &&
          ((!((capSq - 1) & 0x88) && board[capSq - 1] === ours) ||
           (!((capSq + 1) & 0x88) && board[capSq + 1] === ours))) ep = e;
    }
    halfmove = Math.max(0, parseInt(parts[4], 10) || 0);
    fullmove = Math.max(1, parseInt(parts[5], 10) || 1);
    stMove = []; stCap = []; stCastle = []; stEp = []; stHalf = []; stLo = []; stHi = [];
    hply = 0;
    computeHash();
    return true;
  }

  function fen() {
    var out = '', r, f, empty, p;
    for (r = 7; r >= 0; r--) {
      empty = 0;
      for (f = 0; f < 8; f++) {
        p = board[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += PIECE_CHARS.charAt(p);
      }
      if (empty) out += empty;
      if (r) out += '/';
    }
    var c = '';
    if (castling & 1) c += 'K';
    if (castling & 2) c += 'Q';
    if (castling & 4) c += 'k';
    if (castling & 8) c += 'q';
    return out + (side ? ' b ' : ' w ') + (c || '-') + ' ' + (ep >= 0 ? sqName(ep) : '-') +
      ' ' + halfmove + ' ' + fullmove;
  }

  // ---------------------------------------------------------------- attacks
  function attacked(sq, by) {
    var i, to, p, d;
    if (by === 0) {
      to = sq - 15; if (!(to & 0x88) && board[to] === 1) return true;
      to = sq - 17; if (!(to & 0x88) && board[to] === 1) return true;
    } else {
      to = sq + 15; if (!(to & 0x88) && board[to] === 9) return true;
      to = sq + 17; if (!(to & 0x88) && board[to] === 9) return true;
    }
    var c = by << 3, kn = N | c, kg = K | c, bi = B | c, rk = R | c, qu = Q | c;
    for (i = 0; i < 8; i++) {
      to = sq + KNIGHT_D[i];
      if (!(to & 0x88) && board[to] === kn) return true;
      to = sq + KING_D[i];
      if (!(to & 0x88) && board[to] === kg) return true;
    }
    for (i = 0; i < 4; i++) {
      d = BISHOP_D[i];
      for (to = sq + d; !(to & 0x88); to += d) {
        p = board[to];
        if (p) { if (p === bi || p === qu) return true; break; }
      }
      d = ROOK_D[i];
      for (to = sq + d; !(to & 0x88); to += d) {
        p = board[to];
        if (p) { if (p === rk || p === qu) return true; break; }
      }
    }
    return false;
  }

  function inCheck() { return attacked(kingSq[side], side ^ 1); }

  // ------------------------------------------------------- move generation
  function addPawn(moves, from, to, flags, last, capsOnly) {
    var base = from | (to << 7) | (flags << 17);
    if ((to >> 4) === last) {
      moves.push(base | (Q << 14));
      if (!capsOnly) {
        moves.push(base | (R << 14));
        moves.push(base | (B << 14));
        moves.push(base | (N << 14));
      }
    } else {
      moves.push(base);
    }
  }

  // Pseudo-legal moves. With capsOnly: captures plus queen promotions.
  function gen(capsOnly) {
    var moves = [], us = side, them = us ^ 1;
    var sq, p, t, i, d, to, tp, dirs;
    for (sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = board[sq];
      if (!p || (p >> 3) !== us) continue;
      t = p & 7;
      if (t === P) {
        var dir = us === 0 ? 16 : -16, last = us === 0 ? 7 : 0, start = us === 0 ? 1 : 6;
        to = sq + dir;
        if (!(to & 0x88) && !board[to]) {
          if ((to >> 4) === last) {
            addPawn(moves, sq, to, 0, last, capsOnly);
          } else if (!capsOnly) {
            moves.push(sq | (to << 7));
            if ((sq >> 4) === start && !board[to + dir]) {
              moves.push(sq | ((to + dir) << 7) | (F_DOUBLE << 17));
            }
          }
        }
        for (i = -1; i <= 1; i += 2) {
          to = sq + dir + i;
          if (to & 0x88) continue;
          tp = board[to];
          if (tp) {
            if ((tp >> 3) === them) addPawn(moves, sq, to, F_CAPTURE, last, capsOnly);
          } else if (to === ep) {
            moves.push(sq | (to << 7) | ((F_CAPTURE | F_EP) << 17));
          }
        }
      } else if (t === N || t === K) {
        dirs = t === N ? KNIGHT_D : KING_D;
        for (i = 0; i < 8; i++) {
          to = sq + dirs[i];
          if (to & 0x88) continue;
          tp = board[to];
          if (!tp) { if (!capsOnly) moves.push(sq | (to << 7)); }
          else if ((tp >> 3) === them) moves.push(sq | (to << 7) | (F_CAPTURE << 17));
        }
      } else {
        dirs = t === B ? BISHOP_D : (t === R ? ROOK_D : KING_D);
        for (i = 0; i < dirs.length; i++) {
          d = dirs[i];
          for (to = sq + d; !(to & 0x88); to += d) {
            tp = board[to];
            if (!tp) { if (!capsOnly) moves.push(sq | (to << 7)); continue; }
            if ((tp >> 3) === them) moves.push(sq | (to << 7) | (F_CAPTURE << 17));
            break;
          }
        }
      }
    }
    if (!capsOnly) {
      if (us === 0) {
        if ((castling & 1) && !board[5] && !board[6] &&
            !attacked(4, 1) && !attacked(5, 1)) moves.push(4 | (6 << 7) | (F_CASTLE << 17));
        if ((castling & 2) && !board[3] && !board[2] && !board[1] &&
            !attacked(4, 1) && !attacked(3, 1)) moves.push(4 | (2 << 7) | (F_CASTLE << 17));
      } else {
        if ((castling & 4) && !board[117] && !board[118] &&
            !attacked(116, 0) && !attacked(117, 0)) moves.push(116 | (118 << 7) | (F_CASTLE << 17));
        if ((castling & 8) && !board[115] && !board[114] && !board[113] &&
            !attacked(116, 0) && !attacked(115, 0)) moves.push(116 | (114 << 7) | (F_CASTLE << 17));
      }
    }
    return moves;
  }

  function make(m) {
    var from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    var us = side, piece = board[from], cap = board[to];
    stMove[hply] = m; stCastle[hply] = castling; stEp[hply] = ep; stHalf[hply] = halfmove;
    stLo[hply] = hLo; stHi[hply] = hHi;
    if (flags & F_EP) {
      var cs = to + (us === 0 ? -16 : 16);
      cap = board[cs]; board[cs] = 0; xr(cap, cs);
    } else if (cap) {
      xr(cap, to);
    }
    stCap[hply] = cap;
    hply++;
    board[from] = 0; xr(piece, from);
    var placed = promo ? (promo | (us << 3)) : piece;
    board[to] = placed; xr(placed, to);
    if ((piece & 7) === K) {
      kingSq[us] = to;
      if (flags & F_CASTLE) {
        var rf, rt;
        if (to > from) { rf = to + 1; rt = to - 1; } else { rf = to - 2; rt = to + 1; }
        var rk = board[rf];
        board[rf] = 0; board[rt] = rk; xr(rk, rf); xr(rk, rt);
      }
    }
    if (ep >= 0) { hLo ^= zEpLo[ep & 7]; hHi ^= zEpHi[ep & 7]; ep = -1; }
    if (flags & F_DOUBLE) {
      var enemyPawn = P | ((us ^ 1) << 3);
      if ((!((to - 1) & 0x88) && board[to - 1] === enemyPawn) ||
          (!((to + 1) & 0x88) && board[to + 1] === enemyPawn)) {
        ep = (from + to) >> 1;
        hLo ^= zEpLo[ep & 7]; hHi ^= zEpHi[ep & 7];
      }
    }
    var nc = castling & castleMask[from] & castleMask[to];
    if (nc !== castling) {
      hLo ^= zCastleLo[castling] ^ zCastleLo[nc]; hHi ^= zCastleHi[castling] ^ zCastleHi[nc];
      castling = nc;
    }
    halfmove = ((piece & 7) === P || cap) ? 0 : halfmove + 1;
    if (us === 1) fullmove++;
    side = us ^ 1;
    hLo ^= zSideLo; hHi ^= zSideHi;
  }

  function unmake() {
    hply--;
    var m = stMove[hply];
    var from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    side ^= 1;
    var us = side;
    castling = stCastle[hply]; ep = stEp[hply]; halfmove = stHalf[hply];
    hLo = stLo[hply]; hHi = stHi[hply];
    if (us === 1) fullmove--;
    var piece = promo ? (P | (us << 3)) : board[to];
    var cap = stCap[hply];
    board[from] = piece;
    if (flags & F_EP) {
      board[to] = 0;
      board[to + (us === 0 ? -16 : 16)] = cap;
    } else {
      board[to] = cap;
    }
    if ((piece & 7) === K) {
      kingSq[us] = from;
      if (flags & F_CASTLE) {
        if (to > from) { board[to + 1] = board[to - 1]; board[to - 1] = 0; }
        else { board[to - 2] = board[to + 1]; board[to + 1] = 0; }
      }
    }
  }

  function makeNull() {
    stMove[hply] = 0; stCap[hply] = 0; stCastle[hply] = castling; stEp[hply] = ep;
    stHalf[hply] = halfmove; stLo[hply] = hLo; stHi[hply] = hHi;
    hply++;
    if (ep >= 0) { hLo ^= zEpLo[ep & 7]; hHi ^= zEpHi[ep & 7]; ep = -1; }
    halfmove = 0;
    side ^= 1;
    hLo ^= zSideLo; hHi ^= zSideHi;
  }

  function unmakeNull() {
    hply--;
    side ^= 1;
    ep = stEp[hply]; halfmove = stHalf[hply]; hLo = stLo[hply]; hHi = stHi[hply];
  }

  function legalMoves() {
    var ms = gen(false), out = [], us = side, i;
    for (i = 0; i < ms.length; i++) {
      make(ms[i]);
      if (!attacked(kingSq[us], us ^ 1)) out.push(ms[i]);
      unmake();
    }
    return out;
  }

  function perft(depth) {
    if (depth <= 0) return 1;
    var ms = gen(false), us = side, n = 0, i;
    for (i = 0; i < ms.length; i++) {
      make(ms[i]);
      if (!attacked(kingSq[us], us ^ 1)) n += depth === 1 ? 1 : perft(depth - 1);
      unmake();
    }
    return n;
  }

  // ----------------------------------------------------------------- draws
  // How many earlier positions in this game match the current one.
  function repCount() {
    var c = 0, lim = hply - halfmove, i;
    if (lim < 0) lim = 0;
    for (i = hply - 2; i >= lim; i -= 2) {
      if (stLo[i] === hLo && stHi[i] === hHi) c++;
    }
    return c;
  }

  function insufficient() {
    var knights = 0, bishops = 0, lightB = 0, sq, p, t;
    for (sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = board[sq];
      if (!p) continue;
      t = p & 7;
      if (t === P || t === R || t === Q) return false;
      if (t === N) knights++;
      else if (t === B) { bishops++; if (((sq >> 4) + (sq & 7)) & 1) lightB++; }
    }
    if (knights === 0) return lightB === 0 || lightB === bishops;
    return knights === 1 && bishops === 0;
  }

  function status() {
    var moves = legalMoves(), chk = inCheck();
    if (!moves.length) {
      if (chk) return { over: true, result: side === 0 ? '0-1' : '1-0', reason: 'checkmate', check: true };
      return { over: true, result: '1/2-1/2', reason: 'stalemate', check: false };
    }
    if (insufficient()) return { over: true, result: '1/2-1/2', reason: 'insufficient material', check: chk };
    if (halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule', check: chk };
    if (repCount() >= 2) return { over: true, result: '1/2-1/2', reason: 'threefold repetition', check: chk };
    return { over: false, result: null, reason: null, check: chk };
  }

  // ------------------------------------------------------------- notation
  function uci(m) {
    var promo = (m >> 14) & 7;
    return sqName(m & 127) + sqName((m >> 7) & 127) + (promo ? ' pnbrqk'.charAt(promo) : '');
  }

  function findMove(str) {
    var ms = legalMoves(), i;
    str = String(str).toLowerCase();
    for (i = 0; i < ms.length; i++) if (uci(ms[i]) === str) return ms[i];
    return 0;
  }

  // SAN for a legal move in the current position.
  function san(m, legal) {
    var from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flags = m >> 17;
    var t = board[from] & 7, s = '', i, o, of;
    if (flags & F_CASTLE) {
      s = to > from ? 'O-O' : 'O-O-O';
    } else {
      if (t === P) {
        if (flags & F_CAPTURE) s = FILES.charAt(from & 7) + 'x';
      } else {
        s = PIECE_CHARS.charAt(t);
        legal = legal || legalMoves();
        var clash = false, sameFile = false, sameRank = false;
        for (i = 0; i < legal.length; i++) {
          o = legal[i]; of = o & 127;
          if (of === from || ((o >> 7) & 127) !== to || (board[of] & 7) !== t) continue;
          clash = true;
          if ((of & 7) === (from & 7)) sameFile = true;
          if ((of >> 4) === (from >> 4)) sameRank = true;
        }
        if (clash) {
          if (!sameFile) s += FILES.charAt(from & 7);
          else if (!sameRank) s += (from >> 4) + 1;
          else s += sqName(from);
        }
        if (flags & F_CAPTURE) s += 'x';
      }
      s += sqName(to);
      if (promo) s += '=' + PIECE_CHARS.charAt(promo);
    }
    make(m);
    if (inCheck()) s += legalMoves().length ? '+' : '#';
    unmake();
    return s;
  }

  function describe(m) {
    var flags = m >> 17, promo = (m >> 14) & 7;
    return {
      from: sqName(m & 127), to: sqName((m >> 7) & 127),
      promo: promo ? ' pnbrqk'.charAt(promo) : '',
      uci: uci(m),
      piece: PIECE_CHARS.charAt(board[m & 127]),
      capture: !!(flags & F_CAPTURE), castle: !!(flags & F_CASTLE), ep: !!(flags & F_EP)
    };
  }

  // ------------------------------------------------------------ evaluation
  var VALUE = [0, 100, 320, 330, 500, 900, 0];
  var PHASE = [0, 0, 1, 1, 2, 4, 0];
  // Piece-square tables, written from White's side with rank 8 on top.
  var PST = [null,
    [0, 0, 0, 0, 0, 0, 0, 0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
     5, 5, 10, 25, 25, 10, 5, 5,
     0, 0, 0, 20, 20, 0, 0, 0,
     5, -5, -10, 0, 0, -10, -5, 5,
     5, 10, 10, -20, -20, 10, 10, 5,
     0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50,
     -40, -20, 0, 0, 0, 0, -20, -40,
     -30, 0, 10, 15, 15, 10, 0, -30,
     -30, 5, 15, 20, 20, 15, 5, -30,
     -30, 0, 15, 20, 20, 15, 0, -30,
     -30, 5, 10, 15, 15, 10, 5, -30,
     -40, -20, 0, 5, 5, 0, -20, -40,
     -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20,
     -10, 0, 0, 0, 0, 0, 0, -10,
     -10, 0, 5, 10, 10, 5, 0, -10,
     -10, 5, 5, 10, 10, 5, 5, -10,
     -10, 0, 10, 10, 10, 10, 0, -10,
     -10, 10, 10, 10, 10, 10, 10, -10,
     -10, 5, 0, 0, 0, 0, 5, -10,
     -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0,
     5, 10, 10, 10, 10, 10, 10, 5,
     -5, 0, 0, 0, 0, 0, 0, -5,
     -5, 0, 0, 0, 0, 0, 0, -5,
     -5, 0, 0, 0, 0, 0, 0, -5,
     -5, 0, 0, 0, 0, 0, 0, -5,
     -5, 0, 0, 0, 0, 0, 0, -5,
     0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20,
     -10, 0, 0, 0, 0, 0, 0, -10,
     -10, 0, 5, 5, 5, 5, 0, -10,
     -5, 0, 5, 5, 5, 5, 0, -5,
     0, 0, 5, 5, 5, 5, 0, -5,
     -10, 5, 5, 5, 5, 5, 0, -10,
     -10, 0, 5, 0, 0, 0, 0, -10,
     -20, -10, -10, -5, -5, -10, -10, -20]
  ];
  var KING_MG = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20];
  var KING_EG = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50];

  // sqScore[piece * 128 + sq]: material plus PST, signed (+ white, - black).
  var sqScore = new Int16Array(16 * 128);
  var kingMg = new Int16Array(2 * 128), kingEg = new Int16Array(2 * 128);
  (function () {
    var r, f, t, sq, wi, bi;
    for (r = 0; r < 8; r++) for (f = 0; f < 8; f++) {
      sq = r * 16 + f; wi = (7 - r) * 8 + f; bi = r * 8 + f;
      for (t = P; t <= Q; t++) {
        sqScore[t * 128 + sq] = VALUE[t] + PST[t][wi];
        sqScore[(t | 8) * 128 + sq] = -(VALUE[t] + PST[t][bi]);
      }
      kingMg[sq] = KING_MG[wi]; kingMg[128 + sq] = KING_MG[bi];
      kingEg[sq] = KING_EG[wi]; kingEg[128 + sq] = KING_EG[bi];
    }
  })();

  // Static evaluation in centipawns from the side to move's point of view.
  function evaluate() {
    var score = 0, phase = 0, pawns = 0, sq, p, t;
    for (sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = board[sq];
      if (!p) continue;
      t = p & 7;
      if (t === K) continue;
      score += sqScore[p * 128 + sq];
      phase += PHASE[t];
      if (t === P) pawns++;
    }
    if (!pawns && phase <= 1) return 0; // bare kings or a lone minor piece
    if (phase > 24) phase = 24;
    var wk = kingSq[0], bk = kingSq[1];
    score += ((kingMg[wk] - kingMg[128 + bk]) * phase +
              (kingEg[wk] - kingEg[128 + bk]) * (24 - phase)) / 24 | 0;
    // Mop-up: with a big lead in a thin position, push the losing king to the
    // edge and bring the winning king closer so that basic mates get finished.
    if (phase <= 8 && (score > 400 || score < -400)) {
      var lk = score > 0 ? bk : wk;
      var lf = lk & 7, lr = lk >> 4;
      var edge = (lf < 4 ? 3 - lf : lf - 4) + (lr < 4 ? 3 - lr : lr - 4);
      var df = (wk & 7) - (bk & 7), dr = (wk >> 4) - (bk >> 4);
      var bonus = 10 * edge + 4 * (14 - (df < 0 ? -df : df) - (dr < 0 ? -dr : dr));
      score += score > 0 ? bonus : -bonus;
    }
    return side === 0 ? score : -score;
  }

  // ----------------------------------------------------------------- search
  var MATE = 30000, INF = 32000, MAX_PLY = 64;
  var TT_BITS = 18, TT_MASK = (1 << TT_BITS) - 1;
  var ttLo = null, ttHi, ttMove, ttScore, ttDepth, ttFlag;
  var killers = new Int32Array(MAX_PLY * 2), hist = new Int32Array(16 * 128);
  var nodes = 0, stopTime = 0, stopped = false, useQ = true, lastLevel = -1;

  function clearTT() {
    if (!ttLo) {
      ttLo = new Int32Array(1 << TT_BITS); ttHi = new Int32Array(1 << TT_BITS);
      ttMove = new Int32Array(1 << TT_BITS); ttScore = new Int16Array(1 << TT_BITS);
      ttDepth = new Int8Array(1 << TT_BITS); ttFlag = new Uint8Array(1 << TT_BITS);
    } else {
      ttFlag.fill(0);
    }
  }

  function scoreMoves(moves, ttm, ply) {
    var scores = new Array(moves.length), i, m, flags, s;
    var k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    for (i = 0; i < moves.length; i++) {
      m = moves[i]; flags = m >> 17;
      if (m === ttm) s = 2000000;
      else if (flags & F_CAPTURE) {
        // MVV-LVA: most valuable victim first, least valuable attacker first.
        s = 1000000 + ((flags & F_EP) ? P : (board[(m >> 7) & 127] & 7)) * 16 - (board[m & 127] & 7);
        if ((m >> 14) & 7) s += 500;
      }
      else if ((m >> 14) & 7) s = 950000 + ((m >> 14) & 7);
      else if (m === k1) s = 900000;
      else if (m === k2) s = 800000;
      else s = hist[board[m & 127] * 128 + ((m >> 7) & 127)];
      scores[i] = s;
    }
    return scores;
  }

  function pick(moves, scores, i) {
    var best = i, j, t;
    for (j = i + 1; j < moves.length; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      t = moves[i]; moves[i] = moves[best]; moves[best] = t;
      t = scores[i]; scores[i] = scores[best]; scores[best] = t;
    }
    return moves[i];
  }

  function hasPieces(c) {
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = board[sq];
      if (p && (p >> 3) === c && (p & 7) > P && (p & 7) < K) return true;
    }
    return false;
  }

  function quiesce(alpha, beta, ply) {
    nodes++;
    var stand = evaluate();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply >= MAX_PLY - 1) return stand;
    var moves = gen(true), scores = scoreMoves(moves, 0, ply), us = side, i, sc;
    for (i = 0; i < moves.length; i++) {
      make(pick(moves, scores, i));
      if (attacked(kingSq[us], us ^ 1)) { unmake(); continue; }
      sc = -quiesce(-beta, -alpha, ply + 1);
      unmake();
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, ply, allowNull) {
    if ((nodes++ & 2047) === 0 && stopTime && Date.now() > stopTime) stopped = true;
    if (stopped) return 0;
    if (halfmove >= 100 || repCount() > 0) return 0;
    var us = side, chk = attacked(kingSq[us], us ^ 1);
    if (chk && useQ) depth++;
    if (ply >= MAX_PLY - 1) return evaluate();
    if (depth <= 0) return useQ ? quiesce(alpha, beta, ply) : evaluate();

    var idx = hLo & TT_MASK, ttm = 0, sc;
    if (ttFlag[idx] && ttLo[idx] === hLo && ttHi[idx] === hHi) {
      ttm = ttMove[idx];
      if (ttDepth[idx] >= depth) {
        sc = ttScore[idx];
        if (sc > MATE - 1000) sc -= ply; else if (sc < -MATE + 1000) sc += ply;
        if (ttFlag[idx] === 1) return sc;
        if (ttFlag[idx] === 2 && sc >= beta) return sc;
        if (ttFlag[idx] === 3 && sc <= alpha) return sc;
      }
    }

    if (allowNull && useQ && !chk && depth >= 3 && beta < MATE - 1000 && hasPieces(us)) {
      makeNull();
      sc = -negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
      unmakeNull();
      if (stopped) return 0;
      if (sc >= beta) return beta;
    }

    var moves = gen(false), scores = scoreMoves(moves, ttm, ply);
    var best = -INF, bestMove = 0, legal = 0, a0 = alpha, i, m;
    for (i = 0; i < moves.length; i++) {
      m = pick(moves, scores, i);
      make(m);
      if (attacked(kingSq[us], us ^ 1)) { unmake(); continue; }
      legal++;
      if (legal === 1) {
        sc = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        sc = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (sc > alpha && sc < beta) sc = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      unmake();
      if (stopped) return 0;
      if (sc > best) {
        best = sc; bestMove = m;
        if (sc > alpha) {
          alpha = sc;
          if (sc >= beta) {
            if (!((m >> 17) & F_CAPTURE) && !((m >> 14) & 7)) {
              if (killers[ply * 2] !== m) {
                killers[ply * 2 + 1] = killers[ply * 2];
                killers[ply * 2] = m;
              }
              hist[board[m & 127] * 128 + ((m >> 7) & 127)] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (!legal) return chk ? -MATE + ply : 0;

    sc = best;
    if (sc > MATE - 1000) sc += ply; else if (sc < -MATE + 1000) sc -= ply;
    ttLo[idx] = hLo; ttHi[idx] = hHi; ttMove[idx] = bestMove; ttScore[idx] = sc;
    ttDepth[idx] = depth > 127 ? 127 : depth;
    ttFlag[idx] = best <= a0 ? 3 : (best >= beta ? 2 : 1);
    return best;
  }

  // Iterative deepening with a time limit; used by the strongest bot.
  function searchTimed(maxDepth) {
    var moves = legalMoves();
    if (moves.length === 1) return moves[0];
    var scores = scoreMoves(moves, 0, 0), i, d, sc, alpha, iterBest, best, started = Date.now();
    for (i = 0; i < moves.length; i++) pick(moves, scores, i);
    best = moves[0];
    for (d = 1; d <= maxDepth; d++) {
      alpha = -INF; iterBest = 0;
      for (i = 0; i < moves.length; i++) {
        make(moves[i]);
        if (i === 0) {
          sc = -negamax(d - 1, -INF, -alpha, 1, true);
        } else {
          sc = -negamax(d - 1, -alpha - 1, -alpha, 1, true);
          if (!stopped && sc > alpha) sc = -negamax(d - 1, -INF, -alpha, 1, true);
        }
        unmake();
        if (stopped) break;
        if (sc > alpha) { alpha = sc; iterBest = moves[i]; }
      }
      // A cut-off iteration is still usable: the previous best was searched
      // first, so anything recorded here is at least as good.
      if (iterBest) {
        best = iterBest;
        i = moves.indexOf(best);
        moves.splice(i, 1); moves.unshift(best);
      }
      if (stopped || alpha > MATE - 1000) break;
      if (stopTime && Date.now() - started > (stopTime - started) * 0.55) break;
    }
    return best;
  }

  // Fixed depth, every root move scored exactly, then blurred with noise.
  function searchNoisy(depth, noise) {
    var moves = legalMoves(), best = 0, bestScore = -Infinity, i, sc;
    for (i = 0; i < moves.length; i++) {
      make(moves[i]);
      sc = -negamax(depth - 1, -INF, INF, 1, true);
      unmake();
      sc += (Math.random() * 2 - 1) * noise;
      if (sc > bestScore) { bestScore = sc; best = moves[i]; }
    }
    return best;
  }

  // Approximate, uncalibrated strength settings.
  var LEVELS = {
    500: { depth: 1, q: false, noise: 150, rand: 0.35, time: 0 },
    1000: { depth: 2, q: true, noise: 80, rand: 0.10, time: 0 },
    1500: { depth: 3, q: true, noise: 25, rand: 0.03, time: 0 },
    2000: { depth: 6, q: true, noise: 0, rand: 0, time: 1500 }
  };

  // Choose a move for the side to move. Returns 0 when there is none.
  function think(level, opts) {
    var cfg = LEVELS[level] || LEVELS[1000];
    opts = opts || {};
    var moves = legalMoves();
    if (!moves.length) return 0;
    if (cfg.rand && Math.random() < cfg.rand) return moves[Math.floor(Math.random() * moves.length)];
    if (!ttLo || lastLevel !== level) clearTT();
    lastLevel = level;
    useQ = cfg.q; nodes = 0; stopped = false;
    killers.fill(0); hist.fill(0);
    if (cfg.noise) {
      stopTime = 0;
      return searchNoisy(cfg.depth, cfg.noise);
    }
    stopTime = Date.now() + (opts.time || cfg.time);
    return searchTimed(opts.depth || cfg.depth);
  }

  // Worker protocol: start FEN + UCI move list + level in, UCI move out.
  function botMove(startFen, uciMoves, level, opts) {
    if (!load(startFen || START_FEN)) return null;
    var i, m;
    for (i = 0; uciMoves && i < uciMoves.length; i++) {
      m = findMove(uciMoves[i]);
      if (!m) return null;
      make(m);
    }
    m = think(level, opts);
    return m ? uci(m) : null;
  }

  // ------------------------------------------------------------- public API
  load(START_FEN);

  return {
    START_FEN: START_FEN,
    LEVELS: LEVELS,
    load: load,
    reset: function () { load(START_FEN); },
    fen: fen,
    turn: function () { return side === 0 ? 'w' : 'b'; },
    // FEN letter of the piece on a square such as 'e4', or '' when empty.
    piece: function (name) {
      var sq = sqFromName(name);
      return sq < 0 || !board[sq] ? '' : PIECE_CHARS.charAt(board[sq]);
    },
    kingSquare: function (color) { return sqName(kingSq[color === 'w' ? 0 : 1]); },
    inCheck: inCheck,
    // Legal moves as plain objects, optionally only those from one square.
    moves: function (from) {
      var ms = legalMoves(), out = [], i, d;
      for (i = 0; i < ms.length; i++) {
        d = describe(ms[i]);
        if (!from || d.from === from) out.push(d);
      }
      return out;
    },
    // Play a UCI move ('e2e4', 'e7e8q'). Returns its description with SAN,
    // or null when the move is not legal.
    move: function (str) {
      var m = findMove(str);
      if (!m) return null;
      var d = describe(m);
      d.san = san(m);
      make(m);
      return d;
    },
    undo: function () { if (hply > 0) { unmake(); return true; } return false; },
    status: status,
    perft: perft,
    evaluate: evaluate,
    think: function (level, opts) { var m = think(level, opts); return m ? uci(m) : null; },
    botMove: botMove,
    nodes: function () { return nodes; }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = ChessCore;
