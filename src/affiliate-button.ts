function updateAffiliateButton() {
  const button = document.querySelector<HTMLAnchorElement>(".track-price-button");
  if (!button) return;

  // Keep the old Track price button styling/position, but show the new affiliate action.
  button.textContent = "Affiliate link ↗";
  button.setAttribute("href", "#");
  button.removeAttribute("target");
  button.removeAttribute("rel");
  button.setAttribute("role", "button");
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("title", "Affiliate link coming soon");

  if (button.dataset.affiliateBound === "true") return;
  button.dataset.affiliateBound = "true";
  button.addEventListener("click", (event) => {
    if (button.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
}

const affiliateButtonObserver = new MutationObserver(updateAffiliateButton);
affiliateButtonObserver.observe(document.documentElement, { childList: true, subtree: true });
updateAffiliateButton();
