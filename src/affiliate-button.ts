function updateAffiliateButton() {
  const button = document.querySelector<HTMLAnchorElement>(".track-price-button");
  if (!button) return;

  // Only mutate the button when it has not already been converted.
  // This avoids the MutationObserver reacting to its own DOM changes forever.
  if (button.dataset.affiliateReady === "true") return;
  button.dataset.affiliateReady = "true";

  // Keep the old Track price button styling/position, but show the new affiliate action.
  button.textContent = "Affiliate link ↗";
  button.setAttribute("href", "#");
  button.removeAttribute("target");
  button.removeAttribute("rel");
  button.setAttribute("role", "button");
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("title", "Affiliate link coming soon");

  button.addEventListener("click", (event) => {
    if (button.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
}

const affiliateButtonObserver = new MutationObserver(() => {
  const button = document.querySelector<HTMLAnchorElement>(".track-price-button");
  if (button && button.dataset.affiliateReady !== "true") {
    updateAffiliateButton();
  }
});
affiliateButtonObserver.observe(document.documentElement, { childList: true, subtree: true });
updateAffiliateButton();
