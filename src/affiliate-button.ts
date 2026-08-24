function updateAffiliateButton() {
  const button = document.querySelector<HTMLAnchorElement>(".track-price-button");
  if (!button) return;

  button.textContent = "Affiliate link ↗";
  button.removeAttribute("href");
  button.removeAttribute("target");
  button.removeAttribute("rel");
  button.setAttribute("role", "button");
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("title", "Affiliate link will be enabled when an affiliate URL is added for this product.");

  if (button.dataset.affiliateBound === "true") return;
  button.dataset.affiliateBound = "true";
  button.addEventListener("click", (event) => {
    if (button.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
}

const observer = new MutationObserver(updateAffiliateButton);
observer.observe(document.documentElement, { childList: true, subtree: true });
updateAffiliateButton();
