/* ============================================================
   ИИ-помощник студентов СКГУ им. М. Козыбаева (ku.edu.kz)
   ------------------------------------------------------------
   • Кнопка справа снизу → панель чата на 1/3 ширины экрана
   • Ответы строго по страницам сайта (RAG: BM25-поиск по индексу)
   • Ответ формирует серверный помощник Gemma, опираясь на базу KU
   • При недоступности API остаётся локальный поиск с выдержками
   ============================================================ */
(function () {
  'use strict';

  var CFG = {
    aiApi:        'https://ku-portal.onrender.com', // сервер Gemma + база материалов KU
    model:        'google/gemma-4-e4b',      // модель на сервере университета
    topPages:     5,                        // сколько страниц показывать в локальном режиме
    topChunks:    3,                        // сколько кусков со страницы
    maxSources:   4,                        // сколько источников показывать
    sourceMode:   'local',                  // 'local' — копия на этом сервере, 'canonical' — оригинальный сайт
    aiTimeoutSec: 120                       // ожидание ответа модели
  };

  var script = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();

  /* ---- пути ---- */
  var SRC = script.src;
  var idxAt = SRC.indexOf('/chatbot/chatbot');
  var SITE_ROOT = SRC.slice(0, idxAt);                       // …/ku.edu.kz или https://host
  var SERVER_ROOT = SITE_ROOT.replace(/\/ku\.edu\.kz$/, ''); // корень зеркала (для локальных ссылок)
  var INDEX_URL = SITE_ROOT + '/chatbot/data/index.json';
  var ICON_URL = SITE_ROOT + '/chatbot/bird-idle.png';

  /* ================= токенизация (должна совпадать с build_index.py) ================= */

  var STOP = {};
  ('a an the and or of to in on at for with by from as is are was were be been being it its this ' +
   'that these those не ни и но или же ли что чтобы как это этот эта эти указанных указанного ' +
   'которые который которое при о у к из от до по за на с без а также http https www com kz html ' +
   'page view index ru list detail id s b i p div span class href title').split(/\s+/).forEach(function (w) {
    if (w) STOP[w] = 1;
  });

  // размер суффиксов — точно как в build_index.py (порядок важен)
   var SUF = ('иями ями мов ова ует али ами ого его ому ему ыми ими ать ять еть уть ными кий кая ое ее ые ий ая ую юю ом ем ах ях ов ев ой ей ам ям ум ым их ых ья ье ию ея тся ться ит ат ят ют ет ла ло ли ны на ть ся um ер es ed')
            .split(' ').filter(function (s, i, a) { return s.length && a.indexOf(s) === i; });

  function stem(w) {
    if (w.length <= 4) return w;
    var changed = true;
    while (changed && w.length > 4) {
      changed = false;
      for (var i = 0; i < SUF.length; i++) {
        var s = SUF[i];
        if (w.length - s.length >= 3 && w.slice(-s.length) === s) {
          w = w.slice(0, -s.length);
          changed = true;
          break;
        }
      }
    }
    return w.length > 7 ? w.slice(0, 7) : w;
  }

  var TOKEN_RE = /[0-9a-zA-Zа-яА-ЯёЁ]{3,}/g;
  function tokenize(text) {
    var out = [];
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(String(text).toLowerCase())) !== null) {
      var raw = m[0];
      if (STOP[raw]) continue;
      var s = stem(raw);
      if (s) out.push(s);
    }
    return out;
  }

  /* ================= поисковый индекс ================= */

  var DB = null;    // загруженный индекс
  var q4map = null; // префиксный справочник для «мягкого» поиска

  function buildQ4() {
    q4map = {};
    Object.keys(DB.postings).forEach(function (tok) {
      var k = tok.slice(0, 4);
      if (!q4map[k]) q4map[k] = [];
      q4map[k].push(tok);
    });
  }

  function search(query) {
    if (!DB) return [];
    var toks = tokenize(query);
    var uniq = toks.filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (!uniq.length) return [];

    var P = DB.pages, C = DB.chunks, po = DB.postings;
    var n = DB.n_chunks, avdl = DB.avdl, k1 = DB.k1, b = DB.b;

    var scores = {};
    var usedIdf = {};
    function addPostings(t, idf, mult) {
      var lst = po[t];
      if (!lst) return;
      lst.forEach(function (e) {
        var cid = e[0], tf = e[1];
        var dlen = C[cid].t.length / 6.2 || 40; // ≈ число слов в чанке
        var s = idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * dlen / avdl)) * mult;
        scores[cid] = (scores[cid] || 0) + s;
      });
    }

    // точное совпадение
    uniq.forEach(function (t) {
      var lst = po[t];
      if (!lst) return;
      var idf = Math.log((n - lst.length + 0.5) / (lst.length + 0.5) + 1);
      usedIdf[t] = idf;
      addPostings(t, idf, 1);
    });

    // ничего не нашлось → мягкий разбор: совпадения по 4-буквенному префиксу
    var total = 0;
    Object.keys(scores).forEach(function (k) { total += scores[k]; });
    if (total < 1.2) {
      uniq.forEach(function (t) {
        if (t.length < 5) return;
        (q4map[t.slice(0, 4)] || []).forEach(function (tok) {
          if (usedIdf[tok]) return;
          var lst = po[tok];
          var idf = Math.log((n - lst.length + 0.5) / (lst.length + 0.5) + 1) * 0.55;
          addPostings(tok, idf, 1);
        });
      });
    }

    // группируем по страницам
    var pageBest = {}, pageHits = {};
    Object.keys(scores).forEach(function (cidS) {
      var cid = +cidS;
      var u = C[cid].u;
      if (pageBest[u] === undefined || scores[cidS] > pageBest[u]) pageBest[u] = scores[cidS];
      if (!pageHits[u]) pageHits[u] = [];
      pageHits[u].push(cid);
    });

    // бонус за совпадение в заголовке страницы
    Object.keys(pageBest).forEach(function (uStr) {
      var u = +uStr;
      var tk = P[u].tk || [];
      var bonus = 0;
      uniq.forEach(function (t) {
        if (tk.indexOf(t) !== -1) bonus += (usedIdf[t] || 0.5) * 1.1;
      });
      if (bonus) pageBest[uStr] += bonus;
    });

    var rows = Object.keys(pageBest).map(function (u) {
      return { u: +u, score: pageBest[u], cids: pageHits[u] };
    });
    rows.sort(function (a, b) { return b.score - a.score; });
    return rows;
  }

  /* ================= UI ================= */

  var fab, fabLabel, panel, msgs, inputEl, sendBtn, statusDot, statusText, statusLabel;
  var aiMode = false;        // доступна ли модель
  var indexState = 'empty';  // empty | loading | ready | error
  var busy = false;
  var opened = false;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pageLocalHref(p) { return SERVER_ROOT + '/' + p; }
  function pageCanonicalHref(c) {
    if (!c) return null;
    return /^https?:\/\//i.test(c) ? c : 'https://' + c;
  }
  function shortUrl(u) { return String(u || '').replace(/^https?:\/\//, ''); }

  /* лёгкий markdown → HTML (текст модели) */
  function fmt(s) {
    return esc(s)
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\s*[-•]\s+/gm, '&bull; ');
  }

  function addMessage(kind, html, who) {
    var wrap = el('div', 'kwc-msg kwc-msg--' + kind);
    if (kind === 'bot') wrap.appendChild(assistantAvatar());
    var content = el('div', 'kwc-msg__content');
    if (who && kind !== 'user') content.appendChild(el('span', 'kwc-msg__who', esc(who)));
    var body = el('div', 'kwc-msg__body');
    body.innerHTML = kind === 'bot' ? fmt(html) : html;
    content.appendChild(body);
    wrap.appendChild(content);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return wrap;
  }

  function assistantAvatar() {
    var avatar = el('span', 'kwc-avatar');
    var img = document.createElement('img');
    img.src = ICON_URL;
    img.alt = '';
    avatar.appendChild(img);
    return avatar;
  }

  function addSys(text) { return addMessage('sys', text); }

  function typingBubble() {
    var m = el('div', 'kwc-msg kwc-msg--bot');
    m.appendChild(assistantAvatar());
    var content = el('div', 'kwc-msg__content');
    content.innerHTML = '<span class="kwc-msg__who">Помощник</span><span class="kwc-msg__body"><span class="kwc-typing"><i></i><i></i><i></i></span></span>';
    m.appendChild(content);
    msgs.appendChild(m);
    msgs.scrollTop = msgs.scrollHeight;
    return m;
  }

  function sourcesBlock(pages) {
    var box = el('div', 'kwc-sources');
    box.appendChild(el('div', 'kwc-sources__cap', 'Источники · страницы ku.edu.kz'));
    pages.slice(0, CFG.maxSources).forEach(function (pg) {
      var canon = pageCanonicalHref(pg.c);
      var href = CFG.sourceMode === 'canonical' && canon ? canon : pageLocalHref(pg.p);
      var a = el('a', 'kwc-src');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      if (canon) a.title = canon;
      a.innerHTML =
        '<span class="kwc-src__ico">📄</span>' +
        '<span class="kwc-src__body">' +
          '<span class="kwc-src__title">' + esc(pg.h || 'Страница сайта') + '</span>' +
          '<span class="kwc-src__url">' + esc(shortUrl(pg.c || pg.p)) + '</span>' +
        '</span>' +
        '<span class="kwc-src__go" aria-hidden="true">↗</span>';
      box.appendChild(a);
    });
    return box;
  }

  function remoteSourcesBlock(sourceText, fallbackPages) {
    var box = el('div', 'kwc-sources');
    box.appendChild(el('div', 'kwc-sources__cap', 'Источники · материалы Kozybayev University'));
    var lines = String(sourceText || '').split(/\n+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s !== 'offline'; }).slice(0, CFG.maxSources);
    if (!lines.length) return sourcesBlock(fallbackPages);
    lines.forEach(function (line) {
      var match = line.match(/https:\/\/ku\.edu\.kz\S*/i);
      var href = match ? match[0].replace(/[),.;]+$/, '') : '';
      var label = href ? line.replace(href, '').replace(/[\s—-]+$/, '') : line;
      if (!href) {
        var pageMatch = line.match(/^(.*?),\s*PDF,\s*стр\.\s*(\d+)/i);
        if (pageMatch) label = pageMatch[1] + ' · PDF, стр. ' + pageMatch[2];
      }
      var a = el(href ? 'a' : 'div', 'kwc-src');
      if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener'; }
      a.innerHTML = '<span class="kwc-src__ico">📄</span>' +
        '<span class="kwc-src__body"><span class="kwc-src__title">' + esc(label || 'Материал университета') + '</span>' +
        '<span class="kwc-src__url">' + esc(href ? shortUrl(href) : 'Материал KU') + '</span></span>' +
        (href ? '<span class="kwc-src__go" aria-hidden="true">↗</span>' : '');
      box.appendChild(a);
    });
    return box;
  }

  function suggestions() {
    var box = el('div', 'kwc-chips');
    ['Как поступить в СКГУ?', 'Общежития и кампус', 'Гранты и стипендии',
     'Стоимость обучения', 'Электронный ректорат'].forEach(function (q) {
      var b = el('button', 'kwc-chip', esc(q));
      b.type = 'button';
      b.addEventListener('click', function () { sendQuery(q); });
      box.appendChild(b);
    });
    return box;
  }

  function greet() {
    addMessage('bot',
      'Здравствуйте! Я помогу найти информацию об учёбе и жизни в Kozybayev University. Отвечаю по материалам университета и показываю источники. Что вас интересует?', 'Помощник');
    msgs.appendChild(suggestions());
    msgs.scrollTop = msgs.scrollHeight;
  }

  /* ================= загрузка индекса ================= */

  function ensureIndex(onReady, onFail) {
    if (indexState === 'ready') return onReady();
    if (indexState === 'error') return onFail && onFail();

    if (indexState === 'loading') {
      // ждём завершения уже идущей загрузки
      var t = setInterval(function () {
        if (indexState === 'ready') { clearInterval(t); onReady(); }
        else if (indexState === 'error') { clearInterval(t); onFail && onFail(); }
      }, 120);
      return;
    }

    indexState = 'loading';
    var waitMsg = addSys('Загружаю базу знаний сайта…');
    fetch(INDEX_URL)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        DB = d;
        buildQ4();
        indexState = 'ready';
        if (waitMsg.parentNode) msgs.removeChild(waitMsg);
        onReady();
      })
      .catch(function (e) {
        console.warn('chatbot: не удалось загрузить индекс', e);
        indexState = 'error';
        if (waitMsg.parentNode) msgs.removeChild(waitMsg);
        var m = addMessage('bot',
          'Не получилось загрузить базу знаний сайта 😕 Обычно это значит, что сайт ' +
          'нужно открыть через <b>python -m http.server</b> из папки зеркала. ' +
          'Перезагрузите страницу (Ctrl+F5) и попробуйте снова.', 'Помощник');
        m.classList.add('kwc-msg--error');
        onFail && onFail();
      });
  }

  /* ================= серверный AI API ================= */

  function updateStatus() {
    if (!statusDot || !statusText || !statusLabel) return;
    if (aiMode) {
      statusDot.className = 'kwc-head__status kwc-head__status--ai';
      statusLabel.textContent = 'На связи';
    } else {
      statusDot.className = 'kwc-head__status kwc-head__status--local';
      statusLabel.textContent = 'Поиск по сайту';
    }
  }

  function checkAI() {
    return fetch(CFG.aiApi + '/api/ai/status')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { return d.online ? (d.model || CFG.model) : null; })
      .catch(function () { return null; });
  }

  function askRemoteAI(question) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, CFG.aiTimeoutSec * 1000);
    return fetch(CFG.aiApi + '/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ message: question })
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.reply || data.src === 'offline') throw new Error('AI API недоступен');
      return data;
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ================= формирование ответа ================= */

  function buildContext(rows) {
    var parts = [];
    var budget = 6400;
    rows.slice(0, CFG.topPages).forEach(function (row, i) {
      var pg = DB.pages[row.u];
      var text = '';
      row.cids.slice(0, CFG.topChunks).forEach(function (cid) {
        text += (text ? ' … ' : '') + DB.chunks[cid].t;
      });
      if (text.length > 1400) text = text.slice(0, 1400) + '…';
      var head = '[' + (i + 1) + '] ' + (pg.h || 'Страница') + ' — ' + shortUrl(pg.c || pg.p) + '\n';
      if (budget - head.length - text.length < 0) return;
      budget -= head.length + text.length;
      parts.push(head + text);
    });
    return parts.join('\n\n');
  }

  function fallbackAnswer(rows) {
    var lines = [];
    rows.slice(0, 3).forEach(function (row) {
      var text = '';
      row.cids.slice(0, 2).forEach(function (cid) {
        text += (text ? ' ' : '') + DB.chunks[cid].t;
      });
      var s = text.replace(/\s+/g, ' ').slice(0, 260).trim();
      lines.push('• ' + s + (s.length === 260 ? '…' : ''));
    });
    return 'Модель ИИ сейчас недоступна, вот что нашлось на страницах сайта:\n\n' + lines.join('\n\n');
  }

  function sendQuery(q) {
    q = (q || '').trim();
    if (!q || busy) return;
    busy = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    inputEl.style.height = '';

    addMessage('user', esc(q), 'Вы');
    var tp = typingBubble();

    ensureIndex(function () {
      var rows = search(q);
      if (!rows.length && !aiMode) {
        if (tp.parentNode) msgs.removeChild(tp);
        addMessage('bot',
          'На страницах сайта не нашёл ничего по этому запросу 🤔 Попробуйте другими ' +
          'словами — например: «поступление», «общежитие», «гранты», «пересдача сессии», ' +
          '«расписание», «контакты».', 'Помощник');
        busy = false;
        sendBtn.disabled = false;
        return;
      }

      var hitPages = rows.map(function (r) { return DB.pages[r.u]; });
      function finish() {
        msgs.scrollTop = msgs.scrollHeight;
        busy = false;
        sendBtn.disabled = false;
        try { inputEl.focus(); } catch (e) { /* ignore */ }
      }

      if (aiMode) {
        askRemoteAI(q).then(function (answer) {
          if (tp.parentNode) msgs.removeChild(tp);
          var m = addMessage('bot', answer.reply || 'Не удалось получить ответ. Попробуйте ещё раз.', 'Помощник');
          m.querySelector('.kwc-msg__body').appendChild(remoteSourcesBlock(answer.src, hitPages));
          finish();
        }).catch(function (e) {
          console.warn('chatbot: не удалось получить ответ от модели', e);
          if (tp.parentNode) msgs.removeChild(tp);
          var fallback = rows.length ? fallbackAnswer(rows) : 'Не удалось получить ответ от ИИ. Попробуйте позже.';
          var m = addMessage('bot', fallback, 'Помощник');
          if (hitPages.length) m.querySelector('.kwc-msg__body').appendChild(sourcesBlock(hitPages));
          aiMode = false;
          updateStatus();
          finish();
        });
      } else {
        if (tp.parentNode) msgs.removeChild(tp);
        var m = addMessage('bot', fallbackAnswer(rows), 'Помощник');
        m.querySelector('.kwc-msg__body').appendChild(sourcesBlock(hitPages));
        finish();
      }
    }, function () {
      if (tp.parentNode) msgs.removeChild(tp);
      busy = false;
      sendBtn.disabled = false;
    });
  }

  /* ================= построение интерфейса ================= */

  function buildUI() {
    // кнопка
    fab = document.createElement('button');
    fab.id = 'kwc-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Открыть ИИ-помощника');
    fab.title = 'ИИ-помощник СКГУ';
    var fabIcon = document.createElement('img');
    fabIcon.src = ICON_URL;
    fabIcon.alt = '';
    fab.appendChild(fabIcon);
    document.body.appendChild(fab);

    // всплывающая подпись
    fabLabel = el('div', '', 'Спросите меня — помогу найти!');
    fabLabel.id = 'kwc-fab-label';
    document.body.appendChild(fabLabel);
    setTimeout(function () { fabLabel.classList.add('kwc-fab-label--show'); }, 2200);
    setTimeout(function () { fabLabel.classList.remove('kwc-fab-label--show'); }, 7600);

    // подложка для мобильной версии
    var backdrop = el('div');
    backdrop.id = 'kwc-backdrop';
    document.body.appendChild(backdrop);

    // панель
    panel = el('section');
    panel.id = 'kwc-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ИИ-помощник СКГУ');

    var head = el('div', 'kwc-head');
    var headLogo = el('div', 'kwc-head__logo');
    var headIcon = document.createElement('img');
    headIcon.src = ICON_URL;
    headIcon.alt = '';
    headLogo.appendChild(headIcon);
    head.appendChild(headLogo);
    var brand = el('div', 'kwc-head__brand');
    brand.appendChild(el('div', 'kwc-head__title', 'Помощник Kozybayev University'));
    statusText = el('div', 'kwc-head__sub');
    statusDot = el('span', 'kwc-head__status');
    statusLabel = el('span', '', 'проверяю модель…');
    statusText.appendChild(statusDot);
    statusText.appendChild(statusLabel);
    brand.appendChild(statusText);
    head.appendChild(brand);

    var clearBtn = el('button', 'kwc-head__btn');
    clearBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 1 0 7.6 10.5M12 4V1m0 3h4M12 8v4l3 2"/></svg>';
    clearBtn.type = 'button';
    clearBtn.title = 'Новый диалог';
    clearBtn.setAttribute('aria-label', 'Новый диалог');
    head.appendChild(clearBtn);

    var closeBtn = el('button', 'kwc-head__btn kwc-head__btn--close');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"/></svg>';
    closeBtn.type = 'button';
    closeBtn.title = 'Закрыть';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    head.appendChild(closeBtn);
    panel.appendChild(head);

    msgs = el('div', 'kwc-msgs');
    panel.appendChild(msgs);

    var inputRow = el('div');
    inputRow.id = 'kwc-input';
    inputEl = document.createElement('textarea');
    inputEl.rows = 1;
    inputEl.placeholder = 'Спросите об университете…';
    inputEl.setAttribute('aria-label', 'Ваш вопрос');
    sendBtn = el('button', 'kwc-send');
    sendBtn.type = 'button';
    sendBtn.title = 'Отправить';
    sendBtn.setAttribute('aria-label', 'Отправить');
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
    inputRow.appendChild(inputEl);
    inputRow.appendChild(sendBtn);
    panel.appendChild(inputRow);

    panel.appendChild(el('div', 'kwc-foot',
      'Ответы основаны на материалах университета. Проверяйте важные сведения в источниках.'));
    document.body.appendChild(panel);

    // события
    fab.addEventListener('click', toggle);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    clearBtn.addEventListener('click', function () {
      msgs.textContent = '';
      greet();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('kwc-open')) close();
    });
    document.addEventListener('mousedown', function (e) {
      if (!panel.classList.contains('kwc-open')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      close();
    });
    sendBtn.addEventListener('click', function () { sendQuery(inputEl.value); });
    inputEl.addEventListener('input', function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendQuery(inputEl.value);
      }
    });
  }

  function open() {
    panel.classList.add('kwc-open');
    document.body.classList.add('kwc-open');
    if (!opened) {
      opened = true;
      greet();
      ensureIndex(function () {}, function () {});
      checkAI().then(function (model) {
        aiMode = !!model;
        updateStatus();
      });
    }
    setTimeout(function () { try { inputEl.focus(); } catch (e) { /* ignore */ } }, 280);
  }

  function close() {
    panel.classList.remove('kwc-open');
    document.body.classList.remove('kwc-open');
  }

  function toggle() {
    if (panel.classList.contains('kwc-open')) close();
    else open();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }
})();
