// `photo` widget: the slideshow (SPEC §7). Order and position live in the native shell
// (/api/slideshow/*); this widget only displays, times, and handles swipes.
// Videos (SPEC §6) show their poster like a photo; on the frame the native player then plays them
// *behind* the page, and the layer opens a hole where the picture is.

import { fillLayout, mediaRect, visibleRect, holeClipPath, deviceRect, viewFor, viewRect, viewTransform } from './lib/photo-core.js';

const API = '/api/slideshow';
const RETRY_MS = 5000;
const EMPTY_POLL_MS = 10000;
const MIRROR_POLL_MS = 5000;
const SWIPE_MIN_PX = 60;
const TAP_MAX_PX = 15;
const TAP_MAX_MS = 600;
/** No first frame this long after asking: the video counts as failed and the slideshow moves on. */
const VIDEO_START_TIMEOUT_MS = 10000;
/** Past its length by this much without an "ended": treated as ended. */
const VIDEO_END_GRACE_MS = 15000;
/** A finished video stays this long before the slideshow moves on (user request 2026-10-14). */
const AFTER_END_MS = 1000;
/** After a seek, the bar shows the dragged spot this long before following the player again. */
const SEEK_SETTLE_MS = 1500;

/** The native player (the frame's own WebView only; SPEC §6). */
const nativeVideo = typeof window.OpenFrameVideo === 'object' ? window.OpenFrameVideo : null;

class ImageError extends Error {}

async function api(path, method) {
  const res = await fetch(path, { method: method || 'GET', cache: 'no-store' });
  if (!res.ok) throw new Error(`${method || 'GET'} ${path}: HTTP ${res.status}`);
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export class Slideshow {
  /**
   * @param {HTMLElement} root
   * @param {{ isFrame: boolean, onTap?: () => void, onSlide?: (slide: object|null) => void, onVideo?: () => void,
   *   quiet?: () => boolean, portrait?: () => boolean }} opts
   *   isFrame: only the frame's own WebView advances the slideshow; other browsers mirror what it shows.
   *   portrait: the frame stands upright (each direction has its own per-photo zoom).
   *   onTap: a tap (not a swipe) on the photo. onSlide: the photo on screen changed (null: none).
   *   onVideo: the video on screen started, paused, ended, or changed sound (for the quick menu).
   *   quiet: true while videos must start without sound (auto-mute).
   */
  constructor(root, opts) {
    this.root = root;
    this.isFrame = opts.isFrame;
    this.onTap = opts.onTap || null;
    this.onSlide = opts.onSlide || (() => {});
    this.onVideoChange = opts.onVideo || (() => {});
    this.quiet = opts.quiet || (() => false); // auto-mute: nobody has touched the frame for a while
    this.portrait = opts.portrait || (() => false);
    this.sample = opts.sample || (() => null); // layout editor: a still test card instead of the photos
    this.sampleKey = '';
    this.sampleEl = null;
    this.front = -1;        // index of the visible layer
    this.settings = null;
    this.current = null;    // slide on screen
    this.timer = null;
    this.busy = false;
    this.paused = false;
    this.hidden = document.hidden;
    this.destroyed = false;
    this.video = null;      // the video on screen when the native player has it (see startVideo)

    root.classList.add('ss');
    this.layers = [0, 1].map(() => {
      const layer = el('div', 'ss-layer');
      layer.append(el('img', 'bg'), el('img', 'photo'));
      layer.querySelectorAll('img').forEach((img) => { img.alt = ''; });
      root.append(layer);
      return layer;
    });
    this.emptyEl = el('div', 'ss-empty');
    this.emptyEl.hidden = true;
    const title = el('div', 'ss-empty-title');
    title.textContent = 'No photos yet';
    this.emptyText = el('div', 'ss-empty-text');
    this.emptyEl.append(title, this.emptyText);
    root.append(this.emptyEl);

    this.bindSwipes();
    // Box size changes with rotation and layout: recompute the fill crop (and move a playing video).
    this.resizeObserver = new ResizeObserver(() => {
      if (this.front >= 0 && this.current) {
        const layer = this.layers[this.front];
        // A turn can switch to the other direction's zoom, which may need the blurred background.
        if (!this.video) this.setBackground(layer, this.current);
        this.applyFit(layer, this.current);
      }
      this.placeVideo();
    });
    this.resizeObserver.observe(root);
    // Screen off (sleep) or an Android screen in front: the page is hidden. Stop advancing, so the
    // night doesn't use up the shuffle order or decode photos nobody sees; a fresh photo on return.
    this.onVisibility = () => {
      this.hidden = document.hidden;
      if (this.hidden) { clearTimeout(this.timer); this.stopVideo(); }
      else this.schedule(0, this.isFrame ? 'next' : 'current');
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onVideoEvent = (e) => this.videoEvent(e.detail || {});
    window.addEventListener('ofvideo', this.onVideoEvent);
    this.step('current');
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.stopVideo();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('ofvideo', this.onVideoEvent);
    this.resizeObserver.disconnect();
    this.layers.forEach((l) => this.clearLayer(l));
    this.root.innerHTML = '';
    this.root.classList.remove('ss', 'video-on');
  }

  /**
   * Stop advancing (the menu, an editor, or the full calendar). `video`: also hold a playing video
   * paused until resume() (a tap on a video pauses it: user request 2026-10-14).
   * A video's state: `playing` = what the menu's Play/Pause last asked for; `held` = paused by this.
   */
  pause({ video = false } = {}) {
    this.paused = true;
    clearTimeout(this.timer);
    const v = this.video;
    if (!v || video === v.held) return;
    v.held = video;
    if (v.playing) {
      if (video) { nativeVideo.pause(v.token); clearTimeout(v.endTimer); } else { nativeVideo.resume(v.token); this.armEndWatch(); }
    }
    this.onVideoChange();
  }

  /** Quick menu arrows. Only the frame's own WebView moves the slideshow. */
  next() { if (this.isFrame) this.step('next'); }

  prev() { if (this.isFrame) this.step('prev'); }

  /** Settings covers the page (SPEC §16): stop the video (frees the decoder); resume() plays it again. */
  coverVideo() {
    if (!this.video) return;
    this.stopVideo();
    this.restartVideo = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.restartVideo) {
      this.restartVideo = false;
      this.schedule(0, 'current'); // the same video from the start, as after the old page reload
      return;
    }
    const v = this.video;
    if (v) {
      // Carries on unless Pause was pressed in the menu.
      if (v.held) {
        v.held = false;
        if (v.playing) { nativeVideo.resume(v.token); this.armEndWatch(); }
        this.onVideoChange();
      }
      // Like a photo after the menu: a full interval from now, but a video still never gets cut off.
      this.armInterval();
      this.videoMaybeAdvance();
      return;
    }
    this.schedule(this.isFrame && this.settings ? this.settings.intervalSec * 1000 : 0, this.isFrame ? 'next' : 'current');
  }

  applyFit(layer, slide) {
    const photo = layer.querySelector('.photo');
    const view = this.view(slide);
    if (view && slide.width && slide.height) {
      // Zoomed (SPEC §15): the whole photo, scaled and moved; the layer clips the rest.
      const w = layer.clientWidth;
      const h = layer.clientHeight;
      photo.style.objectFit = 'contain';
      photo.style.objectPosition = '50% 50%';
      photo.style.transformOrigin = '0 0';
      photo.style.transform = viewTransform(slide, viewRect(slide, view, w, h), w, h);
      return;
    }
    photo.style.transform = '';
    if (this.effectiveFit(slide) !== 'fill' || !slide.width || !slide.height) {
      photo.style.objectFit = 'contain';
      photo.style.objectPosition = '50% 50%';
      return;
    }
    // Fill: crop around this photo's position, else detected faces, else the center (SPEC §6, §15).
    const { px, py } = fillLayout(slide, layer.clientWidth, layer.clientHeight);
    photo.style.objectFit = 'cover';
    photo.style.objectPosition = `${px.toFixed(2)}% ${py.toFixed(2)}%`;
  }

  /** How the slide on screen is shown now ('fit' or 'fill'): its own setting, else the slideshow's. */
  effectiveFit(slide = this.current) {
    return (slide && slide.fit) || (this.settings && this.settings.fit) || 'fit';
  }

  /** This direction's saved zoom for `slide` (wins over fit and crop), or null. */
  view(slide = this.current) {
    return viewFor(slide, this.portrait());
  }

  /** The background shows around the photo: fitted, or zoomed (it may not cover the box). */
  showsAround(slide = this.current) {
    return this.effectiveFit(slide) !== 'fill' || !!this.view(slide);
  }

  /**
   * The photo menu changed the slide on screen (fit, position, comment): redraw it in place.
   * A switch to Fit may need the blurred background, so that redraws through show() (photos only:
   * a playing video keeps playing and only moves).
   */
  async updateCurrent(slide) {
    if (!this.current || this.current.id !== slide.id || this.front < 0) return;
    const wasAround = this.showsAround();
    this.current = { ...this.current, ...slide };
    this.onSlide(this.current);
    if (this.video) {
      this.video.slide = this.current;
      const layer = this.layers[this.front];
      this.setBackground(layer, this.current);
      this.applyFit(layer, this.current);
      this.placeVideo();
      return;
    }
    if (wasAround === this.showsAround()) {
      this.applyFit(this.layers[this.front], this.current);
      return;
    }
    const transitionMs = this.settings.transitionMs;
    this.settings = { ...this.settings, transitionMs: 0 };
    try { await this.show(this.current); } catch (e) { console.error('slideshow:', e.message); }
    this.settings = { ...this.settings, transitionMs };
  }

  clearLayer(layer) {
    if (this.video && this.video.layer === layer) this.stopVideo();
    layer.classList.remove('active', 'top');
    layer.style.transitionDuration = '0ms';
    layer.style.clipPath = '';
    layer.querySelector('.photo').removeAttribute('src');
    layer.querySelector('.bg').removeAttribute('src');
    layer.querySelectorAll('.ss-play').forEach((b) => b.remove());
  }

  /** Blur, black, or color around a fitted picture. */
  setBackground(layer, slide) {
    const s = this.settings;
    const bg = layer.querySelector('.bg');
    const blurBg = s.background === 'blur' && this.showsAround(slide);
    layer.style.background = s.background === 'color' ? s.backgroundColor : '#000';
    bg.hidden = !blurBg;
    if (blurBg && bg.getAttribute('src') !== slide.bg) bg.src = slide.bg;
    return blurBg;
  }

  async show(slide) {
    const s = this.settings;
    const idx = this.front < 0 ? 0 : 1 - this.front;
    const layer = this.layers[idx];
    const photo = layer.querySelector('.photo');
    const bg = layer.querySelector('.bg');

    this.clearLayer(layer);
    const blurBg = this.setBackground(layer, slide);

    const loads = [];
    photo.src = slide.url;
    loads.push(photo.decode().catch(() => { throw new ImageError(`Could not load ${slide.url}`); }));
    if (blurBg) loads.push(bg.decode().catch(() => { bg.hidden = true; }));
    await Promise.all(loads);
    if (this.destroyed) return;
    this.applyFit(layer, slide);
    // Other browsers can't play the frame's videos: the poster with a ▶ mark (frame: see showPlayButton).
    if (slide.type === 'video' && !nativeVideo) layer.append(el('div', 'ss-play ss-play-badge'));

    // Fade the new layer in on top, then drop the old one (frees its decoded image, stops its video).
    const old = this.front >= 0 ? this.layers[this.front] : null;
    if (old) old.classList.remove('top');
    layer.classList.add('top');
    layer.style.transitionDuration = `${s.transitionMs}ms`;
    void layer.offsetWidth; // flush styles so the opacity change animates
    layer.classList.add('active');
    this.front = idx;
    this.current = slide;
    this.onSlide(slide);
    await sleep(s.transitionMs);
    if (old) this.clearLayer(old);
  }

  showEmpty(data) {
    if (this.front >= 0) { this.clearLayer(this.layers[this.front]); this.front = -1; this.current = null; this.onSlide(null); }
    this.emptyText.textContent = data.indexing
      ? 'Preparing photos… they will appear here shortly.'
      : 'Copy photos into the FrameMedia folder on the frame (connect it to a computer over USB), ' +
        'or insert an SD card or USB drive with photos.';
    this.emptyEl.hidden = false;
  }

  /** ms === null: the playing video decides when to move on. */
  schedule(ms, kind) {
    clearTimeout(this.timer);
    if (ms == null || this.destroyed || this.paused || this.hidden) return;
    this.timer = setTimeout(() => this.step(kind), ms);
  }

  async step(kind) {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    clearTimeout(this.timer);
    let nextKind = this.isFrame ? 'next' : 'current';
    let delay = RETRY_MS;
    try {
      const data = kind === 'current' ? await api(`${API}/current`) : await api(`${API}/${kind}`, 'POST');
      this.settings = data.settings;
      this.showSample(this.sample()); // Fit or Fill may have changed
      if (data.empty) {
        this.showEmpty(data);
        nextKind = 'current';
        delay = EMPTY_POLL_MS;
        return;
      }
      this.emptyEl.hidden = true;
      const slide = data.slide;
      const same = this.current && this.current.url === slide.url;
      if (!same) await this.show(slide);
      delay = this.isFrame ? this.settings.intervalSec * 1000 : MIRROR_POLL_MS;
      if (this.isFrame && nativeVideo && slide.type === 'video') {
        // The same video again (a library of one, or "current"): keep it unless asked for the next.
        if (same && this.video && kind === 'current') delay = null;
        else delay = this.beginVideo(this.current);
      }
    } catch (e) {
      console.error('slideshow:', e.message);
      // A broken image: move on. Server unreachable: retry the same request.
      if (!(e instanceof ImageError)) nextKind = kind === 'prev' ? 'current' : kind;
    } finally {
      this.busy = false;
      this.schedule(delay, nextKind);
    }
  }

  // ---- videos (SPEC §6) ----

  /** A video slide is on screen: play it, or (Autoplay off) offer ▶. Returns the delay for schedule(). */
  beginVideo(slide) {
    this.stopVideo();
    const v = this.settings.video || {};
    if (this.hidden) return null;
    if (!v.autoplay) {
      this.showPlayButton();
      return this.settings.intervalSec * 1000;
    }
    this.startVideo(slide);
    return null;
  }

  showPlayButton() {
    const layer = this.layers[this.front];
    if (!layer || layer.querySelector('.ss-play')) return;
    const b = el('div', 'ss-play');
    b.setAttribute('role', 'button');
    b.setAttribute('aria-label', 'Play video');
    layer.append(b);
  }

  /**
   * Plays `slide` behind the page. When it moves on (Playback, SPEC §6): Play once and continue
   * (default) = about a second after the video ends, whatever the timer; Play once = when both the
   * interval and the video are over (holding the last frame); Loop = when the interval ends, looping a
   * shorter video. A video is never cut off.
   */
  startVideo(slide) {
    this.stopVideo();
    const layer = this.layers[this.front];
    if (!layer || !nativeVideo) return;
    clearTimeout(this.timer); // from here the video decides when to move on
    layer.querySelectorAll('.ss-play').forEach((b) => b.remove());
    const s = this.settings;
    const mode = (s.video && s.video.playback) || 'once';
    const interval = s.intervalSec * 1000;
    const loop = mode === 'loop' && slide.durationMs > 0 && slide.durationMs < interval;
    // Muted unless Sound was turned on for this video, or videos start with sound; auto-mute wins.
    const wantsSound = (this.soundOn && this.soundOn.id === slide.id) || (s.video && s.video.muted === false);
    const muted = !wantsSound || this.quiet();
    const token = nativeVideo.play(JSON.stringify({ id: slide.id, rect: this.videoDeviceRect(slide), loop, muted }));
    this.video = {
      slide, layer, token, mode, loop, muted,
      started: false, ended: false, held: false, playing: true,
      timerDone: mode === 'continue', intervalTimer: null, endTimer: null,
      startTimer: setTimeout(() => this.videoFailed(true), VIDEO_START_TIMEOUT_MS),
    };
    this.armInterval();
    this.onVideoChange();
  }

  /** Stops the native player and closes the hole (the poster shows again). */
  stopVideo() {
    this.hideScrub();
    const v = this.video;
    if (!v) return;
    this.video = null;
    [v.startTimer, v.endTimer, v.intervalTimer].forEach((t) => clearTimeout(t));
    if (nativeVideo) nativeVideo.stop(v.token);
    v.layer.style.clipPath = '';
    this.root.classList.remove('video-on');
    this.onVideoChange();
  }

  armInterval() {
    const v = this.video;
    if (!v || v.mode === 'continue') return;
    clearTimeout(v.intervalTimer);
    v.timerDone = false;
    v.intervalTimer = setTimeout(() => { v.timerDone = true; this.videoMaybeAdvance(); }, this.settings.intervalSec * 1000);
  }

  /** Watchdog: a non-looping video that never reports its end counts as ended a little after its length. */
  armEndWatch() {
    const v = this.video;
    if (!v || v.loop || !v.started || v.ended) return;
    clearTimeout(v.endTimer);
    const left = v.slide.durationMs > 0 ? v.slide.durationMs : 10 * 60000;
    v.endTimer = setTimeout(() => { v.ended = true; v.endedAt = Date.now() - AFTER_END_MS; this.videoMaybeAdvance(); }, left + VIDEO_END_GRACE_MS);
  }

  videoMaybeAdvance() {
    const v = this.video;
    if (!v || this.paused || this.hidden) return;
    if (!v.timerDone || !(v.ended || v.loop)) return;
    // About a second after the video ended (not after the timer, if that came later).
    this.schedule(v.ended ? Math.max(0, v.endedAt + AFTER_END_MS - Date.now()) : 0, 'next');
  }

  videoEvent(d) {
    const v = this.video;
    if (!v || d.token !== v.token) return;
    if (d.type === 'started') {
      clearTimeout(v.startTimer);
      v.started = true;
      this.openHole();
      this.armEndWatch();
    } else if (d.type === 'ended') {
      clearTimeout(v.endTimer);
      v.ended = true;
      v.endedAt = Date.now();
      v.playing = false;
      this.videoMaybeAdvance();
    } else if (d.type === 'error') {
      this.videoFailed(false);
      return;
    } else if (d.type === 'position') {
      // Just after a seek the player only echoes it (Rockchip): the bar keeps the dragged spot a moment.
      if (!(v.seekedAt > Date.now() - SEEK_SETTLE_MS)) v.pos = d.pos;
      if (d.dur > 0) v.dur = d.dur;
    }
    this.onVideoChange();
  }

  /** Asks the player where it is (answered by a `position` event); the menu's seek bar polls this. */
  requestVideoPosition() {
    const v = this.video;
    if (v && v.started) nativeVideo.position(v.token);
  }

  /**
   * Smoother scrubbing (SPEC §6, user request): the video's preview strip (one small picture per second,
   * made by the frame when the video was added). Resolves to { url, count, stepMs } or null (no strip:
   * the seek bar then seeks while dragging, as before).
   */
  loadStrip() {
    const v = this.video;
    if (!v) return Promise.resolve(null);
    if (!v.stripLoad) {
      v.stripLoad = fetch(`/api/video/${v.slide.id}/strip`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        .then((s) => { v.strip = s; return s; });
    }
    return v.stripLoad;
  }

  /** While the seek bar is dragged: the strip's picture nearest `ms` over the video. False without a strip. */
  scrubPreview(ms) {
    const v = this.video;
    const s = v && v.strip;
    if (!s || !(s.count > 0)) return false;
    clearTimeout(this.scrubTimer);
    clearInterval(this.scrubWatch);
    if (!this.scrubEl) {
      this.scrubEl = el('div', 'ss-scrub');
      this.root.append(this.scrubEl);
    }
    const { box, r } = this.videoPageRect(v.slide);
    void box;
    Object.assign(this.scrubEl.style, {
      left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`,
      backgroundImage: `url("${s.url}")`, backgroundSize: `${s.count * 100}% 100%`,
    });
    const i = Math.max(0, Math.min(s.count - 1, Math.round(ms / s.stepMs)));
    this.scrubEl.style.backgroundPosition = `${s.count > 1 ? (i / (s.count - 1)) * 100 : 0}% 0`;
    this.scrubEl.hidden = false;
    return true;
  }

  /** Let go: the player seeks once; the preview stays until the video shows that spot (at most 3 s). */
  scrubEnd(ms) {
    const v = this.video;
    if (!this.scrubEl || this.scrubEl.hidden) return;
    const started = Date.now();
    clearInterval(this.scrubWatch);
    // The player reports a position once it has played up to the spot (paused) or is past it (playing).
    this.scrubWatch = setInterval(() => {
      const pos = v && v.pos;
      const there = v && Date.now() - started > 400 && !(v.seekedAt > Date.now() - SEEK_SETTLE_MS) && Math.abs(pos - ms) < 1500;
      if (there || Date.now() - started > 3000 || this.video !== v) this.hideScrub();
    }, 120);
  }

  hideScrub() {
    clearInterval(this.scrubWatch);
    if (this.scrubEl) this.scrubEl.hidden = true;
  }

  /** Seek bar: jumps to `ms`. After the end it stays paused there, so Play continues from that spot. */
  seekVideo(ms) {
    const v = this.video;
    if (!v || !v.started) return;
    if (v.ended) { v.ended = false; v.playing = false; }
    v.pos = ms;
    v.seekedAt = Date.now();
    nativeVideo.seek(v.token, Math.round(ms));
    this.onVideoChange();
  }

  /** No picture in time, or the player failed: show the poster and move on (the shell counts failures). */
  videoFailed(stalled) {
    const v = this.video;
    if (!v) return;
    console.error(`slideshow: video ${v.slide.id} ${stalled ? 'showed no picture' : 'failed'}`);
    if (stalled && nativeVideo) nativeVideo.stalled(v.token);
    this.stopVideo();
    if (!this.paused) this.schedule(0, 'next');
  }

  /** The video's rectangle on the page (CSS px). */
  videoPageRect(slide) {
    const box = this.root.getBoundingClientRect();
    const r = mediaRect(slide, this.effectiveFit(slide), box.width, box.height, this.view(slide));
    return { box, r };
  }

  videoDeviceRect(slide) {
    const { box, r } = this.videoPageRect(slide);
    return deviceRect({ x: box.left + r.x, y: box.top + r.y, w: r.w, h: r.h }, window.devicePixelRatio || 1);
  }

  /** Lets the video show through: a window in the layer where the picture is, and no black behind it. */
  openHole() {
    const v = this.video;
    if (!v || !v.started) return;
    const { box, r } = this.videoPageRect(v.slide);
    v.layer.style.clipPath = holeClipPath(visibleRect(r, box.width, box.height));
    this.root.classList.add('video-on');
  }

  /** Laid out again (rotation, page switch, layout editor): a box that only moved isn't seen by the ResizeObserver. */
  update() {
    this.placeVideo();
    this.showSample(this.sample());
  }

  /**
   * Layout editor (SPEC §14): a still test card with color bars over the photos, so the box can be judged
   * (user request). `sample`: { ratio: width / height, label } or null. Shown the way photos are (Fit or
   * Fill), under the clock and caption.
   */
  showSample(sample) {
    const fit = this.settings && this.settings.fit === 'fill' ? 'fill' : 'fit';
    const key = sample ? `${sample.ratio}|${sample.label}|${fit}` : '';
    if (key === this.sampleKey) return;
    this.sampleKey = key;
    if (this.sampleEl) { this.sampleEl.remove(); this.sampleEl = null; }
    if (!sample) return;
    const box = el('div', 'ss-sample');
    const pic = el('div', `ss-sample-pic ${fit}`);
    pic.style.setProperty('--r', String(sample.ratio));
    const label = el('div', 'ss-sample-label');
    const big = el('b');
    big.textContent = sample.label;
    const small = el('span');
    small.textContent = `Sample photo · ${fit === 'fill' ? 'Fill' : 'Fit'}`;
    label.append(big, small);
    pic.append(label);
    box.append(pic);
    this.root.append(box);
    this.sampleEl = box;
  }

  /** Rotation, layout, or Fit/Fill changed: move the player and the hole. */
  placeVideo() {
    const v = this.video;
    if (!v) return;
    nativeVideo.move(v.token, JSON.stringify(this.videoDeviceRect(v.slide)));
    this.openHole();
  }

  /** For the quick menu: the video on screen, if the native player has it. */
  videoState() {
    const v = this.video;
    if (v) {
      return {
        id: v.slide.id, playing: v.playing && !v.held && !v.ended, ended: v.ended, muted: v.muted,
        pos: v.ended ? v.dur || v.slide.durationMs : v.pos || 0, dur: v.dur || v.slide.durationMs || 0, canSeek: v.started,
      };
    }
    if (this.current && this.current.type === 'video' && nativeVideo && this.isFrame) return { id: this.current.id, playing: false, ended: true, muted: true, stopped: true };
    return null;
  }

  /** Quick menu Play/Pause: pauses or plays the video on screen (restarts it once it has ended). */
  toggleVideo() {
    const v = this.video;
    if (!v || v.ended) { if (this.current && this.current.type === 'video') this.startVideo(this.current); return; }
    if (v.playing && !v.held) {
      v.playing = false;
      nativeVideo.pause(v.token);
      clearTimeout(v.endTimer);
    } else {
      // Play while the menu is open: no longer held by it either.
      v.playing = true;
      v.held = false;
      nativeVideo.resume(v.token);
      this.armEndWatch();
    }
    this.onVideoChange();
  }

  /** Quick menu Sound: this video (and its replays) with or without sound. */
  setVideoMuted(muted) {
    const v = this.video;
    if (!v) return;
    v.muted = muted;
    this.soundOn = muted ? null : { id: v.slide.id };
    nativeVideo.setMuted(v.token, muted);
    this.onVideoChange();
  }

  // Swipe left = next, swipe right = previous; tap = the menu (onTap), or ▶ to play a video.
  bindSwipes() {
    let start = null;
    this.root.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    this.root.addEventListener('pointercancel', () => { start = null; });
    this.root.addEventListener('pointerup', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const quick = Date.now() - start.t <= TAP_MAX_MS;
      start = null;
      if (quick && Math.hypot(dx, dy) <= TAP_MAX_PX) {
        const play = e.target.closest && e.target.closest('.ss-play:not(.ss-play-badge)');
        if (play && this.isFrame && this.current) { this.startVideo(this.current); return; }
        if (this.onTap) this.onTap();
        return;
      }
      if (!this.isFrame) return;
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.step(dx < 0 ? 'next' : 'prev');
      }
    });
  }
}
