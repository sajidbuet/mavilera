# content/pip/ — Pip, the book's mascot

Pip character design and artwork © Sajid Muhaimin Choudhury. All rights reserved. Not covered by the code licence.

Rights class: pip. The author reserves the copyright in Pip's design and
drawings and in the name *Pip's RISC-V Lab* (spec W-D13). A fork of the code
must remove this folder, every use of Pip and the name.

Rules (spec §9.3, WS-U-040–045):
- Only artwork the author has approved for release, taken from the book
  repository's `resources/mascot/pip/` pipeline and drawn to its
  `PIP_CHARACTER_DESIGN_GUIDE.md`. Never draw, trace, modify or generate Pip
  here; a new pose or the logo is made in that pipeline first.
- Every asset is listed in `ASSETS.md` (file, source path in the book
  repository, approval date). SVG files also carry the line above in a
  comment. `npm test` fails on an unlisted asset or on Pip artwork outside
  this folder.
- Pip appears in the logo and the interface only, never inside a datapath,
  FSM, pipeline diagram, table or export, and can be switched off.
