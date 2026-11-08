---
'@image-aware/editor': patch
---

`--open` no longer crashes the editor when there's no browser opener to run.
On WSL, a bare Linux box or a container, `xdg-open` is missing, and the
unhandled spawn error took the whole server down with it. Now the editor says
it couldn't open a browser, prints the URL to go to, and keeps serving.
