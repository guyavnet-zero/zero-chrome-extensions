import { test, expect } from "./extension-fixture";

test.describe("Connect drill sidebar (extension)", () => {
  test("Dashboard (Beta) is last row after Device Posture", async ({ context }) => {
    const portalUrl = process.env.PORTAL_URL;
    test.skip(
      !portalUrl,
      "Set PORTAL_URL to your portal, e.g. PORTAL_URL=https://admin.zeronetworks.com/#/connect/sessions"
    );

    const page = await context.newPage();
    await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });

    const drill = page.locator(".zn-sidebar .zn-main-drill-down__content").first();
    await drill.waitFor({ state: "visible", timeout: 60_000 });

    const result = await page.evaluate(() => {
      const drillEl = document.querySelector(".zn-sidebar .zn-main-drill-down__content");
      if (!drillEl) return { ok: false, reason: "no .zn-main-drill-down__content in sidebar" };

      const anchors = drillEl.querySelectorAll(
        'a[href*="device-posture"], a[href*="device_posture"], a[href*="DevicePosture"]'
      );
      const postureA = anchors.length ? anchors[anchors.length - 1] : null;
      const btn = document.getElementById("zn-dashboard-beta-button");
      if (!postureA) return { ok: false, reason: "no Device Posture link in drill list" };
      if (!btn) return { ok: false, reason: "no #zn-dashboard-beta-button (extension not loaded?)" };

      const wrap = btn.closest("[data-zn-dashboard-beta-item]");
      if (!wrap) {
        return {
          ok: false,
          reason:
            "button is not inside [data-zn-dashboard-beta-item] — extension wrapper missing (Chrome often shows wrong order in this state)",
        };
      }

      const postureRow =
        postureA.closest(".zn-main-drill-down__content__item") || postureA.closest(".zn-sidebar-item");
      const betaRow = wrap;

      if (!postureRow) {
        return { ok: false, reason: "could not resolve Device Posture row container" };
      }

      const rows = Array.prototype.filter.call(drillEl.children, function (c) {
        return (
          c.nodeType === Node.ELEMENT_NODE &&
          c.matches &&
          c.matches(".zn-main-drill-down__content__item")
        );
      });
      if (!rows.length) return { ok: false, reason: "no drill item rows under __content" };
      if (rows[rows.length - 1] !== wrap) {
        return {
          ok: false,
          reason: "Dashboard (Beta) wrapper is not the last .zn-main-drill-down__content__item",
          lastRowClass: rows[rows.length - 1].className,
        };
      }

      const pr = postureRow.getBoundingClientRect();
      const br = betaRow.getBoundingClientRect();
      if (!(pr.top < br.top - 2)) {
        return {
          ok: false,
          reason: "Device Posture is not above Dashboard (Beta) vertically",
          postureTop: pr.top,
          betaTop: br.top,
        };
      }
      return { ok: true as const };
    });

    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true);
    await page.close();
  });
});
