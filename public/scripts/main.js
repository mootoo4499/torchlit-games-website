// scripts/main.js

document.addEventListener("DOMContentLoaded", () => {
  /* ── Menu toggle ── */
  const menuToggle = document.getElementById("menu-toggle");
  const menuOverlay = document.getElementById("menu-overlay");

  if (menuToggle && menuOverlay) {
    const closeMenu = () => {
      menuOverlay.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuOverlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    };

    menuToggle.addEventListener("click", () => {
      const isOpen = menuOverlay.classList.toggle("is-open");
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuOverlay.setAttribute("aria-hidden", String(!isOpen));
      document.body.style.overflow = isOpen ? "hidden" : "";
    });

    menuOverlay.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

    // Close on clicking outside the links (clicking the overlay background itself)
    menuOverlay.addEventListener("click", (e) => {
      if (e.target === menuOverlay) closeMenu();
    });

    // Close on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menuOverlay.classList.contains("is-open")) {
        closeMenu();
      }
    });
  }

  /* ── Lightbox ── */
  const lightbox = document.getElementById("lightbox");
  const joinBtns = document.querySelectorAll(".js-join-btn");
  const closeBtn = document.getElementById("lightbox-close");
  const form = document.getElementById("lightbox-form");
  const thanks = document.getElementById("lightbox-thanks");

  if (lightbox) {
    joinBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        lightbox.classList.add("is-open");
        document.body.style.overflow = "hidden";

        // Reset form sequence on re-open
        if (form && thanks) {
          form.style.display = "flex";
          form.reset();
          thanks.style.display = "none";
        }
      });
    });

    const closeLightbox = () => {
      lightbox.classList.remove("is-open");
      document.body.style.overflow = "";
    };

    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });

    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        form.style.display = "none";
        if (thanks) thanks.style.display = "block";
      });
    }
  }

  /* ── Scroll Reveals (Intersection Observer) ── */
  const revealElements = document.querySelectorAll(".reveal");

  if (revealElements.length > 0) {
    const revealCallback = (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target); // Optional: only animate once
        }
      });
    };

    const revealOptions = {
      root: null,
      rootMargin: "0px 0px -10% 0px", // Trigger slightly before it comes into view
      threshold: 0.1,
    };

    const revealObserver = new IntersectionObserver(
      revealCallback,
      revealOptions,
    );
    revealElements.forEach((el) => revealObserver.observe(el));
  }
});
