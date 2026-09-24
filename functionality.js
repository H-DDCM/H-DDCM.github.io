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

    // ---------------------------------------------------------------
    // qualitative comparison blocks
    // ---------------------------------------------------------------
    function currentPoint(block) {
        const points = JSON.parse(block.dataset.points);
        const range = block.querySelector(".qual-range");
        // Tiny build: image blocks with a single BPP point have no slider --
        // fall back to the (only) point at index 0.
        return points[range ? parseInt(range.value, 10) : 0];
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

    function updateRadioAvailability(block, point) {
        block.querySelectorAll(".compare-radio").forEach(function (radio) {
            const method = radio.dataset.method;
            const available = (method === "original") || Object.prototype.hasOwnProperty.call(point.methods, method);
            radio.disabled = !available;
            radio.closest(".btn-group-vertical").querySelector(`label[for="${radio.id}"]`).classList.toggle("disabled", !available);
        });
        const checked = block.querySelector(".compare-radio:checked");
        if (checked.disabled) {
            const originalRadio = block.querySelector('.compare-radio[data-method="original"]');
            originalRadio.checked = true;
        }
    }

    function updateAfter(block, point) {
        const dataset = block.dataset.dataset;
        const ours = point.methods.ours;
        block.querySelector(".qual-after-img").src = `resources/${dataset}/${ours.file}`;
        block.querySelector(".qual-after-bpp").innerHTML = formatCaption(ours.bpp, ours.roundtrip_s);
    }

    function updateBefore(block, point) {
        const dataset = block.dataset.dataset;
        const checked = block.querySelector(".compare-radio:checked");
        const method = checked.dataset.method;
        // BUGFIX: label text (e.g. "Turbo-DDCM (K=2<sup>14</sup>)") contains
        // markup -- .textContent strips the <sup> tag but keeps its text,
        // collapsing "2" + "14" into "214" with no separator. .innerHTML
        // preserves the tag so the overlay renders the superscript, exactly
        // like the button's own label does.
        const methodLabelHtml = checked.nextElementSibling.innerHTML;

        const beforeImg = block.querySelector(".qual-before-img");
        const beforeLabelEl = block.querySelector(".qual-before-label");
        const beforeBppEl = block.querySelector(".qual-before-bpp");

        beforeLabelEl.innerHTML = methodLabelHtml;

        if (method === "original") {
            beforeImg.src = `resources/${dataset}/${block.dataset.img}_gt.png`;
            beforeBppEl.style.display = "none";
        } else {
            const m = point.methods[method];
            beforeImg.src = `resources/${dataset}/${m.file}`;
            beforeBppEl.style.display = "";
            beforeBppEl.innerHTML = formatCaption(m.bpp, m.roundtrip_s);
        }
    }

    function refresh(block) {
        const point = currentPoint(block);
        updateRadioAvailability(block, point);
        updateAfter(block, point);
        updateBefore(block, point);
    }

    document.querySelectorAll(".qual-block").forEach(function (block) {
        const range = block.querySelector(".qual-range");
        if (range) {
            range.addEventListener("input", function () {
                refresh(block);
            });
        }
        block.querySelectorAll(".compare-radio").forEach(function (radio) {
            radio.addEventListener("change", function () {
                refresh(block);
            });
        });
        refresh(block);
    });

    // ---------------------------------------------------------------
    // video qualitative comparison blocks
    // ---------------------------------------------------------------
    // Same data-points/"compare to" pattern as the image .qual-block above,
    // but rendered as two independent side-by-side <video> players (Before |
    // Ours) instead of a drag-slider, since img-comparison-slider only
    // supports <img> content. No round-trip time here -- the source CSV
    // (video_compression/selected_video_bpp_comparison) only records bpp,
    // so only bpp is shown (not fabricated). Every method has data at every
    // point for these 4 videos, so no radio-disable logic is needed here
    // (unlike the image blocks, where a poor bpp match could drop a method).
    function currentVideoPoint(block) {
        const points = JSON.parse(block.dataset.points);
        const range = block.querySelector(".video-range");
        return points[parseInt(range.value, 10)];
    }

    function restartVideo(videoEl, src) {
        // Always restarts from the beginning, whether or not the src itself
        // changed -- moving the slider or switching "compare to" should
        // replay both the before/after players from frame 0, in sync, even
        // for the player whose source didn't change this time (e.g. "Ours"
        // when only the compare-to method changes).
        if (videoEl.getAttribute("src") === src) {
            videoEl.currentTime = 0;
        } else {
            videoEl.src = src;
            videoEl.load(); // a fresh load already starts at time 0
        }
        const playPromise = videoEl.play();
        if (playPromise !== undefined) {
            playPromise.catch(function () {});
        }
    }

    function updateVideoAfter(block, point) {
        const video = block.dataset.video;
        const ours = point.methods.ours;
        restartVideo(block.querySelector(".video-after"), `resources/video/${video}/${ours.file}`);
        block.querySelector(".video-after-bpp").textContent = `${formatBpp(ours.bpp)} BPP`;
    }

    function updateVideoBefore(block, point) {
        const video = block.dataset.video;
        const checked = block.querySelector(".compare-radio:checked");
        const method = checked.dataset.method;
        // Same innerHTML fix as updateBefore() above -- no video method
        // label currently contains markup, but this keeps both paths
        // consistent and safe if one ever does (e.g. a future K=... label).
        const methodLabelHtml = checked.nextElementSibling.innerHTML;

        const beforeVideoEl = block.querySelector(".video-before");
        const beforeLabelEl = block.querySelector(".video-before-label");
        const beforeBppEl = block.querySelector(".video-before-bpp");

        beforeLabelEl.innerHTML = methodLabelHtml;

        if (method === "original") {
            restartVideo(beforeVideoEl, `resources/video/${video}/${video}_gt.mp4`);
            beforeBppEl.style.display = "none";
        } else {
            const m = point.methods[method];
            restartVideo(beforeVideoEl, `resources/video/${video}/${m.file}`);
            beforeBppEl.style.display = "";
            beforeBppEl.textContent = `${formatBpp(m.bpp)} BPP`;
        }
    }

    function refreshVideo(block) {
        const point = currentVideoPoint(block);
        updateVideoAfter(block, point);
        updateVideoBefore(block, point);
    }

    // Keep the two side-by-side players in lockstep. Both sources are
    // trimmed to the same frame count (see webpage/resources/video), so
    // native "loop" on each element would still drift apart over many
    // cycles (two independent <video> elements don't loop in perfect
    // lockstep). Instead: no native loop attribute; "Ours" is the sync
    // leader -- its timeupdate periodically pulls the other player back in
    // line if it has drifted, and its "ended" event restarts both together
    // from frame 0. The follower's own "ended" is also handled as a safety
    // net in case it (unexpectedly) finishes first.
    function setupVideoSync(block) {
        const leader = block.querySelector(".video-after");
        const follower = block.querySelector(".video-before");
        const SYNC_THRESHOLD_S = 0.15;

        function restartBoth() {
            leader.currentTime = 0;
            follower.currentTime = 0;
            [leader, follower].forEach(function (v) {
                const p = v.play();
                if (p !== undefined) p.catch(function () {});
            });
        }

        leader.addEventListener("timeupdate", function () {
            if (Math.abs(follower.currentTime - leader.currentTime) > SYNC_THRESHOLD_S) {
                follower.currentTime = leader.currentTime;
            }
        });
        leader.addEventListener("ended", restartBoth);
        follower.addEventListener("ended", restartBoth);
    }

    document.querySelectorAll(".video-qual-block").forEach(function (block) {
        const range = block.querySelector(".video-range");
        range.addEventListener("input", function () {
            refreshVideo(block);
        });
        block.querySelectorAll(".compare-radio").forEach(function (radio) {
            radio.addEventListener("change", function () {
                refreshVideo(block);
            });
        });
        setupVideoSync(block);
    });

    // BUGFIX: calling refreshVideo() (load()+play() on 2 <video> elements)
    // for EVERY block right on page load doesn't scale -- fine at a
    // handful of videos, but at dozens of blocks it fires that many
    // concurrent video requests at once, blowing past the browser's
    // per-origin connection limit and leaving most of them stalled/never
    // playing. Defer each block's own playback until it actually scrolls
    // into view. This also solves the collapsed-accordion case for free:
    // Bootstrap's collapsed panel is `display: none`, so blocks inside it
    // never report as intersecting until the panel is expanded.
    if ("IntersectionObserver" in window) {
        const videoObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    refreshVideo(entry.target);
                    videoObserver.unobserve(entry.target);
                }
            });
        }, { rootMargin: "200px" });
        document.querySelectorAll(".video-qual-block").forEach(function (block) {
            videoObserver.observe(block);
        });
    } else {
        // No IntersectionObserver support: fall back to the old eager behavior.
        document.querySelectorAll(".video-qual-block").forEach(refreshVideo);
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
