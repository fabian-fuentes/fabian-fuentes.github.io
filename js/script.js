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

  /* ---------- Starfield ---------- */
  const canvas = $(".starfield");
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, dpr = 1;
    let stars = [];
    let mouseX = 0, mouseY = 0;
    let targetParallaxX = 0, targetParallaxY = 0;
    let parallaxX = 0, parallaxY = 0;

    // Distribution: ~1 star per 2500 px², capped for very large screens.
    const starDensity = 1 / 2500;
    const maxStars = 420;

    // Stellar palette — mostly white, some blue-white, a few warm gold.
    const palette = [
      { color: [255, 255, 255], weight: 70 }, // white
      { color: [207, 220, 255], weight: 20 }, // blue-white
      { color: [255, 233, 184], weight: 10 }, // warm gold
    ];

    const pickColor = () => {
      const total = palette.reduce((s, p) => s + p.weight, 0);
      let r = Math.random() * total;
      for (const p of palette) {
        if ((r -= p.weight) <= 0) return p.color;
      }
      return palette[0].color;
    };

    const seed = () => {
      const count = Math.min(maxStars, Math.floor(w * h * starDensity));
      stars = [];
      for (let i = 0; i < count; i++) {
        const size = Math.pow(Math.random(), 3) * 2.4 + 0.35;
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: size,
          color: pickColor(),
          // Parallax depth (0 = far, 1 = close). Bigger stars feel closer.
          depth: size / 2.75,
          baseAlpha: 0.45 + Math.random() * 0.45,
          twinkleAmp: 0.15 + Math.random() * 0.35,
          twinkleSpeed: 0.15 + Math.random() * 0.9,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = (t) => {
      ctx.clearRect(0, 0, w, h);

      // Smooth parallax easing
      parallaxX += (targetParallaxX - parallaxX) * 0.05;
      parallaxY += (targetParallaxY - parallaxY) * 0.05;

      for (const s of stars) {
        const alpha = prefersReducedMotion
          ? s.baseAlpha
          : Math.max(
              0.08,
              Math.min(
                1,
                s.baseAlpha +
                  Math.sin(t * 0.001 * s.twinkleSpeed + s.twinklePhase) *
                    s.twinkleAmp
              )
            );

        const px = s.x + parallaxX * s.depth;
        const py = s.y + parallaxY * s.depth;
        const [r, g, b] = s.color;

        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fill();

        // Soft halo for the brighter stars only — cheap and subtle.
        if (s.r > 1.6) {
          const grad = ctx.createRadialGradient(px, py, 0, px, py, s.r * 3);
          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.35})`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.beginPath();
          ctx.arc(px, py, s.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }
      }
    };

    let raf = 0;
    const loop = (t) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    resize();
    if (prefersReducedMotion) {
      draw(0);
    } else {
      raf = requestAnimationFrame(loop);
    }

    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      resize();
      if (prefersReducedMotion) {
        draw(0);
      } else {
        raf = requestAnimationFrame(loop);
      }
    });

    if (!prefersReducedMotion) {
      window.addEventListener(
        "mousemove",
        (e) => {
          mouseX = e.clientX;
          mouseY = e.clientY;
          // Max offset ~12px — keeps the parallax subtle.
          targetParallaxX = ((mouseX / w) - 0.5) * 24;
          targetParallaxY = ((mouseY / h) - 0.5) * 24;
        },
        { passive: true }
      );
    }
  }
})();
