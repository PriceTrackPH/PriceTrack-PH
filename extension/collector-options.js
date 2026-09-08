(function installCollectorOptions(global) {
  global.PriceTrackCollectorOptions = {
    skipUnchangedDayFromUrl(value) {
      try {
        return new URL(value).searchParams.get("ptph_skip_unchanged") === "1";
      } catch {
        return false;
      }
    },
    skipSoldOutFromUrl(value) {
      try {
        return new URL(value).searchParams.get("ptph_skip_sold_out") !== "0";
      } catch {
        return true;
      }
    },
  };
})(globalThis);
