// functionality.js -- page interactivity for the qualitative comparison
// blocks (bit-budget slider + "compare to" method toggle) and the
// back-to-top button.
//
// Each .qual-block carries its own per-point data as a JSON blob in
// data-points (one entry per BPP operating point): [{M, methods: {method:
// {file, bpp, roundtrip_s}}}, ...]. Not every competing method has a valid
// (non-poor-match) reconstruction at every point -- a "compare to" radio is
// disabled for points that don't carry its method, mirroring how the
// original build_qualitative_comparison_figure.py silently drops a
// competitor with no comparable bpp point rather than showing a wrong one.
//
// Perf note: every block's data-points JSON and DOM sub-element references
// are resolved ONCE at setup time (below) rather than re-parsed/re-queried
// on every slider drag or "compare to" click -- cheap either way at this
// page's scale, but there's no reason to redo fixed work on every
// interaction, and it keeps the hot paths (refresh/refreshVideo) doing only
// the work that actually changes per call.

document.addEventListener("DOMContentLoaded", function () {
    // ---------------------------------------------------------------
    // scroll-to-top button
    // ---------------------------------------------------------------
    const backToTop = document.getElementById("btn-back-to-top");
    if (backToTop) {
        window.addEventListener("scroll", function () {
            backToTop.style.display = (document.documentElement.scrollTop > 20) ? "block" : "none";
        });
        backToTop.addEventListener("click", function () {
            document.documentElement.scrollTop = 0;
        });
    }

    function formatBpp(bpp) {
        // Up to 3 digits after the decimal point -- round to 3, then trim
        // any trailing zeros (e.g. 0.19968 -> "0.2", not "0.200").
        return parseFloat(bpp.toFixed(3)).toString();
    }

    function formatCaption(bpp, roundtripS) {
        const t = roundtripS >= 100 ? `${roundtripS.toFixed(0)} sec` : `${roundtripS.toFixed(1)} sec`;
        // A real <br> (via innerHTML), not a "\n" character, so the two
        // lines render as two lines regardless of white-space handling.
        return `${formatBpp(bpp)} BPP<br>${t}`;
    }

    // ---------------------------------------------------------------
    // qualitative comparison blocks (images)
    // ---------------------------------------------------------------
    function setupQualBlock(block) {
        const points = JSON.parse(block.dataset.points);
        const dataset = block.dataset.dataset;
        const img = block.dataset.img;
        const range = block.querySelector(".qual-range");
        const radios = Array.from(block.querySelectorAll(".compare-radio")).map(function (radio) {
            return { radio: radio, label: block.querySelector(`label[for="${radio.id}"]`), method: radio.dataset.method };
        });
        const originalRadio = block.querySelector('.compare-radio[data-method="original"]');
        const refs = {
            points: points,
            dataset: dataset,
            img: img,
            range: range,
            radios: radios,
            originalRadio: originalRadio,
            afterImg: block.querySelector(".qual-after-img"),
            afterBpp: block.querySelector(".qual-after-bpp"),
            beforeImg: block.querySelector(".qual-before-img"),
            beforeLabel: block.querySelector(".qual-before-label"),
            beforeBpp: block.querySelector(".qual-before-bpp"),
        };

        function currentPoint() {
            // Tiny build: image blocks with a single BPP point have no
            // slider -- fall back to the (only) point at index 0.
            return points[range ? parseInt(range.value, 10) : 0];
        }

        function updateRadioAvailability(point) {
            let checkedIsDisabled = false;
            radios.forEach(function (r) {
                const available = (r.method === "original") || Object.prototype.hasOwnProperty.call(point.methods, r.method);
                r.radio.disabled = !available;
                r.label.classList.toggle("disabled", !available);
                if (r.radio.checked && !available) checkedIsDisabled = true;
            });
            if (checkedIsDisabled) originalRadio.checked = true;
        }

        function updateAfter(point) {
            const ours = point.methods.ours;
            refs.afterImg.src = `resources/${dataset}/${ours.file}`;
            refs.afterBpp.innerHTML = formatCaption(ours.bpp, ours.roundtrip_s);
        }

        function updateBefore(point) {
            const checked = radios.find(function (r) { return r.radio.checked; }).radio;
            const method = checked.dataset.method;
            // BUGFIX: label text (e.g. "Turbo-DDCM (K=2<sup>14</sup>)")
            // contains markup -- .textContent strips the <sup> tag but keeps
            // its text, collapsing "2" + "14" into "214" with no separator.
            // .innerHTML preserves the tag so the overlay renders the
            // superscript, exactly like the button's own label does.
            refs.beforeLabel.innerHTML = checked.nextElementSibling.innerHTML;

            if (method === "original") {
                refs.beforeImg.src = `resources/${dataset}/${img}_gt.png`;
                refs.beforeBpp.style.display = "none";
            } else {
                const m = point.methods[method];
                refs.beforeImg.src = `resources/${dataset}/${m.file}`;
                refs.beforeBpp.style.display = "";
                refs.beforeBpp.innerHTML = formatCaption(m.bpp, m.roundtrip_s);
            }
        }

        function refresh() {
            const point = currentPoint();
            updateRadioAvailability(point);
            updateAfter(point);
            updateBefore(point);
        }

        if (range) range.addEventListener("input", refresh);
        radios.forEach(function (r) { r.radio.addEventListener("change", refresh); });
        refresh();
    }

    document.querySelectorAll(".qual-block").forEach(setupQualBlock);

    // ---------------------------------------------------------------
    // video qualitative comparison blocks
    // ---------------------------------------------------------------
    // Same data-points/"compare to" pattern as the image .qual-block above,
    // but rendered as two independent side-by-side <video> players (Before |
    // Ours) instead of a drag-slider, since img-comparison-slider only
    // supports <img> content. No round-trip time here -- the source CSV
    // (video_compression/selected_video_bpp_comparison) only records bpp,
    // so only bpp is shown (not fabricated). Every method has data at every
    // point for these videos, so no radio-disable logic is needed here
    // (unlike the image blocks, where a poor bpp match could drop a method).

    // Loads `src` into `videoEl` and resolves once it can actually play
    // through the beginning without stalling. If `videoEl` already has this
    // exact src loaded and buffered, resolves immediately instead of
    // re-fetching. Used so both players can be started in lockstep -- see
    // refreshVideo() below.
    //
    // BUGFIX: "canplay"/readyState>=3 (HAVE_FUTURE_DATA) only guarantees
    // enough data for the CURRENT frame plus a little more -- not that the
    // rest of the file can play through without further buffering. Starting
    // playback right there meant a heavier file (e.g. DCVC-UF) could
    // outrun its own buffer moments after starting and visibly stall/freeze
    // ("stack"), even though the lighter "Ours" side played fine -- and
    // only the 2nd/3rd loop (file now fully cached) played smoothly.
    // "canplaythrough"/readyState===4 (HAVE_ENOUGH_DATA) is the browser's
    // own estimate that the whole file can play through at the current
    // download rate without stalling -- the right signal to prefer here.
    //
    // BUGFIX 2: "canplaythrough" is only a heuristic ESTIMATE, and browsers
    // don't guarantee it fires promptly -- or at all -- for every file/
    // network condition (a transient CDN hiccup, a connection that looks
    // slow enough that the browser's estimate never turns favorable, etc).
    // Waiting on it with no fallback (the previous version of this fix)
    // meant a single unlucky video could hang forever, and since both
    // players are started together via Promise.all(), THAT ALSO BLOCKED
    // THE OTHER, perfectly-fine player from ever playing -- exactly "some
    // videos are stuck and do not play at all, or a single one of the two".
    // Never let one flaky load block anything indefinitely: also resolve on
    // "error" (so a genuinely failed fetch doesn't hang the pair either),
    // and race the whole thing against a timeout as a last-resort escape
    // hatch -- these are small clips, READY_TIMEOUT_MS is generous for a
    // normal connection but still bounds the worst case.
    var READY_TIMEOUT_MS = 4000;
    function loadVideoReady(videoEl, src) {
        return new Promise(function (resolve) {
            function done() {
                videoEl.removeEventListener("canplaythrough", done);
                videoEl.removeEventListener("error", done);
                clearTimeout(timeoutId);
                resolve();
            }
            if (videoEl.getAttribute("src") === src && videoEl.readyState === 4) {
                resolve();
                return;
            }
            videoEl.addEventListener("canplaythrough", done);
            videoEl.addEventListener("error", done);
            var timeoutId = setTimeout(done, READY_TIMEOUT_MS);
            if (videoEl.getAttribute("src") !== src) {
                videoEl.src = src;
                videoEl.load();
            }
        });
    }

    function setupVideoBlock(block) {
        const points = JSON.parse(block.dataset.points);
        const video = block.dataset.video;
        const radios = Array.from(block.querySelectorAll(".compare-radio"));
        const refs = {
            points: points,
            video: video,
            radios: radios,
            range: block.querySelector(".video-range"),
            afterVideo: block.querySelector(".video-after"),
            afterBpp: block.querySelector(".video-after-bpp"),
            beforeVideo: block.querySelector(".video-before"),
            beforeLabel: block.querySelector(".video-before-label"),
            beforeBpp: block.querySelector(".video-before-bpp"),
        };
        let gen = 0; // bumped on every refresh; guards against stale/superseded loads

        function currentVideoPoint() {
            return points[parseInt(refs.range.value, 10)];
        }

        function updateVideoAfter(point) {
            const ours = point.methods.ours;
            refs.afterBpp.textContent = `${formatBpp(ours.bpp)} BPP`;
            return { videoEl: refs.afterVideo, src: `resources/video/${video}/${ours.file}` };
        }

        function updateVideoBefore(point) {
            const checked = radios.find(function (r) { return r.checked; });
            const method = checked.dataset.method;
            // Same innerHTML fix as updateBefore() above -- no video method
            // label currently contains markup, but this keeps both paths
            // consistent and safe if one ever does (e.g. a future K=...
            // label).
            refs.beforeLabel.innerHTML = checked.nextElementSibling.innerHTML;

            let src;
            if (method === "original") {
                src = `resources/video/${video}/${video}_gt.mp4`;
                refs.beforeBpp.style.display = "none";
            } else {
                const m = point.methods[method];
                src = `resources/video/${video}/${m.file}`;
                refs.beforeBpp.style.display = "";
                refs.beforeBpp.textContent = `${formatBpp(m.bpp)} BPP`;
            }
            return { videoEl: refs.beforeVideo, src: src };
        }

        function refreshVideo() {
            // BUGFIX: starting each player as soon as ITS OWN load finished
            // (the old behavior) meant that whichever method's mp4 happens
            // to be lighter for a given pair would visibly start moving
            // well before the heavier one -- looks broken/stuck, not just
            // slower (not specific to any one method -- applies to every
            // before/after pairing). Labels/BPP captions still update
            // immediately; only the actual playback start is held back
            // until BOTH players have buffered enough to play, then both
            // start together, in sync, from frame 0.
            const point = currentVideoPoint();
            const after = updateVideoAfter(point);
            const before = updateVideoBefore(point);

            // Immediate feedback: freeze both players at frame 0 right
            // away, rather than leaving the old content visibly
            // playing/looping (or just sitting there looking unresponsive)
            // for however long the new method's file takes to load. This
            // fires instantly regardless of load state; the actual resumed
            // playback below still waits for both to be ready.
            after.videoEl.pause();
            after.videoEl.currentTime = 0;
            before.videoEl.pause();
            before.videoEl.currentTime = 0;

            gen += 1;
            const myGen = gen;
            Promise.all([
                loadVideoReady(after.videoEl, after.src),
                loadVideoReady(before.videoEl, before.src),
            ]).then(function () {
                // A newer refreshVideo() call may have superseded this one
                // while waiting (rapid method/bpp switching) -- don't stomp
                // on it.
                if (myGen !== gen) return;
                after.videoEl.currentTime = 0;
                before.videoEl.currentTime = 0;
                [after.videoEl, before.videoEl].forEach(function (v) {
                    const p = v.play();
                    if (p !== undefined) p.catch(function () {});
                });
            });
        }

        // Keep the two side-by-side players in lockstep. Both sources are
        // trimmed to the same frame count (see resources/video), so native
        // "loop" on each element would still drift apart over many cycles
        // (two independent <video> elements don't loop in perfect
        // lockstep). Instead: no native loop attribute; "Ours" is the sync
        // leader -- its timeupdate periodically pulls the other player back
        // in line if it has drifted, and its "ended" event restarts both
        // together from frame 0. The follower's own "ended" is also handled
        // as a safety net in case it (unexpectedly) finishes first.
        const SYNC_THRESHOLD_S = 0.15;
        function restartBoth() {
            refs.afterVideo.currentTime = 0;
            refs.beforeVideo.currentTime = 0;
            [refs.afterVideo, refs.beforeVideo].forEach(function (v) {
                const p = v.play();
                if (p !== undefined) p.catch(function () {});
            });
        }
        refs.afterVideo.addEventListener("timeupdate", function () {
            if (Math.abs(refs.beforeVideo.currentTime - refs.afterVideo.currentTime) > SYNC_THRESHOLD_S) {
                refs.beforeVideo.currentTime = refs.afterVideo.currentTime;
            }
        });
        refs.afterVideo.addEventListener("ended", restartBoth);
        refs.beforeVideo.addEventListener("ended", restartBoth);

        refs.range.addEventListener("input", refreshVideo);
        radios.forEach(function (radio) {
            radio.addEventListener("change", refreshVideo);
        });

        return { block: block, refs: refs, refreshVideo: refreshVideo };
    }

    const videoBlocks = Array.from(document.querySelectorAll(".video-qual-block")).map(setupVideoBlock);
    const videoBlockByEl = new WeakMap();
    videoBlocks.forEach(function (vb) { videoBlockByEl.set(vb.block, vb); });

    // BUGFIX: calling refreshVideo() (load()+play() on 2 <video> elements)
    // for EVERY block right on page load doesn't scale -- fine at a
    // handful of videos, but at dozens of blocks it fires that many
    // concurrent video requests at once, blowing past the browser's
    // per-origin connection limit and leaving most of them stalled/never
    // playing. Defer each block's own playback until it actually scrolls
    // into view. This also solves the collapsed-accordion case for free:
    // Bootstrap's collapsed panel is `display: none`, so blocks inside it
    // never report as intersecting until the panel is expanded.
    //
    // BUGFIX 2: a one-shot "play once, then unobserve" (the original version
    // of this fix) only prevents the initial page-load burst -- scrolling
    // down through many rows still ACCUMULATES more and more simultaneously
    // -playing/looping videos over time (each one, once started, never
    // stops), reproducing the exact same resource exhaustion just spread out
    // over a scroll session instead of instantaneously. Keep observing every
    // block for its whole lifetime instead: pause both players (decode
    // stops, already-buffered data is kept, so resuming is instant) the
    // moment a block scrolls OUT of view, and resume them when it scrolls
    // back in. This keeps the number of actively-decoding videos bounded to
    // roughly what's on screen, no matter how far the page is scrolled.
    if (videoBlocks.length && "IntersectionObserver" in window) {
        const initialized = new WeakSet();
        const videoObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                const vb = videoBlockByEl.get(entry.target);
                if (!vb) return;
                const players = [vb.refs.beforeVideo, vb.refs.afterVideo];
                if (entry.isIntersecting) {
                    if (!initialized.has(vb.block)) {
                        initialized.add(vb.block);
                        vb.refreshVideo();
                    } else {
                        players.forEach(function (v) {
                            const p = v.play();
                            if (p !== undefined) p.catch(function () {});
                        });
                    }
                } else {
                    players.forEach(function (v) { v.pause(); });
                }
            });
        }, { rootMargin: "200px" });
        videoBlocks.forEach(function (vb) { videoObserver.observe(vb.block); });
    } else {
        // No IntersectionObserver support: fall back to the old eager behavior.
        videoBlocks.forEach(function (vb) { vb.refreshVideo(); });
    }

    // ---------------------------------------------------------------
    // collapsible "additional samples" buttons (Bootstrap handles the
    // collapse itself; this just swaps the button's own label)
    // ---------------------------------------------------------------
    document.querySelectorAll(".collapsing-button").forEach(function (btn) {
        btn.addEventListener("click", function () {
            btn.textContent = btn.textContent.trim() === "Additional samples" ? "Hide samples" : "Additional samples";
        });
    });
});

// ---------------------------------------------------------------
// BibTeX "copy" button (global -- called from the inline onclick in
// index.html's citation block, so it must live outside the
// DOMContentLoaded closure above).
// ---------------------------------------------------------------
function copyBib() {
    const citation = document.getElementById("citation");
    navigator.clipboard.writeText(citation.innerText);
}
