/*
  EDUCE WEB NETCODE — hand-rolled WebRTC client (no Emscripten, this repo's own
  web stack). Browser twin of server/client/main.go, talking to server/main.go.

  Two channels (Winterpixel split):
    signaling:   WebSocket  -> wss://educe.fly.dev/ws   (auth + SDP/ICE only)
    game data:   RTCDataChannel over the server's ONE UDP port (ICE UDP mux)

  The server is the offerer and creates the channels; the browser accepts them
  via RTCPeerConnection.ondatachannel. STUN is configured exactly like the Go
  test client: behind a NAT the browser needs a reflexive candidate for the
  server to reach it (server advertises its fly dedicated IPv4 — no TURN).

  Opt-in activation from main.js:  educeNet.connect({...})  — the game calls it
  when the player enters multiplayer. ?net=1 (or ?net=<wss://url>) auto-connects
  at boot for testing.*/

export const educeNet = {
  state: 'idle',          // idle | connecting | connected | failed
  peerId: 0,
  reliable: null,         // RTCDataChannel (ordered) — auth/metadata/state-critical
  unreliable: null,       // RTCDataChannel (unordered, no retransmit) — gameplay
  fallback: false,        // WebRTC never connected: game JSON rides the WebSocket
  rx: 0,
  tx: 0,

  _ws: null,
  _pc: null,
  _stun: 'stun:stun.l.google.com:19302',
  _onState: null,
  _onMessage: null,
  _overlay: null,
  _lagMs: 0,              // simulated one-way outbound lag (farmer's client_simulated_lag)
  _fbTimer: null,         // WebRTC connect timeout -> fallback

  connect(opts = {}) {
    if (this.state === 'connecting' || this.state === 'connected') return;
    const url = opts.url || 'wss://educe.fly.dev/ws';
    if (opts.stun) this._stun = opts.stun;
    if (opts.onState) this._onState = opts.onState;
    if (opts.onMessage) this._onMessage = opts.onMessage;
    this._lagMs = opts.lagMs > 0 ? opts.lagMs : 0;
    if (this._lagMs) this._log(`simulated outbound lag ${this._lagMs}ms`);
    this._lossPct = opts.lossPct > 0 ? Math.min(opts.lossPct, 90) : 0;
    if (this._lossPct) this._log(`simulated outbound loss ${this._lossPct}%`);
    this._forceFallback = !!opts.forceFallback; // test hook: skip WebRTC entirely

    this._ensureOverlay();   // #netstatus HUD; without this call it never existed
    this.url = url;          // exposed for the /diag sink (main.js netDiagDrainEvents)
    this._setState('connecting');
    this._log(`connecting to ${url}`);

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this._fail(`bad signaling URL ${url}: ${e.message}`);
      return;
    }
    this._ws = ws;

    ws.onopen = () => {
      // CLIENT_AUTH_REQUEST (mirrors network_message.h) — server replies
      // SERVER_AUTH_RESPONSE then immediately offers WebRTC.
      ws.send(JSON.stringify({
        type: 'CLIENT_AUTH_REQUEST',
        data: { name: 'web-' + Math.floor(Math.random() * 1e6) },
      }));
    };
    // Binary WS frames only exist on the fallback path, and they are always
    // game snapshots — binary IS the type tag (server sendUnreliableGameBinary).
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        this.rx++;
        this._onMessage?.('unreliable', ev.data);
        return;
      }
      this._onSignal(ev.data);
    };
    ws.onerror = () => this._fail('signaling error');
    ws.onclose = () => {
      if (this.fallback) this._fail('signaling closed (fallback transport lost)');
      else if (this.state === 'connected') this._log('signaling closed (datachannels may survive)');
      else this._fail('signaling closed');
    };
  },

  disconnect() {
    clearTimeout(this._fbTimer);
    try { this._ws?.close(); } catch (_) {}
    try { this._pc?.close(); } catch (_) {}
    this._ws = null; this._pc = null;
    this.reliable = null; this.unreliable = null;
    this.fallback = false;
    this._setState('idle');
  },

  sendReliable(data) { return this._sendGame('reliable', data); },
  sendUnreliable(data) { return this._sendGame('unreliable', data); },

  // Route a game message: datachannel normally, the signaling WebSocket in
  // fallback (unwrapped — the server routes on the top-level "type"). Note the
  // fallback loses unreliable semantics: everything is ordered TCP, so a
  // stalled connection queues snapshots instead of dropping them. The server
  // guards its side with a write deadline (farmer's 8 kB-buffer skip).
  _sendGame(kind, data) {
    // Simulated loss (?loss=25): drop a fraction of UNRELIABLE sends before
    // the wire — exercises the input-redundancy ring and the server's
    // held-state model. Reliable traffic is never dropped (neither would a
    // real network deliver-or-die channel).
    if (kind === 'unreliable' && this._lossPct > 0 &&
        Math.random() * 100 < this._lossPct) {
      this.tx++;
      return true;
    }
    const dc = kind === 'reliable' ? this.reliable : this.unreliable;
    if (!this.fallback && dc?.readyState === 'open') {
      this._lagged(() => {
        if (dc.readyState === 'open') dc.send(data);
      });
      this.tx++;
      return true;
    }
    if (this.fallback && this._ws?.readyState === WebSocket.OPEN) {
      this._lagged(() => {
        if (this._ws?.readyState === WebSocket.OPEN) this._ws.send(data);
      });
      this.tx++;
      return true;
    }
    return false;
  },

  // Simulated one-way lag on OUTBOUND game traffic only, like farmer's
  // client_simulated_lag (network_session_client.cpp:206): enough to tune
  // reconcile/dilation, without double-counting on echoes.
  _lagged(fn) {
    if (this._lagMs > 0) setTimeout(fn, this._lagMs);
    else fn();
  },

  // Extra diagnostic line for the #netstatus overlay (main.js writes net
  // health here: input lead, snapshot cadence, frame hitches).
  statusExtra: '',
  setStatusExtra(s) {
    this.statusExtra = s;
    this._renderOverlay();
  },

  // --- internals -----------------------------------------------------------

  _sendWS(type, data) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type, data }));
    }
  },

  _setState(s) {
    this.state = s;
    this._log(`state -> ${s}`);
    this._renderOverlay();
    this._onState?.(s);
  },

  _onSignal(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    switch (msg.type) {
      case 'SERVER_AUTH_RESPONSE':
        this.peerId = msg.data.peer_id;
        if (this._forceFallback) {
          this.fallback = true;
          this._log('FALLBACK forced (?fallback=1) — skipping WebRTC');
          this._setState('connected');
        } else {
          this._setupPC();
        }
        break;
      case 'WEBRTC_DESCRIPTION': {
        // The server's offer. Answer and send it back over the WebSocket.
        const pc = this._pc;
        if (!pc) break;
        pc.setRemoteDescription({ type: 'offer', sdp: msg.data.data })
          .then(() => pc.createAnswer())
          .then((answer) => {
            pc.setLocalDescription(answer);
            this._sendWS('WEBRTC_DESCRIPTION', { data: answer.sdp });
          })
          .catch((e) => this._fail(`answer failed: ${e.message}`));
        break;
      }
      case 'WEBRTC_CANDIDATE':
        this._pc?.addIceCandidate({
          candidate: msg.data.sdp,
          sdpMid: msg.data.mid,
          sdpMLineIndex: msg.data.index,
        }).catch(() => {});
        break;
      // Fallback inbound: game JSON arriving on the signaling socket. Present
      // them to the game on the channel name they would have used, so
      // onMessage consumers don't know the transport changed.
      case 'SNAPSHOT':
        this.rx++;
        this._onMessage?.('unreliable', raw);
        break;
      case 'JOIN':
      case 'LEAVE':
        this.rx++;
        this._onMessage?.('reliable', raw);
        break;
      default:
        break;
    }
  },

  _setupPC() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: [this._stun] }],
    });
    this._pc = pc;

    // WebRTC connect timeout -> WebSocket fallback (farmer's
    // network_session_client.cpp:302 "connection timeout, fallback"). UDP-
    // blocked networks (corporate NAT, some hotel wifi) land here.
    clearTimeout(this._fbTimer);
    this._fbTimer = setTimeout(() => {
      if (this.state !== 'connected') this._enterFallback('webrtc connect timeout');
    }, 6000);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this._sendWS('WEBRTC_CANDIDATE', {
          mid: e.candidate.sdpMid,
          index: e.candidate.sdpMLineIndex,
          sdp: e.candidate.candidate,
        });
      }
    };
    pc.ondatachannel = (e) => this._wire(e.channel);
    pc.onconnectionstatechange = () => {
      this._log(`ice connectionState -> ${pc.connectionState}`);
      if (pc.connectionState === 'connected') this._renderOpen();
      else if (pc.connectionState === 'failed') this._enterFallback('webrtc connection failed');
      else if (pc.connectionState === 'closed' && this.state === 'connected' && !this.fallback) {
        this._setState('idle');
      }
    };
  },

  _enterFallback(reason) {
    if (this.fallback || this.state === 'connected') return;
    clearTimeout(this._fbTimer);
    this.fallback = true;
    try { this._pc?.close(); } catch (_) {}
    this._pc = null; this.reliable = null; this.unreliable = null;
    this._log(`FALLBACK: ${reason} — game traffic over the signaling WebSocket`);
    if (this._ws?.readyState === WebSocket.OPEN) this._setState('connected');
    else this._fail('fallback with no websocket');
  },

  _wire(dc) {
    this._log(`received channel "${dc.label}" (${dc.ordered ? 'ordered' : 'unordered'})`);
    if (dc.label === 'reliable') this.reliable = dc;
    else if (dc.label === 'unreliable') this.unreliable = dc;
    dc.binaryType = 'arraybuffer'; // spec default is Blob; we want zero-copy views

    dc.onopen = () => this._renderOpen();
    dc.onclose = () => { this._log(`channel "${dc.label}" closed`); };
    dc.onmessage = (e) => {
      this.rx++;
      this._onMessage?.(dc.label, e.data);
    };
  },

  _renderOpen() {
    if (this.reliable?.readyState === 'open' && this.unreliable?.readyState === 'open') {
      clearTimeout(this._fbTimer);
      this._setState('connected');
    }
  },

  // --- status overlay (spike aid; removed when the game owns this UI) --------

  _ensureOverlay() {
    if (this._overlay) return this._overlay;
    const el = document.createElement('div');
    el.id = 'netstatus';
    el.style.cssText =
      'position:fixed;top:4px;left:4px;z-index:99;font:11px/1.4 monospace;' +
      'color:#8f8;background:rgba(0,0,0,0.7);padding:2px 6px;border-radius:3px;' +
      'pointer-events:none;white-space:pre;';
    document.body.appendChild(el);
    this._overlay = el;
    return el;
  },

  _renderOverlay() {
    if (!this._overlay) return;
    const pc = this._pc;
    this._overlay.textContent =
      `net ${this.state}` +
      (this.fallback ? ' [ws-fallback]' : '') +
      (this._lagMs ? ` lag=${this._lagMs}ms` : '') +
      (this._lossPct ? ` loss=${this._lossPct}%` : '') +
      (this.peerId ? ` peer=${this.peerId}` : '') +
      ` rx=${this.rx} tx=${this.tx}` +
      (pc && pc.connectionState !== 'new' ? `\nice=${pc.connectionState}` : '') +
      (this.statusExtra ? `\n${this.statusExtra}` : '');
  },

  _log(s) {
    console.log(`[NET] ${s}`);
    this._renderOverlay();
  },

  _fail(reason) {
    this.lastError = reason;
    this._log(`FAIL: ${reason}`);
    this._setState('failed');
  },
};
