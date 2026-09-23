// =====================
// Run in Terminal (terminal.js)
// =====================
// Adds a "Send" button to code blocks that pushes the snippet straight into the
// live ttyd terminal at the cursor — type a command, or drop a file's contents
// into an editor you've opened in the terminal (vim/nano, `cat > main.c`, …).
// No copy/paste, and no forced execution: the text is inserted exactly as shown,
// so you press Enter yourself to run a command.
//
// How it can possibly work: the terminal is a ttyd session in a *same-origin*
// <iframe src="tty/"> (Caddy serves the page and proxies /tty/* on the same
// :8787 origin). Same-origin means the parent page may reach into the iframe's
// window. We cannot open our own socket — ttyd runs `login` per connection, so a
// second socket would be a *different* shell — so instead we latch onto the
// socket ttyd already opened by intercepting WebSocket.prototype.send inside the
// iframe realm. To send, we push a ttyd INPUT frame (command byte '0' = 0x30,
// then the UTF-8 bytes) — byte-for-byte what ttyd sends when the user types the
// text. We do NOT append a newline, so nothing is executed automatically.
//
// If any of that is unavailable (unexpected ttyd build, cross-origin, socket not
// yet captured), we fall back to copying the command to the clipboard.
//
// Self-contained: wires itself up via a MutationObserver on #markdown-content,
// so app.js needs no changes. Depends only on the DOM and (optionally)
// TerminalPanel from app.js to reveal the terminal when hidden.

var TerminalBridge = {
    sock: null,            // the live ttyd WebSocket, once captured
    IFRAME_ID: 'terminal-iframe',

    init: function() {
        var iframe = document.getElementById(this.IFRAME_ID);
        if (!iframe) return;
        var self = this;

        var attempt = function() {
            self.hookRealm(iframe);
            self.nudge(iframe);   // provoke a send so our hook captures the socket
        };

        attempt();
        iframe.addEventListener('load', attempt);

        // ttyd's socket opens shortly after the iframe loads; retry briefly until
        // we've captured it, so we're ready before the first click.
        var tries = 0;
        var timer = setInterval(function() {
            if (self.sock || tries++ > 25) { clearInterval(timer); return; }
            attempt();
        }, 400);
    },

    // Patch WebSocket.prototype.send inside the iframe realm so the next send
    // (ttyd's connect-time resize, a keystroke, etc.) hands us the live socket.
    hookRealm: function(iframe) {
        var win;
        try { win = iframe.contentWindow; } catch (e) { return; }   // cross-origin guard
        if (!win || !win.WebSocket || !win.WebSocket.prototype) return;
        var proto = win.WebSocket.prototype;
        if (proto.__noppeHooked) return;

        var self = this;
        var origSend = proto.send;
        proto.send = function() {
            self.sock = this;                 // capture the live socket
            return origSend.apply(this, arguments);
        };
        proto.__noppeHooked = true;
    },

    // Fire a resize inside the iframe: ttyd responds by sending a RESIZE frame,
    // which trips our send-hook and captures the socket without user input.
    nudge: function(iframe) {
        try {
            var win = iframe.contentWindow;
            if (win) win.dispatchEvent(new win.Event('resize'));
        } catch (e) { /* ignore */ }
    },

    ready: function() {
        return !!(this.sock && this.sock.readyState === 1 /* OPEN */);
    },

    // ttyd INPUT frame: 0x30 ('0') followed by the UTF-8 payload.
    frame: function(text) {
        var body = new TextEncoder().encode(text);
        var buf = new Uint8Array(body.length + 1);
        buf[0] = 0x30;                        // Command.INPUT
        buf.set(body, 1);
        return buf;
    },

    // Returns true if the command was pushed to the terminal socket.
    send: function(text) {
        if (!this.ready()) return false;
        try {
            this.sock.send(this.frame(text));
            return true;
        } catch (e) {
            return false;
        }
    }
};

var SendButtons = {
    CONTAINER_ID: 'markdown-content',

    init: function() {
        var container = document.getElementById(this.CONTAINER_ID);
        if (!container) return;
        var self = this;

        this.inject(container);   // any content already present

        // Re-scan whenever the chapter content changes. inject() is idempotent
        // (flags each <pre>), so the mutation caused by adding a button doesn't
        // cause a re-inject loop.
        if (typeof MutationObserver !== 'undefined') {
            new MutationObserver(function() { self.inject(container); })
                .observe(container, { childList: true, subtree: true });
        }
    },

    // A Send button goes on every fenced code block (pre > code) regardless of
    // language — a command, a C/Makefile/Python snippet to drop into an editor,
    // etc. `::: terminal` demo blocks render as div.terminal-block (not
    // pre > code), so they are naturally — and correctly — left out.
    inject: function(container) {
        if (!container) return;
        var self = this;
        var codes = container.querySelectorAll('pre > code');
        Array.prototype.forEach.call(codes, function(code) {
            var pre = code.parentNode;
            if (pre.getAttribute('data-noppe-send')) return;     // already processed
            if (!code.textContent.trim()) return;                // skip empty blocks

            pre.setAttribute('data-noppe-send', '1');
            pre.classList.add('has-send-btn');

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'send-btn';
            btn.title = 'Send to terminal';
            btn.setAttribute('aria-label', 'Send to terminal');
            btn.innerHTML =
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>' +
                '</svg><span>Send</span>';
            btn.addEventListener('click', function() { self.send(code, btn); });
            pre.appendChild(btn);
        });
    },

    send: function(code, btn) {
        var text = code.textContent.replace(/\s+$/, '');   // trim trailing blank space/newlines
        if (!text) return;

        // Reveal the terminal so the learner sees the text land at the cursor.
        if (typeof TerminalPanel !== 'undefined' && TerminalPanel.visible === false) {
            TerminalPanel.toggle();
        }

        // No trailing newline: insert verbatim, don't auto-run.
        if (TerminalBridge.send(text)) {
            this.flash(btn, 'Sent ▸', 'ok');
        } else {
            this.copy(text);
            this.flash(btn, 'Copied', 'copy');
        }
    },

    copy: function(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
                return;
            }
        } catch (e) { /* fall through */ }
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { /* give up quietly */ }
    },

    // Briefly relabel the button to confirm the action.
    flash: function(btn, msg, kind) {
        var label = btn.querySelector('span');
        var prev = label ? label.textContent : '';
        var cls = 'send-btn-' + kind;
        btn.classList.add(cls);
        if (label) label.textContent = msg;
        setTimeout(function() {
            btn.classList.remove(cls);
            if (label) label.textContent = prev;
        }, 1400);
    }
};

(function bootstrapTerminal() {
    function start() { TerminalBridge.init(); SendButtons.init(); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
