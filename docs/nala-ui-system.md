# Nala UI system

This is the shared presentation contract for Nala Labs and Nala Trace, informed by [BoardUI](https://www.boardui.com/). Each frontend owns an identical copy of `src/nala-ui.css` and `src/ThemeToggle.jsx`; neither app depends on the other at runtime. Update both copies together when changing the contract.

The visual direction is a calm operational workspace: ENERGY 1, RHYTHM 2, MOTION 1. Labs emphasizes resource access and account capacity. Trace emphasizes captured records and the evidence within a session. Existing product identities, authentication and data contracts remain intact.

| Decision | Rule and reason |
| --- | --- |
| Canvas and surfaces | Cool neutral canvas, solid raised surfaces and subtle inset surfaces separate navigation, working area and dense evidence without decoration. |
| Accent | Blue identifies the primary action, selection and focus. Status colors communicate recorded success, warning or failure alongside text. |
| Type | Inter with native system fallbacks keeps forms and dense records readable. Monospace is reserved for identifiers, commands and captured data. Headings use the same family at 24–32px rather than competing display typography. |
| Spacing | A 4px base with 8/12/16/24/32px steps separates control groups, cards and page sections. Dense records retain their useful information. |
| Shape | 6px controls, 10px cards and 14px dialogs distinguish component scale. Status labels may use a compact rounded shape; entire pages do not become pills. |
| Elevation | Cards use a contact shadow; floating menus use a broader shadow to communicate overlap. No ambient glow or background ornament. |
| Controls | Native buttons, links, selects and disclosure elements retain keyboard behavior. Enabled controls have pointer, hover, active and visible focus states; touch targets are at least 44px. |
| Content | Metrics come from the current account or captured records. Unconnected resource provisioning is named explicitly rather than illustrated with fabricated infrastructure. |
| Themes | Light and dark use the same semantic roles. The first visit follows the system setting; an explicit choice persists in localStorage under `nala-ui-theme` for that origin. Storage restrictions do not block the app. Separate origins store choices independently. |
| Motion | Only short interaction feedback. Reduced-motion preferences suppress nonessential transitions and animation. |
| Responsive behavior | Pages reflow at narrow widths, long identifiers wrap or scroll inside their own data region, controls remain reachable, and content never forces the page wider than the viewport. |

## Component vocabulary

Use `--nala-*` tokens from `nala-ui.css` for new surfaces and components. Product styles may alias existing token names to these roles while preserving their component structure. Never embed a raw light-only color in a theme-sensitive component.

- Primary actions: accent fill and on-accent text; secondary actions: solid surface and visible control border.
- Navigation: current location has a blue selected state plus an explicit current/pressed indicator.
- Cards and lists: a solid surface with one border; headings and action groups stay aligned. Rows highlight on hover and retain readable metadata.
- Forms: visible labels, contrasting field boundaries, pending/disabled feedback and adjacent error text.
- Menus and dialogs: elevated surfaces, keyboard dismissal and focus restoration. No misleading provisioning action when a service is unconnected.
- Evidence: preserve existing trace, tool, metadata and evaluation semantics; distinguish user input, assistant output and system events with labels as well as surface treatment.
- Empty, loading and error states: name what is happening and the available next action. Never replace a failed API with demo records.

## Review boundary

Compare both products at desktop and 390px mobile widths, in both themes. Exercise normal navigation and every changed control, including theme persistence, keyboard focus, Escape dismissal, search/filter/sort and trace disclosures. Component tests and builds are regression evidence; live authentication and saved-record acceptance require the real services.
