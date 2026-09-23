// =====================
// Quiz (quiz.js)
// =====================
// Self-contained quiz subsystem: a GIFT-format parser (GIFTParser) and the
// quiz widget manager (QuizManager). Standalone — no dependency on other app
// modules; QuizManager is invoked by ContentNav.loadChapter in app.js. Must be
// loaded before init() runs (i.e. before DOMContentLoaded).

// =====================
// GIFT Quiz Parser
// =====================
var GIFTParser = {
    parse: function(text) {
        var questions = {};
        var cleaned = text.split('\n').filter(function(l) {
            return l.trim().indexOf('//') !== 0;
        }).join('\n');

        cleaned.split(/\n\s*\n/).forEach(function(block) {
            block = block.trim();
            if (!block) return;
            var q = GIFTParser.parseQuestion(block);
            if (q) questions[q.id] = q;
        });

        return questions;
    },

    parseQuestion: function(block) {
        var idMatch = block.match(/^::([^:]+)::/);
        if (!idMatch) return null;

        var id = idMatch[1].trim();
        var rest = block.slice(idMatch[0].length);
        var braceIdx = rest.indexOf('{');
        if (braceIdx === -1) return null;

        var questionText = rest.slice(0, braceIdx).trim();
        var inner = rest.slice(braceIdx + 1);
        var closeIdx = inner.lastIndexOf('}');
        if (closeIdx === -1) return null;
        inner = inner.slice(0, closeIdx).trim();

        var generalFeedback = '';
        var quadIdx = inner.indexOf('####');
        if (quadIdx !== -1) {
            generalFeedback = inner.slice(quadIdx + 4).trim();
            inner = inner.slice(0, quadIdx).trim();
        }

        var tfMatch = inner.match(/^(TRUE|FALSE|T|F)\b/i);
        if (tfMatch) {
            return {
                id: id, type: 'truefalse', text: questionText,
                correct: /^(TRUE|T)$/i.test(tfMatch[1]),
                feedback: generalFeedback
            };
        }

        if (inner.indexOf('~') !== -1) {
            return GIFTParser.parseMultipleChoice(id, questionText, inner, generalFeedback);
        }
        if (inner.indexOf('=') !== -1) {
            return GIFTParser.parseShortAnswer(id, questionText, inner, generalFeedback);
        }

        return null;
    },

    parseMultipleChoice: function(id, text, inner, feedback) {
        var options = [];
        inner.split('\n').forEach(function(line) {
            line = line.trim();
            if (!line || (line[0] !== '=' && line[0] !== '~')) return;
            var isCorrect = line[0] === '=';
            var content = line.slice(1).trim();
            var choiceFeedback = '';
            var hm = content.match(/\s#([^#].*)$/);
            if (hm) { choiceFeedback = hm[1].trim(); content = content.slice(0, hm.index).trim(); }
            if (content) options.push({ text: content, correct: isCorrect, feedback: choiceFeedback });
        });
        return { id: id, type: 'multichoice', text: text, options: options, feedback: feedback };
    },

    parseShortAnswer: function(id, text, inner, feedback) {
        var answers = [];
        inner.split('\n').forEach(function(line) {
            line = line.trim();
            if (!line || line[0] !== '=') return;
            var content = line.slice(1).trim();
            var hm = content.match(/\s#([^#].*)$/);
            if (hm) content = content.slice(0, hm.index).trim();
            if (content) answers.push(content);
        });
        return { id: id, type: 'shortanswer', text: text, answers: answers, feedback: feedback };
    }
};

// =====================
// Quiz Manager
// =====================
var QuizManager = {
    cache: {},
    pending: {},

    ensureLoaded: function(topicId) {
        if (this.cache[topicId]) return Promise.resolve();
        if (this.pending[topicId]) return this.pending[topicId];

        var self = this;
        var url = CONFIG.contentBase + topicId + '/questions.gift';

        this.pending[topicId] = fetch(url)
            .then(function(r) { return r.ok ? r.text() : ''; })
            .then(function(text) {
                self.cache[topicId] = GIFTParser.parse(text);
                delete self.pending[topicId];
            })
            .catch(function() {
                self.cache[topicId] = {};
                delete self.pending[topicId];
            });

        return this.pending[topicId];
    },

    injectQuizzes: function(container, topicId) {
        var self = this;
        var questions = this.cache[topicId] || {};
        var placeholders = container.querySelectorAll('.quiz-placeholder');

        placeholders.forEach(function(placeholder) {
            var quizId = placeholder.getAttribute('data-quiz-id');
            var question = questions[quizId];
            var wrapper = document.createElement('div');

            if (!question) {
                wrapper.innerHTML = '<div class="admonition question quiz">' +
                    '<div class="admonition-title">Walk time</div>' +
                    '<div class="admonition-content"><p class="text-red">Question not found: ' +
                    self.escapeHtml(quizId) + '</p></div></div>';
            } else {
                wrapper.innerHTML = self.buildWidget(question);
                self.attachHandlers(wrapper.firstChild, question);
            }

            placeholder.parentNode.replaceChild(wrapper.firstChild, placeholder);
        });
    },

    shuffle: function(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    },

    buildWidget: function(question) {
        var body = '';
        if (question.type === 'multichoice') body = this.buildMC(question);
        else if (question.type === 'truefalse') body = this.buildTF(question);
        else if (question.type === 'shortanswer') body = this.buildSA(question);

        return '<div class="admonition question quiz">' +
            '<div class="admonition-title">Walk time</div>' +
            '<div class="admonition-content">' +
            '<p class="quiz-question">' + this.escapeHtml(question.text) + '</p>' +
            body +
            '<div class="quiz-feedback"></div>' +
            '</div></div>';
    },

    buildMC: function(question) {
        var shuffled = this.shuffle(question.options);
        var name = 'quiz-' + question.id;
        var html = '<div class="quiz-options">';
        shuffled.forEach(function(opt) {
            html += '<label class="quiz-option">' +
                '<input type="radio" name="' + name +
                '" data-correct="' + opt.correct +
                '" data-feedback="' + QuizManager.escapeAttr(opt.feedback) + '">' +
                '<span>' + QuizManager.escapeHtml(opt.text) + '</span></label>';
        });
        return html + '</div><button class="quiz-check-btn">Check Answer</button>';
    },

    buildTF: function(question) {
        var name = 'quiz-' + question.id;
        return '<div class="quiz-options">' +
            '<label class="quiz-option"><input type="radio" name="' + name +
            '" data-correct="' + question.correct + '"><span>True</span></label>' +
            '<label class="quiz-option"><input type="radio" name="' + name +
            '" data-correct="' + !question.correct + '"><span>False</span></label>' +
            '</div><button class="quiz-check-btn">Check Answer</button>';
    },

    buildSA: function(question) {
        return '<div class="quiz-input">' +
            '<input type="text" class="quiz-text-input" placeholder="Type your answer…">' +
            '<button class="quiz-check-btn">Check Answer</button></div>';
    },

    attachHandlers: function(quizEl, question) {
        var self = this;
        var btn = quizEl.querySelector('.quiz-check-btn');
        var feedbackEl = quizEl.querySelector('.quiz-feedback');
        if (!btn) return;

        btn.addEventListener('click', function() {
            if (quizEl.classList.contains('quiz-answered')) return;

            var isCorrect = false;
            var choiceFeedback = '';
            var correctLabel = '';

            if (question.type === 'multichoice' || question.type === 'truefalse') {
                var selected = quizEl.querySelector('input[type=radio]:checked');
                if (!selected) return;
                isCorrect = selected.getAttribute('data-correct') === 'true';
                choiceFeedback = selected.getAttribute('data-feedback') || '';

                if (!isCorrect) {
                    var radios = quizEl.querySelectorAll('input[type=radio]');
                    for (var i = 0; i < radios.length; i++) {
                        if (radios[i].getAttribute('data-correct') === 'true') {
                            correctLabel = radios[i].nextElementSibling.textContent;
                            break;
                        }
                    }
                }
            } else if (question.type === 'shortanswer') {
                var input = quizEl.querySelector('.quiz-text-input');
                var answer = input.value.trim();
                isCorrect = question.answers.some(function(a) {
                    return a.toLowerCase() === answer.toLowerCase();
                });
                if (!isCorrect) correctLabel = question.answers.join(', ');
            }

            quizEl.classList.add('quiz-answered');
            quizEl.classList.add(isCorrect ? 'quiz-correct' : 'quiz-incorrect');

            var inputs = quizEl.querySelectorAll('input');
            for (var j = 0; j < inputs.length; j++) inputs[j].disabled = true;
            btn.disabled = true;

            var resultText = isCorrect ? '✓ Correct!' : '✗ Incorrect.';
            if (!isCorrect && correctLabel) {
                resultText += ' Correct answer: ' + self.escapeHtml(correctLabel) + '.';
            }

            var explanation = choiceFeedback || question.feedback;
            feedbackEl.innerHTML = '<span class="quiz-result-text">' + resultText + '</span>' +
                (explanation ? '<p class="quiz-explanation">' + self.escapeHtml(explanation) + '</p>' : '');
            feedbackEl.style.display = 'block';
        });

        if (question.type === 'shortanswer') {
            var textInput = quizEl.querySelector('.quiz-text-input');
            if (textInput) {
                textInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') btn.click();
                });
            }
        }
    },

    escapeHtml: function(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    escapeAttr: function(text) {
        if (!text) return '';
        return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
};
