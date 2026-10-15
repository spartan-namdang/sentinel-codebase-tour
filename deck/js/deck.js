/* Codebase walkthrough deck: theme switch, slide footers, animated diagrams, layout audit, Reveal setup.
   Loaded in <head> so the saved theme applies before first paint;
   Deck.init() is called at the end of index.html. */
(function () {
  'use strict';

  var THEME_KEY = 'cw-deck-theme';
  var root = document.documentElement;

  /* ---- Theme: dark by default (like the PDF), light after the user presses T ---- */
  function readTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }
  function applyTheme(theme) {
    root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }
  function toggleTheme() {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  }
  applyTheme(readTheme());
  // keep the speaker view and the main window in step
  window.addEventListener('storage', function (e) {
    if (e.key === THEME_KEY) applyTheme(readTheme());
  });

  /* ---- Footer: "hirespartan.io · <data-section>", added as the last flex item of the slide
          so it can never cover content. data-footer="off" leaves it out on dense slides. ---- */
  function buildFooters() {
    document.querySelectorAll('.slides > section').forEach(function (slide) {
      if (slide.getAttribute('data-footer') === 'off') return;
      var foot = document.createElement('footer');
      foot.className = 's-foot';
      var brand = document.createElement('span');
      brand.textContent = 'hirespartan.io';
      foot.appendChild(brand);
      var part = slide.getAttribute('data-section');
      if (part) {
        var label = document.createElement('span');
        label.className = 's-foot-part';
        label.textContent = part;
        foot.appendChild(label);
      }
      slide.insertBefore(foot, slide.querySelector('aside.notes'));
    });
  }

  /* ---- Animated diagrams: <svg class="dg dg-anim" data-loop="8"> on the current slide (one or more).
          data-along="#path" data-at="0.3, 5" data-dur="0.6" [data-rev]  a dot that travels that path
          data-show="1 4, 5.7 7.4"                                       visible only in these windows
          <g data-scene="name" data-loop="5">                            drawn while that scene is active:
            the first one by default, then the last visible .fragment[data-scene] on the slide
          Times are seconds within the loop; the loop restarts on every slide or scene change.
          Controls: hovering a diagram shows a replay button (top right) that restarts the loop;
          clicking the diagram pauses and resumes it, and a pause icon stays visible while paused.
          The buttons sit just above the drawing when there is room (or data-tools="above"), else inside it. ---- */
  var dg = { slide: null, scene: null, items: [], t0: 0, raf: 0, paused: false, pausedAt: 0 };

  function dgList(value) {
    return (value || '').split(',').map(function (part) { return part.trim().split(/\s+/).map(Number); });
  }
  function dgScene(slide, svg) {
    var groups = svg.querySelectorAll('g[data-scene]');
    if (!groups.length) return '';
    var name = groups[0].getAttribute('data-scene');
    slide.querySelectorAll('.fragment.visible[data-scene]').forEach(function (el) {
      name = el.getAttribute('data-scene');
    });
    groups.forEach(function (g) { g.classList.toggle('is-active', g.getAttribute('data-scene') === name); });
    return name;
  }
  function dgTick(now) {
    var t = (now - dg.t0) / 1000;
    dg.items.forEach(function (it) {
      var lt = t % it.loop;
      var on = false;
      if (it.path) {
        it.at.forEach(function (a) {
          var k = (lt - a[0]) / it.dur;
          if (k < 0 || k >= 1) return;
          on = true;
          k = k * k * (3 - 2 * k);                     // ease in and out
          var p = it.path.getPointAtLength(it.len * (it.rev ? 1 - k : k));
          it.el.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')');
        });
      } else {
        on = it.show.some(function (w) { return lt >= w[0] && lt < w[1]; });
      }
      it.el.classList.toggle('is-on', on);
    });
    dg.raf = requestAnimationFrame(dgTick);
  }
  function dgStart() {
    var slide = Reveal.getCurrentSlide();
    var svgs = slide ? Array.prototype.slice.call(slide.querySelectorAll('.dg-anim')) : [];
    var scene = svgs.map(function (svg) { return dgScene(slide, svg); }).join('|');
    if (slide === dg.slide && scene === dg.scene) return;

    cancelAnimationFrame(dg.raf);
    dg.items.forEach(function (it) { it.el.classList.remove('is-on'); });
    dgSetPaused(false);
    dg.slide = slide;
    dg.scene = scene;
    dg.items = [];
    if (!svgs.length) return;

    svgs.forEach(function (svg) {
      svg.querySelectorAll('[data-along], [data-show]').forEach(function (el) {
        var group = el.closest('g[data-scene]');
        if (group && !group.classList.contains('is-active')) return;
        var it = { el: el, loop: Number(el.closest('[data-loop]').getAttribute('data-loop')) };
        if (el.hasAttribute('data-along')) {
          it.path = svg.querySelector(el.getAttribute('data-along'));
          it.len = it.path.getTotalLength();
          it.at = dgList(el.getAttribute('data-at'));
          it.dur = Number(el.getAttribute('data-dur'));
          it.rev = el.hasAttribute('data-rev');
        } else {
          it.show = dgList(el.getAttribute('data-show'));
        }
        dg.items.push(it);
      });
    });
    svgs.forEach(dgPlaceTools);
    dg.t0 = performance.now();
    dg.raf = requestAnimationFrame(dgTick);
  }

  /* ---- Diagram controls: replay on hover, click to pause / resume ---- */
  function dgSetPaused(paused) {
    dg.paused = paused;
    document.querySelectorAll('.dg-host').forEach(function (host) {
      host.classList.toggle('is-paused', paused && !!dg.slide && dg.slide.contains(host));
    });
  }
  function dgTogglePause() {
    if (!dg.items.length) return;
    if (dg.paused) {
      dg.t0 += performance.now() - dg.pausedAt;       // continue from the same moment
      dgSetPaused(false);
      dg.raf = requestAnimationFrame(dgTick);
    } else {
      cancelAnimationFrame(dg.raf);
      dg.pausedAt = performance.now();
      dgSetPaused(true);
    }
  }
  function dgReplay() {
    if (!dg.items.length) return;
    cancelAnimationFrame(dg.raf);
    dg.items.forEach(function (it) { it.el.classList.remove('is-on'); });
    dgSetPaused(false);
    dg.t0 = performance.now();
    dg.raf = requestAnimationFrame(dgTick);
  }
  // keep the buttons on the drawing itself, not on the empty sides of a letterboxed svg
  function dgPlaceTools(svg) {
    var host = svg.closest('.dg-host');
    var tools = host && host.querySelector('.dg-tools');
    if (!tools || !svg.viewBox || !svg.viewBox.baseVal) return;
    var vb = svg.viewBox.baseVal;
    // measure in slide pixels: Reveal scales the whole slide, so divide the screen rects by that scale
    var hostRect = host.getBoundingClientRect(), svgRect = svg.getBoundingClientRect();
    var scale = host.offsetWidth ? hostRect.width / host.offsetWidth : 1;
    var w = svgRect.width / scale, h = svgRect.height / scale;
    if (!w || !h || !vb.width || !vb.height) return;
    var drawW = w, drawH = h;
    if (w / h > vb.width / vb.height) drawW = h * vb.width / vb.height;
    else drawH = w * vb.height / vb.width;
    var left = (svgRect.left - hostRect.left) / scale + (w - drawW) / 2;
    var top = (svgRect.top - hostRect.top) / scale + (h - drawH) / 2;
    // just above the drawing when there is room, otherwise inside its top-right corner
    var above = top >= 46 || svg.getAttribute('data-tools') === 'above';
    tools.style.top = Math.round(above ? top - 44 : top + 6) + 'px';
    tools.style.right = Math.round(host.offsetWidth - (left + drawW) + 6) + 'px';
  }
  function buildDiagramControls() {
    document.querySelectorAll('svg.dg-anim').forEach(function (svg) {
      var host = svg.closest('figure') || svg.parentElement;
      host.classList.add('dg-host');
      var tools = document.createElement('div');
      tools.className = 'dg-tools';
      tools.innerHTML =
        '<button type="button" class="dg-btn dg-replay" title="Replay animation" aria-label="Replay animation">' +
          '<svg class="icon"><use href="#i-replay"/></svg></button>' +
        '<span class="dg-btn dg-paused" title="Paused: click the diagram to resume" role="status" aria-label="Animation paused">' +
          '<svg class="icon"><use href="#i-pause"/></svg></span>';
      host.appendChild(tools);
      tools.querySelector('.dg-replay').addEventListener('click', function (e) {
        e.stopPropagation();
        if (dg.slide && dg.slide.contains(svg)) dgReplay();
      });
      svg.addEventListener('click', function () {
        if (dg.slide && dg.slide.contains(svg)) dgTogglePause();
      });
      host.addEventListener('mouseenter', function () { dgPlaceTools(svg); });
    });
  }

  /* ---- Layout audit: run Deck.audit() in the browser console (or a test harness).
          For every slide it reports content that overflows the slide body, code blocks
          wider than their box, and anything that reaches into the footer.
          Fragments are shown while measuring, then the deck goes back where it was. ---- */
  function audit() {
    var here = Reveal.getIndices();
    var slides = Reveal.getSlides();
    var problems = [];
    slides.forEach(function (slide, i) {
      Reveal.slide(i, 0, Number.MAX_SAFE_INTEGER);
      var label = (slide.querySelector('.eyebrow') || slide.querySelector('h1, h2') || { textContent: '' }).textContent.trim();
      var sRect = slide.getBoundingClientRect();
      var scale = sRect.width / 1280;
      var body = slide.querySelector('.s-body');
      var foot = slide.querySelector('.s-foot');
      if (body && body.scrollHeight > body.clientHeight + 1) {
        problems.push({ slide: i + 1, label: label, issue: 'body overflows by ' + (body.scrollHeight - body.clientHeight) + 'px' });
      }
      slide.querySelectorAll('pre code').forEach(function (code) {
        if (code.scrollWidth > code.clientWidth + 1) {
          problems.push({ slide: i + 1, label: label, issue: 'code too wide by ' + (code.scrollWidth - code.clientWidth) + 'px' });
        }
      });
      var limit = foot ? foot.getBoundingClientRect().top : sRect.bottom;
      var right = sRect.right;
      slide.querySelectorAll('.s-head *, .s-body *').forEach(function (el) {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        if (r.bottom > limit + 1 * scale) {
          problems.push({ slide: i + 1, label: label, issue: '<' + el.tagName.toLowerCase() + '> reaches ' + Math.round((r.bottom - limit) / scale) + 'px into the footer / bottom edge' });
        }
        if (r.right > right + 1 * scale) {
          problems.push({ slide: i + 1, label: label, issue: '<' + el.tagName.toLowerCase() + '> sticks out ' + Math.round((r.right - right) / scale) + 'px on the right' });
        }
      });
      Reveal.slide(i, 0, -1);                         // hide the fragments again
    });
    Reveal.slide(here.h, here.v, here.f);
    // one line per problem is enough: drop repeats from nested elements
    var seen = {};
    return problems.filter(function (p) {
      var key = p.slide + p.issue.replace(/<[^>]+>/, '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /* ---- Reveal ---- */
  function init() {
    buildFooters();
    buildDiagramControls();

    return Reveal.initialize({
      width: 1280,
      height: 720,
      margin: 0,
      minScale: 0.2,
      maxScale: 2.5,
      hash: true,
      center: false,
      display: 'flex',
      slideNumber: 'c/t',
      progress: true,
      controls: false,
      transition: 'fade',
      transitionSpeed: 'fast',
      backgroundTransition: 'none',
      plugins: [RevealNotes, RevealHighlight]
    }).then(function () {
      Reveal.addKeyBinding(
        { keyCode: 84, key: 'T', description: 'Toggle dark / light theme' },
        toggleTheme
      );
      ['slidechanged', 'fragmentshown', 'fragmenthidden'].forEach(function (name) {
        Reveal.on(name, dgStart);
      });
      dgStart();
    });
  }

  window.Deck = { init: init, toggleTheme: toggleTheme, audit: audit };
})();
