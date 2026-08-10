# v1.0.53 — Responsive Agent Browser & Mobile Tools

Released: August 9, 2026

This release makes the optional Agent Browser behave like a responsive desktop window and brings Agent Browser and SMS controls to mobile layouts.

## Responsive Agent Browser

- Scales the configured remote browser display to the available panel instead of cropping it or leaving oversized gray areas.
- Adds safe viewer defaults for scale-to-fit and automatic connection while preserving deployment-specific URL parameters.
- Keeps viewer configuration in installation settings; no private viewer endpoint or machine-specific value is embedded in the product.
- Uses the full available panel height for the embedded browser and a black viewer background for clean letterboxing.

## Desktop window controls

- Makes the Agent Browser draggable from its top banner, excluding interactive buttons and form controls.
- Adds resize targets on all four edges and all four corners.
- Constrains moving and resizing to the usable viewport and adapts minimum dimensions when the viewport is smaller than the desktop minimum.
- Adds maximize and restore controls, including double-clicking the banner, and restores the exact pre-maximized geometry.
- Prevents the embedded iframe from capturing the pointer during an active drag or resize gesture.

## Mobile Agent Browser and SMS

- Keeps Agent Browser, SMS, and Settings visible in the mobile top toolbar while hiding the nonessential license chip at compact widths.
- Presents Agent Browser as a compact, touch-friendly 16:9 viewer within the mobile viewport.
- Presents SMS as a full-height mobile sheet with touch-sized close, thread, compose, and Send controls.
- Adds accessible button labels and dialog relationships to the Browser and SMS panels.

## Regression coverage

- Adds unit coverage for viewer URL parsing, default parameters, fragments, relative routes, explicit overrides, and safe blank URLs.
- Adds geometry coverage for viewport constraints, dragging, minimum sizes, invalid directions, and every resize edge and corner.
- Extends the public smoke suite to require the new window controller, responsive assets, mobile toolbar contract, and panel controls.

## Verification

- Passed the public smoke and packaging suite, 35 Provider SDK backend tests, and 14 endpoint-resolution tests.
- Verified desktop drag, right-edge resize, maximize, restore, and scaled embedded-browser behavior on the local product deployment; automated geometry tests cover every edge and corner.
- Verified Agent Browser, SMS, and Settings visibility and touch sizing at a 390 × 844 mobile viewport.
- Rebuilt and health-checked a separate clean Docker install from the pushed GitHub source before publishing the release.

## Upgrade notes

No manual migration or configuration change is required. Existing Agent Browser viewer URLs remain installation-owned and keep any explicitly configured query parameters. Saved worlds, licensing state, provider settings, SMS credentials, and other persistent data are unchanged.
