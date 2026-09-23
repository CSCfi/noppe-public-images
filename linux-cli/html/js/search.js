// =====================
// Search (search.js)
// =====================
// Client-side full-text search for the Noppe CLI viewer: a BM25 index
// (SearchIndex) and the search-box UI (Search). Depends on the ContentNav and
// MarkdownRenderer globals from app.js, so this file must be loaded AFTER app.js.
// It is wired in by Search.init(), called from init() in app.js.

// =====================
// Search Index (BM25)
// =====================
// A client-side full-text index over every chapter in the manifest. Built lazily
// on first use (one fetch per chapter, cached in memory for the session). Ranking
// is Okapi BM25 — term-frequency saturation + document-length normalization + IDF
// — so a query like "grep" surfaces the chapter that is *about* grep above chapters
// that merely mention it, without any manual tagging. Matches in a chapter title or
// heading get an extra boost, and an optional per-chapter `keywords` array in the
// manifest is a hand-tuning escape hatch.
var SearchIndex = {
    K1: 1.2,            // BM25 term-frequency saturation
    B: 0.75,           // BM25 length normalization strength
    TITLE_BOOST: 3.0,  // extra weight (× idf) when a query term is in the title
    HEADING_BOOST: 1.5,// extra weight (× idf) when a query term is in any heading
    KEYWORD_BOOST: 4.0,// extra weight (× idf) for a manifest `keywords` match
    MAX_RESULTS: 8,
    MIN_QUERY_LEN: 2,

    docs: [],
    df: {},            // term -> number of docs containing it
    vocab: [],         // unique terms, for prefix expansion
    N: 0,
    avgLen: 0,
    built: false,
    building: null,

    // Kick off (or reuse) index construction. Returns a promise resolving when ready.
    build: function() {
        if (this.built) return Promise.resolve();
        if (this.building) return this.building;

        var self = this;

        // Wait for the manifest before indexing. The topic list may still be
        // empty when search is first opened (e.g. Ctrl+K on a fresh page, or a
        // slow manifest fetch); indexing off an empty list would otherwise latch
        // an empty index for the whole session.
        this.building = Promise.resolve(ContentNav.ready).then(function() {
            var jobs = [];
            ContentNav.topics.forEach(function(topic, topicIndex) {
                topic.chapters.forEach(function(chapter, chapterIndex) {
                    var url = CONFIG.contentBase + topic.id + '/' + chapter.file;
                    jobs.push(
                        fetch(url)
                            .then(function(r) { return r.ok ? r.text() : ''; })
                            .then(function(md) {
                                if (md) self.addDoc(md, topic, topicIndex, chapter, chapterIndex);
                            })
                            .catch(function() { /* skip unreadable chapter */ })
                    );
                });
            });
            return Promise.all(jobs);
        }).then(function() {
            self.finalize();
            self.built = true;
            self.building = null;
        });
        return this.building;
    },

    addDoc: function(md, topic, topicIndex, chapter, chapterIndex) {
        var parsed = this.stripMarkdown(md);
        var tokens = this.tokenize(parsed.text);

        var tf = {};
        tokens.forEach(function(t) { tf[t] = (tf[t] || 0) + 1; });

        // Record document frequency once per unique term.
        var self = this;
        Object.keys(tf).forEach(function(t) { self.df[t] = (self.df[t] || 0) + 1; });

        var titleTokens = {};
        this.tokenize(chapter.title).forEach(function(t) { titleTokens[t] = true; });

        var headingTokens = {};
        parsed.headings.forEach(function(h) {
            self.tokenize(h.text).forEach(function(t) { headingTokens[t] = true; });
        });

        var keywordTokens = {};
        (chapter.keywords || []).forEach(function(kw) {
            self.tokenize(String(kw)).forEach(function(t) { keywordTokens[t] = true; });
        });

        this.docs.push({
            topicId: topic.id,
            topicTitle: topic.title,
            topicIndex: topicIndex,
            title: chapter.title,
            file: chapter.file,
            chapterIndex: chapterIndex,
            text: parsed.text,
            lower: parsed.text.toLowerCase(),
            headings: parsed.headings,
            tf: tf,
            len: tokens.length || 1,
            titleTokens: titleTokens,
            headingTokens: headingTokens,
            keywordTokens: keywordTokens
        });
    },

    finalize: function() {
        this.N = this.docs.length;
        var total = 0;
        this.docs.forEach(function(d) { total += d.len; });
        this.avgLen = this.N ? (total / this.N) : 1;
        this.vocab = Object.keys(this.df);
    },

    // Reduce Markdown to plain text and pull out headings with their character
    // offset in that text, so a match position can be mapped back to a section.
    // Fenced code is kept as text (commands are searchable); fence/container
    // markers and inline syntax are stripped.
    stripMarkdown: function(md) {
        var self = this;
        md = md.replace(/\{\{[^}]+\}\}/g, ' ');   // template variables
        var lines = md.split('\n');
        var out = '';
        var headings = [];
        var inFence = false;

        lines.forEach(function(line) {
            if (/^\s*```/.test(line)) { inFence = !inFence; return; }
            if (inFence) { out += line + '\n'; return; }
            if (/^\s*:{3,}/.test(line)) return;    // ::: container markers

            var h = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
            if (h) {
                var htext = self.stripInline(h[2]);
                headings.push({ offset: out.length, text: htext, slug: MarkdownRenderer.slugify(htext) });
                out += htext + '\n';
                return;
            }
            out += self.stripInline(line) + '\n';
        });

        return { text: out, headings: headings };
    },

    stripInline: function(s) {
        return s
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')     // images
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // links -> link text
            .replace(/`([^`]*)`/g, '$1')               // inline code
            .replace(/<[^>]+>/g, ' ')                  // HTML tags
            .replace(/[*_~>|]+/g, ' ');                // emphasis / table / quote marks
            // NB: '#' is intentionally kept so tokens like "c#" survive; ATX
            // heading markers are already stripped by the heading regex above.
    },

    tokenize: function(text) {
        var raw = text.toLowerCase().match(/[a-z0-9][a-z0-9._+#-]*/g);
        if (!raw) return [];
        var out = [];
        raw.forEach(function(tok) {
            // Trim sentence punctuation ('grep.' -> 'grep') but keep '+'/'#' so
            // language tokens like 'c++' / 'c#' are preserved.
            tok = tok.replace(/[._-]+$/g, '');
            if (tok.length >= 2) out.push(tok);
        });
        return out;
    },

    idf: function(term) {
        var df = this.df[term];
        if (!df) return 0;
        return Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
    },

    // BM25 body score for one term in one doc, plus field boosts.
    termScore: function(term, doc) {
        var idf = this.idf(term);
        if (idf === 0) return 0;

        var tf = doc.tf[term] || 0;
        var score = 0;
        if (tf > 0) {
            var denom = tf + this.K1 * (1 - this.B + this.B * doc.len / this.avgLen);
            score = idf * (tf * (this.K1 + 1)) / denom;
        }
        if (doc.titleTokens[term])   score += idf * this.TITLE_BOOST;
        if (doc.headingTokens[term]) score += idf * this.HEADING_BOOST;
        if (doc.keywordTokens[term]) score += idf * this.KEYWORD_BOOST;
        return score;
    },

    query: function(q, exactLast) {
        var self = this;
        var tokens = this.tokenize(q);
        if (!tokens.length) return [];

        var lastIdx = tokens.length - 1;

        // For each query token, the set of index terms it can match. The final
        // token is treated as a prefix (as-you-type) so partial words match —
        // unless `exactLast` is set (the caller saw a trailing space), in which
        // case every token is matched exactly. Earlier tokens are always exact.
        var perToken = tokens.map(function(t, i) {
            if (i === lastIdx && !exactLast) {
                var matches = self.vocab.filter(function(v) { return v.indexOf(t) === 0; });
                if (self.df[t] && matches.indexOf(t) === -1) matches.push(t);
                return matches;
            }
            return self.df[t] ? [t] : [];
        });

        var results = [];
        this.docs.forEach(function(doc) {
            var score = 0;
            var matched = 0;
            perToken.forEach(function(terms) {
                if (!terms.length) return;
                // Best-matching term for this query token (avoids over-counting a
                // prefix that expands to many vocabulary words).
                var best = 0;
                terms.forEach(function(term) {
                    var s = self.termScore(term, doc);
                    if (s > best) best = s;
                });
                if (best > 0) { score += best; matched++; }
            });
            // Reward docs that hit more of the query terms.
            if (matched > 0) {
                score *= (1 + 0.25 * (matched - 1));
                results.push({ doc: doc, score: score });
            }
        });

        results.sort(function(a, b) { return b.score - a.score; });
        return results.slice(0, this.MAX_RESULTS).map(function(r) {
            return self.buildResult(r.doc, tokens);
        });
    },

    // Assemble the display record for a hit: breadcrumb, a highlighted snippet
    // around the earliest matching term, and the anchor of its enclosing section.
    buildResult: function(doc, tokens) {
        var lower = doc.lower;
        var pos = -1;
        tokens.forEach(function(t) {
            var p = lower.indexOf(t);
            if (p !== -1 && (pos === -1 || p < pos)) pos = p;
        });
        if (pos === -1) pos = 0;

        var start = Math.max(0, pos - 55);
        var end = Math.min(doc.text.length, pos + 125);
        var raw = doc.text.slice(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) raw = '… ' + raw;
        if (end < doc.text.length) raw = raw + ' …';

        // Section the match falls under: the last heading at or before `pos`.
        var section = null;
        doc.headings.forEach(function(h) {
            if (h.offset <= pos) section = h;
        });

        return {
            topicId: doc.topicId,
            topicTitle: doc.topicTitle,
            title: doc.title,
            file: doc.file,
            slug: section ? section.slug : '',
            sectionText: section ? section.text : '',
            snippetHtml: this.highlight(raw, tokens)
        };
    },

    highlight: function(text, tokens) {
        var escaped = MarkdownRenderer.escapeHtml(text);
        var parts = tokens.map(function(t) {
            return t.replace(/[.*+?^${}()|[\]\\#-]/g, '\\$&');
        }).filter(Boolean);
        if (!parts.length) return escaped;
        var re = new RegExp('(' + parts.join('|') + ')', 'gi');
        return escaped.replace(re, '<mark>$1</mark>');
    }
};

// =====================
// Search UI
// =====================
var Search = {
    box: null,
    input: null,
    resultsEl: null,
    results: [],
    activeIndex: -1,
    debounceTimer: null,

    init: function() {
        this.box = document.getElementById('search-box');
        this.input = document.getElementById('search-input');
        this.resultsEl = document.getElementById('search-results');
        this.toggleBtn = document.getElementById('search-toggle-btn');
        this.closeBtn = document.getElementById('search-close-btn');
        this.navHeader = this.box ? this.box.closest('.nav-header') : null;
        if (!this.input || !this.resultsEl) return;

        var self = this;

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', function() { self.close(); });
        }

        // Build the index on first focus so page load stays cheap.
        this.input.addEventListener('focus', function() {
            if (SearchIndex.built || SearchIndex.building) return;
            self.showMessage('Indexing course content…');
            SearchIndex.build().then(function() {
                // close() clears the value, so an empty value here means the box
                // was closed mid-build — just hide. Otherwise show live results.
                if (self.input.value.trim()) self.run(self.input.value);
                else self.hide();
            });
        });

        this.input.addEventListener('input', function() {
            clearTimeout(self.debounceTimer);
            self.debounceTimer = setTimeout(function() { self.run(self.input.value); }, 120);
        });

        this.input.addEventListener('keydown', function(e) { self.onKeyDown(e); });

        // Click outside the open search box collapses it (ignore the toggle,
        // which opens it via its own handler).
        document.addEventListener('click', function(e) {
            if (!self.isOpen()) return;
            if (self.box.contains(e.target)) return;
            if (self.toggleBtn && self.toggleBtn.contains(e.target)) return;
            self.close();
        });

        // Ctrl/Cmd+K opens search from anywhere.
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                self.open();
            }
        });
    },

    isOpen: function() {
        return !!(this.navHeader && this.navHeader.classList.contains('search-open'));
    },

    open: function() {
        var self = this;
        if (this.navHeader) this.navHeader.classList.add('search-open');
        // Focus after the box switches from display:none.
        setTimeout(function() { self.input.focus(); self.input.select(); }, 0);
    },

    close: function() {
        clearTimeout(this.debounceTimer);
        this.hide();
        this.input.value = '';
        if (this.navHeader) this.navHeader.classList.remove('search-open');
        this.input.blur();
    },

    run: function(q) {
        var raw = q || '';
        var trimmed = raw.trim();
        if (trimmed.length < SearchIndex.MIN_QUERY_LEN) { this.hide(); return; }
        if (!SearchIndex.built) { this.showMessage('Indexing course content…'); return; }

        // A trailing space marks the final word as complete: match it exactly
        // rather than as an as-you-type prefix (so "cat " excludes "catch").
        var exactLast = /\s$/.test(raw);
        this.results = SearchIndex.query(trimmed, exactLast);
        this.activeIndex = -1;

        if (!this.results.length) {
            this.showMessage('No matches for “' + MarkdownRenderer.escapeHtml(trimmed) + '”');
            return;
        }
        this.render();
    },

    render: function() {
        var self = this;
        var html = '';
        this.results.forEach(function(r, i) {
            var crumb = MarkdownRenderer.escapeHtml(r.topicTitle);
            if (r.sectionText) crumb += ' › ' + MarkdownRenderer.escapeHtml(r.sectionText);
            html += '<button class="search-result" role="option" data-index="' + i + '">' +
                '<span class="search-result-title">' + MarkdownRenderer.escapeHtml(r.title) +
                '<span class="search-result-crumb">' + crumb + '</span></span>' +
                '<span class="search-result-snippet">' + r.snippetHtml + '</span>' +
                '</button>';
        });
        this.resultsEl.innerHTML = html;
        this.resultsEl.hidden = false;

        Array.prototype.forEach.call(this.resultsEl.querySelectorAll('.search-result'), function(el) {
            el.addEventListener('click', function() {
                self.go(parseInt(el.getAttribute('data-index'), 10));
            });
        });
    },

    showMessage: function(msg) {
        this.results = [];
        this.activeIndex = -1;
        this.resultsEl.innerHTML = '<div class="search-message">' + msg + '</div>';
        this.resultsEl.hidden = false;
    },

    hide: function() {
        this.resultsEl.hidden = true;
        this.activeIndex = -1;
    },

    onKeyDown: function(e) {
        if (e.key === 'Escape') { this.close(); return; }

        if (this.resultsEl.hidden || !this.results.length) {
            if (e.key === 'Enter' && !SearchIndex.built) e.preventDefault();
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.setActive((this.activeIndex + 1) % this.results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.setActive((this.activeIndex - 1 + this.results.length) % this.results.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            this.go(this.activeIndex >= 0 ? this.activeIndex : 0);
        }
    },

    setActive: function(index) {
        this.activeIndex = index;
        var items = this.resultsEl.querySelectorAll('.search-result');
        Array.prototype.forEach.call(items, function(el, i) {
            var on = (i === index);
            el.classList.toggle('active', on);
            if (on && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        });
    },

    go: function(index) {
        var r = this.results[index];
        if (!r) return;
        this.close();   // collapse the search bar so the toolbar returns
        ContentNav.loadMarkdownFile(r.topicId + '/' + r.file, true, r.slug);
    }
};
