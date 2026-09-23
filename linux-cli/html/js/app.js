// =====================
// Configuration
// =====================
var CONFIG = {
    manifestUrl: 'content/manifest.json',
    contentBase: 'content/',
    storageKey: 'mdviewer_position',
    terminalWidthKey: 'mdviewer_terminal_width',
    codeLangKey: 'mdviewer_code_lang'
};

// =====================
// Markdown Renderer
// =====================
var MarkdownRenderer = {
    md: null,

    init: function() {
        var self = this;

        this._slugCounter = {};

        this.md = window.markdownit({
            html: true,
            breaks: true,
            linkify: true,
            typographer: false,
            highlight: function(code, lang) {
                if (lang && typeof hljs !== 'undefined' && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (e) {
                        console.error('Highlight error:', e);
                    }
                }
                return self.escapeHtml(code);
            }
        });

        this.md.renderer.rules.heading_open = function(tokens, idx, options, env, renderer) {
            var headingToken = tokens[idx];
            var inlineToken = tokens[idx + 1];
            var textContent = '';
            if (inlineToken && inlineToken.children) {
                inlineToken.children.forEach(function(t) {
                    if (t.type === 'text' || t.type === 'code_inline' || t.type === 'softbreak') {
                        textContent += t.content;
                    }
                });
            }
            var slug = self.slugify(textContent);
            if (slug) {
                if (self._slugCounter[slug] === undefined) {
                    self._slugCounter[slug] = 0;
                } else {
                    self._slugCounter[slug]++;
                    slug = slug + '-' + self._slugCounter[slug];
                }
                headingToken.attrSet('id', slug);
            }
            return renderer.renderToken(tokens, idx, options);
        };

        this.registerAdmonitions();
        this.registerSolution();
        this.registerQuizContainer();
        this.registerTabs();
    },

    escapeHtml: function(text) {
        if (typeof text !== 'string') {
            text = String(text);
        }
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    slugify: function(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '');
    },

    registerAdmonitions: function() {
        var types = ['note', 'tip', 'guidance', 'service', 'question', 'beware', 'todo'];
        var self = this;

        types.forEach(function(type) {
            self.md.use(window.markdownitContainer, type, {
                validate: function(params) {
                    return params.trim().match(new RegExp('^' + type + '(\\s+.*)?$'));
                },
                render: function(tokens, idx) {
                    var token = tokens[idx];
                    if (token.nesting === 1) {
                        var title = token.info.trim().slice(type.length).trim();
                        if (!title) {
                            title = type.charAt(0).toUpperCase() + type.slice(1);
                        }
                        return '<div class="admonition ' + type + '">\n' +
                               '<div class="admonition-title">' + title + '</div>\n' +
                               '<div class="admonition-content">\n';
                    } else {
                        return '</div>\n</div>\n';
                    }
                }
            });
        });
    },

    // A `::: solution` container renders as a collapsible <details> reveal so
    // learners can attempt an exercise before checking the answer. Styled like an
    // admonition (see .admonition.solution in styles.css). To wrap a `::: tabs`
    // group, open the solution with FOUR colons (`:::: solution`) so the inner
    // three-colon tabs fence closes independently — see registerTabs.
    registerSolution: function() {
        this.md.use(window.markdownitContainer, 'solution', {
            validate: function(params) {
                return params.trim().match(/^solution(\s+.*)?$/);
            },
            render: function(tokens, idx) {
                var token = tokens[idx];
                if (token.nesting === 1) {
                    var title = token.info.trim().slice('solution'.length).trim();
                    if (!title) {
                        title = 'Solution';
                    }
                    return '<details class="admonition solution">\n' +
                           '<summary class="admonition-title">' + title + '</summary>\n' +
                           '<div class="admonition-content">\n';
                }
                return '</div>\n</details>\n';
            }
        });
    },

    registerQuizContainer: function() {
        this.md.use(window.markdownitContainer, 'quiz', {
            validate: function(params) {
                return params.trim().match(/^quiz\s+\S+/);
            },
            render: function(tokens, idx) {
                var token = tokens[idx];
                if (token.nesting === 1) {
                    var quizId = token.info.trim().slice('quiz'.length).trim();
                    return '<div class="quiz-placeholder" data-quiz-id="' + quizId + '">';
                }
                return '</div>\n';
            }
        });
    },

    // A `::: tabs` container wraps consecutive code fences; TabManager (post
    // render) turns each fenced block into a tab. The fences inside render and
    // highlight as usual — we only emit the wrapping div here.
    registerTabs: function() {
        this.md.use(window.markdownitContainer, 'tabs', {
            validate: function(params) {
                return params.trim().match(/^tabs$/);
            },
            render: function(tokens, idx) {
                return tokens[idx].nesting === 1
                    ? '<div class="code-tabs">\n'
                    : '</div>\n';
            }
        });
    },

    render: function(markdown) {
        this._slugCounter = {};
        var processed = this.preprocessTerminalBlocks(markdown);
        return this.md.render(processed);
    },

    // Terminal blocks are rendered verbatim rather than as markdown, so that
    // whitespace — especially the leading indentation in `pstree`/`ps` output —
    // is preserved exactly. markdown-it's paragraph parser strips leading
    // whitespace on continuation lines and the browser collapses internal space
    // runs, so routing this content through it destroys column alignment.
    // We escape the raw body, mark PS2 continuation prompts as non-selectable,
    // and collapse newlines to `&#10;` so the whole block is a single HTML block
    // (a blank line inside it can no longer terminate the block). Real spaces
    // plus `white-space: pre` (see styles.css) keep copied commands clean ASCII —
    // no non-breaking spaces that would break when pasted into a shell.
    preprocessTerminalBlocks: function(markdown) {
        var self = this;
        // Normalise ```terminal / ```console fences into ::: terminal blocks first.
        markdown = markdown.replace(
            /```(?:terminal|console)\n([\s\S]*?)```/g,
            function(match, code) {
                return '::: terminal\n' + code.replace(/\n+$/, '') + '\n:::\n';
            }
        );
        return markdown.replace(
            /:::[ \t]*terminal[ \t]*\n([\s\S]*?)\n:::/g,
            function(match, body) {
                var esc = self.escapeHtml(body);
                // Wrap line-starting PS2 prompts (>) in a non-selectable span so
                // they are excluded from clipboard copies. Mid-line > (e.g.
                // `echo foo > file`) is left untouched.
                esc = esc.replace(
                    /(^|\n)&gt;(?=[ \t]|\n|$)/g,
                    '$1<span class="ps2-prompt">&gt;</span>'
                );
                // Collapse to one logical line: markdown-it then treats the
                // result as a single HTML block, and `&#10;` renders (and is
                // copied) as a real newline.
                esc = esc.replace(/\n/g, '&#10;');
                return '<div class="terminal-block"><code>' + esc + '</code></div>';
            }
        );
    }
};

// =====================
// Code Tabs Manager
// =====================
// Turns each `<div class="code-tabs">` (emitted by the `tabs` container) into a
// tabbed widget: one tab per fenced code block inside it, labelled by the
// fence language. The reader's chosen language is remembered in localStorage
// and synced across every tab group on the page.
var TabManager = {
    // Fence language -> display label. Fallback is the language upper-cased.
    LANG_LABELS: {
        python: 'Python', py: 'Python',
        sh: 'Bash', bash: 'Bash', shell: 'Bash', console: 'Bash',
        c: 'C',
        cpp: 'C++', 'c++': 'C++', cc: 'C++',
        cs: 'C#', csharp: 'C#', 'c#': 'C#',
        java: 'Java',
        fortran: 'Fortran', f90: 'Fortran',
        js: 'JavaScript', javascript: 'JavaScript',
        rust: 'Rust', go: 'Go', ruby: 'Ruby', perl: 'Perl'
    },

    getSavedLang: function() {
        try {
            return localStorage.getItem(CONFIG.codeLangKey) || '';
        } catch (e) {
            return '';
        }
    },

    saveLang: function(lang) {
        try {
            localStorage.setItem(CONFIG.codeLangKey, lang);
        } catch (e) {
            console.warn('Could not save code language:', e);
        }
    },

    // Read the fence language from a <pre>'s child <code class="language-xxx">.
    langOf: function(pre) {
        var code = pre.querySelector('code');
        var cls = code ? code.className : '';
        var m = cls.match(/language-([\w+#-]+)/);
        return m ? m[1].toLowerCase() : '';
    },

    labelFor: function(lang) {
        return this.LANG_LABELS[lang] || (lang ? lang.toUpperCase() : 'Text');
    },

    injectTabs: function(container) {
        var self = this;
        var groups = container.querySelectorAll('.code-tabs');
        var saved = this.getSavedLang();

        groups.forEach(function(group) {
            var pres = [];
            // Only direct-child <pre> blocks are tabs.
            for (var i = 0; i < group.children.length; i++) {
                if (group.children[i].tagName === 'PRE') pres.push(group.children[i]);
            }
            if (pres.length === 0) return;

            var bar = document.createElement('div');
            bar.className = 'code-tabs-bar';

            pres.forEach(function(pre, idx) {
                var lang = self.langOf(pre) || ('tab-' + idx);
                pre.setAttribute('data-lang', lang);

                var btn = document.createElement('button');
                btn.className = 'code-tab-btn';
                btn.setAttribute('data-lang', lang);
                btn.textContent = self.labelFor(self.langOf(pre));
                btn.addEventListener('click', function() {
                    self.saveLang(lang);
                    self.syncAll(container, lang);
                });
                bar.appendChild(btn);
            });

            group.insertBefore(bar, group.firstChild);

            // Activate the saved language if this group has it, else the first.
            var initial = saved && group.querySelector('[data-lang="' + saved + '"]')
                ? saved
                : pres[0].getAttribute('data-lang');
            self.activate(group, initial);
        });
    },

    // Show the panel/button for `lang` in a single group; hide the others.
    activate: function(group, lang) {
        var pres = group.querySelectorAll(':scope > pre[data-lang]');
        var btns = group.querySelectorAll('.code-tab-btn');
        pres.forEach(function(pre) {
            pre.classList.toggle('active', pre.getAttribute('data-lang') === lang);
        });
        btns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
        });
    },

    // Apply `lang` to every group on the page that offers it; groups without
    // that language keep their current selection.
    syncAll: function(container, lang) {
        var self = this;
        container.querySelectorAll('.code-tabs').forEach(function(group) {
            if (group.querySelector('.code-tab-btn[data-lang="' + lang + '"]')) {
                self.activate(group, lang);
            }
        });
    }
};

// =====================
// Panel Resizer
// =====================
var PanelResizer = {
    resizer: null,
    terminalPanel: null,
    isDragging: false,
    startX: 0,
    startWidth: 0,

    init: function() {
        this.resizer = document.getElementById('panel-resizer');
        this.terminalPanel = document.getElementById('terminal-panel');

        if (!this.resizer || !this.terminalPanel) return;

        var self = this;

        // Restore saved width
        this.restoreWidth();

        // Mouse events
        this.resizer.addEventListener('mousedown', function(e) {
            self.startDrag(e);
        });

        document.addEventListener('mousemove', function(e) {
            self.drag(e);
        });

        document.addEventListener('mouseup', function(e) {
            self.stopDrag(e);
        });

        // Touch events for mobile
        this.resizer.addEventListener('touchstart', function(e) {
            if (e.touches.length > 0) {
                self.startDrag(e.touches[0]);
            }
        });

        document.addEventListener('touchmove', function(e) {
            if (self.isDragging && e.touches.length > 0) {
                e.preventDefault();
                self.drag(e.touches[0]);
            }
        }, { passive: false });

        document.addEventListener('touchend', function(e) {
            self.stopDrag(e);
        });
    },

    startDrag: function(e) {
        if (this.terminalPanel.classList.contains('hidden')) return;

        this.isDragging = true;
        this.startX = e.clientX;
        this.startWidth = this.terminalPanel.offsetWidth;

        this.resizer.classList.add('dragging');
        document.body.classList.add('resizing');
    },

    drag: function(e) {
        if (!this.isDragging) return;

        var delta = this.startX - e.clientX;
        var newWidth = this.startWidth + delta;

        // Constrain width
        var minWidth = 200;
        var maxWidth = window.innerWidth * 0.8;

        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

        this.terminalPanel.style.width = newWidth + 'px';
    },

    stopDrag: function(e) {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.resizer.classList.remove('dragging');
        document.body.classList.remove('resizing');

        // Save the width
        this.saveWidth();
    },

    saveWidth: function() {
        try {
            var width = this.terminalPanel.offsetWidth;
            localStorage.setItem(CONFIG.terminalWidthKey, width);
        } catch (e) {
            console.warn('Could not save terminal width:', e);
        }
    },

    restoreWidth: function() {
        try {
            var savedWidth = parseInt(localStorage.getItem(CONFIG.terminalWidthKey));
            if (!isNaN(savedWidth) && savedWidth > 0) {
                this.terminalPanel.style.width = savedWidth + 'px';
            }
        } catch (e) {
            console.warn('Could not restore terminal width:', e);
        }
    },

    show: function() {
        this.resizer.classList.remove('hidden');
    },

    hide: function() {
        this.resizer.classList.add('hidden');
    }
};

// =====================
// Content Navigation
// =====================
var ContentNav = {
    topics: [],
    currentTopicIndex: -1,
    currentChapterIndex: 0,
    isNavigating: false,
    loadSeq: 0,
    ready: null,          // resolves once the manifest (and topic list) is loaded

    init: function() {
        var self = this;

        // Listen for browser back/forward buttons
        window.addEventListener('popstate', function(event) {
            if (event.state) {
                self.restoreState(event.state, false);
            }
        });

        this.ready = this.loadManifest().catch(function(error) {
            console.error('Failed to initialize:', error);
            self.showError('Failed to Load Content', error.message);
        });
    },

    loadManifest: function() {
        var self = this;
        return fetch(CONFIG.manifestUrl)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.json();
            })
            .then(function(manifest) {
                self.topics = manifest.topics || [];

                var topicSelector = document.getElementById('topic-selector');
                topicSelector.innerHTML = '<option value="">Select Topic...</option>';
                topicSelector.disabled = false;

                self.topics.forEach(function(topic, index) {
                    var option = document.createElement('option');
                    option.value = index;
                    option.textContent = topic.title;
                    topicSelector.appendChild(option);
                });

                // Try to restore position from URL hash or localStorage
                var restored = self.restorePosition();

                if (!restored && self.topics.length > 0) {
                    self.selectTopic(0, true);
                }
            });
    },

    // Save current position to localStorage and URL hash
    savePosition: function() {
        if (this.currentTopicIndex < 0) return;

        var topic = this.topics[this.currentTopicIndex];
        var chapter = topic.chapters[this.currentChapterIndex];
        if (!chapter) return;

        var position = {
            topicId: topic.id,
            topicIndex: this.currentTopicIndex,
            chapterFile: chapter.file,
            chapterIndex: this.currentChapterIndex
        };

        // Save to localStorage
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(position));
        } catch (e) {
            console.warn('Could not save to localStorage:', e);
        }

        // Update URL hash
        var hash = topic.id + '/' + chapter.file;
        if (window.location.hash !== '#' + hash) {
            window.history.replaceState(position, '', '#' + hash);
        }
    },

    // Push state to browser history (for back/forward navigation)
    pushState: function() {
        if (this.currentTopicIndex < 0) return;

        var topic = this.topics[this.currentTopicIndex];
        var chapter = topic.chapters[this.currentChapterIndex];
        if (!chapter) return;

        var state = {
            topicId: topic.id,
            topicIndex: this.currentTopicIndex,
            chapterFile: chapter.file,
            chapterIndex: this.currentChapterIndex
        };

        var hash = '#' + topic.id + '/' + chapter.file;
        window.history.pushState(state, '', hash);

        // Also save to localStorage
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
        } catch (e) {
            console.warn('Could not save to localStorage:', e);
        }
    },

    // Restore position from URL hash or localStorage
    restorePosition: function() {
        var self = this;
        var hash = window.location.hash.slice(1); // Remove the '#'

        // Try URL hash first
        if (hash) {
            var parts = hash.split('/');
            if (parts.length >= 2) {
                var topicId = parts[0];
                var filename = parts.slice(1).join('/');

                var topicIdx = this.findTopicIndex(topicId);
                if (topicIdx !== -1) {
                    var chapterIdx = this.findChapterIndex(topicIdx, filename);
                    this.selectTopic(topicIdx, false, chapterIdx !== -1 ? chapterIdx : 0);
                    return true;
                }
            }
        }

        // Try localStorage
        try {
            var saved = localStorage.getItem(CONFIG.storageKey);
            if (saved) {
                var position = JSON.parse(saved);
                var topicIdx = this.findTopicIndex(position.topicId);
                if (topicIdx !== -1) {
                    var chapterIdx = this.findChapterIndex(topicIdx, position.chapterFile);
                    this.selectTopic(topicIdx, false, chapterIdx !== -1 ? chapterIdx : 0);
                    return true;
                }
            }
        } catch (e) {
            console.warn('Could not restore from localStorage:', e);
        }

        return false;
    },

    // Restore state from history popstate event
    restoreState: function(state, pushToHistory) {
        if (!state || this.isNavigating) return;

        this.isNavigating = true;

        var topicIdx = this.findTopicIndex(state.topicId);
        if (topicIdx !== -1) {
            var chapterIdx = this.findChapterIndex(topicIdx, state.chapterFile);
            if (topicIdx !== this.currentTopicIndex) {
                // Hand the chapter to selectTopic: calling it and then
                // loadChapter starts two fetches for the same panel.
                this.selectTopic(topicIdx, false, chapterIdx !== -1 ? chapterIdx : 0);
            } else if (chapterIdx !== -1) {
                this.loadChapter(chapterIdx, false);
            }
        }

        this.isNavigating = false;
    },

    findTopicIndex: function(topicId) {
        for (var i = 0; i < this.topics.length; i++) {
            if (this.topics[i].id === topicId) {
                return i;
            }
        }
        return -1;
    },

    findChapterIndex: function(topicIdx, filename) {
        var chapters = this.topics[topicIdx].chapters;
        for (var i = 0; i < chapters.length; i++) {
            if (chapters[i].file === filename) {
                return i;
            }
        }
        return -1;
    },

    selectTopic: function(index, pushHistory, initialChapter) {
        index = parseInt(index);
        if (isNaN(index) || index < 0 || index >= this.topics.length) {
            return;
        }

        this.currentTopicIndex = index;
        this.currentChapterIndex = 0;

        var topic = this.topics[index];
        var pageSelector = document.getElementById('page-selector');
        pageSelector.innerHTML = '';
        pageSelector.disabled = false;

        topic.chapters.forEach(function(chapter, idx) {
            var option = document.createElement('option');
            option.value = idx;
            option.textContent = chapter.title;
            pageSelector.appendChild(option);
        });

        document.getElementById('topic-selector').value = index;

        if (topic.chapters.length > 0) {
            var startChapter = (initialChapter !== undefined) ? initialChapter : 0;
            this.loadChapter(startChapter, pushHistory !== false);
        }
    },

    loadChapter: function(index, pushHistory) {
        var self = this;

        if (this.currentTopicIndex < 0) return Promise.resolve();

        var topic = this.topics[this.currentTopicIndex];
        if (index < 0 || index >= topic.chapters.length) {
            return Promise.resolve();
        }

        this.currentChapterIndex = index;
        var chapter = topic.chapters[index];
        var contentDiv = document.getElementById('markdown-content');

        contentDiv.innerHTML = '<div class="loading">Loading...</div>';

        var filePath = CONFIG.contentBase + topic.id + '/' + chapter.file;
        var seq = ++this.loadSeq;

        return QuizManager.ensureLoaded(topic.id)
            .then(function() {
                return fetch(filePath);
            })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.text();
            })
            .then(function(markdown) {
                if (seq !== self.loadSeq) return;
                contentDiv.innerHTML = MarkdownRenderer.render(markdown);
                QuizManager.injectQuizzes(contentDiv, topic.id);
                TabManager.injectTabs(contentDiv);
                self.attachLinkHandlers(contentDiv);
                document.getElementById('content-panel').scrollTop = 0;
                self.updateNavigation();

                // Save position and push to history
                if (pushHistory !== false && !self.isNavigating) {
                    self.pushState();
                } else {
                    self.savePosition();
                }
            })
            .catch(function(error) {
                if (seq !== self.loadSeq) return;
                self.showError('Error Loading Chapter', chapter.file + ' — ' + error.message);
                self.updateNavigation();
            });
    },

    loadMarkdownFile: function(filepath, pushHistory, anchor) {
        var self = this;
        var contentDiv = document.getElementById('markdown-content');

        // Parse the filepath to determine topic and file
        var parts = filepath.split('/');
        var topicId, filename;

        // Resolve ./ and ../ against the current topic directory, so idiomatic
        // relative links work: ./x.md stays here, ../other/x.md crosses topics.
        // Without this, '.' or '..' is taken as the topic id.
        if (parts[0] === '.' || parts[0] === '..') {
            var resolved = [this.topics[this.currentTopicIndex].id];
            parts.forEach(function(seg) {
                if (seg === '.' || seg === '') return;
                if (seg === '..') { if (resolved.length) resolved.pop(); return; }
                resolved.push(seg);
            });
            parts = resolved;
        }

        if (parts.length >= 2) {
            // Cross-topic link: topic-id/filename.md
            topicId = parts[0];
            filename = parts.slice(1).join('/');
        } else {
            // Same topic link: filename.md. Use the resolved segment, not the
            // raw path, or a link that walked past the root escapes content/.
            topicId = this.topics[this.currentTopicIndex].id;
            filename = parts[0];
        }

        var filePath = CONFIG.contentBase + topicId + '/' + filename;
        var seq = ++this.loadSeq;

        return QuizManager.ensureLoaded(topicId)
            .then(function() {
                return fetch(filePath);
            })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.text();
            })
            .then(function(markdown) {
                if (seq !== self.loadSeq) return;
                contentDiv.innerHTML = MarkdownRenderer.render(markdown);
                QuizManager.injectQuizzes(contentDiv, topicId);
                TabManager.injectTabs(contentDiv);
                self.attachLinkHandlers(contentDiv);
                document.getElementById('content-panel').scrollTop = 0;
                if (anchor) {
                    self.scrollToAnchor(anchor);
                }

                // Update selectors if this file is in manifest
                var topicIdx = self.findTopicIndex(topicId);
                var chapterIdx = -1;

                if (topicIdx !== -1) {
                    chapterIdx = self.findChapterIndex(topicIdx, filename);

                    if (topicIdx !== self.currentTopicIndex) {
                        self.currentTopicIndex = topicIdx;
                        document.getElementById('topic-selector').value = topicIdx;

                        var topic = self.topics[topicIdx];
                        var pageSelector = document.getElementById('page-selector');
                        pageSelector.innerHTML = '';

                        topic.chapters.forEach(function(chapter, idx) {
                            var option = document.createElement('option');
                            option.value = idx;
                            option.textContent = chapter.title;
                            pageSelector.appendChild(option);
                        });
                    }
                }

                if (chapterIdx !== -1) {
                    self.currentChapterIndex = chapterIdx;
                } else if (topicIdx !== -1) {
                    // Not in the manifest: the index still refers to the topic
                    // we came from, so keep it inside the new one's range.
                    var count = self.topics[topicIdx].chapters.length;
                    if (self.currentChapterIndex >= count) self.currentChapterIndex = 0;
                }

                self.updateNavigation();

                // Push to history for internal link navigation
                if (pushHistory !== false) {
                    self.pushState();
                } else {
                    self.savePosition();
                }
            })
            .catch(function(error) {
                if (seq !== self.loadSeq) return;
                self.showError('Error Loading File', filepath + ' — ' + error.message);
            });
    },

    attachLinkHandlers: function(container) {
        var self = this;
        var links = container.querySelectorAll('a');

        links.forEach(function(link) {
            var href = link.getAttribute('href') || '';

            // Same-page anchor only (e.g. href="#variables")
            if (href.indexOf('#') === 0) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    self.scrollToAnchor(href.slice(1));
                });
                return;
            }

            var hashIdx = href.indexOf('#');
            var filePart = hashIdx !== -1 ? href.slice(0, hashIdx) : href;
            var anchor = hashIdx !== -1 ? href.slice(hashIdx + 1) : '';

            if (filePart.endsWith('.md')) {
                link.classList.add('internal-link');
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    self.loadMarkdownFile(filePart, true, anchor);
                });
            }
            else if (href.indexOf('http://') === 0 || href.indexOf('https://') === 0) {
                link.classList.add('external-link');
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }
        });
    },

    scrollToAnchor: function(anchor) {
        if (!anchor) return;
        setTimeout(function() {
            var el = document.getElementById(anchor);
            if (!el) return;
            var contentPanel = document.getElementById('content-panel');
            var navHeader = contentPanel.querySelector('.nav-header');
            var navHeight = navHeader ? navHeader.offsetHeight : 0;
            var elRect = el.getBoundingClientRect();
            var panelRect = contentPanel.getBoundingClientRect();
            contentPanel.scrollTop += elRect.top - panelRect.top - navHeight - 16;
        }, 0);
    },

    updateNavigation: function() {
        document.getElementById('page-selector').value = this.currentChapterIndex;

        if (this.currentTopicIndex < 0) return;

        var topic = this.topics[this.currentTopicIndex];
        document.getElementById('prev-btn').disabled = (this.currentChapterIndex === 0);
        document.getElementById('next-btn').disabled = (this.currentChapterIndex === topic.chapters.length - 1);
    },

    prev: function() {
        this.loadChapter(this.currentChapterIndex - 1, true);
    },

    next: function() {
        this.loadChapter(this.currentChapterIndex + 1, true);
    },

    goTo: function(index) {
        this.loadChapter(parseInt(index), true);
    },

    showError: function(title, detail) {
        var div = document.createElement('div');
        div.className = 'error-message';
        var h2 = document.createElement('h2');
        h2.textContent = title;
        var p = document.createElement('p');
        p.textContent = detail;
        div.appendChild(h2);
        div.appendChild(p);
        var content = document.getElementById('markdown-content');
        content.innerHTML = '';
        content.appendChild(div);
    }
};

// =====================
// Terminal Panel
// =====================
var TerminalPanel = {
    visible: true,

    init: function() {
        this.updateButtonState();
    },

    toggle: function() {
        var panel = document.getElementById('terminal-panel');
        this.visible = !this.visible;

        if (this.visible) {
            panel.classList.remove('hidden');
            PanelResizer.show();
        } else {
            panel.classList.add('hidden');
            PanelResizer.hide();
        }

        this.updateButtonState();
    },

    updateButtonState: function() {
        var btn = document.getElementById('toggle-terminal-btn');
        if (this.visible) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    },

    openNewWindow: function() {
        window.open('tty/', '_blank');
    }
};

// =====================
// Initialize
// =====================
function init() {
    if (typeof markdownit === 'undefined' || typeof markdownitContainer === 'undefined') {
        setTimeout(init, 50);
        return;
    }
    MarkdownRenderer.init();
    PanelResizer.init();
    ContentNav.init();
    TerminalPanel.init();
    Search.init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
