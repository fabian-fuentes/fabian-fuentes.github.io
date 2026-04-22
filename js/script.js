(() => {
  "use strict";

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Year ---------- */
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Nav scroll state ---------- */
  const nav = $(".nav");
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle("is-scrolled", window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Mobile menu ---------- */
  const toggle = $(".nav__toggle");
  const menu   = $(".nav__menu");

  const setMenu = (open) => {
    if (!toggle || !menu) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    menu.classList.toggle("is-open", open);
    document.body.classList.toggle("nav-open", open);
  };

  if (toggle && menu) {
    toggle.addEventListener("click", () => {
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      setMenu(!isOpen);
    });

    menu.addEventListener("click", (e) => {
      if (e.target.matches("a")) setMenu(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenu(false);
    });
  }

  /* ---------- Reveal on scroll ---------- */
  const targets = $$("[data-reveal]");
  if ("IntersectionObserver" in window && targets.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    targets.forEach((el) => io.observe(el));
  } else {
    targets.forEach((el) => el.classList.add("is-revealed"));
  }

  /* ---------- Real-sky starfield ---------- */

  const canvas = $(".starfield");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");

  // Default observer: Mexico City (matches the "19.43°N · Mexico City"
  // label in the hero). Replaced with real coordinates if the browser
  // grants geolocation.
  const observer = {
    lat: 19.4326,
    lon: -99.1332,
    label: "Mexico City",
  };

  let stars = [];          // raw catalog: [ra, dec, mag, bv]
  let projected = [];      // { x, y, r, rgb, alpha, tw, ts, tp }
  let constellations = []; // [{ id, lines: [[[ra,dec],...], ...] }]
  let constLines = [];     // projected polylines as [[x,y],[x,y],...]
  let w = 0, h = 0, dpr = 1, cx = 0, cy = 0, scale = 5;

  let targetParallaxX = 0, targetParallaxY = 0;
  let parallaxX = 0, parallaxY = 0;

  /* --- Astronomical math --- */

  const D2R = Math.PI / 180;

  function toJD(date) {
    return date.getTime() / 86400000 + 2440587.5;
  }

  // Greenwich Mean Sidereal Time, degrees.
  function gmstDeg(jd) {
    const d = jd - 2451545.0;
    const T = d / 36525.0;
    let theta =
      280.46061837 +
      360.98564736629 * d +
      0.000387933 * T * T -
      (T * T * T) / 38710000.0;
    theta = ((theta % 360) + 360) % 360;
    return theta;
  }

  function lstDeg(jd, lonDeg) {
    return (((gmstDeg(jd) + lonDeg) % 360) + 360) % 360;
  }

  // Return { alt, az } in radians.
  function altAz(raDeg, decDeg, lstD, latDeg) {
    const HA = (lstD - raDeg) * D2R;
    const dec = decDeg * D2R;
    const lat = latDeg * D2R;
    const sinAlt =
      Math.sin(dec) * Math.sin(lat) +
      Math.cos(dec) * Math.cos(lat) * Math.cos(HA);
    const alt = Math.asin(sinAlt);
    const cosAlt = Math.cos(alt);
    const sinAz = (-Math.sin(HA) * Math.cos(dec)) / cosAlt;
    const cosAz =
      (Math.sin(dec) - Math.sin(lat) * sinAlt) /
      (Math.cos(lat) * cosAlt);
    const az = Math.atan2(sinAz, cosAz);
    return { alt, az };
  }

  // Azimuthal-equidistant projection — zenith at (cx, cy),
  // north at the top. Returns null for stars below the horizon.
  function project(alt, az) {
    if (alt <= 0) return null;
    const r = (Math.PI / 2 - alt) * (180 / Math.PI) * scale;
    return {
      x: cx + r * Math.sin(az),
      y: cy - r * Math.cos(az),
    };
  }

  /* --- Visual helpers --- */

  // B-V colour index → RGB (rough seven-bucket approximation).
  function bvRGB(bv) {
    if (bv < -0.2) return [155, 176, 255];
    if (bv <  0.0) return [190, 208, 255];
    if (bv <  0.3) return [250, 255, 245];
    if (bv <  0.6) return [255, 244, 234];
    if (bv <  0.9) return [255, 222, 180];
    if (bv <  1.3) return [255, 183, 139];
    return [255, 157, 115];
  }

  function starRadius(mag) {
    // Brightest catalog stars ~ mag -1.5 ⇒ r ≈ 2.9
    // Faint cutoff at mag 5.5    ⇒ r ≈ 0.4
    return Math.max(0.35, 2.4 - 0.42 * (mag + 1.5));
  }

  function starAlpha(mag) {
    return Math.max(0.22, Math.min(1, 1.1 - mag * 0.14));
  }

  /* --- Projection pass --- */

  function reproject() {
    const date = new Date();
    const jd = toJD(date);
    const lst = lstDeg(jd, observer.lon);
    projected.length = 0;
    constLines.length = 0;

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const { alt, az } = altAz(s[0], s[1], lst, observer.lat);
      const p = project(alt, az);
      if (!p) continue;
      projected.push({
        x: p.x,
        y: p.y,
        r: starRadius(s[2]),
        rgb: bvRGB(s[3]),
        alpha: starAlpha(s[2]),
        tw: 0.12 + Math.random() * 0.28,
        ts: 0.15 + Math.random() * 0.9,
        tp: Math.random() * Math.PI * 2,
      });
    }

    // Project each constellation stick figure. A segment is only drawn
    // when both of its endpoints are above the horizon — anything
    // crossing the horizon gets cleanly skipped.
    for (let i = 0; i < constellations.length; i++) {
      const c = constellations[i];
      for (let j = 0; j < c.lines.length; j++) {
        const line = c.lines[j];
        for (let k = 0; k < line.length - 1; k++) {
          const a = line[k];
          const b = line[k + 1];
          const pa = altAz(a[0], a[1], lst, observer.lat);
          const pb = altAz(b[0], b[1], lst, observer.lat);
          if (pa.alt <= 0 || pb.alt <= 0) continue;
          const A = project(pa.alt, pa.az);
          const B = project(pb.alt, pb.az);
          if (!A || !B) continue;
          constLines.push([A.x, A.y, B.x, B.y]);
        }
      }
    }
  }

  /* --- Canvas sizing --- */

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width  = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w / 2;
    cy = h / 2;
    // Dome extends to the corners of the viewport.
    scale = Math.hypot(w, h) / 180;
    if (stars.length) reproject();
  }

  /* --- Draw --- */

  function drawSky(t) {
    ctx.clearRect(0, 0, w, h);

    parallaxX += (targetParallaxX - parallaxX) * 0.05;
    parallaxY += (targetParallaxY - parallaxY) * 0.05;

    // Constellations first, behind the stars. Subtle clay lines that
    // read as connective tissue without competing with the starfield.
    if (constLines.length) {
      ctx.lineWidth = 0.65;
      ctx.strokeStyle = "rgba(217, 119, 87, 0.22)";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < constLines.length; i++) {
        const [x1, y1, x2, y2] = constLines[i];
        ctx.moveTo(x1 + parallaxX * 0.35, y1 + parallaxY * 0.35);
        ctx.lineTo(x2 + parallaxX * 0.35, y2 + parallaxY * 0.35);
      }
      ctx.stroke();
    }

    const len = projected.length;
    for (let i = 0; i < len; i++) {
      const s = projected[i];
      const depth = Math.min(1, s.r / 2.4);
      const twinkle = prefersReducedMotion
        ? 0
        : Math.sin(t * 0.001 * s.ts + s.tp) * s.tw;
      const alpha = Math.max(0.08, Math.min(1, s.alpha + twinkle));
      const px = s.x + parallaxX * depth;
      const py = s.y + parallaxY * depth;
      const [r, g, b] = s.rgb;

      ctx.beginPath();
      ctx.arc(px, py, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fill();

      // Soft halo only on brighter stars.
      if (s.r > 1.4) {
        const grad = ctx.createRadialGradient(px, py, 0, px, py, s.r * 3.2);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.32})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.beginPath();
        ctx.arc(px, py, s.r * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
  }

  /* --- Animation loop --- */

  let raf = 0;
  function loop(t) {
    drawSky(t);
    raf = requestAnimationFrame(loop);
  }

  /* --- Boot --- */

  resize();

  // Light placeholder pattern until the real catalog arrives — a few
  // sparse stars so the canvas is not blank on slow networks.
  for (let i = 0; i < 80; i++) {
    projected.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.4 + Math.random() * 1.2,
      rgb: [255, 255, 255],
      alpha: 0.35 + Math.random() * 0.35,
      tw: 0.15,
      ts: 0.4,
      tp: Math.random() * Math.PI * 2,
    });
  }

  if (prefersReducedMotion) {
    drawSky(0);
  } else {
    raf = requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);

  if (!prefersReducedMotion) {
    window.addEventListener(
      "mousemove",
      (e) => {
        targetParallaxX = ((e.clientX / w) - 0.5) * 24;
        targetParallaxY = ((e.clientY / h) - 0.5) * 24;
      },
      { passive: true }
    );
  }

  // Optional: geolocate the user to reproject against their horizon.
  // Silent — no prompt unless we explicitly request it below. We only
  // ask once per visit and fall back to Mexico City.
  function requestGeo() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        observer.lat = pos.coords.latitude;
        observer.lon = pos.coords.longitude;
        observer.label = "Your location";
        if (stars.length) reproject();
      },
      () => {
        /* user denied or unavailable — keep Mexico City */
      },
      { timeout: 6000, maximumAge: 60 * 60 * 1000 }
    );
  }

  // Fetch the star and constellation catalogs in parallel and swap the
  // placeholder for the real sky once stars arrive.
  const fetchJSON = (url) =>
    fetch(url, { cache: "force-cache" }).then((r) =>
      r.ok ? r.json() : Promise.reject(r.status)
    );

  fetchJSON("data/bsc.json")
    .then((data) => {
      stars = data;
      reproject();
      requestGeo();
    })
    .catch(() => {
      // Catalog unavailable — keep the random placeholder.
    });

  fetchJSON("data/constellations.json")
    .then((data) => {
      constellations = data;
      if (stars.length) reproject();
    })
    .catch(() => {
      // Constellation catalog is a nice-to-have — silent failure is OK.
    });

  // Recompute the sky every 10 minutes so an open tab still shows
  // roughly the current star positions.
  setInterval(() => {
    if (stars.length) reproject();
  }, 10 * 60 * 1000);
})();
